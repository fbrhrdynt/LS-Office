// Publisher: posts approved videos at their scheduled time and follows each platform until the post is live.
import { createPool, migrate, tx } from './lib/db.mjs';
import { notify, event } from './lib/engine.mjs';
import { ADAPTERS, accessToken } from './lib/platforms.mjs';

const pool = createPool(2);
await migrate(pool);
let stopping = false;
const POLL_MS = Number(process.env.PUBLISHER_POLL_MS || 30000);
const MAX_ATTEMPTS = 3;

async function claimDue() {
  return tx(pool, async (c) => {
    const r = await c.query(
      `SELECT j.*,t.artifact_path,t.title AS task_title,a.platform AS account_platform,a.external_account_id,a.access_token_ciphertext,a.refresh_token_ciphertext,a.token_expires_at,a.status AS account_status
       FROM publication_jobs j JOIN tasks t ON t.id=j.task_id LEFT JOIN social_accounts a ON a.id=j.account_id
       WHERE ((j.status='scheduled' AND j.scheduled_at<=now()) OR j.status='processing') AND (j.next_attempt_at IS NULL OR j.next_attempt_at<=now())
       ORDER BY j.scheduled_at LIMIT 1 FOR UPDATE OF j SKIP LOCKED`
    );
    if (!r.rowCount) return null;
    const job = r.rows[0];
    if (job.status === 'scheduled') await c.query("UPDATE publication_jobs SET status='publishing',updated_at=now() WHERE id=$1", [job.id]);
    else await c.query("UPDATE publication_jobs SET next_attempt_at=now()+interval '30 seconds' WHERE id=$1", [job.id]);
    return job;
  });
}

async function finishTaskIfDone(taskId) {
  const r = await pool.query("SELECT count(*) FILTER (WHERE status IN ('scheduled','queued','publishing','processing','awaiting_connection'))::int AS open, count(*) FILTER (WHERE status='published')::int AS done, count(*) FILTER (WHERE status='failed')::int AS failed FROM publication_jobs WHERE task_id=$1", [taskId]);
  const s = r.rows[0];
  if (s.open === 0 && s.failed === 0 && s.done > 0) {
    const u = await pool.query("UPDATE tasks SET status='completed',updated_at=now() WHERE id=$1 AND status='approved' RETURNING title", [taskId]);
    if (u.rowCount) { await event(pool, taskId, 'task_completed', { published: s.done }); await notify(pool, { taskId, kind: 'info', title: 'Semua posting tayang: ' + u.rows[0].title }); }
  }
}

async function handle(job) {
  const adapter = ADAPTERS[job.platform];
  const account = { id: job.account_id, platform: job.account_platform, external_account_id: job.external_account_id, access_token_ciphertext: job.access_token_ciphertext, refresh_token_ciphertext: job.refresh_token_ciphertext, token_expires_at: job.token_expires_at };
  try {
    if (!job.account_id || job.account_status !== 'connected') {
      await pool.query("UPDATE publication_jobs SET status='awaiting_connection',account_id=NULL,updated_at=now() WHERE id=$1", [job.id]);
      return;
    }
    if (!job.artifact_path) throw Object.assign(new Error('Video tidak ditemukan'), { permanent: true });
    const token = await accessToken(pool, account);
    const result = job.status === 'processing'
      ? await adapter.poll({ job, token, account, state: job.provider_state })
      : await adapter.start({ job, token, account, file: job.artifact_path });
    if (!result.done) {
      await pool.query("UPDATE publication_jobs SET status='processing',provider_state=$2,next_attempt_at=now()+interval '20 seconds',updated_at=now() WHERE id=$1", [job.id, JSON.stringify(result.state)]);
      return;
    }
    await pool.query("UPDATE publication_jobs SET status='published',external_post_id=$2,post_url=$3,error_message=$4,published_at=now(),updated_at=now() WHERE id=$1", [job.id, result.postId, result.url, result.note || null]);
    await event(pool, job.task_id, 'published', { platform: job.platform, url: result.url });
    await notify(pool, { taskId: job.task_id, kind: 'published', title: 'Tayang di ' + job.platform + ': ' + job.task_title, body: [result.url, result.note].filter(Boolean).join('\n'), action: { url: result.url } });
    await finishTaskIfDone(job.task_id);
  } catch (error) {
    const attempts = job.attempts + 1;
    const permanent = error.permanent || attempts >= MAX_ATTEMPTS || error.status === 401 || error.status === 403;
    console.error('publish failed', job.platform, job.id, error.message);
    if (error.status === 401) await pool.query("UPDATE social_accounts SET status='expired',updated_at=now() WHERE id=$1", [job.account_id]).catch(() => {});
    await pool.query(
      `UPDATE publication_jobs SET status=$2,attempts=$3,error_message=$4,next_attempt_at=now()+($5||' minutes')::interval,provider_state=CASE WHEN $2='failed' THEN provider_state ELSE '{}'::jsonb END,updated_at=now() WHERE id=$1`,
      [job.id, permanent ? 'failed' : 'scheduled', attempts, String(error.message).slice(0, 900), String(5 * attempts)]
    );
    if (permanent) await notify(pool, { taskId: job.task_id, kind: 'failed', title: 'Posting gagal di ' + job.platform + ': ' + job.task_title, body: error.message, action: { publicationId: job.id } });
  }
}

async function tick() {
  if (stopping) return;
  try {
    for (let i = 0; i < 5 && !stopping; i++) {
      const job = await claimDue();
      if (!job) break;
      await handle(job);
    }
  } catch (e) { console.error('publisher loop', e.message); }
}

// A job stuck in 'publishing' (process killed mid-upload) is retried from the start.
await pool.query("UPDATE publication_jobs SET status='scheduled',updated_at=now() WHERE status='publishing'");
console.log('ls-office-publisher online; poll=' + POLL_MS + 'ms');
let running = tick();
const timer = setInterval(() => { running = running.then(tick); }, POLL_MS);
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, async () => { stopping = true; clearInterval(timer); await Promise.race([running, new Promise((r) => setTimeout(r, 60000))]); await pool.end(); process.exit(0); });
