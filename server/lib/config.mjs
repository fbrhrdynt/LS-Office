import path from 'node:path';
import { createHash } from 'node:crypto';

const env = process.env;
const num = (value, fallback) => (Number.isFinite(Number(value)) && value !== '' && value !== undefined ? Number(value) : fallback);

export const config = {
  port: num(env.PORT, 3215),
  databaseUrl: env.DATABASE_URL,
  adminToken: env.LS_OFFICE_ADMIN_TOKEN || '',
  sessionDays: Math.min(30, Math.max(1, num(env.SESSION_DAYS, 14))),
  publicBaseUrl: (env.PUBLIC_BASE_URL || 'https://office.febro.id').replace(/\/$/, ''),
  timezone: env.OFFICE_TIMEZONE || 'Asia/Jakarta',

  openaiKey: env.OPENAI_API_KEY || '',
  textModel: env.OPENAI_MODEL || 'gpt-5-mini',
  reasoningEffort: env.OPENAI_REASONING_EFFORT || 'low',
  maxOutputTokens: Math.max(8000, num(env.MAX_OUTPUT_TOKENS, 8000)),
  imageModel: env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
  imageQuality: env.OPENAI_IMAGE_QUALITY || 'medium',
  ttsModel: env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
  transcribeModel: env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1',

  maxDailyRuns: num(env.MAX_DAILY_RUNS, 60),
  dailyBudgetUsd: num(env.DAILY_BUDGET_USD, 5),
  workerPollMs: num(env.WORKER_POLL_MS, 4000),

  // Runtime data lives outside the git checkout.
  dataRoot: path.resolve(env.LS_OFFICE_DATA || '/var/lib/ls-office'),
  get mediaRoot() { return path.resolve(env.MEDIA_ROOT || path.join(this.dataRoot, 'media')); },
  get workRoot() { return path.resolve(env.WORK_ROOT || path.join(this.dataRoot, 'work')); },
  remotionBundle: path.resolve(env.REMOTION_BUNDLE || path.join(process.cwd(), 'remotion-build')),
  renderConcurrency: num(env.RENDER_CONCURRENCY, 1),
  videoWidth: num(env.VIDEO_WIDTH, 720),
  videoHeight: num(env.VIDEO_HEIGHT, 1280),
  videoFps: num(env.VIDEO_FPS, 30),

  // Voice: ElevenLabs when a key is configured (better Indonesian narration, one fixed voice per series), else OpenAI.
  ttsProvider: env.TTS_PROVIDER || (env.ELEVENLABS_API_KEY ? 'elevenlabs' : 'openai'),
  elevenKey: env.ELEVENLABS_API_KEY || '',
  // eleven_v3: expressive narration with audio tags ([whispers], [sighs] ...). Override to eleven_multilingual_v2 for a flatter, steadier read.
  elevenModel: env.ELEVENLABS_MODEL || 'eleven_v3',
  // Music, ambience and sound effects (needs Sound Effects + Music Generation access on the ElevenLabs key).
  soundDesign: env.SOUND_DESIGN !== 'off',
  elevenVoiceId: env.ELEVENLABS_VOICE_ID || '',
  elevenSpeed: num(env.ELEVENLABS_SPEED, 1.05),
  // ElevenLabs bills a character quota from your plan; set a per-1k-character price only if you want it in the budget.
  elevenUsdPer1kChars: num(env.ELEVENLABS_USD_PER_1K_CHARS, 0),

  telegramToken: env.TELEGRAM_BOT_TOKEN || '',

  devDataRoot: path.resolve(env.LS_OFFICE_DEV_DATA || '/var/lib/ls-office-dev'),
  claudeBin: env.CLAUDE_BIN || 'claude',
  devMaxTurns: num(env.DEV_MAX_TURNS, 60),
};

/** Secret for signed public media links (Instagram/Facebook fetch the video from a URL). */
export const mediaSigningKey = () => env.MEDIA_SIGNING_KEY || createHash('sha256').update('ls-office-media:' + config.adminToken).digest('hex');

/**
 * Estimated USD prices. Providers change prices; these are for budgeting only and can be overridden with
 * PRICE_OVERRIDES='{"gpt-5-mini":{"in":0.25,"out":2}}'. The provider dashboard stays the source of truth.
 */
const PRICES = {
  text: {
    'gpt-5-mini': { in: 0.25, out: 2.0 },
    'gpt-5': { in: 1.25, out: 10.0 },
    'gpt-5-nano': { in: 0.05, out: 0.4 },
    'gpt-4.1-mini': { in: 0.4, out: 1.6 },
    'gpt-4o-mini': { in: 0.15, out: 0.6 },
  },
  webSearchCall: 0.01,
  // Per image, 1024x1536. gpt-image-2 prices are an estimate; check the provider pricing page.
  image: { low: 0.02, medium: 0.07, high: 0.25 },
  ttsPerMinute: { 'gpt-4o-mini-tts': 0.015, 'tts-1': 0.015, 'tts-1-hd': 0.03 },
  transcribePerMinute: { 'whisper-1': 0.006, 'gpt-4o-mini-transcribe': 0.003, 'gpt-4o-transcribe': 0.006 },
};
try { Object.assign(PRICES.text, JSON.parse(env.PRICE_OVERRIDES || '{}')); } catch { /* ignore malformed overrides */ }
export { PRICES };

export function textCost(model, inputTokens, outputTokens, webSearchCalls = 0) {
  const p = PRICES.text[model] || PRICES.text['gpt-5-mini'];
  return (inputTokens / 1e6) * p.in + (outputTokens / 1e6) * p.out + webSearchCalls * PRICES.webSearchCall;
}
