import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config, PRICES, textCost } from './config.mjs';

const API = 'https://api.openai.com/v1';

function authHeaders(extra = {}) {
  if (!config.openaiKey) throw new Error('OPENAI_API_KEY is required');
  return { authorization: 'Bearer ' + config.openaiKey, ...extra };
}

async function postJson(endpoint, payload, timeoutMs) {
  const response = await fetch(API + endpoint, { method: 'POST', signal: AbortSignal.timeout(timeoutMs), headers: authHeaders({ 'content-type': 'application/json' }), body: JSON.stringify(payload) });
  const data = await response.json().catch(() => null);
  if (!data) throw new Error('OpenAI returned a non-JSON response (HTTP ' + response.status + ')');
  if (!response.ok) throw new Error(data.error?.message || 'OpenAI API HTTP ' + response.status);
  return data;
}

/** Records one paid call. `ctx` = { pool, taskId, runId, stepKey }; missing pool = no ledger (tests). */
export async function record(ctx, kind, model, units, costUsd) {
  if (!ctx?.pool) return;
  await ctx.pool.query('INSERT INTO usage_ledger(task_id,run_id,step_key,kind,model,units,cost_usd) VALUES($1,$2,$3,$4,$5,$6,$7)', [ctx.taskId || null, ctx.runId || null, ctx.stepKey || null, kind, model, JSON.stringify(units), Number(costUsd.toFixed(5))]);
  if (ctx.runId) await ctx.pool.query('UPDATE task_runs SET cost_usd=cost_usd+$2 WHERE id=$1', [ctx.runId, Number(costUsd.toFixed(5))]);
}

function responseText(data) {
  const items = Array.isArray(data.output) ? data.output : [];
  const parts = items.flatMap((item) => (Array.isArray(item.content) ? item.content : [])).filter((c) => c.type === 'output_text' && typeof c.text === 'string').map((c) => c.text);
  return { text: (parts.join('\n') || (typeof data.output_text === 'string' ? data.output_text : '')).trim(), items };
}

/**
 * One call to the Responses API. `schema` = JSON schema for structured output (strict). `webSearch` enables the hosted tool.
 * Returns { text, json, inputTokens, outputTokens, costUsd }.
 */
export async function respond({ system, user, schema = null, schemaName = 'result', webSearch = false, maxOutputTokens = config.maxOutputTokens, model = config.textModel, ctx = null, timeoutMs = 180000 }) {
  const started = Date.now();
  const payload = {
    model,
    max_output_tokens: maxOutputTokens,
    input: [{ role: 'system', content: system }, { role: 'user', content: user }],
  };
  if (/^(gpt-5|o\d)/.test(model)) payload.reasoning = { effort: config.reasoningEffort };
  if (webSearch) payload.tools = [{ type: 'web_search' }];
  if (schema) payload.text = { format: { type: 'json_schema', name: schemaName, schema, strict: true } };
  const data = await postJson('/responses', payload, timeoutMs);
  const usage = { inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0 };
  const { text, items } = responseText(data);
  const searches = items.filter((i) => i.type === 'web_search_call').length;
  const costUsd = textCost(model, usage.inputTokens, usage.outputTokens, searches);
  await record(ctx, 'text', model, { ...usage, webSearchCalls: searches, latencyMs: Date.now() - started }, costUsd);
  if (data.status === 'incomplete' || data.incomplete_details) throw new Error('Incomplete model response; reason=' + (data.incomplete_details?.reason || 'unknown') + '; output_tokens=' + usage.outputTokens);
  if (data.status && data.status !== 'completed') throw new Error('Model response not completed; status=' + data.status);
  if (!text) {
    const refusal = items.flatMap((i) => i.content || []).find((c) => c.type === 'refusal');
    throw new Error(refusal ? 'Model refusal: ' + String(refusal.refusal).slice(0, 400) : 'No text in model response; output_tokens=' + usage.outputTokens);
  }
  let json = null;
  if (schema) {
    try { json = JSON.parse(text); } catch { throw new Error('Model returned invalid JSON for ' + schemaName); }
  }
  return { text, json, ...usage, costUsd, latencyMs: Date.now() - started };
}

