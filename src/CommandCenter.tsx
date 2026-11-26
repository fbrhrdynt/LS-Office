import { FormEvent, useCallback, useEffect, useState } from 'react';

type Employee = { id: string; name: string; role: string; department: string; managerKey: string | null };
type Task = { id: string; title: string; instruction: string; assignee_id: string; reviewer_id: string | null; priority: string; status: string; task_type?: string; artifact_path?: string | null; artifact_name?: string | null; assignee_name?: string; created_at: string };
type Run = { id: string; status: string; output_text?: string; error_message?: string };
type WorkflowStep = { id: string; step_order: number; step_key: string; title: string; status: string; requires_approval?: boolean; assignee_name?: string | null; output_text?: string | null };
type PublicationJob = { platform: string; status: string; post_url?: string | null; error_message?: string | null };
type SocialPlatform = { platform: string; configured: boolean; accounts: Array<{ accountId: string; accountName: string; status: string }>; requirements: string[] };
type Overview = { counts: Record<string, number>; recent: Array<{ id: number; taskId: string; type: string; createdAt: string; title?: string }> };
const labels: Record<string, string> = { queued: 'Queued', assigned: 'Assigned', in_progress: 'Working', review: 'Review', completed: 'Completed', failed: 'Failed', blocked: 'Blocked', changes_requested: 'Changes requested', rejected: 'Rejected', cancelled: 'Cancelled' };

