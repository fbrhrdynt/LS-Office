/**
 * Office social life: employees talk in the office group chat ("Grup Kantor") — they comment on each other's real work,
 * pitch ideas, disagree and debate, and chat casually over lunch, coffee or in the evening at the mess. The Director can
 * read and write in the group (web and Telegram); employees answer in character.
 *
 * Conversations are grounded on real data (tasks, step outputs, Director decisions). Opinions and ideas are allowed;
 * inventing progress, numbers or results is not. Each conversation is one cheap model call, capped per day.
 */
import { tx, budgetExceeded } from './db.mjs';
import { respond } from './ai.mjs';
import { config } from './config.mjs';
import { createTask } from './engine.mjs';
import PERSONNEL from '../../shared/personnel.json' with { type: 'json' };

export const GROUP = 'grup';
const STAFF = PERSONNEL.filter((p) => p.key !== 'alex');
const byKey = Object.fromEntries(PERSONNEL.map((p) => [p.key, p]));
const MAX_PER_DAY = Number(process.env.SOCIAL_MAX_PER_DAY || 28);
const DAY_GAP_MIN = Number(process.env.SOCIAL_GAP_MIN || 25);
const toMin = (hm) => { const [h, m] = String(hm).split(':').map(Number); return h * 60 + m; };

/** Jakarta wall clock for a Date. */
export function wib(date = new Date()) {
  const d = new Date(date.getTime() + 7 * 3600000);
  return { day: d.getUTCDay() === 0 ? 7 : d.getUTCDay(), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

/** Where a person is by their own schedule: kantor (office), mess (awake at the dorm), tidur (asleep). */
export function whereIs(p, date = new Date()) {
  const s = p.schedule;
  if (!s) return 'kantor';
  const { day, min } = wib(date);
  const sleep = toMin(s.sleep || '22:30'), wake = toMin(s.wake || '04:45');
  const asleep = sleep > wake ? min >= sleep || min < wake : min >= sleep && min < wake;
  if (asleep) return 'tidur';
  if (day <= 5 && min >= toMin(s.arrive) && min < toMin(s.leave)) return 'kantor';
  return 'mess';
}

const CONVO_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['topic', 'messages'],
  properties: {
    topic: { type: 'string', description: 'Short topic title in Indonesian' },
    messages: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['speaker', 'kind', 'text'],
        properties: {
          speaker: { type: 'string', enum: PERSONNEL.map((p) => p.key) },
          kind: { type: 'string', enum: ['ide', 'komentar', 'setuju', 'sanggah', 'tanya', 'jawab', 'canda', 'info'] },
          text: { type: 'string', description: 'One chat message, casual Indonesian, 1-3 sentences' },
        },
      },
    },
    proposal: {
      type: 'object', additionalProperties: false, required: ['create', 'task_type', 'assignee', 'title', 'instruction'],
      description: 'Only when the Director clearly asked for new work in the group',
      properties: {
        create: { type: 'boolean' },
        task_type: { type: 'string', enum: ['text', 'animated_video', 'story_series', 'web_build'] },
        assignee: { type: 'string', enum: STAFF.map((p) => p.key) },
        title: { type: 'string' },
        instruction: { type: 'string' },
      },
    },
  },
};
// Strict structured output needs every property required.
CONVO_SCHEMA.required = ['topic', 'messages', 'proposal'];

const cast = (keys) => keys.map((k) => byKey[k]).filter(Boolean).map((p) => `- ${p.key} (${p.name}, ${p.role}): ${p.personality}`).join('\n');
const RULES = 'Tulis obrolan grup chat kantor yang natural dalam bahasa Indonesia santai (gaya chat WhatsApp kantor, boleh singkatan wajar, tanpa emoji berlebihan). Tiap orang bicara sesuai kepribadian dan perannya: boleh memberi ide, mengomentari, setuju, MENYANGGAH dengan alasan, bertanya, bercanda. Kalau ada perbedaan pendapat, biarkan terjadi debat singkat yang sehat lalu ada titik temu atau keputusan dilempar ke Director. JANGAN mengarang progres, angka, hasil kerja, atau fakta yang tidak ada di konteks; ide dan opini boleh. Jangan mengulang isi konteks panjang-panjang. Jangan menyebut diri AI.';

