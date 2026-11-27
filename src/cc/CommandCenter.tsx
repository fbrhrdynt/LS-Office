import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError, fmtAgo, usd, STATUS_LABEL, TYPE_LABEL, type Employee, type Notification, type Overview, type Project, type TaskRow } from './api';
import TaskView from './TaskView';
import NewTask from './NewTask';
import Chat from './Chat';
import { Projects, SeriesList, Settings, Social } from './Studio';
import './cc.css';

export type Focus = { task?: string; chat?: string; tab?: Tab } | null;
type Tab = 'inbox' | 'work' | 'chat' | 'studio' | 'settings';

export default function CommandCenter({ open, onClose, focus, onAuth, onUnread }: { open: boolean; onClose: () => void; focus: Focus; onAuth: (ok: boolean) => void; onUnread: (n: number) => void }) {
  const [auth, setAuth] = useState<'checking' | 'in' | 'out'>('checking');
  const [credential, setCredential] = useState('');
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('inbox');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [thread, setThread] = useState('grup');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [notes, setNotes] = useState<Notification[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [showNew, setShowNew] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const session = await api<{ authenticated: boolean }>('/auth/session');
      if (!session.authenticated) { setAuth('out'); onAuth(false); return; }
      const [e, t, n, o, p] = await Promise.all([api('/employees'), api('/tasks'), api('/notifications'), api<Overview>('/overview'), api('/projects')]);
      setEmployees(e.employees); setTasks(t.tasks); setNotes(n.notifications); setOverview(o); setProjects(p.projects);
      setAuth('in'); onAuth(true); onUnread(o.unread);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { setAuth('out'); onAuth(false); }
    }
  }, [onAuth, onUnread]);

  useEffect(() => { void refresh(); const t = window.setInterval(() => void refresh(), 5000); return () => window.clearInterval(t); }, [refresh]);
  useEffect(() => {
    if (!focus) return;
    if (focus.task) { setTaskId(focus.task); setTab('work'); }
    if (focus.chat) { setThread(focus.chat); setTab('chat'); setTaskId(null); }
    if (focus.tab) setTab(focus.tab);
  }, [focus]);
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (q.get('social')) { setTab('studio'); if (q.get('social') === 'error') setError('Gagal menghubungkan akun: ' + (q.get('reason') || '')); }
  }, []);

  const login = async (e: FormEvent) => {
    e.preventDefault(); setError('');
    try { await api('/auth/login', { json: { token: credential } }); setCredential(''); await refresh(); } catch (err) { setError((err as Error).message); }
  };
  const logout = async () => { await api('/auth/logout', { json: {} }).catch(() => {}); setAuth('out'); onAuth(false); };

  const decisions = tasks.filter((t) => t.status === 'review');
  const alerts = notes.filter((n) => !n.readAt && n.kind !== 'approval');
  const openTask = (id: string) => { setTaskId(id); setTab('work'); setShowNew(false); };

  return (
    <aside className={'lc' + (open ? ' open' : '')} aria-hidden={!open}>
      <header className="lc-head">
        <div><span className="lc-kicker">LOGISOURCE AI OFFICE</span><h2>Command Center</h2></div>
        {auth === 'in' && overview && <div className="lc-usage" title="Estimasi biaya AI hari ini"><b>{usd(overview.usage.cost)}</b><small>/ {usd(overview.usage.budget)} hari ini</small></div>}
        <button className="lc-x" onClick={onClose} aria-label="Tutup">✕</button>
      </header>

      {auth === 'checking' && <p className="lc-muted pad">Memeriksa sesi…</p>}
      {auth === 'out' && (
        <form className="lc-login" onSubmit={login}>
          <p>Masuk sebagai Director untuk memberi perintah, review, dan chat dengan tim.</p>
          <input type="password" value={credential} onChange={(e) => setCredential(e.target.value)} placeholder="Director credential" autoComplete="current-password" required />
          <button className="lc-primary">Masuk</button>
          {error && <p className="lc-error">{error}</p>}
        </form>
      )}

      {auth === 'in' && <>
        <nav className="lc-tabs">
          {([['inbox', 'Keputusan', decisions.length], ['work', 'Pekerjaan', 0], ['chat', 'Chat', 0], ['studio', 'Studio', 0], ['settings', 'Pengaturan', 0]] as const).map(([k, label, n]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); if (k !== 'work') setTaskId(null); }}>{label}{n ? <i>{n}</i> : null}</button>
          ))}
        </nav>
        <div className="lc-body">
          {error && <p className="lc-error">{error} <button className="sm" onClick={() => setError('')}>✕</button></p>}

          {tab === 'inbox' && <>
            {decisions.length === 0 && <p className="lc-empty">Tidak ada yang menunggu keputusanmu. 👌</p>}
            {decisions.map((t) => <TaskCard key={t.id} t={t} onOpen={() => openTask(t.id)} />)}
            {alerts.length > 0 && <section className="lc-section"><div className="lc-row between"><h4>Kabar terbaru</h4><button className="sm" onClick={() => void api('/notifications/read', { json: { all: true } }).then(refresh)}>Tandai dibaca</button></div>
              {alerts.map((n) => <button key={n.id} className={'lc-note k-' + n.kind} onClick={() => { if (n.taskId) openTask(n.taskId); void api('/notifications/read', { json: { ids: [n.id] } }); }}><b>{n.title}</b><small>{fmtAgo(n.createdAt)}</small>{n.body && <p>{n.body.slice(0, 220)}</p>}</button>)}
            </section>}
          </>}

          {tab === 'work' && (taskId ? <TaskView id={taskId} onClose={() => setTaskId(null)} onChanged={refresh} /> : <>
            <div className="lc-row between"><h4>Pekerjaan</h4><button className="lc-primary sm" onClick={() => setShowNew((v) => !v)}>{showNew ? 'Tutup' : '+ Perintah baru'}</button></div>
            {showNew && <NewTask employees={employees} projects={projects} onCreated={(id) => { setShowNew(false); void refresh(); openTask(id); }} />}
            {overview && <div className="lc-stats">{[['Dikerjakan', overview.counts.in_progress || 0], ['Antre', overview.counts.queued || 0], ['Keputusan', overview.counts.review || 0], ['Terjadwal', overview.counts.approved || 0], ['Selesai', overview.counts.completed || 0]].map(([k, v]) => <div key={k}><b>{v}</b><small>{k}</small></div>)}</div>}
            {tasks.length === 0 && <p className="lc-empty">Belum ada pekerjaan. Klik "+ Perintah baru".</p>}
            {tasks.map((t) => <TaskCard key={t.id} t={t} onOpen={() => openTask(t.id)} />)}
          </>)}

          {tab === 'chat' && <Chat employees={employees} thread={thread} setThread={setThread} />}
          {tab === 'studio' && <><SeriesList onOpen={openTask} /><Social /><Projects projects={projects} reload={refresh} /></>}
          {tab === 'settings' && <><Settings /><button className="lc-logout" onClick={() => void logout()}>Keluar</button></>}
        </div>
      </>}
    </aside>
  );
}

function TaskCard({ t, onOpen }: { t: TaskRow; onOpen: () => void }) {
  const pct = t.steps_total ? Math.round((t.steps_done / t.steps_total) * 100) : t.status === 'completed' ? 100 : t.status === 'review' ? 90 : t.status === 'in_progress' ? 50 : 5;
  const step = t.current_step;
  return (
    <button className="lc-task" onClick={onOpen}>
      <span className="lc-row between"><b>{t.task_type.startsWith('story') ? '🎞️ ' : TYPE_LABEL[t.task_type] === 'Video' ? '🎬 ' : t.task_type.startsWith('web') ? '🧑‍💻 ' : '📝 '}{t.title}</b><span className="lc-chip sm" data-s={t.status}>{STATUS_LABEL[t.status] || t.status}</span></span>
      <small>{step ? (step.status === 'awaiting_approval' ? '🙋 ' : step.status === 'running' ? '⌨️ ' : step.status === 'failed' ? '⚠️ ' : '⏳ ') + step.title : t.assignee_name} · {fmtAgo(t.updated_at)}</small>
      <span className="lc-bar"><i style={{ width: pct + '%' }} /></span>
    </button>
  );
}
