import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, fmtTime, usd, STATUS_LABEL, type Profile, type Project, type SocialPlatform } from './api';

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

type SeriesRow = { id: string; title: string; logline: string; total_parts: number; status: string; voice_id: string | null; voice_name: string | null; parts: { id: string; part: number; title: string; status: string }[] };
export function SeriesList({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<SeriesRow[]>([]);
  const [error, setError] = useState('');
  const load = useCallback(async () => { setRows((await api<{ series: SeriesRow[] }>('/series')).series); }, []);
  const [voices, setVoices] = useState<{ id: string; name: string; description: string }[]>([]);
  useEffect(() => { void api<{ voices: { id: string; name: string; description: string }[] }>('/voices').then((r) => setVoices(r.voices)).catch(() => {}); }, []);
  useEffect(() => { void load(); const t = window.setInterval(() => void load(), 6000); return () => window.clearInterval(t); }, [load]);
  if (!rows.length) return null;
  const act = (id: string, a: string) => api('/series/' + id + '/' + a, { json: {} }).then(load).catch((e) => setError((e as Error).message));
  return (
    <section className="lc-section"><h4>Seri cerita</h4>
      {error && <p className="lc-error">{error}</p>}
      {rows.map((s) => (
        <div key={s.id} className="lc-card">
          <div className="lc-row between"><b>🎞️ {s.title}</b><span className="lc-chip sm" data-s={s.status === 'active' ? 'in_progress' : s.status === 'finished' ? 'completed' : 'pending'}>{s.status === 'active' ? 'Berjalan' : s.status === 'finished' ? 'Tamat' : 'Dijeda'}</span></div>
          <p className="lc-muted">{s.logline}</p>
          {voices.length > 0 && <label className="lc-field">Suara narator seri (berlaku untuk render berikutnya)<select value={s.voice_id || ''} onChange={(e) => void api('/series/' + s.id + '/voice', { json: { voiceId: e.target.value } }).then(load).catch((err) => setError((err as Error).message))}><option value="" disabled>Dipilih Maya saat render pertama</option>{voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>}
          <div className="lc-parts">{Array.from({ length: s.total_parts }, (_, i) => { const p = s.parts.find((x) => x.part === i + 1); return <button key={i} className="sm" data-s={p?.status || 'none'} disabled={!p} onClick={() => p && onOpen(p.id)} title={p?.title}>Part {i + 1}{p ? ' · ' + (STATUS_LABEL[p.status] || p.status) : ''}</button>; })}</div>
          <div className="lc-row">
            {s.status === 'active' && s.parts.length < s.total_parts && <button className="sm" onClick={() => void act(s.id, 'next')}>+ Produksi part berikutnya sekarang</button>}
            {s.status === 'active' ? <button className="sm" onClick={() => void act(s.id, 'pause')}>Jeda seri</button> : s.status === 'paused' && <button className="sm" onClick={() => void act(s.id, 'resume')}>Lanjutkan seri</button>}
          </div>
        </div>
      ))}
    </section>
  );
}

const EMPTY_PROFILE = { name: '', handle: '', topic: '', audience: '', tone: '', forbidden: '', notes: '', is_default: false };

/** Account profiles: every idea, script and caption for an account follows its profile. */
export function Profiles() {
  const [list, setList] = useState<Profile[]>([]);
  const [f, setF] = useState<typeof EMPTY_PROFILE & { id?: string }>(EMPTY_PROFILE);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => { try { setList((await api<{ profiles: Profile[] }>('/profiles')).profiles); } catch (e) { setError((e as Error).message); } }, []);
  useEffect(() => { void load(); }, [load]);
  const set = (k: keyof typeof EMPTY_PROFILE) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async (e: FormEvent) => {
    e.preventDefault(); setError('');
    try { await api('/profiles' + (f.id ? '/' + f.id : ''), { method: f.id ? 'PUT' : 'POST', json: f }); setOpen(false); setF(EMPTY_PROFILE); await load(); } catch (err) { setError((err as Error).message); }
  };
  const remove = async (p: Profile) => { if (confirm('Hapus profil ' + p.name + '?')) { await api('/profiles/' + p.id, { method: 'DELETE' }); await load(); } };
  return (
    <section className="lc-section"><h4>Profil akun</h4>
      <p className="lc-muted">Tiap akun (TikTok/IG/FB) punya profil: topik, penonton, gaya bahasa, dan larangan. Nadia, Felix, Daren, Ethan, Maya, dan Olivier selalu membaca profil ini. Nadia juga tidak akan mengulang ide yang sudah pernah dibuat akun yang sama. Profil ⭐ dipakai kalau kamu tidak memilih.</p>
      {list.map((p) => (
        <div key={p.id} className="lc-card">
          <div className="lc-row between"><b>{p.is_default ? '⭐ ' : ''}{p.name}{p.handle ? ' · @' + p.handle : ''}</b><span className="lc-row"><button className="sm" onClick={() => { setF({ ...p }); setOpen(true); }}>Ubah</button><button className="sm lc-danger" onClick={() => void remove(p)}>Hapus</button></span></div>
          <p className="lc-muted">{[p.topic, p.audience && 'Penonton: ' + p.audience, p.tone && 'Gaya: ' + p.tone].filter(Boolean).join(' · ')}</p>
        </div>
      ))}
      {!open ? <button onClick={() => { setF(EMPTY_PROFILE); setOpen(true); }}>+ Profil akun baru</button> : (
        <form className="lc-new" onSubmit={save}>
          <div className="lc-row"><label className="lc-field">Nama profil<input required maxLength={80} value={f.name} onChange={set('name')} placeholder="mis. Cerita Bersambung" /></label><label className="lc-field">Username akun<input maxLength={80} value={f.handle} onChange={set('handle')} placeholder="@namaakun" /></label></div>
          <label className="lc-field">Topik<textarea rows={2} maxLength={600} value={f.topic} onChange={set('topic')} placeholder="mis. drama keluarga & pertemanan sehari-hari, horor ringan" /></label>
          <label className="lc-field">Penonton<textarea rows={2} maxLength={600} value={f.audience} onChange={set('audience')} placeholder="mis. 18–35 tahun, pekerja & mahasiswa, suka cerita relate" /></label>
          <label className="lc-field">Gaya bahasa<textarea rows={2} maxLength={600} value={f.tone} onChange={set('tone')} placeholder="mis. santai, hangat, pakai aku/kamu, tidak lebay" /></label>
          <label className="lc-field">Dilarang<textarea rows={2} maxLength={800} value={f.forbidden} onChange={set('forbidden')} placeholder="mis. janji penghasilan, angka tanpa sumber, kata kasar, SARA" /></label>
          <label className="lc-field">Catatan lain<textarea rows={2} maxLength={1500} value={f.notes} onChange={set('notes')} placeholder="mis. selalu ada twist di akhir, CTA follow untuk part berikutnya" /></label>
          <label className="lc-check"><input type="checkbox" checked={f.is_default} onChange={(e) => setF((x) => ({ ...x, is_default: e.target.checked }))} /> Jadikan profil utama ⭐</label>
          <div className="lc-row"><button className="lc-primary">Simpan</button><button type="button" onClick={() => setOpen(false)}>Batal</button></div>
          {error && <p className="lc-error">{error}</p>}
        </form>
      )}
    </section>
  );
}
