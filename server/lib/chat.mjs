import { tx } from './db.mjs';
import { respond } from './ai.mjs';
import { createTask, officeState, notify } from './engine.mjs';
import PERSONNEL from '../../shared/personnel.json' with { type: 'json' };

const YES = /^(ya|iya|y|ok|oke|okey|gas|lanjut|setuju|boleh|siap|buat(kan)?|jalan(kan)?)\b/i;

const PROPOSAL_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['reply', 'proposal'],
  properties: {
    reply: { type: 'string', description: 'Balasan chat natural, bahasa Indonesia santai, singkat (maks 6 kalimat).' },
    proposal: {
      type: 'object', additionalProperties: false, required: ['create', 'task_type', 'assignee', 'title', 'instruction', 'project_slug'],
      properties: {
        create: { type: 'boolean', description: 'true hanya jika Director jelas meminta pekerjaan baru dikerjakan' },
        task_type: { type: 'string', enum: ['text', 'animated_video', 'story_series', 'web_build', 'web_update'] },
        assignee: { type: 'string', enum: PERSONNEL.filter((p) => p.key !== 'alex').map((p) => p.key) },
        title: { type: 'string' },
        instruction: { type: 'string' },
        project_slug: { type: 'string', description: 'Untuk web_update: slug proyek yang ada, selain itu kosong' },
      },
    },
  },
};

async function snapshot(pool, thread) {
  const state = await officeState(pool);
  const tasks = await pool.query(
    `SELECT t.title,t.status,t.task_type,e.name AS owner,
       (SELECT s.title FROM workflow_steps s WHERE s.task_id=t.id AND s.status IN ('running','awaiting_approval','failed','pending') ORDER BY s.step_order LIMIT 1) AS step
     FROM tasks t JOIN employees e ON e.id=t.assignee_id
     WHERE t.updated_at > now()-interval '7 days' AND ($1='alex' OR t.assignee_id=$1 OR EXISTS (SELECT 1 FROM workflow_steps s WHERE s.task_id=t.id AND s.assignee_id=$1))
     ORDER BY t.updated_at DESC LIMIT 15`, [thread]);
  const projects = await pool.query('SELECT slug,name FROM dev_projects ORDER BY name LIMIT 20');
  return 'Status kantor sekarang: ' + JSON.stringify(thread === 'alex' ? state : { [thread]: state[thread] }) +
    '\nTask 7 hari terakhir: ' + JSON.stringify(tasks.rows) +
    '\nProyek web terdaftar: ' + JSON.stringify(projects.rows);
}

/** Answers one pending Director message. Returns true if a message was handled. */
export async function answerNextMessage(pool) {
  const msg = await tx(pool, async (c) => {
    const r = await c.query("SELECT * FROM messages WHERE status='pending' AND sender='director' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED");
    if (!r.rowCount) return null;
    await c.query("UPDATE messages SET status='done' WHERE id=$1", [r.rows[0].id]);
    return r.rows[0];
  });
  if (!msg) return false;
  const who = PERSONNEL.find((p) => p.key === msg.thread) || PERSONNEL[0];
  let reply = '';
  let meta = {};
  try {
    const last = await pool.query("SELECT id,meta FROM messages WHERE thread=$1 AND sender=$2 AND id<$3 ORDER BY id DESC LIMIT 1", [msg.thread, who.key, msg.id]);
    const pending = last.rows[0]?.meta?.proposal;
    if (pending && !last.rows[0].meta.used && YES.test(msg.body.trim())) {
      const project = pending.task_type === 'web_update' ? await pool.query('SELECT id FROM dev_projects WHERE slug=$1', [pending.project_slug]) : null;
      const task = await createTask(pool, { title: pending.title, instruction: pending.instruction, taskType: pending.task_type, assigneeId: pending.assignee, projectId: project?.rows[0]?.id, source: msg.channel });
      await pool.query("UPDATE messages SET meta=meta||'{\"used\":true}'::jsonb WHERE id=$1", [last.rows[0].id]);
      reply = 'Siap, task "' + task.title + '" sudah masuk antrean. Nanti aku kabari kalau ada yang perlu keputusanmu.';
      meta = { taskId: task.id };
    } else {
      const history = await pool.query('SELECT sender,body FROM messages WHERE thread=$1 AND id<$2 ORDER BY id DESC LIMIT 12', [msg.thread, msg.id]);
      const convo = history.rows.reverse().map((m) => (m.sender === 'director' ? 'Director' : who.name) + ': ' + m.body).join('\n');
      const r = await respond({
        system: who.prompt + '\nKamu sedang chat langsung dengan Director (atasan manusia) lewat ' + (msg.channel === 'telegram' ? 'Telegram' : 'aplikasi kantor') + '. Jawab santai, jujur, dan singkat. Gunakan hanya data status yang diberikan; jangan mengarang progres. Jika Director meminta pekerjaan baru, isi proposal (create=true) dan di reply tanyakan konfirmasi singkat ("Mau langsung aku buatkan task-nya?"). Cerita/drama bersambung (part 1, 2, 3) = story_series (Nadia ide seri → Felix rancang part → Ethan desain tokoh → produksi per part); video pendek sekali tayang/TikTok/Reels = animated_video (alurnya otomatis: Nadia ide → Felix naskah → Ethan visual → Maya suara → render → review Director → Olivier caption & jadwal); website baru = web_build (Nadia konsep → Arvin rencana → Nathan coding → Daren QA); ubah website yang sudah ada = web_update; selain itu text dengan assignee yang paling cocok. Sebut task dengan judulnya, jangan menyebut ID.',
        user: (await snapshot(pool, who.key)) + '\n\nPercakapan sebelumnya:\n' + (convo || '-') + '\n\nPesan baru Director: ' + msg.body,
        schema: PROPOSAL_SCHEMA, schemaName: 'chat_reply', maxOutputTokens: 3000, ctx: { pool, taskId: msg.task_id, stepKey: 'chat' },
      });
      reply = r.json.reply;
      if (r.json.proposal.create) meta = { proposal: r.json.proposal };
    }
  } catch (error) {
    console.error('chat failed', error.message);
    reply = 'Maaf, aku lagi tidak bisa membalas (' + String(error.message).slice(0, 120) + '). Coba lagi sebentar ya.';
  }
  await pool.query('INSERT INTO messages(thread,sender,body,channel,meta) VALUES($1,$2,$3,$4,$5)', [msg.thread, who.key, reply, msg.channel === 'telegram' ? 'telegram' : 'web', JSON.stringify(meta)]);
  if (msg.channel === 'telegram') await notify(pool, { employeeId: who.key, kind: 'chat', title: who.name, body: reply, action: meta.proposal ? { proposal: true, thread: who.key } : { thread: who.key } });
  return true;
}
