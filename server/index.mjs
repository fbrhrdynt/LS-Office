import http from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { EMPLOYEES } from './employees.mjs';
import { VIDEO_WORKFLOW } from './workflows.mjs';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DB_POOL_MAX || 5), connectionTimeoutMillis: 5000 });
const PORT = Number(process.env.PORT || 3215);
const TOKEN = process.env.LS_OFFICE_ADMIN_TOKEN || '';
const SESSION_DAYS = Math.min(30, Math.max(1, Number(process.env.SESSION_DAYS || 14)));
const MAX_BODY = 65536;
const COOKIE = 'ls_office_session';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const equal = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const json = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' }); res.end(JSON.stringify(data)); };
async function body(req) { let raw = ''; for await (const c of req) { raw += c; if (Buffer.byteLength(raw) > MAX_BODY) throw Object.assign(new Error('Body too large'), { status: 413 }); } try { return raw ? JSON.parse(raw) : {}; } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); } }
function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map(v => v.trim()).filter(Boolean).map(v => { const i = v.indexOf('='); return [v.slice(0, i), decodeURIComponent(v.slice(i + 1))]; })); }
function setSessionCookie(res, value, maxAge) { res.setHeader('Set-Cookie', value ? `${COOKIE}=${encodeURIComponent(value)}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}` : `${COOKIE}=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0`); }
function checkOrigin(req) { const origin = req.headers.origin; if (!origin) return true; try { return new URL(origin).host === (req.headers.host || '').split(':')[0] || new URL(origin).host === req.headers.host; } catch { return false; } }
async function migrate() {
  await pool.query(await (await import('node:fs/promises')).readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  for (const e of EMPLOYEES) await pool.query('INSERT INTO employees(id,key,name,role,department,manager_key,system_prompt) VALUES($1,$1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,role=EXCLUDED.role,department=EXCLUDED.department,manager_key=EXCLUDED.manager_key,system_prompt=EXCLUDED.system_prompt,updated_at=now()', [e.key, e.name, e.role, e.department, e.managerKey, e.prompt]);
  await pool.query('DELETE FROM director_sessions WHERE expires_at < now()');
}
async function authenticate(req) {
  const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
  if (TOKEN && bearer && equal(bearer, TOKEN)) return { legacy: true };
  const token = cookies(req)[COOKIE];
  if (!token || token.length < 40) return null;
  const result = await pool.query('UPDATE director_sessions SET last_seen_at=now() WHERE token_hash=$1 AND expires_at>now() RETURNING token_hash', [hash(token)]);
  return result.rowCount ? { legacy: false } : null;
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const route = url.pathname;
    if (route === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, service: 'ls-office-api' });
    if (route === '/api/auth/login' && req.method === 'POST') {
      if (!checkOrigin(req)) return json(res, 403, { error: 'Origin not allowed' });
      const b = await body(req);
      if (!TOKEN || typeof b.token !== 'string' || !equal(b.token, TOKEN)) return json(res, 401, { error: 'Invalid Director credential' });
      const raw = randomBytes(32).toString('base64url');
      const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
      await pool.query('INSERT INTO director_sessions(token_hash,expires_at) VALUES($1,$2)', [hash(raw), expires]);
      setSessionCookie(res, raw, SESSION_DAYS * 86400);
      return json(res, 200, { ok: true, expiresAt: expires.toISOString() });
    }
    if (route === '/api/auth/session' && req.method === 'GET') {
      const session = await authenticate(req);
      return json(res, session ? 200 : 401, session ? { authenticated: true } : { authenticated: false });
    }
    if (route === '/api/auth/logout' && req.method === 'POST') {
      if (!checkOrigin(req)) return json(res, 403, { error: 'Origin not allowed' });
      const token = cookies(req)[COOKIE];
      if (token) await pool.query('DELETE FROM director_sessions WHERE token_hash=$1', [hash(token)]);
      setSessionCookie(res, '', 0);
      return json(res, 200, { ok: true });
    }
    const session = await authenticate(req);
    if (!session) return json(res, 401, { error: 'Unauthorized' });
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !checkOrigin(req)) return json(res, 403, { error: 'Origin not allowed' });
    if (route === '/api/employees' && req.method === 'GET') {
      const q = await pool.query("SELECT id,name,role,department,manager_key AS \"managerKey\" FROM employees WHERE active AND id <> 'alex' ORDER BY department,name");
      return json(res, 200, { employees: q.rows });
    }
    if (route === '/api/overview' && req.method === 'GET') {
      const c = await pool.query('SELECT status,count(*)::int AS count FROM tasks GROUP BY status');
      const r = await pool.query("SELECT e.id,e.task_id AS \"taskId\",e.event_type AS type,e.created_at AS \"createdAt\",t.title FROM task_events e LEFT JOIN tasks t ON t.id=e.task_id ORDER BY e.created_at DESC LIMIT 12");
      return json(res, 200, { counts: Object.fromEntries(c.rows.map(x => [x.status, x.count])), recent: r.rows });
    }
    if (route === '/api/tasks' && req.method === 'GET') {
      const q = await pool.query('SELECT t.*,e.name AS assignee_name FROM tasks t JOIN employees e ON e.id=t.assignee_id ORDER BY t.created_at DESC LIMIT 100');
      return json(res, 200, { tasks: q.rows });
    }
    if (route === '/api/tasks' && req.method === 'POST') {
      const b = await body(req);
      if (typeof b.instruction !== 'string' || !b.instruction.trim() || b.instruction.length > 12000 || typeof b.title !== 'string' || !b.title.trim() || b.title.length > 160) return json(res, 400, { error: 'Title/instruction invalid' });
      if (!['text', 'animated_video'].includes(b.taskType || 'text')) return json(res, 400, { error: 'Invalid task type' });
      const taskType = b.taskType || 'text';
      const assigneeId = taskType === 'animated_video' ? 'ethan' : b.assigneeId;
      const a = await pool.query('SELECT id FROM employees WHERE id=$1 AND active AND id<>$2', [assigneeId, 'alex']);
      if (!a.rowCount) return json(res, 400, { error: 'Invalid assignee' });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const v = await client.query("INSERT INTO tasks(title,instruction,acceptance_criteria,assignee_id,reviewer_id,priority,status,task_type) VALUES($1,$2,$3,$4,$5,$6,'queued',$7) RETURNING *", [b.title.trim(), b.instruction.trim(), String(b.acceptanceCriteria || '').slice(0, 5000), assigneeId, 'alex', ['low', 'normal', 'high', 'urgent'].includes(b.priority) ? b.priority : 'normal', taskType]);
        if (taskType === 'animated_video') {
          for (let i = 0; i < VIDEO_WORKFLOW.length; i++) {
            const step = VIDEO_WORKFLOW[i];
            await client.query('INSERT INTO workflow_steps(task_id,step_order,step_key,assignee_id,title,instruction,requires_approval) VALUES($1,$2,$3,$4,$5,$6,$7)', [v.rows[0].id, i + 1, step.key, step.employeeId, step.title, step.instruction, Boolean(step.requiresApproval)]);
          }
        }
        await client.query("INSERT INTO task_events(task_id,event_type,payload) VALUES($1,'task_created',$2)", [v.rows[0].id, JSON.stringify({ assigneeId, taskType, workflow: taskType === 'animated_video' })]);
        await client.query('COMMIT');
        return json(res, 201, { task: v.rows[0] });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    }
    const m = route.match(/^\/api\/tasks\/([0-9a-f-]+)(?:\/(approval|video))?$/i);
    if (m && req.method === 'GET' && !m[2]) {
      const t = await pool.query('SELECT t.*,e.name AS assignee_name FROM tasks t JOIN employees e ON e.id=t.assignee_id WHERE t.id=$1', [m[1]]);
      if (!t.rowCount) return json(res, 404, { error: 'Task not found' });
      const runs = await pool.query('SELECT id,status,output_text,error_message,started_at,finished_at FROM task_runs WHERE task_id=$1 ORDER BY attempt DESC', [m[1]]);
      const steps = await pool.query('SELECT s.id,s.step_order,s.step_key,s.title,s.status,s.requires_approval,s.output_text,s.started_at,s.finished_at,e.name AS assignee_name FROM workflow_steps s LEFT JOIN employees e ON e.id=s.assignee_id WHERE s.task_id=$1 ORDER BY s.step_order', [m[1]]);
      const publicationJobs = await pool.query('SELECT platform,status,post_url,error_message,created_at,published_at FROM publication_jobs WHERE task_id=$1 ORDER BY platform', [m[1]]);
      return json(res, 200, { task: t.rows[0], runs: runs.rows, workflowSteps: steps.rows, publicationJobs: publicationJobs.rows });
    }
    if (m && m[2] === 'video' && req.method === 'GET') {
      const q = await pool.query("SELECT artifact_path,artifact_mime,artifact_name FROM tasks WHERE id=$1 AND task_type='animated_video' AND artifact_path IS NOT NULL", [m[1]]);
      if (!q.rowCount) return json(res, 404, { error: 'Video belum tersedia' });
      const file = q.rows[0].artifact_path;
      const root = path.resolve(process.env.MEDIA_ROOT || '/opt/ls-office/storage/videos');
      if (!file.startsWith(root + path.sep)) return json(res, 403, { error: 'Invalid media path' });
      const info = await stat(file);
      res.writeHead(200, { 'content-type': q.rows[0].artifact_mime || 'video/mp4', 'content-length': info.size, 'content-disposition': `attachment; filename="${path.basename(q.rows[0].artifact_name || 'ls-office-video.mp4').replace(/[^a-zA-Z0-9._-]/g, '_')}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' });
      return createReadStream(file).pipe(res);
    }
    if (m && m[2] === 'approval' && req.method === 'POST') {
      const b = await body(req);
      if (!['approved', 'changes_requested', 'rejected'].includes(b.decision)) return json(res, 400, { error: 'Invalid decision' });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const task = await client.query('SELECT task_type,artifact_path,reviewer_id FROM tasks WHERE id=$1 AND status=$2 FOR UPDATE', [m[1], 'review']);
        if (!task.rowCount || task.rows[0].reviewer_id !== 'alex' || b.reviewerId !== 'alex') {
          await client.query('ROLLBACK');
          return json(res, 409, { error: 'Task not in Director review or reviewer mismatch' });
        }
        const gate = await client.query("SELECT id,step_key FROM workflow_steps WHERE task_id=$1 AND status='awaiting_approval' ORDER BY step_order LIMIT 1 FOR UPDATE", [m[1]]);
        if (!gate.rowCount) {
          await client.query('ROLLBACK');
          return json(res, 409, { error: 'No workflow checkpoint is waiting for Director approval' });
        }
        const currentGate = gate.rows[0];
        let status;
        let publicationJobsCreated = false;
        if (b.decision === 'approved') {
          if (currentGate.step_key === 'distribution' && !task.rows[0].artifact_path) {
            await client.query('ROLLBACK');
            return json(res, 409, { error: 'Final approval blocked: video artifact is missing' });
          }
          await client.query("UPDATE workflow_steps SET status='completed',finished_at=now() WHERE id=$1", [currentGate.id]);
          if (currentGate.step_key === 'distribution') {
            await client.query("INSERT INTO publication_jobs(task_id,platform,status) VALUES($1,'instagram','awaiting_connection'),($1,'tiktok','awaiting_connection'),($1,'youtube','awaiting_connection'),($1,'facebook','awaiting_connection') ON CONFLICT(task_id,platform) DO NOTHING", [m[1]]);
            status = 'blocked';
            publicationJobsCreated = true;
          } else {
            status = 'queued';
          }
        } else if (b.decision === 'changes_requested') {
          await client.query("UPDATE workflow_steps SET status='pending',output_text=NULL,started_at=NULL,finished_at=NULL WHERE id=$1", [currentGate.id]);
          status = 'queued';
        } else {
          await client.query("UPDATE workflow_steps SET status='skipped' WHERE task_id=$1 AND status IN ('pending','awaiting_approval')", [m[1]]);
          status = 'rejected';
        }
        await client.query('UPDATE tasks SET status=$2,updated_at=now() WHERE id=$1', [m[1], status]);
        await client.query('INSERT INTO task_events(task_id,event_type,payload) VALUES($1,$2,$3)', [m[1], 'review_' + b.decision, JSON.stringify({ notes: String(b.notes || '').slice(0, 2000), checkpoint: currentGate.step_key, publicationJobsCreated })]);
        await client.query('COMMIT');
        return json(res, 200, { ok: true, status, checkpoint: currentGate.step_key, publicationJobsCreated });
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { client.release(); }
    }
    return json(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error(e);
    return json(res, e.status || 500, { error: e.status ? e.message : 'Internal server error' });
  }
});
async function start() {
  if (!TOKEN || !process.env.DATABASE_URL) throw new Error('DATABASE_URL and LS_OFFICE_ADMIN_TOKEN are required');
  await migrate();
  server.listen(PORT, '127.0.0.1', () => console.log('LS Office API listening on 127.0.0.1:' + PORT));
}
start().catch(e => { console.error(e); process.exit(1); });
process.on('SIGTERM', async () => { server.close(); await pool.end(); });
