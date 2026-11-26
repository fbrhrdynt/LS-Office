import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { GAYA, TAMPIL_PEMILIH_GAYA } from './config';
import { DAFTAR_GAYA, KUNCI_SIMPAN, cariGaya, gayaAwal, type GayaId } from './gaya/daftar';
import { isNight, lapseAt, params as readParams, runtimeDoing, type DeskState, type RuntimeEntry } from './office';
import type { RoomKey } from './config';
import CommandCenter, { type Focus } from './cc/CommandCenter';
import PERSONNEL_DATA from '../shared/personnel.json';

const OfficeScene = lazy(() => import('./OfficeScene'));

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const ROOM: Record<string, RoomKey> = { creative: 'bizdev', marketing: 'keuangan', webdev: 'studio' };

type Person = (typeof PERSONNEL_DATA)[number];
const PERSONNEL = PERSONNEL_DATA.filter((p): p is Person & { desk: { x: number; z: number } } => Boolean(p.desk));
const managerName = (key: string | null) => PERSONNEL_DATA.find((p) => p.key === key)?.name ?? '—';

export default function App() {
  const p = useMemo(() => readParams(new URLSearchParams(location.search)), []);
  const [now, setNow] = useState(() => new Date());
  const [t, setT] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [agentsOpen, setAgentsOpen] = useState(() => window.innerWidth > 900);
  const [office, setOffice] = useState<Record<string, RuntimeEntry>>({});
  const [authed, setAuthed] = useState(false);
  const [ccOpen, setCcOpen] = useState(() => new URLSearchParams(location.search).has('social'));
  const [focus, setFocus] = useState<Focus>(null);
  const [unread, setUnread] = useState(0);
  const drive = useRef<((t: number) => void) | null>(null);
  const anchors = useRef(new Map<string, HTMLElement>());
  const boardAnchor = useRef<HTMLElement | null>(null);
  const [gaya, setGaya] = useState<GayaId>(() => {
    let simpanan: string | null = null;
    try { simpanan = localStorage.getItem(KUNCI_SIMPAN); } catch { /* storage blocked */ }
    return gayaAwal(new URLSearchParams(location.search).get('gaya'), simpanan, GAYA);
  });
  const [pilihBuka, setPilihBuka] = useState(false);
  const gantiGaya = (id: GayaId) => {
    setGaya(id); setPilihBuka(false);
    try { localStorage.setItem(KUNCI_SIMPAN, id); } catch { /* ignore */ }
    const q = new URLSearchParams(location.search); q.set('gaya', id);
    history.replaceState(null, '', `${location.pathname}?${q}`);
  };
  const g = cariGaya(gaya);

  // Live office state from the backend: who is working on what, who waits for the Director.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(authed ? '/api/office' : '/api/office/public', { credentials: 'same-origin' });
        if (r.ok && alive) setOffice((await r.json()).state || {});
      } catch { /* offline: keep last state */ }
    };
    void load();
    const id = window.setInterval(() => void load(), 4000);
    return () => { alive = false; window.clearInterval(id); };
  }, [authed]);

  useEffect(() => {
    if (p.rec) {
      const w = window as unknown as { __koFrame?: (t: number) => boolean };
      w.__koFrame = (x: number) => { flushSync(() => setT(x)); drive.current?.(x); return !!drive.current; };
      return () => void delete w.__koFrame;
    }
    const start = performance.now();
    const id = window.setInterval(() => { setT((performance.now() - start) / 1000); setNow(new Date()); }, 250);
    return () => window.clearInterval(id);
  }, [p.rec]);

  const lapse = p.lapse ? lapseAt(t) : null;
  const time = lapse?.time ?? p.time ?? hm(now);
  const desks = useMemo(() => PERSONNEL.map((person): DeskState => {
    const e = office[person.key];
    const doing = runtimeDoing(e);
    return {
      doing,
      desk: { key: person.key, room: ROOM[person.room] ?? 'studio', color: person.color, x: person.desk.x, z: person.desk.z },
      agen: { key: person.key, nama: person.name, tugas: person.summary, ruang: ROOM[person.room] ?? 'studio', warna: person.color, x: person.desk.x, z: person.desk.z },
      bubble: e?.title ?? null,
      waiting: e?.state === 'waiting' ? [e.title || 'Menunggu keputusan'] : [],
      urgent: e?.state === 'blocked' ? [e.title || 'Perlu dicek'] : [],
    };
  }), [office]);
  const night = isNight(time);
  const count = (s: string) => PERSONNEL.filter((x) => (office[x.key]?.state ?? 'available') === s).length;
  const waitingList = PERSONNEL.filter((x) => office[x.key]?.state === 'waiting' || office[x.key]?.state === 'blocked');
  const latar = g.latar && (night ? g.latar.malam : g.latar.siang);

  const openCC = useCallback((f: Focus) => { setFocus(f ? { ...f } : null); setCcOpen(true); setOpen(null); }, []);
  const onAuth = useCallback((ok: boolean) => setAuthed(ok), []);
  const person = open ? PERSONNEL.find((x) => x.key === open) : null;
  const entry = open ? office[open] : undefined;

  return (
    <main className="ko" data-night={night || !!g.malam || undefined} data-gaya={gaya} style={latar ? { background: latar } : undefined}>
      <div className="ko-stage">
        <Suspense fallback={<div className="ko-loading">Menyiapkan kantor…</div>}>
          <OfficeScene desks={desks} night={night} boardCount={Math.min(waitingList.length, 8)} anchors={anchors} boardAnchor={boardAnchor} cinematic manual={p.rec} drive={drive} gaya={gaya} />
        </Suspense>
        {g.tiltShift && <div className="ko-tilt" aria-hidden="true" />}
        <div className="ko-layer">
          {desks.map((d) => (
            <Tag key={d.desk.key} d={d} refFn={(el) => (el ? anchors.current.set(d.desk.key, el) : anchors.current.delete(d.desk.key))} onOpen={() => setOpen(d.desk.key)} />
          ))}
          <span className="ko-board-pin" ref={(el) => void (boardAnchor.current = el)}>Mission Board</span>
        </div>
      </div>

      <header className="ko-hud">
        <div className="ko-brand">
          <span className="ko-brand-mark">LS</span>
          <div><b>LogiSource <span>AI Office</span></b><small>{PERSONNEL.length} personnel · {count('working')} sedang bekerja</small></div>
        </div>
        <div className="ko-hud-meta">
          <div className="ko-hud-actions">
            <button type="button" className="ko-hud-btn" onClick={() => openCC({ tab: 'inbox' })} aria-label="Perlu keputusan">🔔{unread > 0 && <i>{unread}</i>}</button>
            <button type="button" className="ko-hud-btn" onClick={() => openCC({ chat: 'alex' })}>💬 Chat</button>
            <button type="button" className="ko-hud-btn primary" onClick={() => (ccOpen ? setCcOpen(false) : openCC(null))}>⌘ Command Center</button>
          </div>
          <div className="ko-clock"><b>{time.replace(':', '.')}</b><small>{HARI[now.getDay()]}, {now.getDate()} {BULAN[now.getMonth()]} {now.getFullYear()}</small></div>
        </div>
      </header>

      <section className={`ko-panel ko-panel-agents ${agentsOpen ? '' : 'is-collapsed'}`} aria-label="Personnel">
        <div className="ko-panel-head">
          <div><span className="ko-eyebrow">TIM</span><h2>Personnel</h2><p>{count('working')} bekerja · {count('waiting')} menunggu kamu · {count('available')} siap</p></div>
          <button className="ko-icon-btn" type="button" onClick={() => setAgentsOpen((v) => !v)} aria-label={agentsOpen ? 'Ciutkan' : 'Buka'}>{agentsOpen ? '−' : '+'}</button>
        </div>
        {agentsOpen && <div className="ko-person-list">
          {PERSONNEL.map((x) => {
            const e = office[x.key];
            const d = runtimeDoing(e);
            return <button className="ko-person" type="button" key={x.key} onClick={() => setOpen(x.key)}>
              <span className="ko-avatar" style={{ '--agent': x.color } as React.CSSProperties}>{x.name.slice(0, 1)}</span>
              <span className="ko-person-copy"><b>{x.name}</b><small>{x.role}</small><em>{e?.title ? d.label + ' · ' + e.title : d.label}</em></span>
              <i className="ko-presence" data-state={e?.state ?? 'available'} />
            </button>;
          })}
        </div>}
        {agentsOpen && waitingList.length > 0 && <div className="ko-waiting">
          <span className="ko-eyebrow">MENUNGGU KAMU</span>
          {waitingList.map((x) => <button key={x.key} type="button" onClick={() => openCC(office[x.key]?.taskId ? { task: office[x.key]!.taskId } : { tab: 'inbox' })}>{office[x.key]?.state === 'blocked' ? '⚠️' : '🙋'} {x.name}: {office[x.key]?.title || 'butuh keputusan'}</button>)}
        </div>}
      </section>

      {lapse && (!p.rec || lapse.inAct < 3) && <p key={lapse.act} className="ko-act">{lapse.title}</p>}

      {TAMPIL_PEMILIH_GAYA && !p.rec && <nav className="ko-gaya" aria-label="Gaya 3D">
        {pilihBuka && <ul>{DAFTAR_GAYA.map((x) => <li key={x.id}><button type="button" aria-pressed={x.id === gaya} title={x.ket} onClick={() => gantiGaya(x.id as GayaId)}>{x.nama}{x.jenis === 'paduan' && <small>dunia</small>}</button></li>)}</ul>}
        <button type="button" className="ko-gaya-btn" aria-expanded={pilihBuka} onClick={() => setPilihBuka((b) => !b)}>Style · {g.nama}</button>
      </nav>}

      {person && <div className="ko-sheet" role="dialog" aria-label={person.name} onClick={() => setOpen(null)}>
        <div className="ko-sheet-in" onClick={(e) => e.stopPropagation()}>
          <span className="ko-eyebrow">{person.department.toUpperCase()} · lapor ke {managerName(person.managerKey)}</span>
          <h3>{person.name} <small>{person.role}</small></h3>
          <p className="ko-sheet-role">{person.summary}</p>
          <p>Sekarang: <b>{runtimeDoing(entry).label}</b>{entry?.title ? <> — {entry.title}</> : null}</p>
          <div className="ko-sheet-actions">
            {authed && entry?.taskId && <button type="button" onClick={() => openCC({ task: entry.taskId })}>Buka task</button>}
            <button type="button" onClick={() => openCC({ chat: person.key })}>💬 Chat dengan {person.name}</button>
            <button type="button" className="ghost" onClick={() => setOpen(null)}>Tutup</button>
          </div>
        </div>
      </div>}

      <CommandCenter open={ccOpen} onClose={() => setCcOpen(false)} focus={focus} onAuth={onAuth} onUnread={setUnread} />
    </main>
  );
}

function Tag({ d, refFn, onOpen }: { d: DeskState; refFn: (el: HTMLElement | null) => void; onOpen: () => void }) {
  const a = d.doing.activity;
  const think = a === 'kerja' ? '</>' : a === 'menunggu' ? '🙋' : a === 'kendala' ? '!?' : null;
  return <div className="ko-tag" ref={refFn} data-act={a} style={{ ['--agent' as string]: d.desk.color }}>
    <div className="ko-tag-in">
      {think && <span className="ko-think">{think}</span>}
      <div className="ko-tag-row"><button type="button" className="ko-name" onClick={onOpen}><span className="ko-dot" />{d.agen.nama}<span className="ko-name-act">{d.doing.label}</span></button>
        {d.waiting.length > 0 && <button type="button" className="ko-bang" onClick={onOpen} aria-label="Menunggu keputusan">!</button>}
        {d.urgent.length > 0 && <span className="ko-urgent">!</span>}
      </div>
    </div>
  </div>;
}
