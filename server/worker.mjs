import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';
import { startWorker } from './lib/runner.mjs';
import { respond, listElevenVoices, narrationVoices, voiceNamedIn } from './lib/ai.mjs';
import { workContext } from './lib/engine.mjs';
import { answerNextMessage } from './lib/chat.mjs';
import { config } from './lib/config.mjs';
import { SCHEMAS, stepDef, durationTarget } from './workflows.mjs';
import { formatOutput } from './lib/format.mjs';
import { hasCues } from './video/produce.mjs';

const exec = promisify(execFile);

const RULES = '\nIkuti job description dan batas kewenanganmu. Jangan mengerjakan peran personnel lain. Jangan mengarang sumber, angka, progres, atau hasil. Tulis dalam bahasa Indonesia kecuali diminta lain.';
const RESEARCH_RULES = '\nUntuk riset, gunakan web_search secara nyata. Cantumkan sumber yang benar-benar dibuka (judul + URL). Pisahkan fakta dari opini.';

async function agentStep(job, { pool }) {
  const ctx = { pool, taskId: job.id, runId: job.runId, stepKey: job.step_key || 'task' };
  const context = await workContext(pool, job);
  if (!job.workflow) {
    const research = job.assignee_id === 'nadia' || /riset|research|referensi|tren|market/i.test(job.title + ' ' + job.instruction);
    const r = await respond({ system: job.system_prompt + RULES + (research ? RESEARCH_RULES : ''), user: context, webSearch: research, ctx });
    await pool.query('UPDATE task_runs SET input_tokens=$2,output_tokens=$3 WHERE id=$1', [job.runId, r.inputTokens, r.outputTokens]);
    return { text: r.text };
  }
  const def = stepDef(job.task_type, job.step_key);
  if (!job.system_prompt) throw new Error('Employee prompt not found for step ' + job.step_key);
  let schema = def?.schema ? SCHEMAS[def.schema] : null;
  let voiceNote = '';
  if (job.step_key === 'audio_direction' && config.ttsProvider === 'elevenlabs') {
    // Maya chooses from the voices that really exist on the ElevenLabs account; a series keeps its first voice.
    const voices = narrationVoices(await listElevenVoices()).slice(0, 80);
    let fixed = job.series_id ? (await pool.query('SELECT voice_name FROM series WHERE id=$1', [job.series_id])).rows[0]?.voice_name : null;
    // The Director can move a series to another voice by naming it in a revision ("ganti suara ke Yudo").
    const asked = voiceNamedIn([job.step_revision_notes, job.revision_notes].filter(Boolean).join(' '), voices);
    if (asked && job.series_id && asked.name !== fixed) {
      await pool.query('UPDATE series SET voice_id=$2,voice_name=$3,updated_at=now() WHERE id=$1', [job.series_id, asked.id, asked.name]);
      fixed = asked.name;
    } else if (asked && !job.series_id) fixed = asked.name;
    if (!voices.length) throw new Error('Akun ElevenLabs belum punya suara');
    const names = fixed ? [fixed] : [...new Set(voices.map((v) => v.name))];
    schema = { ...schema, properties: { ...schema.properties, voice: { type: 'string', enum: names, description: 'ElevenLabs voice name' } } };
    voiceNote = fixed
      ? '\n\n### SUARA SERI SUDAH DIKUNCI: ' + fixed + ' (pakai suara ini; tulis arahanmu untuk catatan saja).'
      : '\n\n### PILIHAN SUARA ELEVENLABS (pilih satu yang paling cocok untuk narasi bahasa Indonesia ini):\n' + voices.map((v) => '- ' + v.name + ' — ' + [Object.values(v.labels).join(', '), v.description].filter(Boolean).join(' · ')).join('\n');
  }
  // The current definition wins over the copy stored at task creation, so prompt fixes reach tasks in flight.
  const instruction = def?.instruction || job.step_instruction;
  const ask = (extra = '') => respond({
    system: job.system_prompt + RULES + (def?.webSearch ? RESEARCH_RULES : ''),
    user: 'INSTRUKSI TAHAPMU (' + job.step_title + '):\n' + instruction + voiceNote + '\n\n' + context + extra,
    schema, schemaName: job.step_key, webSearch: Boolean(def?.webSearch), ctx,
    maxOutputTokens: def?.webSearch ? 16000 : 12000, timeoutMs: 300000,
  });
  let r = await ask();
  let problem = r.json ? await validate(pool, job, r.json) : null;
  if (problem) {
    // One self-correction round: the agent sees exactly what was wrong.
    r = await ask('\n\n### HASILMU SEBELUMNYA DITOLAK QA, PERBAIKI:\n' + problem + '\n\nHasil sebelumnya:\n' + JSON.stringify(r.json).slice(0, 8000));
    problem = await validate(pool, job, r.json);
    if (problem) throw new Error('Output ' + job.step_title + ' tidak lolos validasi: ' + problem);
  }
  await pool.query('UPDATE task_runs SET input_tokens=input_tokens+$2,output_tokens=output_tokens+$3 WHERE id=$1', [job.runId, r.inputTokens, r.outputTokens]);
  return { text: r.json ? formatOutput(job.step_key, r.json) : r.text, json: r.json };
}

const words = (s) => String(s || '').split(/\s+/).filter(Boolean).length;

