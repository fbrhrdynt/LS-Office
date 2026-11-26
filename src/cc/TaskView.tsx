import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, fmtTime, usd, GATE, REVISE_OPTIONS, STATUS_LABEL, TYPE_LABEL, wibToLocalInput, type TaskDetail, type Step, type PubJob } from './api';

export default function TaskView({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<TaskDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState('');

  const load = useCallback(async () => {
    try { setD(await api<TaskDetail>('/tasks/' + id)); setError(''); } catch (e) { setError((e as Error).message); }
  }, [id]);
  useEffect(() => { void load(); const t = window.setInterval(() => void load(), 4000); return () => window.clearInterval(t); }, [load]);

  const act = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true); setError(''); setFlash('');
    try { const r = await fn(); setFlash(typeof ok === 'string' ? ok + (r?.restartFrom ? ' Diulang dari tahap: ' + r.restartFrom + '.' : '') : ''); await load(); onChanged(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const decide = (decision: string, extra: Record<string, unknown> = {}, ok = 'Tersimpan.') => act(() => api('/tasks/' + id + '/approval', { json: { decision, ...extra } }), ok);

  if (!d) return <div className="lc-detail"><button className="lc-back" onClick={onClose}>← Kembali</button>{error ? <p className="lc-error">{error}</p> : <p className="lc-muted">Memuat…</p>}</div>;
  const { task } = d;
  const gateStep = d.workflowSteps.find((s) => s.status === 'awaiting_approval');
  const gate = gateStep ? GATE[gateStep.step_key] : task.status === 'review' ? 'task_review' : null;
  const final = ['completed', 'rejected', 'cancelled'].includes(task.status);
  const lastRun = d.runs.find((r) => r.status === 'succeeded');

  return (
    <div className="lc-detail">
      <div className="lc-detail-head">
        <button className="lc-back" onClick={onClose}>← Kembali</button>
        <span className="lc-chip" data-s={task.status}>{STATUS_LABEL[task.status] || task.status}</span>
      </div>
      <h3>{task.title}</h3>
      <p className="lc-muted">{TYPE_LABEL[task.task_type]} · {task.assignee_name} · dibuat {fmtTime(task.created_at)} · biaya {usd(d.cost)}{task.revision_count ? ' · revisi ke-' + task.revision_count : ''}{d.project ? ' · proyek ' + d.project.name : ''}</p>
      <details className="lc-brief"><summary>Brief</summary><p>{task.instruction}</p>{task.meta?.affiliate && <p><b>Affiliate:</b> {task.meta.affiliate.product} {task.meta.affiliate.link}</p>}</details>
      {flash && <p className="lc-ok">{flash}</p>}
      {error && <p className="lc-error">{error}</p>}

      {gate && <div className="lc-gate">
        {gate === 'choose_idea' && gateStep && <ChooseIdea step={gateStep} busy={busy} onPick={(x) => decide('approved', x, 'Ide dipilih, tim lanjut kerja.')} />}
        {gate === 'video_review' && <VideoReview id={id} step={gateStep!} busy={busy} onApprove={() => decide('approved', {}, 'Video disetujui. Olivier menyiapkan caption & jadwal.')} />}
        {gate === 'publish' && gateStep && <PublishPlan step={gateStep} meta={task.meta} busy={busy} onApprove={(x) => decide('approved', x, 'Disetujui. Posting masuk jadwal.')} />}
        {gate === 'approve_plan' && gateStep && <Output title="Rencana teknis Arvin" text={gateStep.output_text} open />}
        {gate === 'web_review' && gateStep && <WebReview step={gateStep} />}
        {gate === 'task_review' && <Output title={'Hasil ' + task.assignee_name} text={lastRun?.output_text || ''} open />}
        {['approve_plan', 'web_review', 'task_review'].includes(gate) && <button className="lc-primary" disabled={busy} onClick={() => void decide('approved', {}, 'Disetujui.')}>✅ Approve</button>}
        <Revise gate={gate} busy={busy} onSend={(notes, restartFrom) => decide('changes_requested', { notes, restartFrom }, 'Revisi terkirim.')} onReject={() => { if (confirm('Tolak task ini? Semua tahap berikutnya dibatalkan.')) void decide('rejected', {}, 'Task ditolak.'); }} />
      </div>}

      {d.publicationJobs.length > 0 && <section className="lc-section"><h4>Posting</h4>{d.publicationJobs.map((j) => <PubRow key={j.id} j={j} onAct={(a) => act(() => api('/publications/' + j.id + '/' + a, { json: {} }), 'Status posting diperbarui.')} />)}</section>}

      {d.workflowSteps.length > 0 && <section className="lc-section"><h4>Alur kerja</h4><ol className="lc-steps">{d.workflowSteps.map((s) => <StepRow key={s.id} s={s} runs={d.runs} />)}</ol></section>}
      {!d.workflowSteps.length && lastRun && gate !== 'task_review' && <Output title="Hasil" text={lastRun.output_text} />}
      {task.status === 'failed' && d.runs.filter((r) => r.status === 'failed').slice(0, 1).map((r) => <p key={r.id} className="lc-error"><b>Error terakhir:</b> {r.error_message}</p>)}

      <div className="lc-row lc-actions">
        {task.status === 'failed' && <button disabled={busy} onClick={() => void act(() => api('/tasks/' + id + '/retry', { json: {} }), 'Masuk antrean lagi.')}>🔁 Ulangi</button>}
        {task.has_video && <a className="lc-btn" href={'/api/tasks/' + id + '/video?download=1'}>⬇ Download MP4</a>}
        {!final && <button className="lc-danger" disabled={busy} onClick={() => { if (confirm('Batalkan task ini?')) void act(() => api('/tasks/' + id + '/cancel', { json: {} }), 'Task dibatalkan.'); }}>Batalkan</button>}
      </div>
    </div>
  );
}

function Output({ title, text, open }: { title: string; text: string | null | undefined; open?: boolean }) {
  if (!text) return null;
  return <details className="lc-output" open={open}><summary>{title}</summary><pre>{text}</pre></details>;
}

function StepRow({ s, runs }: { s: Step; runs: TaskDetail['runs'] }) {
  const err = s.status === 'failed' ? runs.find((r) => r.step_id === s.id && r.status === 'failed')?.error_message : null;
  return (
    <li className="lc-step" data-s={s.status}>
      <span className="lc-dot" />
      <div>
        <b>{s.title}</b> <small>{s.assignee_name || 'Production engine'}{s.attempts > 1 ? ' · percobaan ' + s.attempts : ''}</small>
        <span className="lc-chip sm" data-s={s.status}>{STATUS_LABEL[s.status] || s.status}</span>
        {s.revision_notes && <p className="lc-rev">Revisi: {s.revision_notes}</p>}
        {err && <p className="lc-error sm">{err}</p>}
        {s.output_text && <details><summary>Lihat hasil</summary><pre>{s.output_text}</pre></details>}
      </div>
    </li>
  );
}

function ChooseIdea({ step, busy, onPick }: { step: Step; busy: boolean; onPick: (x: Record<string, unknown>) => void }) {
  const ideas: any[] = step.output_json?.ideas || [];
  const [pick, setPick] = useState(0);
  const [custom, setCustom] = useState('');
  const [notes, setNotes] = useState('');
  return (
    <div>
      <h4>💡 Nadia menyiapkan {ideas.length} ide. Pilih satu:</h4>
      {step.output_json?.recommendation && <p className="lc-muted">Rekomendasi Nadia: {step.output_json.recommendation}</p>}
      <div className="lc-ideas">
        {ideas.map((x, i) => (
          <label key={i} className={'lc-idea' + (pick === i && !custom ? ' on' : '')}>
            <input type="radio" name="idea" checked={pick === i && !custom} onChange={() => { setPick(i); setCustom(''); }} />
            <b>{i + 1}. {x.title}</b> <span className="lc-chip sm">{x.format === 'cards' ? 'motion cards' : 'explainer'}</span>
            <p>🎣 {x.hook}</p>
            <p className="lc-muted">{x.why_it_works}</p>
            {x.sources?.length > 0 && <details><summary>{x.sources.length} sumber · fakta</summary><ul>{x.key_facts?.map((f: string, j: number) => <li key={j}>{f}</li>)}</ul><ul>{x.sources.map((s: any, j: number) => <li key={j}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></li>)}</ul></details>}
            {x.affiliate_fit && <p className="lc-muted">🛒 {x.affiliate_fit}</p>}
          </label>
        ))}
      </div>
      <label className="lc-field">Atau pakai ide sendiri<textarea rows={2} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Tulis ide kamu, tim akan memakai ini" /></label>
      <label className="lc-field">Catatan untuk tim (opsional)<input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="mis. karakter penyelam helm kuning, durasi 60 detik" /></label>
      <button className="lc-primary" disabled={busy || (!ideas.length && !custom.trim())} onClick={() => onPick(custom.trim() ? { customIdea: custom, notes } : { ideaIndex: pick, notes })}>Pakai ide ini →</button>
    </div>
  );
}

function VideoReview({ id, step, busy, onApprove }: { id: string; step: Step; busy: boolean; onApprove: () => void }) {
  return (
    <div>
      <h4>🎬 Video siap direview</h4>
      <video className="lc-video" src={'/api/tasks/' + id + '/video?v=' + encodeURIComponent(step.finished_at || '')} controls playsInline preload="metadata" />
      <p className="lc-muted">{step.output_text?.split('\n').slice(0, 5).join(' · ')}</p>
      <button className="lc-primary" disabled={busy} onClick={onApprove}>✅ Video oke, lanjut caption & jadwal</button>
    </div>
  );
}

function WebReview({ step }: { step: Step }) {
  const url = /Preview \(khusus Director\): (\S+)/.exec(step.output_text || '')?.[1];
  return (
    <div>
      <h4>🧪 Preview siap direview</h4>
      {url && url.startsWith('http') ? <a className="lc-btn" href={url} target="_blank" rel="noreferrer">Buka preview ↗</a> : <p className="lc-muted">Tidak ada preview (folder build belum diatur di proyek).</p>}
      <Output title="Laporan QA Daren" text={step.output_text} />
    </div>
  );
}

function PublishPlan({ step, meta, busy, onApprove }: { step: Step; meta: any; busy: boolean; onApprove: (x: Record<string, unknown>) => void }) {
  const pkg = step.output_json || { posts: [] };
  const initial = useMemo(() => (pkg.posts || []).map((p: any) => ({ ...p, caption: p.caption + (pkg.affiliate_cta && !p.caption.includes(pkg.affiliate_cta) ? '\n\n' + pkg.affiliate_cta : ''), hashtags: (p.hashtags || []).join(' ') })), [step.id]);
  const [posts, setPosts] = useState<any[]>(initial);
  const [platforms, setPlatforms] = useState<string[]>(meta?.platforms?.length ? meta.platforms : initial.map((p: any) => p.platform));
  const [when, setWhen] = useState(wibToLocalInput(pkg.recommended_time));
  const payload = (now: boolean) => ({ platforms, scheduledAt: now ? new Date(Date.now() + 5 * 60000).toISOString() : new Date(when).toISOString(), posts: posts.map((p) => ({ platform: p.platform, title: p.title, caption: p.caption, hashtags: String(p.hashtags).split(/\s+/).filter(Boolean) })) });
  return (
    <div>
      <h4>📣 Caption & jadwal dari Olivier</h4>
      <p className="lc-muted">Usulan: {pkg.recommended_time} WIB — {pkg.schedule_reason}</p>
      {posts.map((p, i) => (
        <div key={p.platform} className="lc-post">
          <label className="lc-check"><input type="checkbox" checked={platforms.includes(p.platform)} onChange={(e) => setPlatforms((x) => (e.target.checked ? [...x, p.platform] : x.filter((y) => y !== p.platform)))} /> <b>{p.platform}</b></label>
          <textarea rows={4} value={p.caption} onChange={(e) => setPosts((x) => x.map((y, j) => (j === i ? { ...y, caption: e.target.value } : y)))} />
          <input value={p.hashtags} onChange={(e) => setPosts((x) => x.map((y, j) => (j === i ? { ...y, hashtags: e.target.value } : y)))} />
        </div>
      ))}
      <label className="lc-field">Waktu posting<input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></label>
      <div className="lc-row">
        <button className="lc-primary" disabled={busy || !platforms.length} onClick={() => onApprove(payload(false))}>✅ Setujui & jadwalkan</button>
        <button disabled={busy || !platforms.length} onClick={() => onApprove(payload(true))}>🚀 Posting sekarang</button>
      </div>
      <p className="lc-muted">Platform yang akunnya belum terhubung akan menunggu sampai kamu menghubungkannya di tab Studio.</p>
    </div>
  );
}

function Revise({ gate, busy, onSend, onReject }: { gate: string; busy: boolean; onSend: (notes: string, restartFrom: string) => void; onReject: () => void }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const options = REVISE_OPTIONS[gate];
  const [from, setFrom] = useState('auto');
  if (!open) return <div className="lc-row"><button disabled={busy} onClick={() => setOpen(true)}>✏️ Minta revisi</button><button className="lc-danger" disabled={busy} onClick={onReject}>❌ Tolak</button></div>;
  return (
    <div className="lc-revise">
      <label className="lc-field">Revisinya apa?<textarea autoFocus rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="mis. hook kurang nendang, suara terlalu lambat, ganti visual adegan 3" /></label>
      {options && <label className="lc-field">Ulang dari tahap<select value={from} onChange={(e) => setFrom(e.target.value)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>}
      <div className="lc-row"><button className="lc-primary" disabled={busy || !notes.trim()} onClick={() => onSend(notes, from)}>Kirim revisi</button><button onClick={() => setOpen(false)}>Batal</button></div>
    </div>
  );
}

function PubRow({ j, onAct }: { j: PubJob; onAct: (a: 'retry' | 'cancel' | 'now') => void }) {
  return (
    <div className="lc-pub">
      <b>{j.platform}</b>
      <span className="lc-chip sm" data-s={j.status}>{STATUS_LABEL[j.status] || j.status}</span>
      <small>{j.status === 'published' ? 'tayang ' + fmtTime(j.published_at) : 'jadwal ' + fmtTime(j.scheduled_at)}</small>
      {j.post_url && <a href={j.post_url} target="_blank" rel="noreferrer">Lihat ↗</a>}
      {j.error_message && <small className="lc-error sm">{j.error_message}</small>}
      <span className="lc-row">
        {j.status === 'failed' && <button onClick={() => onAct('retry')}>Ulangi</button>}
        {j.status === 'scheduled' && <button onClick={() => onAct('now')}>Sekarang</button>}
        {['scheduled', 'awaiting_connection', 'failed'].includes(j.status) && <button onClick={() => onAct('cancel')}>Batal</button>}
      </span>
    </div>
  );
}
