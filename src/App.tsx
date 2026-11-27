import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { GAYA, TAMPIL_PEMILIH_GAYA } from './config';
import { DAFTAR_GAYA, KUNCI_SIMPAN, cariGaya, gayaAwal, type GayaId } from './gaya/daftar';
import { isNight, isoDay, lapseAt, params as readParams, plannedSpot, runtimeDoing, toMin, type DeskState, type RuntimeEntry, type Schedule } from './office';
import { prayerTimes, fmtMin } from './prayer';
import { ROOMS } from './layout';
import type { OfficeControls } from './OfficeScene';
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
  const roomAnchors = useRef(new Map<string, HTMLElement>());
  const cam = useRef<OfficeControls | null>(null);
  const [camState, setCamState] = useState<{ following: string | null; tour: boolean; zoomed: boolean }>({ following: null, tour: false, zoomed: false });
  const onCamera = useCallback((s: { following: string | null; tour: boolean; zoomed: boolean }) => setCamState(s), []);
  const look = useCallback((key: string) => { setOpen(key); cam.current?.focusPerson(key); }, []);
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
  const today = now.toDateString();
  const pt = useMemo(() => prayerTimes(new Date(today)), [today]);
  const minute = toMin(time);
  const day = isoDay(now);
  const desks = useMemo(() => PERSONNEL.map((person): DeskState => {
    const e = office[person.key];
    const plan = plannedSpot(person.key, (person as { schedule?: Schedule }).schedule, minute, day, pt);
    // Real work always wins: someone with a running task, waiting for you or stuck is at the desk.
    const busy = e && e.state !== 'available';
    const doing = busy
      ? { ...runtimeDoing(e), label: (plan.spot === 'rumah' ? 'lembur: ' : '') + runtimeDoing(e).label }
      : plan.spot === 'rumah' ? { activity: 'pulang' as const, label: plan.label }
      : plan.spot === 'meja' ? { ...runtimeDoing(e), label: plan.label === 'siap menerima perintah' ? runtimeDoing(e).label : plan.label }
      : { activity: 'siaga' as const, label: plan.label };
    const spot = busy ? 'meja' : plan.spot;
    return {
      doing,
      spot,
      desk: { key: person.key, room: ROOM[person.room] ?? 'studio', color: person.color, x: person.desk.x, z: person.desk.z },
      agen: { key: person.key, nama: person.name, tugas: person.summary, ruang: ROOM[person.room] ?? 'studio', warna: person.color, x: person.desk.x, z: person.desk.z },
      bubble: e?.title ?? null,
      waiting: e?.state === 'waiting' ? [e.title || 'Menunggu keputusan'] : [],
      urgent: e?.state === 'blocked' ? [e.title || 'Perlu dicek'] : [],
    };
  }), [office, minute, day, pt]);
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
          <OfficeScene desks={desks} night={night} boardCount={Math.min(waitingList.length, 8)} anchors={anchors} roomAnchors={roomAnchors} boardAnchor={boardAnchor} controls={cam} onCamera={onCamera} cinematic manual={p.rec} drive={drive} gaya={gaya} />
        </Suspense>
        {g.tiltShift && <div className="ko-tilt" aria-hidden="true" />}
        <div className="ko-layer">
          {desks.map((d) => (
            <Tag key={d.desk.key} d={d} refFn={(el) => (el ? anchors.current.set(d.desk.key, el) : anchors.current.delete(d.desk.key))} onOpen={() => look(d.desk.key)} />
          ))}
          <span className="ko-board-pin" ref={(el) => void (boardAnchor.current = el)}>Mission Board</span>
          {ROOMS.map((r) => <button type="button" key={r.key} className="ko-room-pin" onClick={() => cam.current?.focusRoom(r.key)} ref={(el) => { if (el) roomAnchors.current.set(r.key, el); else roomAnchors.current.delete(r.key); }}>{ROOM_ICON[r.key] ?? ''} {r.label}</button>)}
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
          <div className="ko-clock"><b>{time.replace(':', '.')}</b><small>{HARI[now.getDay()]}, {now.getDate()} {BULAN[now.getMonth()]} {now.getFullYear()}</small><small className="ko-prayer">{nextPrayer(pt, minute)}</small></div>
        </div>
      </header>

      <section className={`ko-panel ko-panel-agents ${agentsOpen ? '' : 'is-collapsed'}`} aria-label="Personnel">
        <div className="ko-panel-head">
          <div><span className="ko-eyebrow">TIM</span><h2>Personnel</h2><p>{count('working')} bekerja · {count('waiting')} menunggu kamu · {desks.filter((d) => d.spot !== 'rumah').length} di kantor</p></div>
          <button className="ko-icon-btn" type="button" onClick={() => setAgentsOpen((v) => !v)} aria-label={agentsOpen ? 'Ciutkan' : 'Buka'}>{agentsOpen ? '−' : '+'}</button>
        </div>
        {agentsOpen && <div className="ko-person-list">
          {PERSONNEL.map((x) => {
            const e = office[x.key];
            const d = desks.find((k) => k.desk.key === x.key)!.doing;
            return <button className="ko-person" type="button" key={x.key} onClick={() => look(x.key)}>
              <span className="ko-avatar" style={{ '--agent': x.color } as React.CSSProperties}>{x.name.slice(0, 1)}</span>
              <span className="ko-person-copy"><b>{x.name}</b><small>{x.role}</small><em>{e?.title ? d.label + ' · ' + e.title : d.label}</em></span>
              <i className="ko-presence" data-state={desks.find((d) => d.desk.key === x.key)?.spot === 'rumah' && (e?.state ?? 'available') === 'available' ? 'away' : e?.state ?? 'available'} />
            </button>;
          })}
        </div>}
        {agentsOpen && waitingList.length > 0 && <div className="ko-waiting">
          <span className="ko-eyebrow">MENUNGGU KAMU</span>
          {waitingList.map((x) => <button key={x.key} type="button" onClick={() => openCC(office[x.key]?.taskId ? { task: office[x.key]!.taskId } : { tab: 'inbox' })}>{office[x.key]?.state === 'blocked' ? '⚠️' : '🙋'} {x.name}: {office[x.key]?.title || 'butuh keputusan'}</button>)}
        </div>}
      </section>

      {!p.rec && <nav className="ko-cam" aria-label="Kamera">
        <button type="button" className={!camState.zoomed && !camState.following && !camState.tour ? 'on' : ''} onClick={() => cam.current?.overview()}>🏢 Semua</button>
        {ROOMS.map((r) => <button type="button" key={r.key} onClick={() => cam.current?.focusRoom(r.key)}>{ROOM_ICON[r.key]} {ROOM_SHORT[r.key] ?? r.label}</button>)}
        <button type="button" className={camState.tour ? 'on' : ''} onClick={() => cam.current?.setTour(!camState.tour)}>🎥 Tur</button>
      </nav>}
      {camState.following && <p className="ko-following">Mengikuti {PERSONNEL.find((x) => x.key === camState.following)?.name} · geser layar untuk berhenti</p>}

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
            <button type="button" onClick={() => { cam.current?.focusPerson(person.key); setOpen(null); }}>🎯 Ikuti dengan kamera</button>
            <button type="button" onClick={() => openCC({ chat: person.key })}>💬 Chat dengan {person.name}</button>
            <button type="button" className="ghost" onClick={() => setOpen(null)}>Tutup</button>
          </div>
        </div>
      </div>}

      <CommandCenter open={ccOpen} onClose={() => setCcOpen(false)} focus={focus} onAuth={onAuth} onUnread={setUnread} />
    </main>
  );
}

