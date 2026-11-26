import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, fmtTime, usd, STATUS_LABEL, type Project, type SocialPlatform } from './api';

export function Social() {
  const [platforms, setPlatforms] = useState<SocialPlatform[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const load = useCallback(async () => {
    const [s, j] = await Promise.all([api<{ platforms: SocialPlatform[] }>('/social/accounts'), api<{ jobs: any[] }>('/publications')]);
    setPlatforms(s.platforms); setJobs(j.jobs);
  }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <div>
      <section className="lc-section"><h4>Akun sosial</h4>
        {platforms.map((p) => (
          <div key={p.platform} className="lc-card">
            <div className="lc-row between"><b>{p.platform}</b><span className="lc-chip sm" data-s={p.accounts.some((a) => a.status === 'connected') ? 'published' : p.configured ? 'pending' : 'failed'}>{p.accounts.some((a) => a.status === 'connected') ? 'Terhubung' : p.configured ? 'Siap dihubungkan' : 'Perlu setup'}</span></div>
            {p.accounts.map((a) => <p key={a.id} className="lc-muted">{a.accountName} · {a.status}{a.tokenExpiresAt ? ' · token s/d ' + fmtTime(a.tokenExpiresAt) : ''} <button className="sm" onClick={() => { if (confirm('Putuskan akun ini?')) void api('/social/accounts/' + a.id + '/disconnect', { json: {} }).then(load); }}>Putuskan</button></p>)}
            {p.configured ? <a className="lc-btn" href={'/api/social/' + p.platform + '/connect'}>Hubungkan akun</a> : <details><summary>Yang perlu disiapkan</summary><ul>{p.requirements.map((r) => <li key={r}>{r}</li>)}</ul><p className="lc-muted">Isi kredensial aplikasi di /etc/ls-office/api.env (lihat docs/OPERATIONS.md).</p></details>}
          </div>
        ))}
      </section>
      <section className="lc-section"><h4>Jadwal posting</h4>
        {!jobs.length && <p className="lc-muted">Belum ada posting.</p>}
        {jobs.map((j) => <div key={j.id} className="lc-pub"><b>{j.platform}</b><span className="lc-chip sm" data-s={j.status}>{STATUS_LABEL[j.status] || j.status}</span><small>{j.title}</small><small>{fmtTime(j.published_at || j.scheduled_at)}</small>{j.post_url && <a href={j.post_url} target="_blank" rel="noreferrer">Lihat ↗</a>}</div>)}
      </section>
    </div>
  );
}

export function Projects({ projects, reload }: { projects: Project[]; reload: () => void }) {
  const empty = { slug: '', name: '', repoUrl: '', defaultBranch: 'main', installCmd: 'npm ci', buildCmd: 'npm run build', testCmd: '', previewDir: 'dist', notes: '' };
  const [f, setF] = useState(empty);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const edit = (p: Project) => { setF({ slug: p.slug, name: p.name, repoUrl: p.repo_url || '', defaultBranch: p.default_branch, installCmd: p.install_cmd || '', buildCmd: p.build_cmd || '', testCmd: p.test_cmd || '', previewDir: p.preview_dir || '', notes: p.notes || '' }); setOpen(true); };
  const save = async (e: FormEvent) => { e.preventDefault(); setError(''); try { await api('/projects', { json: f }); setOpen(false); setF(empty); reload(); } catch (err) { setError((err as Error).message); } };
  return (
    <section className="lc-section"><h4>Proyek web</h4>
      <p className="lc-muted">Proyek yang boleh dikerjakan tim Web Dev. Perintah install/build/test ditulis olehmu, bukan oleh AI. Website baru dari tugas "Website baru" otomatis terdaftar di sini.</p>
      {projects.map((p) => <div key={p.id} className="lc-card"><div className="lc-row between"><b>{p.name}</b><button className="sm" onClick={() => edit(p)}>Ubah</button></div><p className="lc-muted">{p.slug} · {p.repo_url || 'repo lokal'} · {p.tasks} task</p></div>)}
      {!open ? <button onClick={() => setOpen(true)}>+ Daftarkan proyek</button> : (
        <form className="lc-new" onSubmit={save}>
          <div className="lc-row"><label className="lc-field">Slug<input required value={f.slug} onChange={set('slug')} placeholder="toko-febro" /></label><label className="lc-field">Nama<input required value={f.name} onChange={set('name')} /></label></div>
          <label className="lc-field">Repo git (SSH/HTTPS)<input value={f.repoUrl} onChange={set('repoUrl')} placeholder="git@github.com:owner/repo.git" /></label>
          <div className="lc-row"><label className="lc-field">Branch utama<input value={f.defaultBranch} onChange={set('defaultBranch')} /></label><label className="lc-field">Folder hasil build<input value={f.previewDir} onChange={set('previewDir')} placeholder="dist" /></label></div>
          <div className="lc-row"><label className="lc-field">Install<input value={f.installCmd} onChange={set('installCmd')} /></label><label className="lc-field">Build<input value={f.buildCmd} onChange={set('buildCmd')} /></label><label className="lc-field">Test<input value={f.testCmd} onChange={set('testCmd')} /></label></div>
          <label className="lc-field">Catatan untuk tim<textarea rows={2} value={f.notes} onChange={set('notes')} /></label>
          <div className="lc-row"><button className="lc-primary">Simpan</button><button type="button" onClick={() => setOpen(false)}>Batal</button></div>
          {error && <p className="lc-error">{error}</p>}
        </form>
      )}
    </section>
  );
}

export function Settings() {
  const [tg, setTg] = useState<{ configured: boolean; linked: boolean; linkedName: string | null } | null>(null);
  const [code, setCode] = useState('');
  const [usage, setUsage] = useState<{ days: { day: string; kind: string; cost: number; calls: number }[]; tasks: { id: string; title: string; cost: number }[]; budget: number; note: string } | null>(null);
  const load = useCallback(async () => { const [t, u] = await Promise.all([api('/telegram'), api('/usage')]); setTg(t); setUsage(u); }, []);
  useEffect(() => { void load(); const t = window.setInterval(() => void load(), 8000); return () => window.clearInterval(t); }, [load]);
  const byDay = Object.entries((usage?.days || []).reduce<Record<string, number>>((a, d) => ({ ...a, [d.day]: (a[d.day] || 0) + d.cost }), {}));
  return (
    <div>
      <section className="lc-section"><h4>Telegram</h4>
        {!tg ? <p className="lc-muted">Memuat…</p> : !tg.configured ? (
          <ol className="lc-howto">
            <li>Buka Telegram, chat <b>@BotFather</b>, kirim <code>/newbot</code>, beri nama (mis. LSAI Office) dan username yang berakhiran <code>bot</code>.</li>
            <li>Salin token yang diberikan BotFather. <b>Jangan kirim token ke chat mana pun.</b></li>
            <li>Di VPS: <code>sudo nano /etc/ls-office/api.env</code>, tambahkan baris <code>TELEGRAM_BOT_TOKEN=…</code>, simpan.</li>
            <li><code>sudo systemctl restart ls-office-telegram</code>, lalu kembali ke sini untuk menghubungkan chat.</li>
          </ol>
        ) : tg.linked ? (
          <p>✅ Terhubung ke <b>{tg.linkedName}</b>. Notifikasi approval, video, dan chat masuk ke Telegram. <button className="sm" onClick={() => void api('/telegram/unlink', { json: {} }).then(load)}>Putuskan</button></p>
        ) : (
          <div>
            <p>Bot siap. Buat kode, lalu kirim <code>/link KODE</code> ke bot kamu di Telegram.</p>
            <button className="lc-primary" onClick={() => void api<{ code: string }>('/telegram/link-code', { json: {} }).then((r) => setCode(r.code))}>Buat kode</button>
            {code && <p className="lc-code">/link {code} <small>(berlaku 10 menit)</small></p>}
          </div>
        )}
      </section>
      <section className="lc-section"><h4>Biaya AI (estimasi)</h4>
        <p className="lc-muted">Budget harian {usd(usage?.budget || 0)}. {usage?.note}</p>
        <table className="lc-table"><tbody>{byDay.map(([day, cost]) => <tr key={day}><td>{day}</td><td>{usd(cost)}</td></tr>)}</tbody></table>
        {usage?.tasks.length ? <><h5>Task termahal (14 hari)</h5><table className="lc-table"><tbody>{usage.tasks.map((t) => <tr key={t.id}><td>{t.title}</td><td>{usd(t.cost)}</td></tr>)}</tbody></table></> : null}
      </section>
    </div>
  );
}