async function context(pool) {
  const tasks = await pool.query(`SELECT t.title,t.status,t.task_type,
      (SELECT s.title FROM workflow_steps s WHERE s.task_id=t.id AND s.status IN ('running','awaiting_approval','failed','pending') ORDER BY s.step_order LIMIT 1) AS step
    FROM tasks t WHERE t.updated_at > now()-interval '3 days' AND t.status NOT IN ('cancelled') ORDER BY t.updated_at DESC LIMIT 8`);
  const recent = await pool.query("SELECT sender,body FROM messages WHERE thread=$1 AND created_at <= now() ORDER BY id DESC LIMIT 10", [GROUP]);
  return 'Pekerjaan kantor saat ini: ' + JSON.stringify(tasks.rows) + '\nObrolan grup terakhir (terbaru dulu): ' + JSON.stringify(recent.rows.map((m) => (byKey[m.sender]?.name || 'Director') + ': ' + m.body.slice(0, 160)));
}

async function saveConversation(pool, { kind, topic, place, taskId = null, messages, startAt = Date.now(), proposal = null }) {
  const spacing = 40000;
  const valid = messages.filter((m) => byKey[m.speaker] && m.text.trim()).slice(0, 9);
  if (!valid.length) return null;
  const participants = [...new Set(valid.map((m) => m.speaker))];
  const ends = new Date(startAt + valid.length * spacing + 90000);
  return tx(pool, async (c) => {
    const conv = (await c.query('INSERT INTO conversations(kind,topic,place,participants,task_id,started_at,ends_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id', [kind, topic.slice(0, 200), place, participants, taskId, new Date(startAt), ends])).rows[0];
    for (const [i, m] of valid.entries()) {
      const meta = { kind: m.kind };
      if (proposal?.create && i === valid.length - 1) meta.proposal = proposal;
      await c.query("INSERT INTO messages(thread,sender,body,channel,status,conversation_id,meta,created_at) VALUES($1,$2,$3,'system','done',$4,$5,$6)", [GROUP, m.speaker, m.text.slice(0, 1200), conv.id, JSON.stringify(meta), new Date(startAt + i * spacing)]);
    }
    return conv.id;
  });
}