const ROOM_SHORT: Record<string, string> = { creative: 'Creative', direksi: 'Direksi', webdev: 'Web Dev', musholla: 'Musholla', atrium: 'Lounge', rapat: 'Rapat', pantry: 'Pantry', lobby: 'Lobby', marketing: 'Marketing' };
const ROOM_ICON: Record<string, string> = { creative: '🎨', direksi: '👔', webdev: '💻', musholla: '🕌', atrium: '🛋️', rapat: '🗓️', pantry: '☕', lobby: '🚪', marketing: '📈' };

function nextPrayer(pt: Record<string, number>, minute: number) {
  const next = Object.entries(pt).find(([, m]) => m >= minute);
  return next ? '🕌 ' + next[0] + ' ' + fmtMin(next[1]) : '🕌 Subuh ' + fmtMin(pt.Subuh ?? 0);
}

function Tag({ d, refFn, onOpen }: { d: DeskState; refFn: (el: HTMLElement | null) => void; onOpen: () => void }) {
  const a = d.doing.activity;
  const think = a === 'kerja' ? '</>' : a === 'menunggu' ? '🙋' : a === 'kendala' ? '!?' : null;
  return <div className="ko-tag" ref={refFn} data-act={a} data-spot={d.spot ?? 'meja'} style={{ ['--agent' as string]: d.desk.color }}>
    <div className="ko-tag-in">
      {think && <span className="ko-think">{think}</span>}
      <div className="ko-tag-row"><button type="button" className="ko-name" onClick={onOpen}><span className="ko-dot" />{d.agen.nama}<span className="ko-name-act">{d.doing.label}</span></button>
        {d.waiting.length > 0 && <button type="button" className="ko-bang" onClick={onOpen} aria-label="Menunggu keputusan">!</button>}
        {d.urgent.length > 0 && <span className="ko-urgent">!</span>}
      </div>
    </div>
  </div>;
}
