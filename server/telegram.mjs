// Telegram bot: the Director's pocket office. Long polling (no public webhook needed); only the linked chat is served.
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createPool, migrate, getSetting, setSetting } from './lib/db.mjs';
import { config } from './lib/config.mjs';
import { createTask, decide, retry, officeState } from './lib/engine.mjs';
import PERSONNEL from '../shared/personnel.json' with { type: 'json' };

if (!config.telegramToken) {
  console.log('TELEGRAM_BOT_TOKEN not set; telegram bot idle');
  setInterval(() => {}, 1 << 30);
} else {
  await main();
}

async function main() {
  const pool = createPool(2);
  await migrate(pool);
  const API = 'https://api.telegram.org/bot' + config.telegramToken;
  const hash = (v) => createHash('sha256').update(v).digest('hex');
  const name = (key) => PERSONNEL.find((p) => p.key === key)?.name || key;
  let stopping = false;

  async function tg(method, payload, timeoutMs = 30000) {
    const isForm = payload instanceof FormData;
    const r = await fetch(API + '/' + method, { method: 'POST', signal: AbortSignal.timeout(timeoutMs), headers: isForm ? {} : { 'content-type': 'application/json' }, body: isForm ? payload : JSON.stringify(payload) });
    const d = await r.json().catch(() => ({}));
    if (!d.ok) throw new Error('Telegram ' + method + ': ' + (d.description || r.status));
    return d.result;
  }
  const linked = () => getSetting(pool, 'telegram.chat', null);
  const send = (chatId, text, extra = {}) => tg('sendMessage', { chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true, ...extra });

  const buttons = (n) => {
    const a = n.action || {};
    const id = n.task_id;
    const decisionRow = [{ text: '✏️ Revisi', callback_data: 'rev:' + id }, { text: '❌ Tolak', callback_data: 'rej:' + id }];
    if (n.kind === 'approval' && a.gate === 'choose_idea') {
      const count = Math.max(1, Math.min(5, (n.body.match(/^\d+\. /gm) || []).length));
      return [Array.from({ length: count }, (_, i) => ({ text: 'Ide ' + (i + 1), callback_data: 'idea:' + id + ':' + i })), decisionRow];
    }
    if (n.kind === 'approval' && a.gate === 'publish') return [[{ text: '✅ Posting sesuai jadwal', callback_data: 'ok:' + id }], [{ text: '🚀 Posting sekarang', callback_data: 'now:' + id }], decisionRow];
    if (n.kind === 'approval') return [[{ text: '✅ Approve', callback_data: 'ok:' + id }], decisionRow];
    if (n.kind === 'failed' && a.retry) return [[{ text: '🔁 Ulangi', callback_data: 'retry:' + id }]];
    if (n.kind === 'chat' && a.proposal) return [[{ text: '👍 Ya, buatkan task', callback_data: 'yes:' + a.thread }]];
    return null;
  };

  async function deliver(chat, n) {
    const icon = { approval: '🟡', failed: '🔴', published: '🟢', info: 'ℹ️', chat: '💬' }[n.kind] || '•';
    const who = n.employee_id ? name(n.employee_id) : 'Kantor';
    const text = n.kind === 'chat' ? who + ':\n' + n.body : icon + ' ' + n.title + (n.employee_id ? '\n— ' + who : '') + (n.body ? '\n\n' + n.body : '');
    const kb = buttons(n);
    const markup = kb ? { reply_markup: { inline_keyboard: kb } } : {};
    if (n.kind === 'approval' && n.action?.gate === 'video_review' && n.task_id) {
      const t = await pool.query('SELECT artifact_path,artifact_name FROM tasks WHERE id=$1', [n.task_id]);
      const file = t.rows[0]?.artifact_path;
      const size = file ? (await stat(file).catch(() => ({ size: 0 }))).size : 0;
      if (file && size > 0 && size < 48 * 1048576) {
        const form = new FormData();
        form.append('chat_id', String(chat.id));
        form.append('caption', text.slice(0, 1000));
        form.append('supports_streaming', 'true');
        if (kb) form.append('reply_markup', JSON.stringify({ inline_keyboard: kb }));
        form.append('video', new Blob([await readFile(file)], { type: 'video/mp4' }), t.rows[0].artifact_name || 'video.mp4');
        return tg('sendVideo', form, 180000);
      }
    }
    return send(chat.id, text, markup);
  }

  async function outbox() {
    const chat = await linked();
    if (!chat) return;
    const r = await pool.query('SELECT * FROM notifications WHERE telegram_sent_at IS NULL AND created_at >= $1 ORDER BY id LIMIT 5', [chat.linkedAt]);
    for (const n of r.rows) {
      try {
        const m = await deliver(chat, n);
        await pool.query('UPDATE notifications SET telegram_sent_at=now(),telegram_message_id=$2 WHERE id=$1', [n.id, m.message_id]);
      } catch (e) {
        console.error('telegram deliver', n.id, e.message);
        if (/bot was blocked|chat not found/i.test(e.message)) return;
        await pool.query("UPDATE notifications SET telegram_sent_at=now() WHERE id=$1 AND created_at < now()-interval '10 minutes'", [n.id]);
      }
    }
  }

  async function onCallback(q, chat) {
    const [kind, id, extra] = String(q.data || '').split(':');
    let reply = '';
    try {
      if (kind === 'idea') { const r = await decide(pool, id, 'approved', { ideaIndex: Number(extra), notes: 'Dipilih lewat Telegram' }); reply = 'Ide ' + (Number(extra) + 1) + ' dipilih. Tim lanjut kerja. (' + r.status + ')'; }
      else if (kind === 'ok') { const r = await decide(pool, id, 'approved', {}); reply = r.publication ? 'Disetujui. Dijadwalkan ' + new Date(r.publication.scheduledAt).toLocaleString('id-ID', { timeZone: config.timezone }) + ' WIB.' : 'Disetujui ✅'; }
      else if (kind === 'now') { await decide(pool, id, 'approved', { scheduledAt: new Date(Date.now() + 5 * 60000).toISOString() }); reply = 'Disetujui. Diposting dalam ~5 menit 🚀'; }
      else if (kind === 'rej') { await decide(pool, id, 'rejected', { notes: 'Ditolak lewat Telegram' }); reply = 'Task ditolak.'; }
      else if (kind === 'retry') { await retry(pool, id); reply = 'Diulang, masuk antrean lagi 🔁'; }
      else if (kind === 'rev') {
        const t = await pool.query('SELECT title FROM tasks WHERE id=$1', [id]);
        const m = await send(chat.id, '✏️ Tulis revisi untuk "' + (t.rows[0]?.title || 'task') + '" (balas pesan ini):', { reply_markup: { force_reply: true, input_field_placeholder: 'Contoh: hook kurang nendang, ganti suara cewek…' } });
        await setSetting(pool, 'telegram.pendingRevision', { taskId: id, messageId: m.message_id, at: Date.now() });
        return tg('answerCallbackQuery', { callback_query_id: q.id });
      } else if (kind === 'yes') {
        await pool.query("INSERT INTO messages(thread,sender,body,channel,status) VALUES($1,'director','ya','telegram','pending')", [id]);
        reply = 'Oke, diteruskan.';
      }
    } catch (e) { reply = '⚠️ ' + e.message; }
    await tg('answerCallbackQuery', { callback_query_id: q.id, text: reply.slice(0, 190) }).catch(() => {});
    if (q.message) await tg('editMessageReplyMarkup', { chat_id: chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
    await send(chat.id, reply);
  }

  async function statusText() {
    const s = await officeState(pool);
    const lines = Object.entries(s).filter(([k]) => k !== 'alex').map(([k, v]) => ({ working: '⌨️', waiting: '🙋', blocked: '⚠️', available: '☕' }[v.state] + ' ' + name(k) + (v.title ? ' — ' + v.title + (v.step ? ' (' + v.step + ')' : '') : '')));
    const review = await pool.query("SELECT count(*)::int AS n FROM tasks WHERE status='review'");
    return 'Status kantor:\n' + lines.join('\n') + '\n\nMenunggu keputusanmu: ' + review.rows[0].n;
  }

  async function onMessage(m, chat) {
    const text = String(m.text || '').trim();
    if (!text) return;
    const pendingRev = await getSetting(pool, 'telegram.pendingRevision', null);
    if (pendingRev && (m.reply_to_message?.message_id === pendingRev.messageId || Date.now() - pendingRev.at < 10 * 60000) && !text.startsWith('/')) {
      await pool.query("DELETE FROM app_settings WHERE key='telegram.pendingRevision'");
      try {
        const r = await decide(pool, pendingRev.taskId, 'changes_requested', { notes: text, restartFrom: 'auto' });
        return send(chat.id, '✏️ Revisi dikirim' + (r.restartFrom ? ', diulang dari tahap ' + r.restartFrom + (r.routeReason ? ' (' + r.routeReason + ')' : '') : '') + '. Nanti aku kabari hasil barunya.');
      } catch (e) { return send(chat.id, '⚠️ ' + e.message); }
    }
    if (/^\/(start|help)\b/.test(text)) return send(chat.id, 'Perintah:\n/status — siapa sedang apa\n/video <brief> — minta tim creative bikin video\n/web <brief> — minta tim web bikin website baru\n/tugas <@nama> <instruksi> — tugas teks ke karyawan\n\nChat biasa diteruskan ke Alex. Awali dengan @nama untuk chat ke karyawan tertentu, mis. "@nadia ada ide konten hari ini?"');
    if (/^\/status\b/.test(text)) return send(chat.id, await statusText());
    const cmd = /^\/(video|web)\s+([\s\S]+)/.exec(text);
    if (cmd) {
      const brief = cmd[2].trim();
      const task = await createTask(pool, { taskType: cmd[1] === 'video' ? 'animated_video' : 'web_build', title: brief.split(/[.\n]/)[0].slice(0, 120), instruction: brief, source: 'telegram' });
      return send(chat.id, (cmd[1] === 'video' ? '🎬 Siap! Nadia mulai cari ide untuk: ' : '🧑‍💻 Siap! Nadia mulai cari konsep untuk: ') + task.title);
    }
    const tugas = /^\/tugas\s+@?([a-z]+)\s+([\s\S]+)/i.exec(text);
    if (tugas) {
      const task = await createTask(pool, { taskType: 'text', assigneeId: tugas[1].toLowerCase(), title: tugas[2].slice(0, 120), instruction: tugas[2], source: 'telegram' });
      return send(chat.id, '📝 Task untuk ' + name(task.assignee_id) + ' masuk antrean.');
    }
    const at = /^@([a-z]+)[\s,:]+([\s\S]+)/i.exec(text);
    const thread = at && PERSONNEL.some((p) => p.key === at[1].toLowerCase()) ? at[1].toLowerCase() : 'alex';
    await pool.query("INSERT INTO messages(thread,sender,body,channel,status) VALUES($1,'director',$2,'telegram','pending')", [thread, (at && thread !== 'alex' ? at[2] : text).slice(0, 4000)]);
    await tg('sendChatAction', { chat_id: chat.id, action: 'typing' }).catch(() => {});
  }

  async function poll() {
    let offset = (await getSetting(pool, 'telegram.offset', 0)) || 0;
    while (!stopping) {
      try {
        const updates = await tg('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] }, 60000);
        for (const u of updates) {
          offset = u.update_id + 1;
          const msg = u.message || u.callback_query?.message;
          const chatId = msg?.chat?.id;
          const chat = await linked();
          const text = String(u.message?.text || '').trim();
          const link = /^\/(?:link|start)\s+(\d{6})$/.exec(text);
          if (link && u.message?.chat?.type === 'private') {
            const code = await getSetting(pool, 'telegram.linkCode', null);
            if (code && code.expires > Date.now() && code.hash === hash(link[1])) {
              await setSetting(pool, 'telegram.chat', { id: chatId, name: [u.message.from?.first_name, u.message.from?.username && '@' + u.message.from.username].filter(Boolean).join(' '), linkedAt: new Date().toISOString() });
              await pool.query("DELETE FROM app_settings WHERE key='telegram.linkCode'");
              await send(chatId, '✅ Terhubung! Mulai sekarang notifikasi LSAI Office masuk ke sini. Ketik /help untuk perintah.');
            } else await send(chatId, 'Kode salah atau kedaluwarsa. Buat kode baru di Command Center → Telegram.');
            continue;
          }
          if (!chat || chatId !== chat.id) {
            if (u.message?.chat?.type === 'private') await send(chatId, 'Bot ini privat. Hubungkan dulu dari Command Center (menu Telegram), lalu kirim /link <kode>.').catch(() => {});
            continue;
          }
          if (u.callback_query) await onCallback(u.callback_query, chat);
          else if (u.message) await onMessage(u.message, chat);
        }
        await setSetting(pool, 'telegram.offset', offset);
      } catch (e) {
        if (!stopping) { console.error('telegram poll', e.message); await new Promise((r) => setTimeout(r, 5000)); }
      }
    }
  }

  console.log('ls-office-telegram online');
  const out = setInterval(() => void outbox().catch((e) => console.error('outbox', e.message)), 3000);
  void poll();
  for (const s of ['SIGTERM', 'SIGINT']) process.on(s, async () => { stopping = true; clearInterval(out); await pool.end().catch(() => {}); process.exit(0); });
}