/** Rules the JSON schema cannot express. Returns a problem description, or null when the output is fine. */
async function validate(pool, job, json) {
  const key = job.step_key;
  if (key === 'ideas' && !(json.ideas?.length >= 2)) return 'Berikan 3-5 ide, bukan ' + (json.ideas?.length || 0);
  if (key === 'series_plan' && !(json.episodes?.length >= 2 && json.episodes.length <= 30)) return 'Rancangan seri butuh 2-30 part';
  if (key === 'character_design' && !json.characters?.length) return 'Desain minimal satu tokoh';
  if (key === 'script') {
    const total = json.scenes.reduce((n, x) => n + words(x.spoken), 0);
    const bad = json.scenes.map((x, i) => (hasCues(x.spoken) || /[()[\]]/.test(x.spoken) ? i + 1 : 0)).filter(Boolean);
    if (bad.length) return 'Adegan ' + bad.join(', ') + ' masih berisi arahan/label/tanda kurung di field spoken. Pindahkan ke visual_note.';
    const d = durationTarget(job.task_type, job.meta);
    const [lo, hi] = [Math.round(d.words[0] * 0.9), Math.round(d.words[1] * 1.1)];
    if (total < lo || total > hi) return 'Total kata yang diucapkan ' + total + '; harus ' + d.words[0] + '-' + d.words[1] + ' supaya durasinya ' + d.label + '.';
    if (json.scenes.length < Math.max(3, d.scenes[0] - 2)) return 'Adegan terlalu sedikit untuk durasi ' + d.label + '.';
  }
  if (key === 'storyboard') {
    const d = durationTarget(job.task_type, job.meta);
    if (!(json.scenes?.length >= 3 && json.scenes.length <= d.scenes[1] + 4)) return 'Storyboard untuk ' + d.label + ' butuh ' + d.scenes[0] + '-' + d.scenes[1] + ' adegan';
    const bad = json.scenes.map((x, i) => (hasCues(x.narration) || /[()[\]]/.test(x.narration) ? i + 1 : 0)).filter(Boolean);
    if (bad.length) return 'Narasi adegan ' + bad.join(', ') + ' berisi arahan/label. Narasi hanya kata yang diucapkan.';
    for (const [i, x] of json.scenes.entries()) {
      if (!x.narration.trim()) return 'Adegan ' + (i + 1) + ' tidak punya narasi';
      if (json.template !== 'cards' && x.image_prompt.trim().length < 20 && x.card.kind === 'none') return 'Adegan ' + (i + 1) + ' tidak punya visual';
      if (job.task_type === 'story_episode' && json.template !== 'story') return 'Episode seri wajib memakai template story';
    }
    if (words(json.hook_text) > 12) return 'hook_text maksimal 10 kata';
    const script = (await pool.query("SELECT output_json FROM workflow_steps WHERE task_id=$1 AND step_key='script'", [job.id])).rows[0]?.output_json;
    if (script?.scenes) {
      const want = script.scenes.reduce((n, x) => n + words(x.spoken), 0);
      const got = json.scenes.reduce((n, x) => n + words(x.narration), 0);
      if (Math.abs(got - want) > Math.max(8, want * 0.12)) return 'Narasi storyboard ' + got + ' kata, naskah Felix ' + want + ' kata. Salin persis field spoken dari naskah.';
    }
  }
  if (key === 'distribution') {
    if (!json.posts?.length) return 'Siapkan caption minimal untuk satu platform';
    const leak = json.posts.find((p) => /\b(catatan|director|ethan|render|dipangkas|persetujuan|internal|draft|TODO)\b/i.test(p.caption + ' ' + p.title));
    if (leak) return 'Caption ' + leak.platform + ' berisi catatan internal. Caption tayang publik; pindahkan catatan ke schedule_reason.';
    if (!job.meta?.affiliate && (json.affiliate_cta.trim() || json.posts.some((p) => /affiliate|keranjang kuning/i.test(p.caption)))) return 'Task ini tidak punya produk affiliate: kosongkan affiliate_cta dan jangan menyebut affiliate/keranjang di caption.';
  }
  return null;
}

async function qaVideo(job, { pool }) {
  const r = await pool.query('SELECT artifact_path,artifact_name FROM tasks WHERE id=$1', [job.id]);
  const file = r.rows[0]?.artifact_path;
  if (!file) throw new Error('MP4 artifact tidak ditemukan');
  const info = await stat(file);
  if (!info.isFile() || info.size < 50000) throw new Error('File MP4 kosong atau terlalu kecil');
  const { stdout } = await exec(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', file], { timeout: 30000, maxBuffer: 1 << 20 });
  const probe = JSON.parse(stdout);
  const v = probe.streams?.find((s) => s.codec_type === 'video');
  const a = probe.streams?.find((s) => s.codec_type === 'audio');
  const duration = Number(probe.format?.duration || 0);
  const checks = [
    ['Stream video H.264', v?.codec_name === 'h264'],
    ['Stream audio AAC', a?.codec_name === 'aac'],
    ['Resolusi ' + config.videoWidth + 'x' + config.videoHeight, v?.width === config.videoWidth && v?.height === config.videoHeight],
    ['Durasi 15-240 detik', duration >= 15 && duration <= 240],
  ];
  const lines = checks.map(([label, ok]) => (ok ? '✓ ' : '✗ ') + label);
  if (checks.some(([, ok]) => !ok)) throw new Error('QA gagal:\n' + lines.join('\n'));
  return { text: 'QA PASS\n' + lines.join('\n') + '\nDurasi: ' + duration.toFixed(1) + ' detik · Ukuran: ' + (info.size / 1048576).toFixed(1) + ' MB\nVideo siap direview Director.' };
}

await startWorker({
  name: 'ls-office-worker',
  executors: ['agent', 'qa'],
  execute: (job, opts) => (job.executor === 'qa' ? qaVideo(job, opts) : agentStep(job, opts)),
  extraLoops: [{ every: 1500, fn: answerNextMessage }],
});
