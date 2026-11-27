import http from 'node:http';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { config } from './lib/config.mjs';
import { signMedia } from './lib/media.mjs';
import { createPool, migrate, getSetting, setSetting, todayUsage, tx } from './lib/db.mjs';
import { createTask, decide, retry, cancel, officeState, createEpisodeTask } from './lib/engine.mjs';
import { buildAuthorizationUrl, completeOAuth, oauthConfiguration } from './social-oauth.mjs';
import { listElevenVoices, narrationVoices } from './lib/ai.mjs';
import { activeConversations, GROUP } from './lib/social.mjs';
import PERSONNEL from '../shared/personnel.json' with { type: 'json' };

const pool = createPool(Number(process.env.DB_POOL_MAX || 6));
const COOKIE = 'ls_office_session';
const MAX_BODY = 65536;
const hash = (v) => createHash('sha256').update(v).digest('hex');
const equal = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const SECURITY = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' };
const json = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...SECURITY }); res.end(JSON.stringify(data)); };
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

async function body(req) {
  let raw = '';
  for await (const c of req) { raw += c; if (Buffer.byteLength(raw) > MAX_BODY) throw Object.assign(new Error('Body too large'), { status: 413 }); }
  try { return raw ? JSON.parse(raw) : {}; } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}
function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map((v) => v.trim()).filter(Boolean).map((v) => { const i = v.indexOf('='); return [v.slice(0, i), decodeURIComponent(v.slice(i + 1))]; })); }
function setSessionCookie(res, value, maxAge) { res.setHeader('Set-Cookie', `${COOKIE}=${value ? encodeURIComponent(value) : ''}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${value ? maxAge : 0}`); }
function checkOrigin(req) { const origin = req.headers.origin; if (!origin) return true; try { const host = new URL(origin).host; return host === req.headers.host || host === (req.headers.host || '').split(':')[0]; } catch { return false; } }
const clientIp = (req) => String(req.headers['x-real-ip'] || req.socket.remoteAddress || '?');

/* Login throttling: 8 failed attempts per IP per 15 minutes. */
const attempts = new Map();
function throttled(ip) { const a = attempts.get(ip); return a && a.n >= 8 && Date.now() - a.first < 900000; }
function recordFailure(ip) { const a = attempts.get(ip); if (!a || Date.now() - a.first > 900000) attempts.set(ip, { n: 1, first: Date.now() }); else a.n++; }

async function authenticate(req) {
  const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
  if (config.adminToken && bearer && equal(bearer, config.adminToken)) return { legacy: true };
  const token = cookies(req)[COOKIE];
  if (!token || token.length < 40) return null;
  const r = await pool.query('UPDATE director_sessions SET last_seen_at=now() WHERE token_hash=$1 AND expires_at>now() RETURNING token_hash', [hash(token)]);
  return r.rowCount ? { legacy: false, tokenHash: r.rows[0].token_hash } : null;
}

