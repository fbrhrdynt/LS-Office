import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { api, type Employee, type Message } from './api';
import { plannedSpot } from '../office';
import { prayerTimes } from '../prayer';

/** Chat in the style of WhatsApp / Telegram: a chat list, then a conversation with bubbles, ticks and typing status. */
const GROUP = 'grup';
const TZ = 'Asia/Jakarta';
type Thread = { thread: string; sender: string; body: string; created_at: string };
const SEEN_KEY = 'lc-chat-seen';

const clock = (s: string) => new Date(s).toLocaleTimeString('id-ID', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const dayKey = (s: string | Date) => new Date(s).toLocaleDateString('en-CA', { timeZone: TZ });
function dayLabel(s: string) {
  const k = dayKey(s);
  if (k === dayKey(new Date())) return 'Hari ini';
  if (k === dayKey(new Date(Date.now() - 86400000))) return 'Kemarin';
  return new Date(s).toLocaleDateString('id-ID', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
}
function listTime(s: string) {
  const k = dayKey(s);
  if (k === dayKey(new Date())) return clock(s);
  if (k === dayKey(new Date(Date.now() - 86400000))) return 'Kemarin';
  return new Date(s).toLocaleDateString('id-ID', { timeZone: TZ, day: '2-digit', month: '2-digit', year: '2-digit' });
}
function wibNow() {
  const d = new Date(Date.now() + 7 * 3600000);
  return { min: d.getUTCHours() * 60 + d.getUTCMinutes(), day: d.getUTCDay() === 0 ? 7 : d.getUTCDay() };
}
/** Presence like a messenger, from the person's own schedule: online in the office, at the mess, asleep. */
function presence(e: Employee | undefined) {
  if (!e?.schedule) return 'online';
  const { min, day } = wibNow();
  const spot = plannedSpot(e.key, e.schedule, min, day, prayerTimes(new Date())).spot;
  if (spot === 'tidur') return 'sedang tidur';
  if (spot === 'rumah') return 'sedang di luar';
  if (spot === 'kamar' || spot === 'mess') return 'online · di mess';
  if (spot === 'musholla') return 'sedang sholat';
  return 'online';
}
const readSeen = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); } catch { return {}; } };

function Avatar({ e, group, size = 42 }: { e?: Employee; group?: boolean; size?: number }) {
  return <i className="wa-av" style={{ width: size, height: size, background: group ? 'linear-gradient(135deg,#f08a3c,#8e6bd8)' : e?.color ?? '#555', fontSize: size * 0.42 }}>{group ? '👥' : e?.name[0] ?? '?'}</i>;
}

