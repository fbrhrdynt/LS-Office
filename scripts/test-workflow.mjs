// Workflow definitions and pure engine helpers (no database, no network).
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';
import { VIDEO_WORKFLOW, WEB_BUILD_WORKFLOW, WEB_UPDATE_WORKFLOW, STORY_SERIES_WORKFLOW, STORY_EPISODE_WORKFLOW, SCHEMAS, stepDef } from '../server/workflows.mjs';
import { buildPublishPlan, parseLocal } from '../server/lib/engine.mjs';
import { cleanNarration, alignWords, spokenText, evenWords, hasCues, friendlyVoiceError } from '../server/video/produce.mjs';
import { formatOutput } from '../server/lib/format.mjs';
import { alignmentToWords, narrationVoices } from '../server/lib/ai.mjs';

let n = 0;
const t = (name, fn) => { fn(); n++; };

t('video: each role does its own step, gates where the Director decides', () => {
  assert.deepEqual(VIDEO_WORKFLOW.map((s) => [s.key, s.employeeId, s.executor]), [
    ['ideas', 'nadia', 'agent'], ['script', 'felix', 'agent'], ['storyboard', 'ethan', 'agent'], ['audio_direction', 'maya', 'agent'],
    ['render_video', null, 'render'], ['qa_video', 'daren', 'qa'], ['distribution', 'olivier', 'agent'],
  ]);
  assert.deepEqual(VIDEO_WORKFLOW.filter((s) => s.gate).map((s) => s.gate), ['choose_idea', 'video_review', 'publish']);
  assert.deepEqual(stepDef('animated_video', 'qa_video').revisable, ['script', 'storyboard', 'audio_direction', 'render_video']);
});
t('story series: Nadia ideas, Director approves the plan, every part reviewed and approved for posting', () => {
  assert.deepEqual(STORY_SERIES_WORKFLOW.map((s) => [s.key, s.employeeId, s.gate || null]), [['ideas', 'nadia', 'choose_idea'], ['series_plan', 'felix', 'approve_series'], ['character_design', 'ethan', null]]);
  assert.deepEqual(STORY_EPISODE_WORKFLOW.map((s) => s.key), ['script', 'storyboard', 'audio_direction', 'render_video', 'qa_video', 'distribution']);
  assert.deepEqual(STORY_EPISODE_WORKFLOW.filter((s) => s.gate).map((s) => s.gate), ['video_review', 'publish']);
  assert.match(STORY_EPISODE_WORKFLOW[0].instruction, /cliffhanger/);
  assert.ok(SCHEMAS.STORYBOARD_SCHEMA.properties.template.enum.includes('story'));
});
t('web: plan approved before code, review before release, code only by devagent', () => {
  for (const wf of [WEB_BUILD_WORKFLOW, WEB_UPDATE_WORKFLOW]) {
    const keys = wf.map((s) => s.key);
    assert.ok(keys.indexOf('plan') < keys.indexOf('implement') && keys.indexOf('qa_web') < keys.indexOf('release'));
    assert.equal(wf.find((s) => s.key === 'plan').gate, 'approve_plan');
    assert.equal(wf.find((s) => s.key === 'qa_web').gate, 'web_review');
    assert.ok(wf.filter((s) => ['implement', 'qa_web', 'release'].includes(s.key)).every((s) => s.executor === 'devagent'));
  }
});
t('structured outputs use strict-compatible schemas', () => {
  const walk = (s) => {
    if (s.type === 'object') { assert.equal(s.additionalProperties, false); assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort()); Object.values(s.properties).forEach(walk); }
    if (s.type === 'array') { assert.equal(s.minItems, undefined); walk(s.items); }
  };
  Object.values(SCHEMAS).forEach(walk);
});
t('narration: stage notes are never read aloud', () => {
  assert.equal(cleanNarration('Adegan 2: "Arus terfokus ke benda kerja. (fakta: las basah)" [zoom]'), 'Arus terfokus ke benda kerja.');
  assert.equal(cleanNarration('Rumah itu kosong. Close up menunjukan tekstur dan noda.'), 'Rumah itu kosong.');
  assert.ok(hasCues('Close up menunjukan tekstur dan noda.'));
  assert.equal(spokenText('Suhu 4.000 °C', [{ written: '4.000 °C', spoken: 'empat ribu derajat celcius' }]), 'Suhu empat ribu derajat celcius');
});
t('captions keep the script spelling when word counts match', () => {
  const words = alignWords('Kenapa las 4.000°C?', [{ word: 'kenapa', start: 0, end: 0.4 }, { word: 'las', start: 0.4, end: 0.6 }, { word: '4000', start: 0.6, end: 1 }], 10);
  assert.deepEqual(words.map((w) => w.text), ['Kenapa', 'las', '4.000°C?']);
  assert.equal(words[0].start, 10);
  const even = evenWords('satu dua tiga', 0, 3);
  assert.equal(even.length, 3);
  assert.ok(even[2].end <= 3);
});
t('publish plan: Director overrides, future time, affiliate CTA once', () => {
  const pkg = { posts: [{ platform: 'tiktok', title: 'T', caption: 'Halo', hashtags: ['fyp', '#edukasi'] }, { platform: 'instagram', title: 'I', caption: 'Hai', hashtags: [] }], recommended_time: '2020-01-01 19:00', affiliate_cta: 'Cek keranjang kuning!' };
  assert.ok(!buildPublishPlan(pkg, {}, {}).posts[0].caption.includes('keranjang'), 'no affiliate CTA without an affiliate product');
  const plan = buildPublishPlan(pkg, { platforms: ['tiktok'] }, { affiliate: { product: 'x' } });
  assert.deepEqual(plan.posts.map((p) => p.platform), ['tiktok']);
  assert.ok(new Date(plan.scheduledAt).getTime() > Date.now());
  assert.ok(plan.posts[0].caption.endsWith('Cek keranjang kuning!'));
  assert.deepEqual(plan.posts[0].hashtags, ['#fyp', '#edukasi']);
  const edited = buildPublishPlan(pkg, { posts: [{ platform: 'instagram', caption: 'Caption baru' }] });
  assert.equal(edited.posts.find((p) => p.platform === 'instagram').caption, 'Caption baru');
  assert.equal(parseLocal('2026-12-01 19:30').toISOString(), '2026-12-01T12:30:00.000Z');
});
t('ElevenLabs character timing becomes word timing', () => {
  const text = 'Gaji Dina habis, cuma lima puluh ribu.';
  const c = [...text];
  const words = alignmentToWords({ characters: c, character_start_times_seconds: c.map((_, i) => i * 0.05), character_end_times_seconds: c.map((_, i) => i * 0.05 + 0.05) });
  assert.deepEqual(words.map((w) => w.word), ['Gaji', 'Dina', 'habis,', 'cuma', 'lima', 'puluh', 'ribu.']);
  assert.ok(words.every((w, i) => w.end > w.start && (i === 0 || w.start >= words[i - 1].end)));
});
t('voice errors are explained in Indonesian', () => {
  assert.match(friendlyVoiceError(new Error('ElevenLabs: Free users cannot use library voices via the API.'), 'Indah'), /Upgrade paket ElevenLabs/);
});
t('Indonesian voices are preferred for narration', () => {
  const v = [{ name: 'Bella', labels: { language: 'en' } }, { name: 'Putra', labels: { language: 'id' } }, { name: 'Indah', labels: { locale: 'id-ID' } }];
  assert.deepEqual(narrationVoices(v).map((x) => x.name), ['Putra', 'Indah']);
  assert.equal(narrationVoices([v[0]]).length, 1);
});
t('outputs are readable for the Director', () => {
  const text = formatOutput('ideas', { ideas: [{ title: 'A', hook: 'H', angle: 'X', format: 'cards', why_it_works: 'W', key_facts: ['f'], sources: [{ title: 's', url: 'https://x' }], affiliate_fit: '-' }], recommendation: 'A' });
  assert.match(text, /IDE 1 · A \[motion cards\]/);
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = (await runnerImport(path.join(root, 'remotion/captions.ts'), { root, configFile: false, cacheDir: path.join(os.tmpdir(), 'kantor-vite'), logLevel: 'error' })).module;
t('captions: short chunks, keyword highlighted, no gaps', () => {
  const w = 'Kenapa las bawah air tidak menyetrum penyelamnya? Ternyata jawabannya gelembung.'.split(' ').map((x, i) => ({ text: x, start: i * 0.4, end: i * 0.4 + 0.35 }));
  const chunks = C.chunkWords(w, 2);
  assert.ok(chunks.every((c) => c.words.length >= 1 && c.words.length <= 3));
  assert.ok(chunks.some((c) => c.words.includes('penyelamnya')));
  const hit = chunks.find((c) => c.words.includes('menyetrum'));
  assert.equal(hit.words[hit.highlight], 'menyetrum');
  for (let i = 0; i < chunks.length - 1; i++) assert.ok(chunks[i].end <= chunks[i + 1].start + 1e-9);
});
console.log(n + ' workflow tests passed');
