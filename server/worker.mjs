import pg from 'pg';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';
import { renderAnimatedDrama } from './video.mjs';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const exec = promisify(execFile);
const key = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || 'gpt-5-mini';
const poll = Number(process.env.WORKER_POLL_MS || 4000);
const limit = Number(process.env.MAX_DAILY_RUNS || 40);
if (!key) throw new Error('OPENAI_API_KEY is required by worker');
let stopping = false;
let busy = false;

async function createRun(client, taskId) {
  const n = await client.query('SELECT COALESCE(MAX(attempt),0)+1 AS n FROM task_runs WHERE task_id=$1', [taskId]);
  const run = await client.query("INSERT INTO task_runs(task_id,attempt,status,model) VALUES($1,$2,'running',$3) RETURNING id", [taskId, n.rows[0].n, model]);
  return run.rows[0].id;
}

async function claimWorkflowStep() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      SELECT s.id AS step_id,s.step_key,s.title AS step_title,s.instruction AS step_instruction,s.assignee_id AS step_assignee,
             t.*,e.system_prompt
      FROM workflow_steps s
      JOIN tasks t ON t.id=s.task_id
      LEFT JOIN employees e ON e.id=s.assignee_id
      WHERE s.status='pending' AND t.task_type='animated_video' AND t.status IN ('queued','in_progress')
        AND NOT EXISTS (
          SELECT 1 FROM workflow_steps previous
          WHERE previous.task_id=s.task_id AND previous.step_order<s.step_order AND previous.status<>'completed'
        )
      ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,t.created_at,s.step_order
      LIMIT 1 FOR UPDATE OF s,t SKIP LOCKED
    `);
    if (!result.rowCount) { await client.query('COMMIT'); return null; }
    const step = result.rows[0];
    await client.query("UPDATE workflow_steps SET status='running',started_at=now() WHERE id=$1", [step.step_id]);
    await client.query("UPDATE tasks SET status='in_progress',updated_at=now() WHERE id=$1", [step.id]);
    const runId = await createRun(client, step.id);
    await client.query("INSERT INTO task_events(task_id,event_type,payload) VALUES($1,'workflow_step_started',$2)", [step.id, JSON.stringify({ stepKey: step.step_key, assigneeId: step.step_assignee })]);
    await client.query('COMMIT');
    return { ...step, runId, workflow: true };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function claimRegularTask() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      SELECT t.*,e.system_prompt FROM tasks t
      JOIN employees e ON e.id=t.assignee_id
      WHERE t.status IN ('queued','assigned','changes_requested')
        AND NOT EXISTS (SELECT 1 FROM workflow_steps s WHERE s.task_id=t.id)
      ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,t.created_at
      LIMIT 1 FOR UPDATE OF t SKIP LOCKED
    `);
    if (!result.rowCount) { await client.query('COMMIT'); return null; }
    const task = result.rows[0];
    await client.query("UPDATE tasks SET status='in_progress',updated_at=now() WHERE id=$1", [task.id]);
    const runId = await createRun(client, task.id);
    await client.query("INSERT INTO task_events(task_id,event_type) VALUES($1,'task_started')", [task.id]);
    await client.query('COMMIT');
    return { ...task, runId, workflow: false };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function claim() {
  return await claimWorkflowStep() || await claimRegularTask();
}

async function callTextAgent(task, systemPrompt, instruction, context) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    signal: AbortSignal.timeout(90000),
    headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_output_tokens: Number(process.env.MAX_OUTPUT_TOKENS || 2200),
      input: [
        { role: 'system', content: systemPrompt + '\nIkuti job description dan batas kewenanganmu. Jangan mengerjakan peran personnel lain. Jangan mengarang sumber, angka, progres, atau hasil. Laporkan hasil, kendala, dan handoff secara jelas.' },
        { role: 'user', content: 'Task: ' + task.title + '\nBrief utama: ' + task.instruction + '\nAcceptance criteria: ' + (task.acceptance_criteria || 'Hasil akurat, lengkap, dapat diperiksa.') + '\nInstruksi tahap: ' + instruction + '\n\nKonteks dan hasil tahap sebelumnya:\n' + context }
      ]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'OpenAI API HTTP ' + response.status);
  const output = (data.output || []).flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('\n');
  if (!output) throw new Error('Empty model output');
  return { output, inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0 };
}

async function workflowContext(task) {
  const result = await pool.query('SELECT step_key,title,output_text FROM workflow_steps WHERE task_id=$1 AND status=\'completed\' ORDER BY step_order', [task.id]);
  return result.rows.map(step => '### ' + step.title + ' (' + step.step_key + ')\n' + (step.output_text || '')).join('\n\n');
}