export default function Chat({ employees, thread, setThread }: { employees: Employee[]; thread: string; setThread: (k: string) => void }) {
  const [view, setView] = useState<'list' | 'chat'>('chat');
  const [threads, setThreads] = useState<Thread[]>([]);
  const [pending, setPending] = useState<Record<string, number>>({});
  const [seen, setSeen] = useState(readSeen);
  const [q, setQ] = useState('');
  const byKey = useCallback((k: string) => employees.find((e) => e.id === k || e.key === k), [employees]);

  const loadList = useCallback(async () => {
    try { const r = await api<{ threads: Thread[]; pending: Record<string, number> }>('/chat'); setThreads(r.threads); setPending(r.pending); } catch { /* keep */ }
  }, []);
  useEffect(() => { void loadList(); const t = window.setInterval(() => void loadList(), 4000); return () => window.clearInterval(t); }, [loadList]);

  const markSeen = useCallback((k: string, at: string) => {
    setSeen((s) => {
      if (s[k] && s[k]! >= at) return s;
      const n = { ...s, [k]: at };
      try { localStorage.setItem(SEEN_KEY, JSON.stringify(n)); } catch { /* ignore */ }
      return n;
    });
  }, []);

  const rows = useMemo(() => {
    const last = Object.fromEntries(threads.map((t) => [t.thread, t]));
    const all = [{ key: GROUP, name: 'Grup Kantor', group: true }, ...employees.map((e) => ({ key: e.id, name: e.name, group: false }))];
    return all
      .map((r) => ({ ...r, last: last[r.key] as Thread | undefined }))
      .filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => (a.key === GROUP ? -1 : b.key === GROUP ? 1 : (b.last?.created_at ?? '').localeCompare(a.last?.created_at ?? '')));
  }, [threads, employees, q]);

  if (view === 'list') {
    return (
      <div className="wa">
        <div className="wa-top"><b>Chat</b></div>
        <div className="wa-search"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍  Cari atau mulai chat" /></div>
        <ul className="wa-list">
          {rows.map((r) => {
            const e = r.group ? undefined : byKey(r.key);
            const from = r.last && r.group && r.last.sender !== 'director' ? (byKey(r.last.sender)?.name ?? r.last.sender) + ': ' : r.last?.sender === 'director' ? 'Kamu: ' : '';
            const unread = r.last && r.last.sender !== 'director' && (!seen[r.key] || seen[r.key]! < r.last.created_at);
            return (
              <li key={r.key}>
                <button type="button" className={thread === r.key ? 'on' : ''} onClick={() => { setThread(r.key); setView('chat'); }}>
                  <Avatar e={e} group={r.group} size={48} />
                  <span className="wa-row">
                    <span className="wa-row-top"><b>{r.name}</b><small className={unread ? 'new' : ''}>{r.last ? listTime(r.last.created_at) : ''}</small></span>
                    <span className="wa-row-bot">
                      <em>{r.last ? from + r.last.body : r.group ? 'Semua karyawan' : e?.role}</em>
                      {pending[r.key] ? <i className="wa-badge wait" title="Menunggu balasan">…</i> : unread ? <i className="wa-badge">●</i> : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
  return <Conversation key={thread} thread={thread} employees={employees} byKey={byKey} onBack={() => setView('list')} onSeen={markSeen} />;
}

function Conversation({ thread, employees, byKey, onBack, onSeen }: { thread: string; employees: Employee[]; byKey: (k: string) => Employee | undefined; onBack: () => void; onSeen: (k: string, at: string) => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [typing, setTyping] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const group = thread === GROUP;
  const who = byKey(thread);
  const waiting = messages.some((m) => m.sender === 'director' && m.status === 'pending');

  const load = useCallback(async () => {
    try {
      const r = await api<{ messages: Message[]; typing: string | null }>('/chat/' + thread);
      setMessages(r.messages); setTyping(r.typing ?? null); setError('');
      const last = r.messages.at(-1);
      if (last) onSeen(thread, last.created_at);
    } catch (e) { setError((e as Error).message); }
  }, [thread, onSeen]);
  useEffect(() => { void load(); const t = window.setInterval(() => void load(), 2500); return () => window.clearInterval(t); }, [load]);
  useEffect(() => { if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight; }, [messages.length, typing, waiting]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setText(''); setError(''); stick.current = true;
    if (input.current) input.current.style.height = '';
    try { await api('/chat/' + thread, { json: { body } }); await load(); } catch (err) { setError((err as Error).message); setText(body); }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
  };

  const typer = typing ? byKey(typing) : null;
  const status = group
    ? typer ? typer.name + ' sedang mengetik…' : waiting ? 'tim sedang mengetik…' : employees.map((e) => e.name).join(', ')
    : waiting || typer ? 'sedang mengetik…' : presence(who);
  const answered = (i: number) => messages.slice(i + 1).some((m) => m.sender !== 'director');

  return (
    <div className="wa">
      <div className="wa-head">
        <button type="button" className="wa-back" onClick={onBack} aria-label="Kembali ke daftar chat">‹</button>
        <Avatar e={who} group={group} size={38} />
        <span className="wa-head-txt">
          <b>{group ? 'Grup Kantor' : who?.name}</b>
          <small className={/mengetik/.test(status) ? 'typing' : ''}>{status}</small>
        </span>
      </div>
      <div className="wa-wall" ref={box} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
        <p className="wa-sys">{group
          ? '🔒 Grup semua karyawan. Mereka diskusi kerjaan & ngobrol santai di sini; sebut nama kalau pesanmu untuk orang tertentu.'
          : thread === 'alex' ? '🔒 ' + who?.role + '. Tanya status kantor atau minta pekerjaan baru; Alex yang meneruskan ke tim.' : '🔒 ' + who?.role + '. Minta pekerjaan baru, nanti ditawari dibuatkan task.'}</p>
        {messages.map((m, i) => {
          const me = m.sender === 'director';
          const prev = messages[i - 1];
          const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
          const first = newDay || prev?.sender !== m.sender;
          const p = me ? null : byKey(m.sender);
          return (
            <div key={m.id} className="wa-item">
              {newDay && <div className="wa-day"><span>{dayLabel(m.created_at)}</span></div>}
              <div className={'wa-msg ' + (me ? 'out' : 'in') + (first ? ' first' : '')}>
                {group && !me && first && <b className="wa-from" style={{ color: p?.color }}>{p?.name ?? m.sender}</b>}
                <span className="wa-text">{m.body}</span>
                <span className="wa-meta">
                  {m.channel === 'telegram' && <span title="dikirim lewat Telegram">✈︎ </span>}
                  {clock(m.created_at)}
                  {me && <span className={'wa-tick' + (answered(i) ? ' read' : '')}>{m.status === 'pending' ? '✓' : '✓✓'}</span>}
                </span>
                {m.meta?.proposal && !m.meta?.used && <button type="button" className="wa-action" onClick={() => void api('/chat/' + thread, { json: { body: 'ya' } }).then(load)}>👍 Ya, buatkan task</button>}
              </div>
            </div>
          );
        })}
        {(waiting || typer) && (
          <div className="wa-msg in first wa-typing">
            {group && typer && <b className="wa-from" style={{ color: typer.color }}>{typer.name}</b>}
            <span className="wa-dots"><i /><i /><i /></span>
          </div>
        )}
      </div>
      {error && <p className="lc-error sm">{error}</p>}
      <div className="wa-compose">
        <textarea ref={input} rows={1} value={text} maxLength={4000}
          onChange={(e) => { setText(e.target.value); e.target.style.height = ''; e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px'; }}
          onKeyDown={onKey} placeholder={group ? 'Ketik pesan ke grup' : 'Ketik pesan'} />
        <button type="button" className="wa-send" disabled={!text.trim()} onClick={() => void send()} aria-label="Kirim">➤</button>
      </div>
    </div>
  );
}
