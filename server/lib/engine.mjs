import { tx } from './db.mjs';
import { config } from './config.mjs';
import { respond } from './ai.mjs';
import { WORKFLOWS, COORDINATOR, GATE_LABEL, stepDef, STORY_EPISODE_WORKFLOW } from '../workflows.mjs';

export const TASK_TYPES = ['text', 'animated_video', 'web_build', 'web_update', 'story_series', 'story_episode'];
const PRIORITY_ORDER = "CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END";
const FINAL = ['completed', 'rejected', 'cancelled'];

export async function notify(db, { taskId = null, employeeId = null, kind, title, body = '', action = {} }) {
  await db.query('INSERT INTO notifications(task_id,employee_id,kind,title,body,action) VALUES($1,$2,$3,$4,$5,$6)', [taskId, employeeId, kind, title.slice(0, 300), String(body).slice(0, 3500), JSON.stringify(action)]);
}

export async function event(db, taskId, type, payload = {}) {
  await db.query('INSERT INTO task_events(task_id,event_type,payload) VALUES($1,$2,$3)', [taskId, type, JSON.stringify(payload)]);
}

/* ------------------------------------------------------------------ create */

export async function createTask(pool, input) {
  const taskType = input.taskType || 'text';
  if (!TASK_TYPES.includes(taskType)) throw Object.assign(new Error('Invalid task type'), { status: 400 });
  const title = String(input.title || '').trim();
  const instruction = String(input.instruction || '').trim();
  if (!title || title.length > 160 || !instruction || instruction.length > 12000) throw Object.assign(new Error('Title/instruction invalid'), { status: 400 });
  const workflow = WORKFLOWS[taskType];
  const assigneeId = workflow ? COORDINATOR[taskType] : input.assigneeId;
  const priority = ['low', 'normal', 'high', 'urgent'].includes(input.priority) ? input.priority : 'normal';
  const meta = {};
  if (input.affiliate && typeof input.affiliate === 'object') {
    meta.affiliate = { product: String(input.affiliate.product || '').slice(0, 300), link: String(input.affiliate.link || '').slice(0, 500), notes: String(input.affiliate.notes || '').slice(0, 1000) };
    if (!meta.affiliate.product && !meta.affiliate.link) delete meta.affiliate;
  }
  if (Array.isArray(input.platforms)) meta.platforms = input.platforms.filter((p) => ['tiktok', 'instagram', 'youtube', 'facebook'].includes(p));
  if (input.source) meta.source = String(input.source).slice(0, 20);
  return tx(pool, async (c) => {
    const a = await c.query("SELECT id FROM employees WHERE id=$1 AND active AND id<>'alex'", [assigneeId]);
    if (!a.rowCount) throw Object.assign(new Error('Invalid assignee'), { status: 400 });
    if (taskType === 'web_update') {
      const p = await c.query('SELECT id FROM dev_projects WHERE id=$1', [input.projectId || null]);
      if (!p.rowCount) throw Object.assign(new Error('Pilih proyek yang akan di-update'), { status: 400 });
    }
    const t = await c.query(
      "INSERT INTO tasks(title,instruction,acceptance_criteria,assignee_id,reviewer_id,priority,status,task_type,meta,project_id,due_at) VALUES($1,$2,$3,$4,'alex',$5,'queued',$6,$7,$8,$9) RETURNING *",
      [title, instruction, String(input.acceptanceCriteria || '').slice(0, 5000), assigneeId, priority, taskType, JSON.stringify(meta), taskType.startsWith('web_') ? input.projectId || null : null, input.dueAt || null]
    );
    const task = t.rows[0];
    for (const [i, s] of (workflow || []).entries()) {
      await c.query('INSERT INTO workflow_steps(task_id,step_order,step_key,assignee_id,title,instruction,requires_approval,executor) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [task.id, i + 1, s.key, s.employeeId, s.title, s.instruction, Boolean(s.gate), s.executor]);
    }
    await event(c, task.id, 'task_created', { assigneeId, taskType, source: meta.source || 'web' });
    return task;
  });
}

/* ------------------------------------------------------------------ claim / complete / fail */

async function createRun(c, taskId, stepId, executor) {
  const n = await c.query('SELECT COALESCE(MAX(attempt),0)+1 AS n FROM task_runs WHERE task_id=$1', [taskId]);
  const model = executor === 'render' ? 'render:' + config.imageModel + '+' + config.ttsModel : executor === 'devagent' ? 'claude-code' : executor === 'qa' ? 'ffprobe' : config.textModel;
  const run = await c.query("INSERT INTO task_runs(task_id,attempt,status,model,step_id,executor) VALUES($1,$2,'running',$3,$4,$5) RETURNING id", [taskId, n.rows[0].n, model, stepId, executor]);
  return run.rows[0].id;
}

/** Claims the next ready workflow step for one of `executors` (and, for 'agent', plain text tasks). */
export async function claim(pool, executors) {
  const step = await tx(pool, async (c) => {
    const r = await c.query(
      `SELECT s.id AS step_id,s.step_key,s.title AS step_title,s.instruction AS step_instruction,s.assignee_id AS step_assignee,s.requires_approval,s.revision_notes AS step_revision_notes,s.executor,
              t.*,e.system_prompt
       FROM workflow_steps s JOIN tasks t ON t.id=s.task_id LEFT JOIN employees e ON e.id=s.assignee_id
       WHERE s.status='pending' AND s.executor = ANY($1::text[]) AND t.status IN ('queued','in_progress')
         AND NOT EXISTS (SELECT 1 FROM workflow_steps p WHERE p.task_id=s.task_id AND p.step_order<s.step_order AND p.status NOT IN ('completed','skipped'))
       ORDER BY ${PRIORITY_ORDER},t.created_at,s.step_order
       LIMIT 1 FOR UPDATE OF s,t SKIP LOCKED`,
      [executors]
    );
    if (!r.rowCount) return null;
    const s = r.rows[0];
    await c.query("UPDATE workflow_steps SET status='running',started_at=now(),finished_at=NULL,attempts=attempts+1 WHERE id=$1", [s.step_id]);
    await c.query("UPDATE tasks SET status='in_progress',updated_at=now() WHERE id=$1", [s.id]);
    const runId = await createRun(c, s.id, s.step_id, s.executor);
    await event(c, s.id, 'workflow_step_started', { stepKey: s.step_key, assigneeId: s.step_assignee });
    return { ...s, runId, workflow: true };
  });
  if (step || !executors.includes('agent')) return step;
  return tx(pool, async (c) => {
    const r = await c.query(
      `SELECT t.*,e.system_prompt FROM tasks t JOIN employees e ON e.id=t.assignee_id
       WHERE t.status IN ('queued','assigned','changes_requested') AND t.task_type='text'
       ORDER BY ${PRIORITY_ORDER},t.created_at LIMIT 1 FOR UPDATE OF t SKIP LOCKED`
    );
    if (!r.rowCount) return null;
    const t = r.rows[0];
    await c.query("UPDATE tasks SET status='in_progress',updated_at=now() WHERE id=$1", [t.id]);
    const runId = await createRun(c, t.id, null, 'agent');
    await event(c, t.id, 'task_started', { assigneeId: t.assignee_id });
    return { ...t, runId, workflow: false, executor: 'agent' };
  });
}

/** Finishes a claimed unit of work. Ignored if the task was cancelled meanwhile. */
export async function complete(pool, job, { text = '', json = null, artifact = null }) {
  return tx(pool, async (c) => {
    await c.query("UPDATE task_runs SET status='succeeded',output_text=$2,finished_at=now(),latency_ms=(EXTRACT(EPOCH FROM now()-started_at)*1000)::int WHERE id=$1 AND status='running'", [job.runId, text]);
    if (!job.workflow) {
      const u = await c.query("UPDATE tasks SET status='review',updated_at=now() WHERE id=$1 AND status='in_progress' RETURNING id", [job.id]);
      if (!u.rowCount) return false;
      await event(c, job.id, 'task_ready_for_review');
      await notify(c, { taskId: job.id, employeeId: job.assignee_id, kind: 'approval', title: 'Hasil siap direview: ' + job.title, body: text.slice(0, 900), action: { gate: 'task_review' } });
      return true;
    }
    if (artifact) await c.query('UPDATE tasks SET artifact_path=$2,artifact_mime=$3,artifact_name=$4,updated_at=now() WHERE id=$1', [job.id, artifact.path, artifact.mime, artifact.name]);
    const gate = stepDef(job.task_type, job.step_key)?.gate;
    const u = await c.query('UPDATE workflow_steps SET status=$2,output_text=$3,output_json=$4,finished_at=now() WHERE id=$1 AND status=\'running\' RETURNING id', [job.step_id, gate ? 'awaiting_approval' : 'completed', text, json ? JSON.stringify(json) : null]);
    if (!u.rowCount) return false;
    if (gate) {
      await c.query("UPDATE tasks SET status='review',updated_at=now() WHERE id=$1 AND status='in_progress'", [job.id]);
      await event(c, job.id, 'director_checkpoint_ready', { stepKey: job.step_key, gate });
      await notify(c, { taskId: job.id, employeeId: job.step_assignee, kind: 'approval', title: GATE_LABEL[gate] + ': ' + job.title, body: summarizeForDirector(gate, text, json), action: { gate, stepKey: job.step_key } });
      return true;
    }
    if (job.task_type === 'story_series' && job.step_key === 'character_design') await createSeriesFromTask(c, job.id);
    const pending = await c.query("SELECT count(*)::int AS n FROM workflow_steps WHERE task_id=$1 AND status NOT IN ('completed','skipped')", [job.id]);
    if (pending.rows[0].n === 0) {
      await c.query("UPDATE tasks SET status='completed',updated_at=now() WHERE id=$1", [job.id]);
      await event(c, job.id, 'task_completed');
      await notify(c, { taskId: job.id, kind: 'info', title: 'Selesai: ' + job.title, body: text.slice(0, 900) });
    } else {
      await event(c, job.id, 'workflow_step_completed', { stepKey: job.step_key });
    }
    return true;
  });
}

export async function fail(pool, job, error) {
  const message = String(error?.message || error).slice(0, 1000);
  await tx(pool, async (c) => {
    await c.query("UPDATE task_runs SET status='failed',error_message=$2,finished_at=now() WHERE id=$1 AND status='running'", [job.runId, message]);
    if (job.workflow) await c.query("UPDATE workflow_steps SET status='failed',finished_at=now() WHERE id=$1 AND status='running'", [job.step_id]);
    const u = await c.query("UPDATE tasks SET status='failed',updated_at=now() WHERE id=$1 AND status='in_progress' RETURNING id", [job.id]);
    if (!u.rowCount) return;
    await event(c, job.id, 'task_failed', { error: message, stepKey: job.step_key || null });
    await notify(c, { taskId: job.id, employeeId: job.step_assignee || job.assignee_id, kind: 'failed', title: 'Gagal' + (job.step_title ? ' di tahap ' + job.step_title : '') + ': ' + job.title, body: message, action: { retry: true } });
  });
}

/** Puts work that was running when this executor stopped back in the queue. Each executor runs as one process. */
export async function reapInterrupted(pool, executors) {
  return tx(pool, async (c) => {
    const steps = await c.query("UPDATE workflow_steps SET status='pending',started_at=NULL WHERE status='running' AND executor = ANY($1::text[]) RETURNING task_id", [executors]);
    const ids = [...new Set(steps.rows.map((r) => r.task_id))];
    await c.query("UPDATE task_runs SET status='interrupted',error_message='Worker restarted before finishing',finished_at=now() WHERE status='running' AND executor = ANY($1::text[])", [executors]);
    if (ids.length) await c.query("UPDATE tasks SET status='queued',updated_at=now() WHERE id = ANY($1::uuid[]) AND status='in_progress'", [ids]);
    let plain = { rowCount: 0 };
    if (executors.includes('agent')) {
      await c.query("UPDATE task_runs SET status='interrupted',error_message='Worker restarted before finishing',finished_at=now() WHERE status='running' AND executor IS NULL");
      plain = await c.query("UPDATE tasks SET status='queued',updated_at=now() WHERE status='in_progress' AND task_type='text' RETURNING id");
    }
    return ids.length + plain.rowCount;
  });
}

/* ------------------------------------------------------------------ story series */

/** Creates the task for one part of a series (inside a transaction). Returns null if that part already exists. */
export async function createEpisodeTask(c, series, part) {
  const ep = (series.plan?.episodes || []).find((e) => Number(e.part) === part) || series.plan?.episodes?.[part - 1];
  if (!ep) return null;
  const exists = await c.query("SELECT id FROM tasks WHERE series_id=$1 AND part_no=$2 AND status NOT IN ('cancelled','rejected')", [series.id, part]);
  if (exists.rowCount) return null;
  const origin = series.origin_task_id ? (await c.query('SELECT meta,priority FROM tasks WHERE id=$1', [series.origin_task_id])).rows[0] : null;
  const meta = { ...(origin?.meta || {}), source: 'series' };
  const t = await c.query(
    "INSERT INTO tasks(title,instruction,acceptance_criteria,assignee_id,reviewer_id,priority,status,task_type,meta,series_id,part_no) VALUES($1,$2,$3,'ethan','alex',$4,'queued','story_episode',$5,$6,$7) RETURNING *",
    [(series.title + ' — Part ' + part + ': ' + ep.title).slice(0, 160), 'Part ' + part + ' dari ' + series.total_parts + '. ' + ep.summary + '\nCliffhanger/penutup: ' + ep.cliffhanger, 'Durasi 1,5-2 menit, tokoh konsisten dengan character sheet seri, ditutup cliffhanger.', origin?.priority || 'normal', JSON.stringify(meta), series.id, part]
  );
  for (const [i, st] of STORY_EPISODE_WORKFLOW.entries()) {
    await c.query('INSERT INTO workflow_steps(task_id,step_order,step_key,assignee_id,title,instruction,requires_approval,executor) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [t.rows[0].id, i + 1, st.key, st.employeeId, st.title, st.instruction, Boolean(st.gate), st.executor]);
  }
  await event(c, t.rows[0].id, 'task_created', { taskType: 'story_episode', seriesId: series.id, part });
  await notify(c, { taskId: t.rows[0].id, employeeId: 'felix', kind: 'info', title: 'Part ' + part + ' mulai diproduksi: ' + series.title, body: ep.title + ' — ' + ep.summary });
  return t.rows[0];
}

/** After Ethan finishes the character design, the series exists and Part 1 starts. */
async function createSeriesFromTask(c, taskId) {
  const steps = Object.fromEntries((await c.query('SELECT step_key,output_json FROM workflow_steps WHERE task_id=$1', [taskId])).rows.map((r) => [r.step_key, r.output_json]));
  const task = (await c.query('SELECT meta FROM tasks WHERE id=$1', [taskId])).rows[0];
  const plan = steps.series_plan || {};
  const s = await c.query(
    'INSERT INTO series(origin_task_id,title,logline,plan,design,total_parts,platforms) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [taskId, plan.title || 'Seri baru', plan.logline || '', JSON.stringify(plan), JSON.stringify(steps.character_design || {}), Math.max(1, Math.min(30, plan.episodes?.length || 1)), task?.meta?.platforms || []]
  );
  await c.query('UPDATE tasks SET series_id=$2 WHERE id=$1', [taskId, s.rows[0].id]);
  await createEpisodeTask(c, s.rows[0], 1);
  return s.rows[0];
}

/* ------------------------------------------------------------------ context for agents */

export async function workContext(pool, job) {
  const parts = ['Task: ' + job.title, 'Brief Director: ' + job.instruction];
  if (job.acceptance_criteria) parts.push('Acceptance criteria: ' + job.acceptance_criteria);
  const meta = job.meta || {};
  if (meta.affiliate) parts.push('Produk affiliate: ' + [meta.affiliate.product, meta.affiliate.link, meta.affiliate.notes].filter(Boolean).join(' · '));
  if (meta.platforms?.length) parts.push('Platform target: ' + meta.platforms.join(', '));
  if (job.project_id) {
    const p = await pool.query('SELECT name,slug,repo_url,default_branch,notes FROM dev_projects WHERE id=$1', [job.project_id]);
    if (p.rowCount) parts.push('Proyek: ' + p.rows[0].name + ' (' + p.rows[0].slug + ')' + (p.rows[0].notes ? '\nCatatan proyek: ' + p.rows[0].notes : ''));
  }
  if (job.series_id && job.task_type === 'story_episode') {
    const sr = (await pool.query('SELECT * FROM series WHERE id=$1', [job.series_id])).rows[0];
    if (sr) {
      const ep = (sr.plan.episodes || []).find((e) => Number(e.part) === job.part_no);
      parts.push('### SERI: ' + sr.title + ' (Part ' + job.part_no + ' dari ' + sr.total_parts + ')\nLogline: ' + sr.logline + '\nTone: ' + (sr.plan.tone || '-') +
        '\nTokoh: ' + JSON.stringify(sr.plan.characters || []) + '\nDesain visual: ' + JSON.stringify(sr.design || {}) +
        '\nRencana semua part: ' + (sr.plan.episodes || []).map((e) => 'Part ' + e.part + ' ' + e.title + ': ' + e.summary + ' [akhir: ' + e.cliffhanger + ']').join(' | '));
      if (ep) parts.push('### PART INI (' + job.part_no + '): ' + ep.title + '\n' + ep.summary + '\nAkhir part: ' + ep.cliffhanger + (job.part_no >= sr.total_parts ? '\nIni PART TERAKHIR: beri penyelesaian, bukan cliffhanger.' : ''));
      const prevParts = await pool.query(
        "SELECT t.part_no,s.output_json FROM tasks t JOIN workflow_steps s ON s.task_id=t.id AND s.step_key='script' AND s.status='completed' WHERE t.series_id=$1 AND t.part_no<$2 AND t.status NOT IN ('cancelled','rejected') ORDER BY t.part_no DESC LIMIT 3",
        [job.series_id, job.part_no]
      );
      for (const pp of prevParts.rows.reverse()) parts.push('### Yang sudah terjadi di Part ' + pp.part_no + ' (naskah final)\n' + (pp.output_json?.scenes || []).map((x) => x.spoken).join(' ').slice(0, 1800));
      const voice = await pool.query("SELECT s.output_json FROM tasks t JOIN workflow_steps s ON s.task_id=t.id AND s.step_key='audio_direction' AND s.status='completed' WHERE t.series_id=$1 AND t.part_no<$2 ORDER BY t.part_no DESC LIMIT 1", [job.series_id, job.part_no]);
      if (voice.rowCount) parts.push('### Suara narator part sebelumnya (pertahankan): ' + JSON.stringify(voice.rows[0].output_json));
    }
  }
  if (job.workflow) {
    const prev = await pool.query("SELECT step_key,title,output_text,output_json,decision FROM workflow_steps WHERE task_id=$1 AND status='completed' AND step_order < (SELECT step_order FROM workflow_steps WHERE id=$2) ORDER BY step_order", [job.id, job.step_id]);
    for (const s of prev.rows) {
      if (s.step_key === 'ideas') parts.push('### Ide terpilih (keputusan Director)\n' + selectedIdeaText(s));
      else parts.push('### ' + s.title + ' (' + s.step_key + ')\n' + (s.output_json ? JSON.stringify(s.output_json) : s.output_text || ''));
    }
    if (job.step_revision_notes) parts.push('### REVISI DARI DIRECTOR (wajib dipenuhi)\n' + job.step_revision_notes);
    else if (job.revision_notes) parts.push('### Konteks revisi terakhir Director (jaga agar tetap terpenuhi)\n' + job.revision_notes);
  } else if (job.revision_notes) {
    const last = await pool.query("SELECT output_text FROM task_runs WHERE task_id=$1 AND status='succeeded' ORDER BY attempt DESC LIMIT 1", [job.id]);
    parts.push('### Hasil sebelumnya\n' + (last.rows[0]?.output_text || '-').slice(0, 6000));
    parts.push('### REVISI DARI DIRECTOR (wajib dipenuhi)\n' + job.revision_notes);
  }
  return parts.join('\n\n');
}

export function selectedIdeaText(step) {
  const d = step.decision || {};
  if (d.customIdea) return 'Ide dari Director: ' + d.customIdea + (d.notes ? '\nCatatan: ' + d.notes : '');
  const list = step.output_json?.ideas || [];
  const idea = list[Number.isInteger(d.ideaIndex) ? d.ideaIndex : 0];
  if (!idea) return step.output_text || '';
  return JSON.stringify(idea) + (d.notes ? '\nCatatan Director: ' + d.notes : '');
}

function summarizeForDirector(gate, text, json) {
  if (gate === 'choose_idea' && json?.ideas) return json.ideas.map((x, i) => (i + 1) + '. ' + x.title + '\n   Hook: ' + x.hook + ' [' + x.format + ']').join('\n') + '\n\nRekomendasi: ' + json.recommendation;
  if (gate === 'publish' && json?.posts) return 'Jadwal usulan: ' + json.recommended_time + ' WIB\n' + json.posts.map((p) => p.platform.toUpperCase() + ': ' + p.caption.slice(0, 200)).join('\n');
  if (gate === 'approve_plan' && json?.summary) return json.summary + '\n\nFitur: ' + json.features.join(', ');
  return String(text).slice(0, 900);
}

/* ------------------------------------------------------------------ Director decisions */

const err = (status, message) => Object.assign(new Error(message), { status });

/** Picks which step a free-text revision should go back to. */
export async function routeRevision(pool, taskId, notes, options) {
  if (options.length === 1) return { step: options[0], reason: 'satu-satunya pilihan' };
  try {
    const r = await respond({
      system: 'Kamu Alex, AI Managing Director. Tentukan tahap produksi paling awal yang harus diulang agar revisi Director terpenuhi. script = isi/kata-kata narasi; storyboard = visual, gambar, urutan adegan, label, kartu; audio_direction = suara, tempo, intonasi, pengucapan; render_video = masalah teknis render saja; plan = rencana/fitur; implement = kode/tampilan.',
      user: 'Revisi Director: ' + notes + '\nPilihan tahap: ' + options.join(', '),
      schema: { type: 'object', additionalProperties: false, required: ['step', 'reason'], properties: { step: { type: 'string', enum: options }, reason: { type: 'string' } } },
      schemaName: 'revision_route', maxOutputTokens: 2000, ctx: { pool, taskId, stepKey: 'revision_routing' },
    });
    return r.json;
  } catch (error) {
    console.error('revision routing failed', error.message);
    return { step: options[0], reason: 'fallback' };
  }
}

/**
 * Applies a Director decision to a task in review.
 * opts: { notes, ideaIndex, customIdea, restartFrom ('auto' or step key), scheduledAt (ISO), platforms, posts }
 */
export async function decide(pool, taskId, decision, opts = {}) {
  if (!['approved', 'changes_requested', 'rejected'].includes(decision)) throw err(400, 'Invalid decision');
  const notes = String(opts.notes || '').trim().slice(0, 4000);
  if (decision === 'changes_requested' && !notes) throw err(400, 'Tulis dulu revisinya apa');

  // Revision routing may call the model, so resolve it before taking row locks.
  let route = null;
  if (decision === 'changes_requested') {
    const t = await pool.query('SELECT t.task_type,s.step_key FROM tasks t LEFT JOIN workflow_steps s ON s.task_id=t.id AND s.status=\'awaiting_approval\' WHERE t.id=$1 ORDER BY s.step_order LIMIT 1', [taskId]);
    const gateKey = t.rows[0]?.step_key;
    if (gateKey) {
      const def = stepDef(t.rows[0].task_type, gateKey);
      const options = def?.revisable || [gateKey];
      if (opts.restartFrom && opts.restartFrom !== 'auto') {
        if (!options.includes(opts.restartFrom)) throw err(400, 'Tahap revisi tidak valid');
        route = { step: opts.restartFrom, reason: 'dipilih Director' };
      } else route = await routeRevision(pool, taskId, notes, options);
    }
  }

  return tx(pool, async (c) => {
    const tr = await c.query("SELECT * FROM tasks WHERE id=$1 AND status='review' FOR UPDATE", [taskId]);
    if (!tr.rowCount) throw err(409, 'Task tidak sedang menunggu review');
    const task = tr.rows[0];
    const gr = await c.query("SELECT * FROM workflow_steps WHERE task_id=$1 AND status='awaiting_approval' ORDER BY step_order LIMIT 1 FOR UPDATE", [taskId]);
    const gateStep = gr.rows[0] || null;
    if (WORKFLOWS[task.task_type] && !gateStep) throw err(409, 'Tidak ada checkpoint yang menunggu approval');
    const gate = gateStep ? stepDef(task.task_type, gateStep.step_key)?.gate : 'task_review';
    let status;
    const result = { checkpoint: gateStep?.step_key || 'task_review' };

    if (decision === 'approved') {
      const d = { notes, at: new Date().toISOString() };
      if (gate === 'choose_idea') {
        const ideas = gateStep.output_json?.ideas || [];
        if (opts.customIdea && String(opts.customIdea).trim()) d.customIdea = String(opts.customIdea).trim().slice(0, 3000);
        else {
          const i = Number(opts.ideaIndex ?? 0);
          if (!Number.isInteger(i) || i < 0 || i >= Math.max(1, ideas.length)) throw err(400, 'Pilih nomor ide yang valid');
          d.ideaIndex = i;
        }
      }
      if (gate === 'video_review' && !task.artifact_path) throw err(409, 'Video belum ada');
      if (gate === 'publish') {
        const plan = buildPublishPlan(gateStep.output_json, opts, task.meta);
        await createPublicationJobs(c, task, plan);
        d.publish = plan;
        result.publication = plan;
        if (task.task_type === 'story_episode' && task.series_id) {
          const series = (await c.query("SELECT * FROM series WHERE id=$1 AND status='active'", [task.series_id])).rows[0];
          if (series && task.part_no < series.total_parts) {
            const next = await createEpisodeTask(c, series, task.part_no + 1);
            if (next) result.nextPart = task.part_no + 1;
          } else if (series) await c.query("UPDATE series SET status='finished',updated_at=now() WHERE id=$1", [series.id]);
        }
      }
      await c.query("UPDATE workflow_steps SET status='completed',decision=$2,finished_at=COALESCE(finished_at,now()) WHERE id=$1", [gateStep?.id, JSON.stringify(d)]).catch(() => {});
      if (!gateStep) status = 'completed';
      else if (gate === 'publish') status = 'approved';
      else {
        const left = await c.query("SELECT count(*)::int AS n FROM workflow_steps WHERE task_id=$1 AND status NOT IN ('completed','skipped')", [taskId]);
        status = left.rows[0].n ? 'queued' : 'completed';
      }
    } else if (decision === 'changes_requested') {
      if (gateStep) {
        const from = await c.query('SELECT step_order FROM workflow_steps WHERE task_id=$1 AND step_key=$2', [taskId, route.step]);
        const order = from.rows[0].step_order;
        await c.query(
          `UPDATE workflow_steps SET status='pending',output_text=NULL,output_json=NULL,decision=NULL,started_at=NULL,finished_at=NULL,
             revision_notes=CASE WHEN step_order=$2 THEN $3 ELSE COALESCE(revision_notes,'') END
           WHERE task_id=$1 AND step_order>=$2 AND step_order<=$4`,
          [taskId, order, notes, gateStep.step_order]
        );
        result.restartFrom = route.step;
        result.routeReason = route.reason;
      }
      await c.query('UPDATE tasks SET revision_notes=$2,revision_count=revision_count+1 WHERE id=$1', [taskId, notes]);
      status = 'queued';
    } else {
      await c.query("UPDATE workflow_steps SET status='skipped' WHERE task_id=$1 AND status IN ('pending','awaiting_approval')", [taskId]);
      status = 'rejected';
    }
    await c.query('UPDATE tasks SET status=$2,updated_at=now() WHERE id=$1', [taskId, status]);
    await c.query("UPDATE notifications SET read_at=now() WHERE task_id=$1 AND kind='approval' AND read_at IS NULL", [taskId]);
    await event(c, taskId, 'review_' + decision, { notes, checkpoint: result.checkpoint, restartFrom: result.restartFrom || null });
    if (status === 'completed') await notify(c, { taskId, kind: 'info', title: 'Selesai: ' + task.title });
    return { ok: true, status, ...result };
  });
}

/** Turns Olivier's distribution package + Director overrides into a concrete publishing plan. */
export function buildPublishPlan(pkg, opts = {}, meta = {}) {
  const posts = Array.isArray(pkg?.posts) ? pkg.posts : [];
  const overrides = Array.isArray(opts.posts) ? opts.posts : [];
  const wanted = Array.isArray(opts.platforms) && opts.platforms.length ? opts.platforms : meta?.platforms?.length ? meta.platforms : posts.map((p) => p.platform);
  let when = opts.scheduledAt ? new Date(opts.scheduledAt) : parseLocal(pkg?.recommended_time);
  const min = Date.now() + 5 * 60000;
  if (!when || Number.isNaN(when.getTime()) || when.getTime() < min) when = new Date(min);
  // An affiliate CTA is only allowed when the Director actually gave an affiliate product for this task.
  const affiliate = pkg?.affiliate_cta && meta?.affiliate ? '\n\n' + pkg.affiliate_cta : '';
  return {
    scheduledAt: when.toISOString(),
    posts: [...new Set(wanted)].filter((p) => ['tiktok', 'instagram', 'youtube', 'facebook'].includes(p)).map((platform) => {
      const base = posts.find((p) => p.platform === platform) || posts[0] || { title: '', caption: '', hashtags: [] };
      const o = overrides.find((p) => p.platform === platform) || {};
      const caption = typeof o.caption === 'string' ? o.caption : base.caption + (base.caption.includes(pkg?.affiliate_cta || '\u0000') ? '' : affiliate);
      return { platform, title: String(o.title ?? base.title ?? '').slice(0, 100), caption: caption.slice(0, 2200), hashtags: (o.hashtags || base.hashtags || []).map((h) => String(h).replace(/^#?/, '#')).slice(0, 15) };
    }),
  };
}

/** "YYYY-MM-DD HH:mm" in the office timezone (WIB, UTC+7, no DST). */
export function parseLocal(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(value || ''));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 7, +m[5]));
}

async function createPublicationJobs(c, task, plan) {
  if (!plan.posts.length) throw err(400, 'Pilih minimal satu platform');
  for (const p of plan.posts) {
    const acct = await c.query("SELECT id FROM social_accounts WHERE platform=$1 AND status='connected' ORDER BY updated_at DESC LIMIT 1", [p.platform]);
    await c.query(
      `INSERT INTO publication_jobs(task_id,platform,status,caption,hashtags,title,scheduled_at,account_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(task_id,platform) DO UPDATE SET status=EXCLUDED.status,caption=EXCLUDED.caption,hashtags=EXCLUDED.hashtags,title=EXCLUDED.title,scheduled_at=EXCLUDED.scheduled_at,account_id=EXCLUDED.account_id,attempts=0,error_message=NULL,updated_at=now()`,
      [task.id, p.platform, acct.rowCount ? 'scheduled' : 'awaiting_connection', p.caption, p.hashtags, p.title, plan.scheduledAt, acct.rows[0]?.id || null]
    );
  }
}

export async function retry(pool, taskId) {
  return tx(pool, async (c) => {
    const t = await c.query("SELECT id,task_type FROM tasks WHERE id=$1 AND status='failed' FOR UPDATE", [taskId]);
    if (!t.rowCount) throw err(409, 'Hanya task yang gagal yang bisa diulang');
    await c.query("UPDATE workflow_steps SET status='pending',started_at=NULL,finished_at=NULL WHERE task_id=$1 AND status IN ('failed','running')", [taskId]);
    await c.query("UPDATE tasks SET status='queued',updated_at=now() WHERE id=$1", [taskId]);
    await c.query("UPDATE notifications SET read_at=now() WHERE task_id=$1 AND kind='failed' AND read_at IS NULL", [taskId]);
    await event(c, taskId, 'task_retried');
    return { ok: true, status: 'queued' };
  });
}

export async function cancel(pool, taskId) {
  return tx(pool, async (c) => {
    const t = await c.query('SELECT status FROM tasks WHERE id=$1 FOR UPDATE', [taskId]);
    if (!t.rowCount) throw err(404, 'Task not found');
    if (FINAL.includes(t.rows[0].status)) throw err(409, 'Task sudah selesai/dibatalkan');
    await c.query("UPDATE workflow_steps SET status='skipped' WHERE task_id=$1 AND status IN ('pending','running','awaiting_approval','failed')", [taskId]);
    await c.query("UPDATE task_runs SET status='cancelled',finished_at=now() WHERE task_id=$1 AND status='running'", [taskId]);
    await c.query("UPDATE publication_jobs SET status='cancelled',updated_at=now() WHERE task_id=$1 AND status IN ('awaiting_connection','scheduled','queued','failed')", [taskId]);
    await c.query("UPDATE tasks SET status='cancelled',updated_at=now() WHERE id=$1", [taskId]);
    await c.query('UPDATE notifications SET read_at=now() WHERE task_id=$1 AND read_at IS NULL', [taskId]);
    await event(c, taskId, 'task_cancelled');
    return { ok: true, status: 'cancelled' };
  });
}

/** True if the task was cancelled/rejected while a long job ran (workers check before expensive phases). */
export async function isStopped(pool, taskId) {
  const r = await pool.query('SELECT status FROM tasks WHERE id=$1', [taskId]);
  return !r.rowCount || ['cancelled', 'rejected'].includes(r.rows[0].status);
}

/* ------------------------------------------------------------------ office state (drives the 3D office) */

export async function officeState(pool) {
  const r = await pool.query(`
    SELECT e.id,
      (SELECT json_build_object('taskId',t.id,'title',t.title,'step',s.title,'since',s.started_at) FROM workflow_steps s JOIN tasks t ON t.id=s.task_id
        WHERE s.status='running' AND (s.assignee_id=e.id OR (s.assignee_id IS NULL AND t.assignee_id=e.id)) ORDER BY s.started_at LIMIT 1) AS working_step,
      (SELECT json_build_object('taskId',t.id,'title',t.title,'since',r.started_at) FROM tasks t JOIN task_runs r ON r.task_id=t.id AND r.status='running'
        WHERE t.assignee_id=e.id AND t.task_type='text' AND t.status='in_progress' LIMIT 1) AS working_task,
      (SELECT json_build_object('taskId',t.id,'title',t.title,'step',s.title) FROM workflow_steps s JOIN tasks t ON t.id=s.task_id
        WHERE s.status='awaiting_approval' AND s.assignee_id=e.id LIMIT 1) AS waiting_step,
      (SELECT json_build_object('taskId',t.id,'title',t.title) FROM tasks t WHERE t.assignee_id=e.id AND t.task_type='text' AND t.status='review' LIMIT 1) AS waiting_task,
      (SELECT json_build_object('taskId',t.id,'title',t.title) FROM tasks t LEFT JOIN workflow_steps s ON s.task_id=t.id AND s.status='failed'
        WHERE t.status='failed' AND COALESCE(s.assignee_id,t.assignee_id)=e.id LIMIT 1) AS blocked,
      (SELECT count(*)::int FROM workflow_steps s JOIN tasks t ON t.id=s.task_id WHERE s.assignee_id=e.id AND s.status='pending' AND t.status IN ('queued','in_progress')) AS queued
    FROM employees e WHERE e.active`);
  const out = {};
  for (const x of r.rows) {
    const working = x.working_step || x.working_task;
    const waiting = x.waiting_step || x.waiting_task;
    out[x.id] = working ? { state: 'working', ...working } : waiting ? { state: 'waiting', ...waiting } : x.blocked ? { state: 'blocked', ...x.blocked } : { state: 'available', queued: x.queued };
  }
  return out;
}