/** Generates one image; returns PNG bytes. */
export async function generateImage({ prompt, size = '1024x1536', quality = config.imageQuality, ctx = null }) {
  const data = await postJson('/images/generations', { model: config.imageModel, prompt, size, quality, output_format: 'png', n: 1 }, 300000);
  const encoded = data.data?.[0]?.b64_json;
  if (!encoded) throw new Error('Image generation returned no image');
  await record(ctx, 'image', config.imageModel, { size, quality }, PRICES.image[quality] ?? PRICES.image.medium);
  return Buffer.from(encoded, 'base64');
}

/** Image guided by reference images (e.g. a series character sheet) so characters stay identical across scenes. */
export async function editImage({ prompt, refs, size = '1024x1536', quality = config.imageQuality, ctx = null }) {
  const form = new FormData();
  form.append('model', config.imageModel);
  form.append('prompt', prompt);
  form.append('size', size);
  form.append('quality', quality);
  for (const ref of refs) form.append('image[]', new Blob([await readFile(ref)], { type: 'image/png' }), path.basename(ref));
  const response = await fetch(API + '/images/edits', { method: 'POST', signal: AbortSignal.timeout(300000), headers: authHeaders(), body: form });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error('Image edit failed: ' + (data?.error?.message || 'HTTP ' + response.status));
  const encoded = data.data?.[0]?.b64_json;
  if (!encoded) throw new Error('Image edit returned no image');
  await record(ctx, 'image', config.imageModel, { size, quality, reference: refs.length }, (PRICES.image[quality] ?? PRICES.image.medium) * 1.2);
  return Buffer.from(encoded, 'base64');
}

/** Text-to-speech; returns MP3 bytes. `instructions` (voice direction) is supported by gpt-4o-*-tts models only. */
export async function speak({ input, voice = 'alloy', instructions = '', ctx = null }) {
  const body = { model: config.ttsModel, voice, input: input.slice(0, 4000), response_format: 'mp3' };
  if (instructions && /gpt-4o/.test(config.ttsModel)) body.instructions = instructions.slice(0, 2000);
  const response = await fetch(API + '/audio/speech', { method: 'POST', signal: AbortSignal.timeout(180000), headers: authHeaders({ 'content-type': 'application/json' }), body: JSON.stringify(body) });
  if (!response.ok) throw new Error('Speech generation failed: ' + (await response.text()).slice(0, 500));
  const bytes = Buffer.from(await response.arrayBuffer());
  // Cost is estimated from duration later (see recordSpeech) because the API bills audio output by length.
  return bytes;
}

export async function recordSpeech(ctx, seconds) {
  await record(ctx, 'tts', config.ttsModel, { seconds }, (seconds / 60) * (PRICES.ttsPerMinute[config.ttsModel] ?? 0.015));
}

/** Word-level timestamps for an audio file: [{ word, start, end }] in seconds. */
export async function transcribeWords({ file, language = 'id', ctx = null }) {
  const form = new FormData();
  form.append('file', new Blob([await readFile(file)], { type: 'audio/mpeg' }), path.basename(file));
  form.append('model', config.transcribeModel);
  form.append('language', language);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  const response = await fetch(API + '/audio/transcriptions', { method: 'POST', signal: AbortSignal.timeout(180000), headers: authHeaders(), body: form });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error('Transcription failed: ' + (data?.error?.message || 'HTTP ' + response.status));
  const seconds = Number(data.duration || 0);
  await record(ctx, 'transcribe', config.transcribeModel, { seconds }, (seconds / 60) * (PRICES.transcribePerMinute[config.transcribeModel] ?? 0.006));
  return (data.words || []).map((w) => ({ word: String(w.word).trim(), start: Number(w.start), end: Number(w.end) })).filter((w) => w.word);
}