/** Director wrote in the group: the right people answer (and Alex can turn a request into a task). */
async function answerDirector(pool) {
  const msg = await tx(pool, async (c) => {
    const r = await c.query("SELECT * FROM messages WHERE thread=$1 AND sender='director' AND status='pending' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED", [GROUP]);
    if (!r.rowCount) return null;
    await c.query("UPDATE messages SET status='done' WHERE id=$1", [r.rows[0].id]);
    return r.rows[0];
  });
  if (!msg) return false;
  // "ya" confirms Alex's last proposal in the group.
  const last = await pool.query("SELECT id,meta FROM messages WHERE thread=$1 AND meta ? 'proposal' AND NOT (meta ? 'used') AND id<$2 ORDER BY id DESC LIMIT 1", [GROUP, msg.id]);
  if (last.rowCount && /^(ya|iya|ok|oke|gas|lanjut|setuju|boleh|buat(kan)?)\b/i.test(msg.body.trim())) {
    const p = last.rows[0].meta.proposal;
    const task = await createTask(pool, { title: p.title, instruction: p.instruction, taskType: p.task_type, assigneeId: p.assignee, source: msg.channel });
    await pool.query("UPDATE messages SET meta=meta||'{\"used\":true}'::jsonb WHERE id=$1", [last.rows[0].id]);
    await saveConversation(pool, { kind: 'director', topic: 'Task baru', place: 'meja', messages: [{ speaker: 'alex', kind: 'info', text: 'Siap, task "' + task.title + '" sudah masuk antrean. Nanti saya kabari progresnya di sini.' }] });
    return true;
  }
  const present = STAFF.filter((p) => whereIs(p) !== 'tidur').map((p) => p.key);
  try {
    const r = await respond({
      system: RULES + '\nDirector (atasan manusia) baru saja menulis di grup. Pilih 1-3 orang yang paling relevan untuk menjawab (yang disebut namanya wajib menjawab; Alex menjawab kalau pertanyaannya umum soal kantor). Jawaban harus menanggapi Director langsung, boleh saling melengkapi atau berbeda pendapat. Kalau Director meminta pekerjaan baru, Alex menawarkan membuatkan task (isi proposal create=true dan Alex bertanya "Mau langsung saya buatkan task-nya?"); selain itu proposal.create=false. Yang sedang tidur tidak menjawab; kalau Director menyebut orang yang sedang tidur, salah satu yang bangun bilang orangnya sudah tidur dan biasanya baru balas pagi.',
      user: (await context(pool)) + '\nYang sedang tidak tidur: ' + present.join(', ') + '\nYang sedang tidur: ' + (STAFF.filter((p) => !present.includes(p.key)).map((p) => p.name).join(', ') || '-') + '\nKarakter:\n' + cast(['alex', ...present]) + '\n\nPesan Director: ' + msg.body,
      schema: CONVO_SCHEMA, schemaName: 'group_reply', maxOutputTokens: 12000, effort: 'low', ctx: { pool, stepKey: 'grup' },
    });
    const msgs = r.json.messages.filter((m) => m.speaker === 'alex' || present.includes(m.speaker));
    await saveConversation(pool, { kind: 'director', topic: r.json.topic || 'Pesan Director', place: 'meja', messages: msgs, startAt: Date.now() + 5000, proposal: r.json.proposal });
  } catch (e) {
    console.error('group reply failed', e.message);
    // Try once more on the next tick; after that say so in the group instead of leaving the Director unanswered.
    const tries = (msg.meta?.tries ?? 0) + 1;
    if (tries < 2) await pool.query("UPDATE messages SET status='pending', meta=coalesce(meta,'{}'::jsonb)||$2::jsonb WHERE id=$1", [msg.id, JSON.stringify({ tries })]);
    else await saveConversation(pool, { kind: 'director', topic: 'Gangguan', place: 'meja', messages: [{ speaker: 'alex', kind: 'info', text: 'Maaf, sistem obrolan lagi gangguan jadi pesanmu belum bisa dijawab tim. Coba kirim ulang sebentar lagi ya.' }] });
  }
  return true;
}

/** Who talks about a work event: the person who did it, plus teammates downstream / their lead. */
const TEAMS = {
  ideas: ['nadia', 'felix', 'ethan', 'olivier'], script: ['felix', 'ethan', 'maya', 'nadia'], storyboard: ['ethan', 'felix', 'maya'],
  audio_direction: ['maya', 'ethan', 'felix'], qa_video: ['daren', 'ethan', 'olivier', 'adrian'], distribution: ['olivier', 'adrian', 'ethan'],
  series_plan: ['felix', 'nadia', 'ethan'], character_design: ['ethan', 'maya', 'felix'], plan: ['arvin', 'nathan', 'daren'],
  implement: ['nathan', 'arvin', 'daren'], qa_web: ['daren', 'nathan', 'arvin'], decision: ['alex', 'ethan', 'olivier', 'arvin'],
};

async function workConversation(pool, item) {
  const team = (TEAMS[item.payload.stepKey] || TEAMS.decision).filter((k) => k === 'alex' || whereIs(byKey[k]) !== 'tidur');
  if (team.length < 2) return null;
  const r = await respond({
    system: RULES + '\nIni diskusi kerja tentang kejadian nyata di bawah. Orang yang mengerjakan menjelaskan singkat, rekan lain memberi komentar, ide perbaikan, atau sanggahan (minimal satu sanggahan/pertanyaan kritis), lalu ditutup kesepakatan atau catatan untuk Director. 4-7 pesan.',
    user: (await context(pool)) + '\n\nKEJADIAN: ' + JSON.stringify(item.payload) + '\nPeserta:\n' + cast(team),
    schema: CONVO_SCHEMA, schemaName: 'work_talk', maxOutputTokens: 12000, effort: 'low', ctx: { pool, taskId: item.task_id, stepKey: 'grup' },
  });
  const place = ['qa_video', 'distribution', 'decision'].includes(item.payload.stepKey) ? 'rapat' : 'ngobrol';
  return saveConversation(pool, { kind: 'kerja', topic: r.json.topic, place, taskId: item.task_id, messages: r.json.messages.filter((m) => team.includes(m.speaker)) });
}

