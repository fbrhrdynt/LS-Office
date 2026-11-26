import { mkdir, writeFile, readFile, stat, rename, access } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import http from 'node:http';
import path from 'node:path';
import { config } from '../lib/config.mjs';
import { generateImage, editImage, speak, recordSpeech, transcribeWords, speakEleven, listElevenVoices } from '../lib/ai.mjs';
import { isStopped } from '../lib/engine.mjs';

const exec = promisify(execFile);
const sha = (v) => createHash('sha256').update(v).digest('hex').slice(0, 24);
const exists = (p) => access(p).then(() => true, () => false);

async function duration(file) {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { timeout: 30000 });
  return Number(stdout.trim());
}

function run(cmd, args, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], signal });
    let err = '';
    child.stderr.on('data', (c) => { err = (err + c).slice(-4000); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(cmd + ' failed (' + code + '): ' + err))));
  });
}

/** Text for the TTS engine: Maya's pronunciation list applied (captions keep the original spelling). */
export function spokenText(text, pronunciations = []) {
  let out = text;
  for (const p of pronunciations) if (p.written && p.spoken) out = out.split(p.written).join(p.spoken);
  return out;
}

/** Removes stage directions that must not be read aloud: (notes), [notes], "Adegan 1:" labels, stray quotes. */
export function cleanNarration(text) {
  const t = String(text || '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/^\s*(adegan|scene)\s*\d+\s*[:.-]\s*/gim, '').replace(/["“”]/g, '');
  return t
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !CUE_SENTENCE.test(sentence))
    .map((sentence) => sentence.replace(CUE_LABEL, '').replace(/^./, (c) => c.toUpperCase()))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
/** Sentences that are production directions, not narration. */
export const CUE_SENTENCE = /^\s*(visual|tampilkan|perlihatkan|zoom|cut|b-roll|sfx|musik|transisi|kamera|hook cepat|on-screen|teks layar)\b/i;
const CUE_LABEL = /^\s*(penjelasan singkat|catatan penting|catatan|cta|hook|narasi|vo|voice-over|penutup)\s*:\s*/i;
/** True if a narration line still contains directions (used to reject and self-correct agent output). */
export const hasCues = (text) => /\b(visual|catatan|arahan|b-roll|sfx|on-screen)\s*:/i.test(text) || String(text).split(/(?<=[.!?])\s+/).some((x) => CUE_SENTENCE.test(x));

/** Caption words: the script's own spelling when the transcript has the same word count, else the transcript. */
export function alignWords(narration, transcript, offset) {
  const tokens = narration.split(/\s+/).filter(Boolean);
  const useScript = tokens.length === transcript.length;
  return transcript.map((w, i) => ({ text: useScript ? tokens[i] : w.word, start: +(w.start + offset).toFixed(3), end: +(w.end + offset).toFixed(3) }));
}

/** Evenly spaced fallback timing when transcription is unavailable. */
export function evenWords(narration, start, end) {
  const tokens = narration.split(/\s+/).filter(Boolean);
  const step = (end - start) / Math.max(1, tokens.length);
  return tokens.map((t, i) => ({ text: t, start: +(start + i * step).toFixed(3), end: +(start + (i + 0.9) * step).toFixed(3) }));
}

/** Serves the job folder to the headless browser on 127.0.0.1 only, for the duration of the render. */
function serveFolder(root) {
  const server = http.createServer(async (req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try {
      const info = await stat(file);
      const type = file.endsWith('.png') ? 'image/png' : file.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream';
      const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
      if (range) {
        const startB = Number(range[1]);
        const endB = range[2] ? Number(range[2]) : info.size - 1;
        res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${startB}-${endB}/${info.size}`, 'accept-ranges': 'bytes', 'content-length': endB - startB + 1, 'access-control-allow-origin': '*' });
        createReadStream(file, { start: startB, end: endB }).pipe(res);
      } else {
        res.writeHead(200, { 'content-type': type, 'content-length': info.size, 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' });
        createReadStream(file).pipe(res);
      }
    } catch { res.writeHead(404).end(); }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, base: 'http://127.0.0.1:' + server.address().port + '/' })));
}

async function pool2(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

/**
 * Builds the MP4 for a video task from the team's handoffs.
 * job: claimed render step; returns { text, artifact }.
 */
export async function produceVideo(job, { pool, signal }) {
  const ctx = { pool, taskId: job.id, runId: job.runId, stepKey: 'render_video' };
  const steps = await pool.query("SELECT step_key,output_json,output_text FROM workflow_steps WHERE task_id=$1 AND status='completed'", [job.id]);
  const by = Object.fromEntries(steps.rows.map((s) => [s.step_key, s]));
  const board = by.storyboard?.output_json;
  if (!board?.scenes?.length) throw new Error('Storyboard Ethan belum ada atau tidak valid');
  for (const s of board.scenes) s.narration = cleanNarration(s.narration);
  board.scenes = board.scenes.filter((s) => s.narration);
  const audio = by.audio_direction?.output_json || { voice: 'ash', instructions: 'Energetic Indonesian short-video narrator, fast pace.', pronunciations: [] };

  const taskDir = path.join(config.workRoot, job.id);
  const cache = path.join(taskDir, 'cache');
  const work = path.join(taskDir, 'run-' + job.runId);
  await mkdir(cache, { recursive: true });
  await mkdir(work, { recursive: true });

  // Series: one character sheet per series, used as the reference for every scene of every part.
  const series = job.series_id ? (await pool.query('SELECT * FROM series WHERE id=$1', [job.series_id])).rows[0] : null;
  const design = series?.design || {};
  let sheet = series?.character_sheet || null;
  if (series && !(sheet && (await exists(sheet)))) {
    sheet = path.join(config.mediaRoot, 'series', series.id, 'characters.png');
    await mkdir(path.dirname(sheet), { recursive: true });
    const who = (design.characters || []).map((c, i) => `(${i + 1}) ${c.name}: ${c.appearance}`).join('; ');
    await writeFile(sheet + '.tmp', await generateImage({ prompt: `Character reference sheet, full body, front view, characters standing side by side in a row, plain light grey background, even lighting, no text, no labels. Characters: ${who}. Style: ${design.visual_style || board.visual_style}`, size: '1536x1024', ctx }));
    await rename(sheet + '.tmp', sheet);
    await pool.query('UPDATE series SET character_sheet=$2,updated_at=now() WHERE id=$1', [series.id, sheet]);
  }

  // 1. Scene images (cached by prompt: a revision that only changes the voice does not pay for images again).
  const bible = series ? (design.characters || []).map((c) => c.name + ': ' + c.appearance).join('; ') : board.character_bible;
  const style = [series ? design.visual_style : board.visual_style, bible && bible !== 'none' ? 'Recurring characters (keep identical): ' + bible : ''].filter(Boolean).join('. ');
  const images = await pool2(board.scenes, 2, async (scene, i) => {
    if (!scene.image_prompt?.trim()) return null;
    const prompt = (sheet ? 'Use the EXACT character designs (faces, hijab/hair, clothes, colors, proportions) from the reference character sheet. ' : '') +
      `${scene.image_prompt}. ${style}. Vertical 9:16 cinematic frame for a short video, subject centered with room at the top and bottom for captions. No text, no letters, no watermark, no logo.`;
    const file = path.join(cache, 'img-' + sha(prompt + (sheet || '')) + '.png');
    if (!(await exists(file))) {
      if (await isStopped(pool, job.id)) throw new Error('Task dibatalkan');
      await writeFile(file + '.tmp', sheet ? await editImage({ prompt, refs: [sheet], ctx }) : await generateImage({ prompt, ctx }));
      await rename(file + '.tmp', file);
    }
    const name = 'scene-' + String(i + 1).padStart(2, '0') + '.png';
    await writeFile(path.join(work, name), await readFile(file));
    return name;
  });

  // 2. Voice-over per scene, so scene timing follows the real audio.
  const eleven = config.ttsProvider === 'elevenlabs';
  let voiceId = null;
  if (eleven) {
    if (series?.voice_id) voiceId = series.voice_id;
    else {
      const voices = await listElevenVoices();
      voiceId = voices.find((v) => v.name === audio.voice)?.id || config.elevenVoiceId || voices[0]?.id;
      if (!voiceId) throw new Error('Tidak ada suara ElevenLabs yang bisa dipakai');
      if (series) await pool.query('UPDATE series SET voice_id=$2,voice_name=$3,updated_at=now() WHERE id=$1 AND voice_id IS NULL', [series.id, voiceId, voices.find((v) => v.id === voiceId)?.name || audio.voice]);
    }
  }
  const voiceKey = eleven ? 'eleven|' + config.elevenModel + '|' + voiceId + '|' + config.elevenSpeed : audio.voice + '|' + audio.instructions + '|' + config.ttsModel;
  const said = board.scenes.map((scene) => spokenText(scene.narration, audio.pronunciations));
  const clips = await pool2(board.scenes, eleven ? 2 : 3, async (scene, i) => {
    const file = path.join(cache, 'vo-' + sha(voiceKey + '|' + said[i]) + '.mp3');
    const timing = file.replace(/\.mp3$/, '.words.json');
    if (!(await exists(file))) {
      if (eleven) {
        const r = await speakEleven({ text: said[i], voiceId, previousText: said[i - 1] || '', nextText: said[i + 1] || '', ctx });
        await writeFile(timing, JSON.stringify(r.words));
        await writeFile(file, r.bytes);
      } else {
        await writeFile(file, await speak({ input: said[i], voice: audio.voice, instructions: audio.instructions, ctx }));
        await recordSpeech(ctx, await duration(file));
      }
    }
    const words = (await exists(timing)) ? JSON.parse(await readFile(timing, 'utf8')) : null;
    return { file, seconds: await duration(file), words };
  });

  // 3. One narration track with a short breath between scenes.
  const gap = 0.12;
  const listFile = path.join(work, 'concat.txt');
  const silence = path.join(work, 'gap.mp3');
  await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', String(gap), '-q:a', '9', silence], signal);
  await writeFile(listFile, clips.flatMap((c, i) => ["file '" + c.file.replace(/'/g, "'\\''") + "'", ...(i < clips.length - 1 ? ["file '" + silence + "'"] : [])]).join('\n'));
  const narration = path.join(work, 'narration.mp3');
  await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-ar', '44100', '-ac', '1', '-b:a', '160k', narration], signal);

  // 4. Word timings per scene (Whisper), shifted to the scene's place in the track.
  let t = 0;
  const scenes = [];
  const words = [];
  for (const [i, scene] of board.scenes.entries()) {
    const start = t;
    const end = t + clips[i].seconds;
    let w;
    try {
      // ElevenLabs returns timing with the audio; OpenAI voices are timed with Whisper.
      w = alignWords(scene.narration, clips[i].words?.length ? clips[i].words : await transcribeWords({ file: clips[i].file, ctx }), start);
    } catch (e) { console.warn('transcribe failed, even timing', e.message); w = evenWords(scene.narration, start, end); }
    words.push(...w);
    scenes.push({ start, end: i === board.scenes.length - 1 ? end + (series ? 2.4 : 0.8) : end + gap, image: images[i], labels: board.template === 'story' ? [] : scene.labels || [], card: scene.card });
    t = end + gap;
  }
  const total = scenes.at(-1).end;
  if (await isStopped(pool, job.id)) throw new Error('Task dibatalkan');

  // 5. Render with Remotion (bundle built at deploy time).
  const { renderMedia, selectComposition, makeCancelSignal } = await import('@remotion/renderer');
  const { server, base } = await serveFolder(work);
  const out = path.join(config.mediaRoot, 'videos', job.id + '-r' + (job.revision_count || 0) + '-' + job.runId.slice(0, 8) + '.mp4');
  await mkdir(path.dirname(out), { recursive: true });
  const { cancelSignal, cancel } = makeCancelSignal();
  const onAbort = () => cancel();
  signal?.addEventListener('abort', onAbort);
  const started = Date.now();
  try {
    const inputProps = {
      template: board.template, fps: config.videoFps, width: config.videoWidth, height: config.videoHeight,
      hookText: board.template === 'story' ? '' : board.hook_text || '', audio: base + 'narration.mp3', duration: total,
      partLabel: job.part_no ? 'PART ' + job.part_no : '', mainName: series?.plan?.characters?.[0]?.name || '', endLabel: series ? (job.part_no < series.total_parts ? 'Bersambung ke Part ' + (job.part_no + 1) : 'Tamat') : '',
      scenes: scenes.map((s) => ({ ...s, image: s.image ? base + s.image : null })), words,
    };
    await writeFile(path.join(work, 'props.json'), JSON.stringify(inputProps));
    const serveUrl = config.remotionBundle;
    const composition = await selectComposition({ serveUrl, id: 'Short', inputProps, logLevel: 'error' });
    await renderMedia({
      composition, serveUrl, inputProps, codec: 'h264', outputLocation: out + '.part.mp4', concurrency: config.renderConcurrency,
      crf: 23, x264Preset: 'veryfast', audioCodec: 'aac', audioBitrate: '160k', licenseKey: 'free-license', cancelSignal, logLevel: 'error',
      timeoutInMilliseconds: 120000,
    });
    await rename(out + '.part.mp4', out);
  } finally {
    signal?.removeEventListener('abort', onAbort);
    server.close();
  }
  await pool.query("INSERT INTO usage_ledger(task_id,run_id,step_key,kind,model,units,cost_usd) VALUES($1,$2,'render_video','render','remotion',$3,0)", [job.id, job.runId, JSON.stringify({ seconds: total, renderSeconds: Math.round((Date.now() - started) / 1000) })]);

  const name = (board.title || 'video').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) + '.mp4';
  const text = [
    'VIDEO SELESAI DIRENDER',
    'Judul: ' + board.title,
    'Template: ' + board.template + ' · ' + board.scenes.length + ' adegan · ' + total.toFixed(1) + ' detik',
    'Suara: ' + (eleven ? 'ElevenLabs · ' + (series?.voice_name || audio.voice) : 'OpenAI · ' + audio.voice),
    'Waktu render: ' + Math.round((Date.now() - started) / 1000) + ' detik',
  ].join('\n');
  return { text, artifact: { path: out, mime: 'video/mp4', name } };
}