export default function CommandCenter({ onRuntime }: { onRuntime?: (tasks: Task[]) => void }) {
  const [credential, setCredential] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [overview, setOverview] = useState<Overview>({ counts: {}, recent: [] });
  const [mode, setMode] = useState<'chat' | 'assign'>('chat');
  const [taskType, setTaskType] = useState<'text' | 'animated_video'>('text');
  const [assignee, setAssignee] = useState('nadia');
  const [title, setTitle] = useState('');
  const [instruction, setInstruction] = useState('');
  const [criteria, setCriteria] = useState('');
  const [priority, setPriority] = useState('normal');
  const [busy, setBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewMessage, setReviewMessage] = useState('');
  const [detail, setDetail] = useState<{ task: Task; runs: Run[]; workflowSteps: WorkflowStep[]; publicationJobs: PublicationJob[] } | null>(null);
  const [notes, setNotes] = useState('');
  const [socialPlatforms, setSocialPlatforms] = useState<SocialPlatform[]>([]);

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const r = await fetch('/api' + path, { ...init, credentials: 'same-origin', headers: { 'content-type': 'application/json', ...(init.headers || {}) } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
    return d;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [e, t, o, s] = await Promise.all([request('/employees'), request('/tasks'), request('/overview'), request('/social/accounts')]);
      setEmployees(e.employees || []); setTasks(t.tasks || []); setOverview(o); setSocialPlatforms(s.platforms || []); onRuntime?.(t.tasks || []);
      setAuthenticated(true); setError('');
    } catch (e) {
      setAuthenticated(false);
      setError(e instanceof Error ? e.message : 'API error');
    }
  }, [request, onRuntime]);

  useEffect(() => {
    let alive = true;
    void request('/auth/session').then(() => { if (alive) return refresh(); }).catch(() => {}).finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, [request, refresh]);

  useEffect(() => {
    if (!authenticated) return;
    const id = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(id);
  }, [authenticated, refresh]);

  const login = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      await request('/auth/login', { method: 'POST', body: JSON.stringify({ token: credential }) });
      setCredential('');
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Login gagal'); }
    finally { setBusy(false); }
  };

  const logout = async () => {
    try { await request('/auth/logout', { method: 'POST', body: '{}' }); }
    finally { setAuthenticated(false); setTasks([]); setEmployees([]); setOverview({ counts: {}, recent: [] }); setSocialPlatforms([]); setDetail(null); }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const taskTitle = mode === 'chat' ? (title.trim() || instruction.trim().slice(0, 80)) : title;
      await request('/tasks', { method: 'POST', body: JSON.stringify({ title: taskTitle, instruction, assigneeId: assignee, reviewerId: 'alex', priority, acceptanceCriteria: criteria, taskType }) });
      setTitle(''); setInstruction(''); setCriteria(''); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Task gagal dibuat'); }
    finally { setBusy(false); }
  };

  const openTask = async (id: string) => {
    try { const d = await request('/tasks/' + id); setDetail({ task: d.task, runs: d.runs || [], workflowSteps: d.workflowSteps || [], publicationJobs: d.publicationJobs || [] }); }
    catch (e) { setError(e instanceof Error ? e.message : 'Gagal membuka task'); }
  };

  const downloadVideo = async (task: Task) => {
    try {
      const r = await fetch('/api/tasks/' + task.id + '/video', { credentials: 'same-origin' });
      if (!r.ok) throw new Error('Video belum tersedia atau sesi berakhir');
      const blob = await r.blob(); const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = task.artifact_name || 'logisource-animation.mp4'; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError(e instanceof Error ? e.message : 'Download gagal'); }
  };

  const decide = async (decision: 'approved' | 'changes_requested' | 'rejected') => {
    if (!detail || reviewBusy || detail.task.status !== 'review') return;
    setReviewBusy(true); setError(''); setReviewMessage('');
    try {
      const result = await request('/tasks/' + detail.task.id + '/approval', { method: 'POST', body: JSON.stringify({ decision, reviewerId: detail.task.reviewer_id, notes }) });
      setNotes('');
      setReviewMessage(decision === 'approved' ? 'Task berhasil disetujui.' : decision === 'changes_requested' ? 'Revisi dikirim kembali ke antrean.' : 'Task berhasil ditolak.');
      await openTask(detail.task.id);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Review gagal'); }
    finally { setReviewBusy(false); }
  };

  return <section className="cc-shell">
    <header className="cc-head"><div><span className="cc-kicker">LOGISOURCE OPERATIONS</span><h2>Command Center</h2><p>Task, produksi kreatif, dan review dalam satu antrean.</p></div><span className={'cc-connection ' + (authenticated ? 'online' : '')}>{authenticated ? '● API CONNECTED' : '● API DISCONNECTED'}</span></header>
    {checking && <p className="cc-note">Memeriksa Director session…</p>}
    {!checking && !authenticated && <form className="cc-connect" onSubmit={login}><label>Director login<input type="password" value={credential} onChange={e => setCredential(e.target.value)} placeholder="Masukkan Director credential" autoComplete="current-password" required /></label><button disabled={busy || !credential}>{busy ? 'Signing in…' : 'Login'}</button></form>}
    {error && <p className="cc-error">{error}</p>}
    {authenticated && <>
      <div className="cc-list-head"><span className="cc-note">Session aktif · login tersimpan dengan secure HttpOnly cookie</span><button type="button" onClick={() => void logout()}>Logout</button></div>
      <div className="cc-metrics">{[['Active', (overview.counts.in_progress || 0) + (overview.counts.assigned || 0)], ['Queued', overview.counts.queued || 0], ['Review', overview.counts.review || 0], ['Completed', overview.counts.completed || 0]].map(([k, v]) => <div key={String(k)}><b>{v}</b><span>{k}</span></div>)}</div>
      <section className="cc-workflow"><h3>Social account connections</h3><p className="cc-note">Status konfigurasi OAuth dan akun terhubung. Belum ada publikasi otomatis sampai integrasi resmi dan izin platform aktif.</p>{socialPlatforms.map(platform => <article className="cc-workflow-step" key={platform.platform}><div><b>{platform.platform}</b><small>{platform.accounts.length ? platform.accounts.map(account => account.accountName + ' · ' + account.status).join(', ') : 'Belum ada akun terhubung'}</small></div><em data-status={platform.configured ? 'ready' : 'blocked'}>{platform.accounts.length ? 'Connected' : platform.configured ? 'OAuth configured' : 'Setup required'}</em>{platform.configured && <a className="cc-social-connect" href={'/api/social/' + platform.platform + '/connect'}>Connect account</a>}<details><summary>Persyaratan</summary><ul>{platform.requirements.map(item => <li key={item}>{item}</li>)}</ul></details></article>)}</section>
      <div className="cc-workspace"><div className="cc-compose"><div className="cc-tabs"><button type="button" className={mode === 'chat' ? 'active' : ''} onClick={() => setMode('chat')}>Chat Command</button><button type="button" className={mode === 'assign' ? 'active' : ''} onClick={() => setMode('assign')}>Task Assignment</button></div>
        <form onSubmit={create}>
          <label>Deliverable<select value={taskType} onChange={e => setTaskType(e.target.value as 'text' | 'animated_video')}><option value="text">Text / Research</option><option value="animated_video">Animated drama video (MP4)</option></select></label>
          <label>{taskType === 'animated_video' ? 'Workflow coordinator' : 'Assignee'}<select value={taskType === 'animated_video' ? 'ethan' : assignee} disabled={taskType === 'animated_video'} onChange={e => setAssignee(e.target.value)}>{employees.map(x => <option key={x.id} value={x.id}>{x.name} · {x.department}</option>)}</select></label>
          {mode === 'assign' && <label>Task title<input required maxLength={160} value={title} onChange={e => setTitle(e.target.value)} placeholder="Drama animasi: Rahasia di Balik Hujan" /></label>}
          <label>{mode === 'chat' ? 'Instruksi chat' : 'Detail instruksi'}<textarea required rows={5} maxLength={12000} value={instruction} onChange={e => setInstruction(e.target.value)} placeholder={taskType === 'animated_video' ? 'Ceritakan drama animasi yang ingin diproduksi…' : 'Tuliskan pekerjaan dan output yang diharapkan…'} /></label>
          {mode === 'assign' && <label>Acceptance criteria<textarea rows={2} maxLength={5000} value={criteria} onChange={e => setCriteria(e.target.value)} /></label>}
          <div className="cc-form-row"><label>Priority<select value={priority} onChange={e => setPriority(e.target.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label><button disabled={busy || !instruction.trim() || (mode === 'assign' && !title.trim())}>{busy ? 'Submitting…' : mode === 'chat' ? 'Send command' : 'Create task'}</button></div>
        </form>
        <small className="cc-note">{taskType === 'animated_video' ? 'Video diproses menjadi MP4 animasi motion-comic; task hanya bisa complete setelah file video berhasil dibuat.' : 'Task tersimpan di PostgreSQL dan diproses oleh AI worker.'}</small>
      </div>
      <div className="cc-task-list"><div className="cc-list-head"><h3>Task queue</h3><button type="button" onClick={() => void refresh()}>Refresh</button></div>{tasks.length === 0 ? <p className="cc-empty">Belum ada task.</p> : tasks.map(t => <button type="button" className="cc-task" key={t.id} onClick={() => void openTask(t.id)}><span><b>{t.title}</b><small>{t.assignee_name || t.assignee_id} · {new Date(t.created_at).toLocaleString('id-ID')}</small></span><em data-status={t.status}>{t.task_type === 'animated_video' ? '🎬 ' : ''}{labels[t.status] || t.status}</em></button>)}</div></div>
      {detail && <div className="cc-detail"><div className="cc-list-head"><h3>{detail.task.title}</h3><button type="button" onClick={() => setDetail(null)}>Close</button></div><p>{detail.task.instruction}</p>{detail.workflowSteps.length > 0 && <section className="cc-workflow"><h4>Production workflow</h4>{detail.workflowSteps.map(step => <article key={step.id} className="cc-workflow-step"><div><b>{step.step_order}. {step.title}</b><small>{step.assignee_name || 'Production Engine'}</small></div><em data-status={step.status}>{step.status === 'awaiting_approval' ? 'Menunggu approval Director' : step.status}</em>{step.output_text && <details><summary>Hasil handoff</summary><pre>{step.output_text}</pre></details>}</article>)}</section>}{detail.runs.map(r => <article className="cc-output" key={r.id}><b>Run · {r.status}</b>{r.output_text ? <pre>{r.output_text}</pre> : <p>{r.error_message || 'Belum ada output.'}</p>}</article>)}{detail.task.task_type === 'animated_video' && detail.task.artifact_path && <button type="button" onClick={() => void downloadVideo(detail.task)}>Download MP4</button>}{detail.publicationJobs.length > 0 && <section className="cc-workflow"><h4>Social publishing queue</h4><p className="cc-note">Final approval tercatat. Publikasi menunggu koneksi akun resmi platform.</p>{detail.publicationJobs.map(job => <article className="cc-workflow-step" key={job.platform}><b>{job.platform}</b><em data-status={job.status}>{job.status}</em>{job.post_url && <a href={job.post_url} target="_blank" rel="noreferrer">Lihat posting</a>}{job.error_message && <small>{job.error_message}</small>}</article>)}</section>}{reviewMessage && <p className="cc-review-message" role="status">{reviewMessage}</p>}{detail.task.status === 'review' && <div className="cc-review"><label>Review notes<textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Catatan untuk personnel (opsional)" /></label><div><button type="button" disabled={reviewBusy} onClick={() => void decide('approved')}>{reviewBusy ? 'Processing…' : 'Approve'}</button><button type="button" disabled={reviewBusy} onClick={() => void decide('changes_requested')}>{reviewBusy ? 'Processing…' : 'Request changes'}</button><button type="button" disabled={reviewBusy} onClick={() => void decide('rejected')}>{reviewBusy ? 'Processing…' : 'Reject'}</button></div></div>}</div>}
      <div className="cc-events"><h3>Recent activity</h3>{overview.recent.slice(0, 8).map(x => <div key={x.id}><b>{x.type}</b><small>{x.title || x.taskId} · {new Date(x.createdAt).toLocaleTimeString('id-ID')}</small></div>)}</div>
    </>}
  </section>;
}