async function casualConversation(pool, where, min) {
  const here = STAFF.filter((p) => whereIs(p) === where).map((p) => p.key);
  if (here.length < 2) return null;
  const pick = here.sort(() => Math.random() - 0.5).slice(0, Math.min(4, 2 + Math.floor(Math.random() * 3)));
  const moment = where === 'mess' ? (min < 16 * 60 ? 'santai akhir pekan di ruang santai mess' : min < 20 * 60 ? 'makan malam bareng di mess' : 'santai malam di ruang santai mess sebelum tidur')
    : min >= 12 * 60 && min < 13 * 60 ? 'makan siang bareng di pantry'
    : min >= 15 * 60 && min < 16 * 60 + 30 ? 'ngopi sore di pantry' : 'ngobrol sebentar di lounge sambil istirahat';
  const r = await respond({
    system: RULES + '\nIni obrolan santai: ' + moment + '. Campurkan obrolan ringan sehari-hari (makanan, macet, kos, rencana weekend, film) dengan sedikit soal kerjaan atau ide konten baru. Boleh ada beda pendapat ringan dan canda. 3-6 pesan.',
    user: (await context(pool)) + '\nPeserta:\n' + cast(pick),
    schema: CONVO_SCHEMA, schemaName: 'casual_talk', maxOutputTokens: 12000, effort: 'low', ctx: { pool, stepKey: 'grup' },
  });
  const place = where === 'mess' ? 'mess' : moment.includes('pantry') ? 'makan' : 'ngobrol';
  return saveConversation(pool, { kind: 'santai', topic: r.json.topic, place, messages: r.json.messages.filter((m) => pick.includes(m.speaker)) });
}

/** One step of office social life; returns true when it did something (the caller loops while true). */
export async function socialTick(pool) {
  if (await answerDirector(pool)) return true;
  if (await budgetExceeded(pool)) return false;
  const active = await pool.query('SELECT 1 FROM conversations WHERE ends_at > now() LIMIT 1');
  if (active.rowCount) return false;
  const { day, min } = wib();
  const today = await pool.query("SELECT count(*)::int AS n, max(started_at) AS last FROM conversations WHERE kind<>'director' AND started_at >= date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1", [config.timezone]);
  const { n, last } = today.rows[0];
  if (n >= MAX_PER_DAY) return false;
  const office = day <= 5 && min >= 8 * 60 + 30 && min < 17 * 60 + 30;
  // Off-duty chatter at the mess: weekday evenings, and the daytime on weekends.
  const evening = (min >= 18 * 60 + 30 && min < 22 * 60) || (day > 5 && min >= 9 * 60 && min < 16 * 60);
  const gap = (office ? DAY_GAP_MIN : 50) * 60000 * (0.8 + Math.random() * 0.5);
  if (last && Date.now() - new Date(last).getTime() < gap) return false;

  // Work events first (only fresh ones), then casual talk at natural moments.
  const item = (await pool.query("SELECT * FROM social_queue WHERE done_at IS NULL AND created_at > now()-interval '8 hours' ORDER BY id LIMIT 1")).rows[0];
  if (item && (office || evening)) {
    await pool.query('UPDATE social_queue SET done_at=now() WHERE id=$1', [item.id]);
    try { await workConversation(pool, item); } catch (e) { console.error('work talk failed', e.message); }
    return false;
  }
  if (office || evening) {
    try { await casualConversation(pool, office ? 'kantor' : 'mess', min); } catch (e) { console.error('casual talk failed', e.message); }
  }
  return false;
}

/** Active conversations for the 3D office: who stands together where, and their latest line. */
export async function activeConversations(pool, withText) {
  const r = await pool.query(`SELECT c.id,c.place,c.participants,c.topic,
      (SELECT json_agg(json_build_object('sender',m.sender,'body',m.body,'at',m.created_at) ORDER BY m.id) FROM messages m WHERE m.conversation_id=c.id AND m.created_at <= now()) AS said
    FROM conversations c WHERE c.ends_at > now() AND c.started_at <= now() ORDER BY c.id DESC LIMIT 3`);
  return r.rows.map((c) => ({ id: c.id, place: c.place, participants: c.participants, topic: withText ? c.topic : null, said: withText ? (c.said || []).slice(-6) : [] }));
}

