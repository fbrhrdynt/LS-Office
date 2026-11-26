import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { GAYA, KANTOR, TAMPIL_PEMILIH_GAYA } from './config';
import { DAFTAR_GAYA, KUNCI_SIMPAN, cariGaya, gayaAwal, type GayaId } from './gaya/daftar';
import { IDLE_LABEL, idleAt, isNight, isoDay, lapseAt, missionBoard, officeDesks, params as readParams, type DeskState, type IdleSpot } from './office';

const OfficeScene = lazy(() => import('./OfficeScene'));

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

type Personnel = {
  key: string; nama: string; jabatan: string; divisi: string; tugas: string;
  manager: string; color: string; x: number; z: number; room: 'bizdev' | 'keuangan' | 'studio';
};

const PERSONNEL: Personnel[] = [
  { key: 'nadia', nama: 'Nadia', jabatan: 'Research & Creative Strategist', divisi: 'Creative', tugas: 'Riset ide, tren, dan referensi', manager: 'Ethan', color: '#F28C28', x: -5.7, z: -1.5, room: 'bizdev' },
  { key: 'felix', nama: 'Felix', jabatan: 'Scriptwriter & Content Writer', divisi: 'Creative', tugas: 'Menulis naskah dan copy', manager: 'Ethan', color: '#D97757', x: -3.9, z: 0.7, room: 'bizdev' },
  { key: 'ethan', nama: 'Ethan', jabatan: 'Creative Director & Storyboard Artist', divisi: 'Creative', tugas: 'Arahan kreatif dan storyboard', manager: 'Alex', color: '#B88A5A', x: -2.1, z: -1.5, room: 'bizdev' },
  { key: 'maya', nama: 'Maya', jabatan: 'Voice & Audio Specialist', divisi: 'Creative', tugas: 'Voice-over dan audio', manager: 'Ethan', color: '#C77D9B', x: -5.7, z: 1.7, room: 'bizdev' },
  { key: 'olivier', nama: 'Olivier', jabatan: 'Social Media & Distribution Specialist', divisi: 'Marketing', tugas: 'Caption, jadwal, dan distribusi', manager: 'Ethan', color: '#35B8A5', x: 0, z: -1.5, room: 'keuangan' },
  { key: 'adrian', nama: 'Adrian', jabatan: 'Content Performance Analyst', divisi: 'Analytics', tugas: 'Analisis performa dan KPI', manager: 'Alex', color: '#6687C8', x: 0, z: 1.7, room: 'keuangan' },
  { key: 'arvin', nama: 'Arvin', jabatan: 'Lead Software Engineer', divisi: 'Web Development', tugas: 'Arsitektur dan technical planning', manager: 'Alex', color: '#8C78B8', x: 3.8, z: -1.5, room: 'studio' },
  { key: 'nathan', nama: 'Nathan', jabatan: 'Full-stack Developer', divisi: 'Web Development', tugas: 'Implementasi frontend dan backend', manager: 'Arvin', color: '#4C9B91', x: 5.7, z: -1.5, room: 'studio' },
  { key: 'daren', nama: 'Daren', jabatan: 'QA Automation & DevOps Engineer', divisi: 'Web Development', tugas: 'QA, automation, dan DevOps', manager: 'Arvin', color: '#D1A64B', x: 4.8, z: 1.7, room: 'studio' },
];

