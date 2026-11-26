import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

const API = 'https://api.openai.com/v1';
const key = process.env.OPENAI_API_KEY;
const textModel = process.env.OPENAI_MODEL || 'gpt-5-mini';
const imageModel = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
const speechModel = process.env.OPENAI_TTS_MODEL || 'tts-1';
const mediaRoot = path.resolve(process.env.MEDIA_ROOT || '/opt/ls-office/storage/videos');

async function openai(endpoint, payload, timeoutMs = 180000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(API + endpoint, { method: 'POST', signal: controller.signal, headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'OpenAI API HTTP ' + response.status);
    return data;
  } finally { clearTimeout(timer); }
}

function run(command, args, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-12000); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(command + ' failed (' + code + '): ' + stderr)); });
  });
}

function extractText(response) {
  return (response.output || []).flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('\n');
}

function parseStory(text) {
  const cleaned = text.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  const story = JSON.parse(cleaned);
  if (!Array.isArray(story.scenes) || story.scenes.length < 4 || story.scenes.length > 7 || !story.narration) throw new Error('Model returned an invalid video storyboard');
  for (const scene of story.scenes) if (typeof scene.image_prompt !== 'string' || scene.image_prompt.length < 30) throw new Error('Storyboard scene prompt is missing');
  return story;
}

export async function renderAnimatedDrama(task) {
  if (!key) throw new Error('OPENAI_API_KEY is required');
  await mkdir(mediaRoot, { recursive: true, mode: 0o750 });
  const work = await mkdtemp(path.join(os.tmpdir(), 'ls-office-video-'));
  const id = randomUUID();
  const output = path.join(mediaRoot, id + '.mp4');
  try {
    const storyResponse = await openai('/responses', {
      model: textModel,
      max_output_tokens: 2600,
      input: [
        { role: 'system', content: 'You are a professional animated short-film writer and storyboard director. Return ONLY valid JSON. Create a compelling Indonesian dramatic animated short for TikTok, 9:16 vertical, 35-50 seconds, 5 scenes. Maintain exactly the same character identities and clothing across scenes. Story must have a strong 2-second hook, emotional conflict, twist, and satisfying ending. Use this JSON shape: {"title":"...","style":"...","character_bible":"...","narration":"Indonesian narration suitable for voiceover","scenes":[{"duration_seconds":8,"dialogue":"...","image_prompt":"Detailed English image generation prompt for one cinematic 9:16 animated film frame. Include full character bible, scene action, facial expression, environment, lighting, composition. No text, no watermark."}]}. Each scene image prompt must repeat character appearance details from character_bible for visual consistency.' },
        { role: 'user', content: 'Create the animated drama using the completed personnel handoffs below as the source of truth. Preserve the approved script and storyboard; do not restart ideation or contradict them. Use Maya audio direction when producing narration. Task title: ' + task.title + '\nDirector brief: ' + task.instruction + '\nAcceptance criteria: ' + (task.acceptance_criteria || 'Strong story, coherent character design, cinematic visuals, complete beginning-middle-ending.') + '\n\nCOMPLETED TEAM HANDOFFS:\n' + (task.workflowContext || 'No team handoffs were supplied.') }
      ]
    });
    const story = parseStory(extractText(storyResponse));
    const images = [];
    for (let i = 0; i < story.scenes.length; i++) {
      const image = await openai('/images/generations', { model: imageModel, prompt: story.scenes[i].image_prompt, size: '1024x1536', quality: 'medium', output_format: 'png' }, 240000);
      const encoded = image.data?.[0]?.b64_json;
      if (!encoded) throw new Error('Image generation returned no image for scene ' + (i + 1));
      const imagePath = path.join(work, 'scene-' + String(i + 1).padStart(2, '0') + '.png');
      await writeFile(imagePath, Buffer.from(encoded, 'base64'));
      images.push(imagePath);
    }
    const audioController = new AbortController();
    const audioTimer = setTimeout(() => audioController.abort(), 180000);
    let audioResponse;
    try {
      audioResponse = await fetch(API + '/audio/speech', { method: 'POST', signal: audioController.signal, headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: JSON.stringify({ model: speechModel, voice: 'alloy', input: story.narration.slice(0, 4000), response_format: 'mp3' }) });
      if (!audioResponse.ok) throw new Error('Speech generation failed: ' + (await audioResponse.text()).slice(0, 1000));
      await writeFile(path.join(work, 'voice.mp3'), Buffer.from(await audioResponse.arrayBuffer()));
    } finally { clearTimeout(audioTimer); }
    const audioPath = path.join(work, 'voice.mp3');
    const ffmpegArgs = ['-y'];
    for (let i = 0; i < images.length; i++) ffmpegArgs.push('-loop', '1', '-t', String(story.scenes[i].duration_seconds || 8), '-i', images[i]);
    ffmpegArgs.push('-i', audioPath);
    const filters = images.map((_, i) => '[' + i + ':v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,zoompan=z="min(zoom+0.0009,1.12)":d=1:s=720x1280:fps=24,setsar=1,format=yuv420p[v' + i + ']').join(';');
    const concat = images.map((_, i) => '[v' + i + ']').join('') + 'concat=n=' + images.length + ':v=1:a=0[outv]';
    ffmpegArgs.push('-filter_complex', filters + ';' + concat, '-map', '[outv]', '-map', String(images.length) + ':a:0', '-shortest', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output);
    await run(process.env.FFMPEG_PATH || 'ffmpeg', ffmpegArgs, 600000);
    const summary = [
      'VIDEO PRODUKSI SELESAI',
      'Judul: ' + story.title,
      'Gaya visual: ' + story.style,
      'Karakter: ' + story.character_bible,
      'Narasi: ' + story.narration,
      '',
      'Storyboard:',
      ...story.scenes.map((scene, i) => (i + 1) + '. ' + (scene.duration_seconds || 8) + ' detik — ' + scene.dialogue)
    ].join('\n');
    return { output, name: (story.title || 'logisource-drama').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) + '.mp4', summary };
  } catch (error) {
    await rm(output, { force: true }).catch(() => {});
    throw error;
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}
