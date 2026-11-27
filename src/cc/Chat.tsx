import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { api, fmtTime, type Employee, type Message } from './api';

const GROUP = 'grup';

export default function Chat({ employees, thread, setThread }: { employees: Employee[]; thread: string; setThread: (k: string) => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const group = thread === GROUP;
  const who = employees.find((e) => e.id === thread);
  const byKey = (k: string) => employees.find((e) => e.id === k || e.key === k);
  const waiting = messages.some((m) => m.sender === 'director' && m.status === 'pending');

  const load = useCallback(async () => {
    try { const r = await api<{ messages: Message[] }>('/chat/' + thread); setMessages(r.messages); } catch (e) { setError((e as Error).message); }
  }, [thread]);
  useEffect(() => { setMessages([]); void load(); const t = window.setInterval(() => void load(), 2500); return () => window.clearInterval(t); }, [load]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [messages.length, waiting]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText(''); setError('');
    try { await api('/chat/' + thread, { json: { body } }); await load(); } catch (err) { setError((err as Error).message); setText(body); }
  };

  return (
    <div className="lc-chat">
      <div className="lc-people">
        <button className={group ? 'on' : ''} onClick={() => setThread(GROUP)} title="Grup chat semua karyawan"><i style={{ background: '#271b3f' }}>👥</i>Grup Kantor</button>
        {employees.map((e) => <button key={e.id} className={thread === e.id ? 'on' : ''} onClick={() => setThread(e.id)} title={e.role}><i style={{ background: e.color }}>{e.name[0]}</i>{e.name}</button>)}
      </div>
      <div className="lc-thread">
        <p className="lc-muted">{group
          ? 'Grup Kantor · semua karyawan. Mereka saling diskusi soal kerjaan & ngobrol santai di sini; kamu bisa ikut nimbrung atau kasih perintah.'
          : who?.name + ' · ' + who?.role + '. ' + (thread === 'alex' ? 'Tanya status kantor atau minta pekerjaan baru; Alex yang meneruskan ke tim.' : 'Chat langsung. Minta pekerjaan baru, nanti ditawari dibuatkan task.')}</p>
        {messages.map((m, i) => {
          const me = m.sender === 'director';
          const p = me ? null : byKey(m.sender);
          const showName = group && !me && messages[i - 1]?.sender !== m.sender;
          return (
            <div key={m.id} className={'lc-msg ' + (me ? 'me' : 'them')} style={group && p ? { ['--who' as string]: p.color } : undefined}>
              {showName && <b className="lc-sender" style={{ color: p?.color }}>{p?.name ?? m.sender}</b>}
              <p>{m.body}</p>
              <small>{m.channel === 'telegram' ? 'via Telegram · ' : ''}{fmtTime(m.created_at)}</small>
              {m.meta?.proposal && !m.meta?.used && <button className="lc-primary sm" onClick={() => void api('/chat/' + thread, { json: { body: 'ya' } }).then(load)}>👍 Ya, buatkan task</button>}
            </div>
          );
        })}
        {waiting && <div className="lc-msg them typing"><p>{group ? 'Tim sedang mengetik…' : who?.name + ' sedang mengetik…'}</p></div>}
        <div ref={end} />
      </div>
      <form className="lc-compose" onSubmit={send}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={group ? 'Tulis di Grup Kantor (sebut nama kalau untuk orang tertentu)' : 'Pesan ke ' + (who?.name || '')} maxLength={4000} />
        <button className="lc-primary" disabled={!text.trim()}>Kirim</button>
      </form>
      {error && <p className="lc-error">{error}</p>}
    </div>
  );
}