export default function App() {
  const p = useMemo(() => readParams(new URLSearchParams(location.search)), []);
  const [now, setNow] = useState(() => new Date());
  const [t, setT] = useState(0);
  const [open, setOpen] = useState<DeskState | null>(null);
  const [agentsOpen, setAgentsOpen] = useState(true);
  const [reportsOpen, setReportsOpen] = useState(true);
  const drive = useRef<((t: number) => void) | null>(null);
  const anchors = useRef(new Map<string, HTMLElement>());
  const boardAnchor = useRef<HTMLElement | null>(null);
  const [gaya, setGaya] = useState<GayaId>(() => {
    let simpanan: string | null = null;
    try { simpanan = localStorage.getItem(KUNCI_SIMPAN); } catch { /* penyimpanan diblokir: pakai config */ }
    return gayaAwal(new URLSearchParams(location.search).get('gaya'), simpanan, GAYA);
  });
  const [pilihBuka, setPilihBuka] = useState(false);
  const gantiGaya = (id: GayaId) => {
    setGaya(id); setPilihBuka(false);
    try { localStorage.setItem(KUNCI_SIMPAN, id); } catch { /* abaikan */ }
    const q = new URLSearchParams(location.search); q.set('gaya', id);
    history.replaceState(null, '', `${location.pathname}?${q}`);
  };
  const g = cariGaya(gaya);

  useEffect(() => {
    const nodes = document.querySelectorAll<HTMLElement>('[data-reveal]');
    if (!('IntersectionObserver' in window)) {
      nodes.forEach((node) => node.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (p.rec) {
      const w = window as unknown as { __koFrame?: (t: number) => boolean };
      w.__koFrame = (x: number) => { flushSync(() => setT(x)); drive.current?.(x); return !!drive.current; };
      return () => void delete w.__koFrame;
    }
    const start = performance.now();
    const id = window.setInterval(() => { setT((performance.now() - start) / 1000); setNow(new Date()); }, 100);
    return () => window.clearInterval(id);
  }, [p.rec]);

  const lapse = p.lapse ? lapseAt(t) : null;
  const time = lapse?.time ?? p.time ?? hm(now);
  const sourceDesks = officeDesks(isoDay(now), time, p.alwaysWork);
  const desks = PERSONNEL.map((person, index): DeskState => {
    const source = sourceDesks[index % sourceDesks.length]!;
    return {
      ...source,
      desk: { key: person.key, room: person.room, color: person.color, x: person.x, z: person.z },
      agen: { key: person.key, nama: person.nama, tugas: person.tugas, ruang: person.room, warna: person.color, x: person.x, z: person.z },
      bubble: null,
      waiting: [],
      urgent: [],
    };
  });
  const board = missionBoard(desks);
  const night = isNight(time);
  const working = desks.filter((d) => ['kerja', 'laporan', 'belajar'].includes(d.doing.activity)).length;
  const idle = desks.filter((d) => d.doing.activity === 'siaga').length;
  const latar = g.latar && (night ? g.latar.malam : g.latar.siang);
  const divisionCounts = PERSONNEL.reduce<Record<string, number>>((acc, person) => {
    acc[person.divisi] = (acc[person.divisi] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <main className="ko" data-night={night || !!g.malam || undefined} data-gaya={gaya} style={latar ? { background: latar } : undefined}>
      <div className="ko-stage">
        <Suspense fallback={<div className="ko-loading">Menyiapkan kantor…</div>}>
          <OfficeScene desks={desks} night={night} boardCount={Math.min(board.items.length, 8)} anchors={anchors} boardAnchor={boardAnchor} cinematic manual={p.rec} drive={drive} gaya={gaya} />
        </Suspense>
        {g.tiltShift && <div className="ko-tilt" aria-hidden="true" />}
        <div className="ko-layer">
          {desks.map((d) => (
            <Tag key={d.desk.key} d={d} spot={false} idle={d.doing.activity === 'siaga' ? idleAt(d.desk.key, t).spot : null}
              refFn={(el) => (el ? anchors.current.set(d.desk.key, el) : anchors.current.delete(d.desk.key))}
              onOpen={() => setOpen(d)} />
          ))}
          <span className="ko-board-pin" ref={(el) => void (boardAnchor.current = el)}>LogiSource Office</span>
        </div>
      </div>

      <header className="ko-hud">
        <div className="ko-brand">
          <span className="ko-brand-mark">LS</span>
          <div><b>LogiSource <span>AI Office</span></b><small>Internal workspace · {PERSONNEL.length} personnel</small></div>
        </div>
        <div className="ko-hud-meta">
          <span className="ko-status"><i /> OFFICE LIVE</span>
          <div className="ko-clock"><b>{time.replace(':', '.')}</b><small>{HARI[now.getDay()]}, {now.getDate()} {BULAN[now.getMonth()]} {now.getFullYear()}</small></div>
        </div>
      </header>

      <section className={`ko-panel ko-panel-agents ${agentsOpen ? '' : 'is-collapsed'}`} data-reveal aria-label="Personnel directory">
        <div className="ko-panel-head">
          <div><span className="ko-eyebrow">ORGANIZATION</span><h2>Personnel</h2><p>Team directory & reporting line</p></div>
          <button className="ko-icon-btn" type="button" onClick={() => setAgentsOpen((v) => !v)} aria-label={agentsOpen ? 'Ciutkan personnel' : 'Buka personnel'}>{agentsOpen ? '−' : '+'}</button>
        </div>
        {agentsOpen && <div className="ko-person-list">
          {PERSONNEL.map((person) => <button className="ko-person" type="button" key={person.key} onClick={() => setOpen(desks.find((d) => d.agen.key === person.key) ?? null)}>
            <span className="ko-avatar" style={{ '--agent': person.color } as React.CSSProperties}>{person.nama.slice(0, 1)}</span>
            <span className="ko-person-copy"><b>{person.nama}</b><small>{person.jabatan}</small><em>{person.divisi} · Reports to {person.manager}</em></span>
            <i className="ko-presence" />
          </button>)}
        </div>}
        <div className="ko-panel-foot">{Object.entries(divisionCounts).map(([name, count]) => <span key={name}>{name}<b>{count}</b></span>)}</div>
      </section>

      <section className={`ko-panel ko-panel-reports ${reportsOpen ? '' : 'is-collapsed'}`} data-reveal aria-label="Office overview">
        <div className="ko-panel-head">
          <div><span className="ko-eyebrow">DAILY OPERATIONS</span><h2>Office pulse</h2><p>Ringkasan aktivitas saat ini</p></div>
          <button className="ko-icon-btn" type="button" onClick={() => setReportsOpen((v) => !v)} aria-label={reportsOpen ? 'Ciutkan ringkasan' : 'Buka ringkasan'}>{reportsOpen ? '−' : '+'}</button>
        </div>
        {reportsOpen && <>
          <div className="ko-pulse-grid">
            <div><b>{working}</b><span>Working</span></div><div><b>{idle}</b><span>Available</span></div><div><b>{PERSONNEL.length}</b><span>Personnel</span></div>
          </div>
          <div className="ko-report-section"><span className="ko-eyebrow">REPORTS</span><p>Belum ada laporan operasional untuk personnel LogiSource. Laporan akan muncul setelah data tersedia di <code>src/laporan.json</code>.</p></div>
          <div className="ko-report-section"><span className="ko-eyebrow">WORKFLOW</span><ol><li>Nadia · Research & validation</li><li>Felix · Scriptwriting</li><li>Ethan · Creative review</li><li>Maya · Voice & audio</li><li>Olivier · Distribution</li><li>Adrian · Performance analysis</li><li>Arvin → Nathan → Daren · Engineering</li></ol></div>
        </>}
        <div className="ko-panel-foot"><span>Data source<b>Personnel charter</b></span><span>Mode<b>Assisted</b></span></div>
      </section>

      {lapse && (!p.rec || lapse.inAct < 3) && <p key={lapse.act} className="ko-act" style={p.rec ? { animation: 'none', opacity: Math.max(0, Math.min(1, lapse.inAct * 3, (3 - lapse.inAct) * 2)) } : undefined}>{lapse.title}</p>}

      {TAMPIL_PEMILIH_GAYA && !p.rec && <nav className="ko-gaya" aria-label="Gaya 3D">
        {pilihBuka && <ul>{DAFTAR_GAYA.map((x) => <li key={x.id}><button type="button" aria-pressed={x.id === gaya} title={x.ket} onClick={() => gantiGaya(x.id as GayaId)}>{x.nama}{x.jenis === 'paduan' && <small>dunia</small>}</button></li>)}</ul>}
        <button type="button" className="ko-gaya-btn" aria-expanded={pilihBuka} onClick={() => setPilihBuka((b) => !b)}>Style · {g.nama}</button>
      </nav>}

      {open && <div className="ko-sheet" role="dialog" aria-label={open.agen.nama} onClick={() => setOpen(null)}>
        <div className="ko-sheet-in" onClick={(e) => e.stopPropagation()}>
          <span className="ko-eyebrow">{PERSONNEL.find((x) => x.key === open.agen.key)?.divisi ?? 'PERSONNEL'}</span>
          <h3>{open.agen.nama} <small>{PERSONNEL.find((x) => x.key === open.agen.key)?.jabatan}</small></h3>
          <p className="ko-sheet-role">{open.agen.tugas}</p>
          <p>Current status: <b>{open.doing.label}</b></p>
          <p className="ko-sheet-sum">Responsibility: {open.agen.tugas}</p>
          <button type="button" onClick={() => setOpen(null)}>Close profile</button>
        </div>
      </div>}
    </main>
  );
}

function Tag({ d, spot, idle, refFn, onOpen }: { d: DeskState; spot: boolean; idle: IdleSpot | null; refFn: (el: HTMLElement | null) => void; onOpen: () => void }) {
  const label = idle ? IDLE_LABEL[idle] : d.doing.label;
  const a = d.doing.activity;
  const think = a === 'kerja' ? '</>' : a === 'laporan' ? '•••' : a === 'belajar' ? '↗' : idle === 'kopi' ? 'COFFEE' : idle === 'papan' ? 'BOARD' : idle === 'sofa' ? 'CHAT' : null;
  return <div className="ko-tag" ref={refFn} data-act={a} style={{ ['--agent' as string]: d.desk.color }}>
    <div className="ko-tag-in">
      {d.bubble && spot && a !== 'pulang' && <p className="ko-bubble">{d.bubble}</p>}
      {think && !(d.bubble && spot) && <span className="ko-think">{think}</span>}
      <div className="ko-tag-row"><button type="button" className="ko-name" onClick={onOpen}><span className="ko-dot" />{d.agen.nama}<span className="ko-name-act">{label}</span></button>
        {d.waiting.length > 0 && <button type="button" className="ko-bang" onClick={onOpen} aria-label={`${d.waiting.length} butir menunggu keputusan`}>!</button>}
        {d.urgent.length > 0 && <span className="ko-urgent">!</span>}
      </div>
    </div>
  </div>;
}