async function executeWorkflowStep(task) {
  const context = await workflowContext(task);
  let output = '';
  let video = null;
  if (task.step_key === 'render_video') {
    video = await renderAnimatedDrama({ ...task, workflowContext: context });
    output = video.summary;
    await pool.query("UPDATE tasks SET artifact_path=$2,artifact_mime='video/mp4',artifact_name=$3,updated_at=now() WHERE id=$1", [task.id, video.output, video.name]);
  } else if (task.step_key === 'qa_video') {
    const result = await pool.query('SELECT artifact_path,artifact_name FROM tasks WHERE id=$1', [task.id]);
    if (!result.rowCount || !result.rows[0].artifact_path) throw new Error('MP4 artifact tidak ditemukan');
    const file = result.rows[0].artifact_path;
    const info = await stat(file);
    if (!info.isFile() || info.size < 10000) throw new Error('File MP4 kosong atau terlalu kecil');
    const { stdout } = await exec(process.env.FFPROBE_PATH || 'ffprobe', ['-v','error','-show_entries','format=duration,format_name:stream=codec_type,codec_name,width,height','-of','json',file], { timeout: 30000, maxBuffer: 1024 * 1024 });
    const probe = JSON.parse(stdout);
    const videoStream = (probe.streams || []).find(stream => stream.codec_type === 'video');
    const audioStream = (probe.streams || []).find(stream => stream.codec_type === 'audio');
    const duration = Number(probe.format?.duration || 0);
    if (!videoStream || !audioStream || duration < 5 || videoStream.width !== 720 || videoStream.height !== 1280) throw new Error('QA gagal: stream video/audio, durasi, atau resolusi tidak sesuai');
    output = 'QA PASS\nFile: ' + result.rows[0].artifact_name + '\nSize: ' + info.size + ' bytes\nDuration: ' + duration.toFixed(2) + ' seconds\nVideo: ' + videoStream.codec_name + ' ' + videoStream.width + 'x' + videoStream.height + '\nAudio: ' + audioStream.codec_name;
  } else {
    if (!task.system_prompt) throw new Error('Employee prompt not found for workflow step ' + task.step_key);
    const result = await callTextAgent(task, task.system_prompt, task.step_instruction, context);
    output = result.output;
    await pool.query("UPDATE task_runs SET input_tokens=$2,output_tokens=$3 WHERE id=$1", [task.runId, result.inputTokens, result.outputTokens]);
  }

  await pool.query("UPDATE task_runs SET status='succeeded',output_text=$2,finished_at=now() WHERE id=$1", [task.runId, output]);
  await pool.query("UPDATE workflow_steps SET status='completed',output_text=$2,finished_at=now() WHERE id=$1", [task.step_id, output]);
  const pending = await pool.query("SELECT count(*)::int AS count FROM workflow_steps WHERE task_id=$1 AND status<>'completed'", [task.id]);
  if (pending.rows[0].count === 0) {
    await pool.query("UPDATE tasks SET status='review',updated_at=now() WHERE id=$1", [task.id]);
    await pool.query("INSERT INTO task_events(task_id,event_type) VALUES($1,'task_ready_for_review')", [task.id]);
  } else {
    await pool.query("INSERT INTO task_events(task_id,event_type,payload) VALUES($1,'workflow_step_completed',$2)", [task.id, JSON.stringify({ stepKey: task.step_key, nextStepPending: true })]);
  }
}

async function executeRegularTask(task) {
  const result = await callTextAgent(task, task.system_prompt, task.instruction, '');
  await pool.query("UPDATE task_runs SET status='succeeded',output_text=$2,input_tokens=$3,output_tokens=$4,finished_at=now() WHERE id=$1", [task.runId, result.output, result.inputTokens, result.outputTokens]);
  await pool.query("UPDATE tasks SET status='review',updated_at=now() WHERE id=$1", [task.id]);
  await pool.query("INSERT INTO task_events(task_id,event_type) VALUES($1,'task_ready_for_review')", [task.id]);
}

async function processOne() {
  if (busy || stopping) return;
  busy = true;
  let task = null;
  try {
    task = await claim();
    if (!task) return;
    const daily = await pool.query("SELECT count(*)::int AS n FROM task_runs WHERE started_at>=date_trunc('day',now())");
    if (daily.rows[0].n > limit) throw new Error('Daily run limit reached');
    if (task.workflow) await executeWorkflowStep(task);
    else await executeRegularTask(task);
  } catch (error) {
    console.error('task failed', task?.id, error.message);
    if (task?.runId) await pool.query("UPDATE task_runs SET status='failed',error_message=$2,finished_at=now() WHERE id=$1", [task.runId, String(error.message).slice(0,1000)]).catch(() => {});
    if (task?.workflow && task.step_id) await pool.query("UPDATE workflow_steps SET status='failed' WHERE id=$1", [task.step_id]).catch(() => {});
    if (task?.id) {
      await pool.query("UPDATE tasks SET status='failed',updated_at=now() WHERE id=$1", [task.id]).catch(() => {});
      await pool.query("INSERT INTO task_events(task_id,event_type,payload) VALUES($1,'task_failed',$2)", [task.id, JSON.stringify({ error: String(error.message).slice(0,1000), stepKey: task.step_key || null })]).catch(() => {});
    }
  } finally { busy = false; }
}

console.log('LS Office worker online; model=' + model);
const timer = setInterval(() => void processOne(), poll);
void processOne();
for (const signal of ['SIGTERM','SIGINT']) process.on(signal, async () => { stopping = true; clearInterval(timer); await pool.end(); process.exit(0); });