async function streamFile(req, res, file, mime, downloadName = null) {
  const root = path.resolve(config.mediaRoot);
  const legacyRoot = '/opt/ls-office/storage/videos';
  if (!file || !(file.startsWith(root + path.sep) || file.startsWith(legacyRoot + path.sep))) return json(res, 403, { error: 'Invalid media path' });
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return json(res, 404, { error: 'File tidak ditemukan' });
  const headers = { 'content-type': mime || 'video/mp4', 'accept-ranges': 'bytes', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
  if (downloadName) headers['content-disposition'] = `attachment; filename="${path.basename(downloadName).replace(/[^a-zA-Z0-9._-]/g, '_')}"`;
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : info.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : info.size - 1;
    if (start >= info.size || start > end) { res.writeHead(416, { 'content-range': `bytes */${info.size}` }); return res.end(); }
    end = Math.min(end, info.size - 1);
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${info.size}`, 'content-length': end - start + 1 });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'content-length': info.size });
  if (req.method === 'HEAD') return res.end();
  return createReadStream(file).pipe(res);
}

const PUBLIC_STATE = (s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { state: v.state }]));

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const route = url.pathname;
    const method = req.method;

    /* ------------------------------------------------------------ public */
    if (route === '/api/health' && method === 'GET') return json(res, 200, { ok: true, service: 'ls-office-api' });
    if (route === '/api/auth/login' && method === 'POST') {
      if (!checkOrigin(req)) return json(res, 403, { error: 'Origin not allowed' });
      const ip = clientIp(req);
      if (throttled(ip)) return json(res, 429, { error: 'Terlalu banyak percobaan login. Coba lagi 15 menit lagi.' });
      const b = await body(req);
      if (!config.adminToken || typeof b.token !== 'string' || !equal(b.token, config.adminToken)) { recordFailure(ip); return json(res, 401, { error: 'Invalid Director credential' }); }
      attempts.delete(ip);
      const raw = randomBytes(32).toString('base64url');
      const expires = new Date(Date.now() + config.sessionDays * 86400000);
      await pool.query('INSERT INTO director_sessions(token_hash,expires_at) VALUES($1,$2)', [hash(raw), expires]);
      setSessionCookie(res, raw, config.sessionDays * 86400);
      return json(res, 200, { ok: true, expiresAt: expires.toISOString() });
    }
    if (route === '/api/auth/session' && method === 'GET') {
      const s = await authenticate(req);
      return json(res, 200, { authenticated: Boolean(s) });
    }
    // nginx auth_request for /preview/ (web dev previews are Director-only).
    if (route === '/api/auth/check') { const s = await authenticate(req); res.writeHead(s ? 204 : 401, SECURITY); return res.end(); }
    if (route === '/api/auth/logout' && method === 'POST') {
      if (!checkOrigin(req)) return json(res, 403, { error: 'Origin not allowed' });
      const token = cookies(req)[COOKIE];
      if (token) await pool.query('DELETE FROM director_sessions WHERE token_hash=$1', [hash(token)]);
      setSessionCookie(res, '', 0);
      return json(res, 200, { ok: true });
    }
    if (route === '/api/office/public' && method === 'GET') return json(res, 200, { state: PUBLIC_STATE(await officeState(pool)), conversations: await activeConversations(pool, false) });
    const pub = route.match(new RegExp(`^/api/public/media/(${UUID})$`));
    if (pub && (method === 'GET' || method === 'HEAD')) {
      const exp = Number(url.searchParams.get('exp'));
      const sig = url.searchParams.get('sig') || '';
      if (!exp || exp < Date.now() / 1000 || !equal(sig, signMedia(pub[1], exp))) return json(res, 403, { error: 'Link expired' });
      const q = await pool.query('SELECT t.artifact_path,t.artifact_mime FROM publication_jobs j JOIN tasks t ON t.id=j.task_id WHERE j.id=$1', [pub[1]]);
      if (!q.rowCount) return json(res, 404, { error: 'Not found' });
      return streamFile(req, res, q.rows[0].artifact_path, q.rows[0].artifact_mime);
    }
    const socialCallback = route.match(/^\/api\/social\/(instagram|facebook|tiktok|youtube)\/callback$/);
    if (socialCallback && method === 'GET') {
      const sessionToken = cookies(req)[COOKIE];
      const session = await authenticate(req);
      const back = (q) => { res.writeHead(303, { location: '/?' + q, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }); res.end(); };
      if (!session || !sessionToken) return back('social=error&reason=' + encodeURIComponent('Login Director dulu sebelum menghubungkan akun'));
      const providerError = url.searchParams.get('error');
      if (providerError) return back('social=error&reason=' + encodeURIComponent(providerError.slice(0, 100)));
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code || !state || code.length > 4096 || state.length > 256) return back('social=error&reason=invalid_callback');
      try { await completeOAuth(pool, socialCallback[1], code, state, hash(sessionToken)); } catch (e) { console.error('oauth', e.message); return back('social=error&reason=' + encodeURIComponent(e.message.slice(0, 160))); }
      await pool.query("UPDATE publication_jobs j SET status='scheduled',account_id=a.id,updated_at=now() FROM social_accounts a WHERE j.status='awaiting_connection' AND a.platform=j.platform AND a.status='connected'");
      return back('social=connected');
    }

    /* ------------------------------------------------------------ Director only */
    const session = await authenticate(req);
    if (!session) return json(res, 401, { error: 'Unauthorized' });
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !checkOrigin(req)) return json(res, 403, { error: 'Origin not allowed' });

    if (route === '/api/employees' && method === 'GET') {
      return json(res, 200, { employees: PERSONNEL.map(({ prompt, ...p }) => ({ id: p.key, ...p })) });
    }
    if (route === '/api/office' && method === 'GET') return json(res, 200, { state: await officeState(pool), conversations: await activeConversations(pool, true) });
    if (route === '/api/overview' && method === 'GET') {
      const c = await pool.query('SELECT status,count(*)::int AS count FROM tasks GROUP BY status');
      const r = await pool.query('SELECT e.id,e.task_id AS "taskId",e.event_type AS type,e.created_at AS "createdAt",t.title FROM task_events e LEFT JOIN tasks t ON t.id=e.task_id ORDER BY e.created_at DESC LIMIT 15');
      const usage = await todayUsage(pool);
      const unread = await pool.query("SELECT count(*)::int AS n FROM notifications WHERE read_at IS NULL AND kind<>'chat'");
      return json(res, 200, { counts: Object.fromEntries(c.rows.map((x) => [x.status, x.count])), recent: r.rows, usage: { ...usage, budget: config.dailyBudgetUsd, maxRuns: config.maxDailyRuns }, unread: unread.rows[0].n });
    }
    if (route === '/api/usage' && method === 'GET') {
      const days = await pool.query(`SELECT to_char(date_trunc('day', created_at AT TIME ZONE $1),'YYYY-MM-DD') AS day, kind, round(sum(cost_usd)::numeric,4)::float AS cost, count(*)::int AS calls FROM usage_ledger WHERE created_at > now()-interval '14 days' GROUP BY 1,2 ORDER BY 1 DESC,2`, [config.timezone]);
      const perTask = await pool.query(`SELECT t.id,t.title,round(sum(u.cost_usd)::numeric,4)::float AS cost FROM usage_ledger u JOIN tasks t ON t.id=u.task_id WHERE u.created_at > now()-interval '14 days' GROUP BY 1,2 ORDER BY 3 DESC LIMIT 15`);
      return json(res, 200, { days: days.rows, tasks: perTask.rows, budget: config.dailyBudgetUsd, note: 'Estimasi berdasarkan tarif publik; tagihan resmi ada di dashboard provider.' });
    }

    /* tasks */
    if (route === '/api/tasks' && method === 'GET') {
      const q = await pool.query(`SELECT t.id,t.title,t.status,t.task_type,t.priority,t.assignee_id,t.created_at,t.updated_at,t.artifact_name,t.revision_count,e.name AS assignee_name,
          (SELECT json_build_object('key',s.step_key,'title',s.title,'status',s.status,'assignee',s.assignee_id) FROM workflow_steps s WHERE s.task_id=t.id AND s.status IN ('running','awaiting_approval','failed','pending') ORDER BY s.step_order LIMIT 1) AS current_step,
          (SELECT count(*)::int FROM workflow_steps s WHERE s.task_id=t.id) AS steps_total,
          (SELECT count(*)::int FROM workflow_steps s WHERE s.task_id=t.id AND s.status IN ('completed','skipped')) AS steps_done
        FROM tasks t JOIN employees e ON e.id=t.assignee_id ORDER BY t.updated_at DESC LIMIT 100`);
      return json(res, 200, { tasks: q.rows });
    }
    if (route === '/api/tasks' && method === 'POST') {
      const b = await body(req);
      const task = await createTask(pool, { ...b, source: 'web' });
      return json(res, 201, { task });
    }
    const m = route.match(new RegExp(`^/api/tasks/(${UUID})(?:/(approval|video|retry|cancel))?$`, 'i'));
    if (m && method === 'GET' && !m[2]) {
      const t = await pool.query('SELECT t.*,e.name AS assignee_name FROM tasks t JOIN employees e ON e.id=t.assignee_id WHERE t.id=$1', [m[1]]);
      if (!t.rowCount) return json(res, 404, { error: 'Task not found' });
      const [runs, steps, jobs, events, cost, project] = await Promise.all([
        pool.query('SELECT id,status,output_text,error_message,started_at,finished_at,cost_usd::float AS cost,executor,step_id FROM task_runs WHERE task_id=$1 ORDER BY attempt DESC LIMIT 30', [m[1]]),
        pool.query('SELECT s.id,s.step_order,s.step_key,s.title,s.status,s.requires_approval,s.output_text,s.output_json,s.decision,s.revision_notes,s.attempts,s.started_at,s.finished_at,s.assignee_id,s.executor,e.name AS assignee_name FROM workflow_steps s LEFT JOIN employees e ON e.id=s.assignee_id WHERE s.task_id=$1 ORDER BY s.step_order', [m[1]]),
        pool.query('SELECT id,platform,status,caption,hashtags,title,scheduled_at,post_url,error_message,attempts,published_at FROM publication_jobs WHERE task_id=$1 ORDER BY platform', [m[1]]),
        pool.query('SELECT event_type AS type,payload,created_at FROM task_events WHERE task_id=$1 ORDER BY created_at DESC LIMIT 40', [m[1]]),
        pool.query('SELECT round(COALESCE(sum(cost_usd),0)::numeric,4)::float AS cost FROM usage_ledger WHERE task_id=$1', [m[1]]),
        t.rows[0].project_id ? pool.query('SELECT id,slug,name FROM dev_projects WHERE id=$1', [t.rows[0].project_id]) : { rows: [] },
      ]);
      const task = t.rows[0];
      delete task.artifact_path;
      task.has_video = Boolean(t.rows[0].artifact_name && task.task_type === 'animated_video');
      return json(res, 200, { task, runs: runs.rows, workflowSteps: steps.rows, publicationJobs: jobs.rows, events: events.rows, cost: cost.rows[0].cost, project: project.rows[0] || null });
    }
    if (m && m[2] === 'video' && (method === 'GET' || method === 'HEAD')) {
      const q = await pool.query('SELECT artifact_path,artifact_mime,artifact_name FROM tasks WHERE id=$1 AND artifact_path IS NOT NULL', [m[1]]);
      if (!q.rowCount) return json(res, 404, { error: 'Video belum tersedia' });
      return streamFile(req, res, q.rows[0].artifact_path, q.rows[0].artifact_mime, url.searchParams.get('download') ? q.rows[0].artifact_name : null);
    }
    if (m && m[2] === 'approval' && method === 'POST') {
      const b = await body(req);
      return json(res, 200, await decide(pool, m[1], b.decision, b));
    }
    if (m && m[2] === 'retry' && method === 'POST') return json(res, 200, await retry(pool, m[1]));
    if (m && m[2] === 'cancel' && method === 'POST') return json(res, 200, await cancel(pool, m[1]));

    /* story series */
    if (route === '/api/series' && method === 'GET') {
      const q = await pool.query(`SELECT s.id,s.title,s.logline,s.total_parts,s.status,s.created_at,s.voice_id,s.voice_name,
          COALESCE((SELECT json_agg(json_build_object('id',t.id,'part',t.part_no,'title',t.title,'status',t.status) ORDER BY t.part_no) FROM tasks t WHERE t.series_id=s.id AND t.task_type='story_episode' AND t.status NOT IN ('cancelled','rejected')),'[]') AS parts
        FROM series s ORDER BY s.created_at DESC LIMIT 30`);
      return json(res, 200, { series: q.rows });
    }
    if (route === '/api/voices' && method === 'GET') {
      if (config.ttsProvider !== 'elevenlabs') return json(res, 200, { provider: config.ttsProvider, voices: [] });
      const all = await listElevenVoices();
      return json(res, 200, { provider: 'elevenlabs', voices: narrationVoices(all).map((v) => ({ id: v.id, name: v.name, labels: v.labels, description: v.description })) });
    }
    const sv = route.match(new RegExp(`^/api/series/(${UUID})/voice$`));
    if (sv && method === 'POST') {
      const b = await body(req);
      const v = (await listElevenVoices()).find((x) => x.id === b.voiceId);
      if (!v) return json(res, 400, { error: 'Suara tidak ditemukan di akun ElevenLabs' });
      await pool.query('UPDATE series SET voice_id=$2,voice_name=$3,updated_at=now() WHERE id=$1', [sv[1], v.id, v.name]);
      return json(res, 200, { ok: true, voice: v.name });
    }
    const sr = route.match(new RegExp(`^/api/series/(${UUID})/(next|pause|resume)$`));
    if (sr && method === 'POST') {
      if (sr[2] !== 'next') {
        await pool.query('UPDATE series SET status=$2,updated_at=now() WHERE id=$1', [sr[1], sr[2] === 'pause' ? 'paused' : 'active']);
        return json(res, 200, { ok: true });
      }
      const out = await tx(pool, async (c) => {
        const s = (await c.query('SELECT * FROM series WHERE id=$1 FOR UPDATE', [sr[1]])).rows[0];
        if (!s) throw Object.assign(new Error('Seri tidak ditemukan'), { status: 404 });
        const last = (await c.query("SELECT COALESCE(max(part_no),0)::int AS n FROM tasks WHERE series_id=$1 AND task_type='story_episode' AND status NOT IN ('cancelled','rejected')", [s.id])).rows[0].n;
        if (last >= s.total_parts) throw Object.assign(new Error('Semua part sudah dibuat'), { status: 409 });
        return createEpisodeTask(c, s, last + 1);
      });
      return json(res, 200, { ok: true, task: out });
    }

    /* publications */
    const pj = route.match(new RegExp(`^/api/publications/(${UUID})/(retry|cancel|now)$`));
    if (pj && method === 'POST') {
      const to = pj[2] === 'cancel' ? "status='cancelled'" : pj[2] === 'now' ? "status=CASE WHEN account_id IS NULL THEN 'awaiting_connection' ELSE 'scheduled' END,scheduled_at=now()" : "status=CASE WHEN account_id IS NULL THEN 'awaiting_connection' ELSE 'scheduled' END,attempts=0,error_message=NULL,next_attempt_at=NULL";
      const allowed = pj[2] === 'retry' ? "('failed')" : "('awaiting_connection','scheduled','failed')";
      const r = await pool.query(`UPDATE publication_jobs SET ${to},updated_at=now() WHERE id=$1 AND status IN ${allowed} RETURNING status`, [pj[1]]);
      if (!r.rowCount) return json(res, 409, { error: 'Status posting tidak bisa diubah' });
      return json(res, 200, { ok: true, status: r.rows[0].status });
    }
    if (route === '/api/publications' && method === 'GET') {
      const q = await pool.query("SELECT j.id,j.platform,j.status,j.scheduled_at,j.published_at,j.post_url,j.error_message,t.id AS task_id,t.title FROM publication_jobs j JOIN tasks t ON t.id=j.task_id WHERE j.status<>'cancelled' ORDER BY COALESCE(j.scheduled_at,j.created_at) DESC LIMIT 50");
      return json(res, 200, { jobs: q.rows });
    }

    /* notifications */
    if (route === '/api/notifications' && method === 'GET') {
      const q = await pool.query("SELECT n.id,n.task_id AS \"taskId\",n.employee_id AS \"employeeId\",n.kind,n.title,n.body,n.action,n.created_at AS \"createdAt\",n.read_at AS \"readAt\" FROM notifications n WHERE n.kind<>'chat' ORDER BY (n.read_at IS NULL) DESC, n.created_at DESC LIMIT 40");
      return json(res, 200, { notifications: q.rows });
    }
    if (route === '/api/notifications/read' && method === 'POST') {
      const b = await body(req);
      if (b.all) await pool.query("UPDATE notifications SET read_at=now() WHERE read_at IS NULL AND kind NOT IN ('approval')");
      else if (Array.isArray(b.ids)) await pool.query('UPDATE notifications SET read_at=now() WHERE id = ANY($1::bigint[]) AND read_at IS NULL', [b.ids.map(Number).filter(Number.isFinite)]);
      return json(res, 200, { ok: true });
    }

    /* chat */
    if (route === '/api/chat' && method === 'GET') {
      const q = await pool.query("SELECT DISTINCT ON (thread) thread,sender,body,created_at FROM messages WHERE created_at <= now() ORDER BY thread,created_at DESC");
      const pending = await pool.query("SELECT thread,count(*)::int AS n FROM messages WHERE status='pending' GROUP BY thread");
      return json(res, 200, { threads: q.rows, pending: Object.fromEntries(pending.rows.map((r) => [r.thread, r.n])) });
    }
    const chat = route.match(/^\/api\/chat\/([a-z]{2,20})$/);
    if (chat && (chat[1] === GROUP || PERSONNEL.some((p) => p.key === chat[1]))) {
      if (method === 'GET') {
        const q = await pool.query('SELECT id,sender,body,channel,status,meta,created_at FROM messages WHERE thread=$1 AND created_at <= now() ORDER BY created_at DESC, id DESC LIMIT 80', [chat[1]]);
        return json(res, 200, { messages: q.rows.reverse() });
      }
      if (method === 'POST') {
        const b = await body(req);
        const text = String(b.body || '').trim();
        if (!text || text.length > 4000) return json(res, 400, { error: 'Pesan kosong atau terlalu panjang' });
        const r = await pool.query("INSERT INTO messages(thread,sender,body,channel,status) VALUES($1,'director',$2,'web','pending') RETURNING id,created_at", [chat[1], text]);
        return json(res, 201, { message: r.rows[0] });
      }
    }

    /* social */
    const socialConnect = route.match(/^\/api\/social\/(instagram|facebook|tiktok|youtube)\/connect$/);
    if (socialConnect && method === 'GET') {
      const platform = ['instagram', 'facebook'].includes(socialConnect[1]) ? 'facebook' : socialConnect[1];
      if (!oauthConfiguration(platform) || !process.env.SOCIAL_TOKEN_ENCRYPTION_KEY) return json(res, 503, { error: 'OAuth provider and token-encryption configuration are required' });
      const sessionToken = cookies(req)[COOKIE];
      if (!sessionToken) return json(res, 401, { error: 'Director session required' });
      const state = randomBytes(32).toString('base64url');
      await pool.query("INSERT INTO social_oauth_states(state_hash,platform,session_hash,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')", [hash(state), platform, hash(sessionToken)]);
      res.writeHead(302, { location: await buildAuthorizationUrl(platform, state), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
      return res.end();
    }
    if (route === '/api/social/accounts' && method === 'GET') {
      const connected = await pool.query('SELECT id,platform,external_account_id AS "accountId",account_name AS "accountName",status,scopes,token_expires_at AS "tokenExpiresAt",connected_at AS "connectedAt" FROM social_accounts ORDER BY platform,account_name');
      const requirements = {
        instagram: ['Meta Developer App', 'Akun Instagram Professional (Business/Creator)', 'Facebook Page yang terhubung ke Instagram'],
        facebook: ['Meta Developer App', 'Facebook Page', 'Izin pages_manage_posts'],
        tiktok: ['TikTok for Developers app', 'Produk Content Posting API', 'Audit aplikasi agar posting bisa publik (sebelum audit: hanya private)'],
        youtube: ['Google Cloud project', 'YouTube Data API v3 aktif', 'OAuth consent screen'],
      };
      return json(res, 200, { platforms: Object.keys(requirements).map((platform) => ({ platform, configured: oauthConfiguration(platform) && Boolean(process.env.SOCIAL_TOKEN_ENCRYPTION_KEY), accounts: connected.rows.filter((a) => a.platform === platform), requirements: requirements[platform] })) });
    }
    const disc = route.match(new RegExp(`^/api/social/accounts/(${UUID})/disconnect$`));
    if (disc && method === 'POST') {
      await pool.query("UPDATE social_accounts SET status='revoked',access_token_ciphertext='',refresh_token_ciphertext=NULL,updated_at=now() WHERE id=$1", [disc[1]]);
      await pool.query("UPDATE publication_jobs SET status='awaiting_connection',account_id=NULL,updated_at=now() WHERE account_id=$1 AND status='scheduled'", [disc[1]]);
      return json(res, 200, { ok: true });
    }

    /* web dev projects */
    if (route === '/api/projects' && method === 'GET') {
      const q = await pool.query('SELECT p.*,(SELECT count(*)::int FROM tasks t WHERE t.project_id=p.id) AS tasks FROM dev_projects p ORDER BY p.name');
      return json(res, 200, { projects: q.rows });
    }
    if (route === '/api/projects' && method === 'POST') {
      const b = await body(req);
      const slug = String(b.slug || '').trim().toLowerCase();
      const name = String(b.name || '').trim();
      if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug) || !name) return json(res, 400, { error: 'Slug (huruf kecil, angka, -) dan nama wajib diisi' });
      const repo = String(b.repoUrl || '').trim();
      if (repo && !/^(git@[\w.-]+:[\w./-]+\.git|https:\/\/[\w.-]+\/[\w./-]+)$/.test(repo)) return json(res, 400, { error: 'URL repo tidak valid (pakai git@host:owner/repo.git atau https://)' });
      const field = (k, max = 300) => (b[k] ? String(b[k]).slice(0, max) : null);
      const r = await pool.query(
        `INSERT INTO dev_projects(slug,name,repo_url,default_branch,install_cmd,build_cmd,test_cmd,preview_dir,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name,repo_url=EXCLUDED.repo_url,default_branch=EXCLUDED.default_branch,install_cmd=EXCLUDED.install_cmd,build_cmd=EXCLUDED.build_cmd,test_cmd=EXCLUDED.test_cmd,preview_dir=EXCLUDED.preview_dir,notes=EXCLUDED.notes,updated_at=now() RETURNING *`,
        [slug, name.slice(0, 120), repo || null, field('defaultBranch', 80) || 'main', field('installCmd'), field('buildCmd'), field('testCmd'), field('previewDir', 120), field('notes', 3000)]
      );
      return json(res, 200, { project: r.rows[0] });
    }

    /* telegram */
    if (route === '/api/telegram' && method === 'GET') {
      const link = await getSetting(pool, 'telegram.chat', null);
      return json(res, 200, { configured: Boolean(config.telegramToken), linked: Boolean(link), linkedName: link?.name || null });
    }
    if (route === '/api/telegram/link-code' && method === 'POST') {
      const code = String(randomInt(100000, 999999));
      await setSetting(pool, 'telegram.linkCode', { hash: hash(code), expires: Date.now() + 10 * 60000 });
      return json(res, 200, { code, expiresInMinutes: 10 });
    }
    if (route === '/api/telegram/unlink' && method === 'POST') {
      await pool.query("DELETE FROM app_settings WHERE key='telegram.chat'");
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: 'Not found' });
  } catch (e) {
    if (!e.status) console.error(e);
    return json(res, e.status || 500, { error: e.status ? e.message : 'Internal server error' });
  }
});

async function start() {
  if (!config.adminToken || !config.databaseUrl) throw new Error('DATABASE_URL and LS_OFFICE_ADMIN_TOKEN are required');
  await migrate(pool);
  server.listen(config.port, '127.0.0.1', () => console.log('LS Office API listening on 127.0.0.1:' + config.port));
}
start().catch((e) => { console.error(e); process.exit(1); });
process.on('SIGTERM', () => { server.close(); pool.end().finally(() => process.exit(0)); });
