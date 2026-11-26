import { FormEvent, useState } from 'react';
import { api, type Employee, type Project } from './api';

const TYPES = [
  { v: 'animated_video', label: '🎬 Video pendek', hint: 'Nadia cari ide → Felix naskah → Ethan visual → Maya suara → render → kamu review → Olivier caption & jadwal → posting.' },
  { v: 'web_build', label: '🧑‍💻 Website baru', hint: 'Nadia cari konsep → Arvin rencana (kamu setujui) → Nathan coding → Daren QA + preview → kamu review → rilis.' },
  { v: 'web_update', label: '🛠 Update website', hint: 'Arvin rencana → Nathan coding di branch terpisah → Daren QA + preview → kamu review → merge ke main.' },
  { v: 'text', label: '📝 Tugas teks / riset', hint: 'Satu karyawan mengerjakan, hasilnya kamu review.' },
] as const;

export default function NewTask({ employees, projects, onCreated }: { employees: Employee[]; projects: Project[]; onCreated: (id: string) => void }) {
  const [type, setType] = useState<string>('animated_video');
  const [title, setTitle] = useState('');
  const [instruction, setInstruction] = useState('');
  const [assignee, setAssignee] = useState('nadia');
  const [projectId, setProjectId] = useState('');
  const [priority, setPriority] = useState('normal');
  const [platforms, setPlatforms] = useState<string[]>(['tiktok', 'instagram']);
  const [affProduct, setAffProduct] = useState('');
  const [affLink, setAffLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const t = TYPES.find((x) => x.v === type)!;

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const r = await api<{ task: { id: string } }>('/tasks', { json: { taskType: type, title: title.trim() || instruction.trim().split(/[.\n]/)[0]!.slice(0, 120), instruction, assigneeId: assignee, priority, projectId: projectId || undefined, platforms: type === 'animated_video' ? platforms : undefined, affiliate: type === 'animated_video' && (affProduct || affLink) ? { product: affProduct, link: affLink } : undefined } });
      setTitle(''); setInstruction(''); setAffProduct(''); setAffLink('');
      onCreated(r.task.id);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <form className="lc-new" onSubmit={submit}>
      <div className="lc-types">{TYPES.map((x) => <button type="button" key={x.v} className={type === x.v ? 'on' : ''} onClick={() => setType(x.v)}>{x.label}</button>)}</div>
      <p className="lc-muted">{t.hint}</p>
      {type === 'text' && <label className="lc-field">Kerjakan oleh<select value={assignee} onChange={(e) => setAssignee(e.target.value)}>{employees.filter((x) => x.id !== 'alex').map((x) => <option key={x.id} value={x.id}>{x.name} · {x.role}</option>)}</select></label>}
      {type === 'web_update' && <label className="lc-field">Proyek<select required value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">Pilih proyek…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>{!projects.length && <small>Belum ada proyek. Daftarkan dulu di tab Studio → Proyek web.</small>}</label>}
      <label className="lc-field">Judul (opsional)<input maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={type === 'animated_video' ? 'mis. Fakta unik las bawah air' : 'mis. Landing page katalog'} /></label>
      <label className="lc-field">{type === 'animated_video' ? 'Mau video seperti apa?' : 'Instruksi'}<textarea required rows={4} maxLength={12000} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={type === 'animated_video' ? 'Contoh: video edukasi ala akun knowledge di TikTok, topik teknik/sains yang bikin penasaran, gaya animasi 3D, caption tebal per kata.' : 'Tuliskan yang kamu mau…'} /></label>
      {type === 'animated_video' && <>
        <div className="lc-field">Posting ke<div className="lc-row">{['tiktok', 'instagram', 'youtube', 'facebook'].map((p) => <label key={p} className="lc-check"><input type="checkbox" checked={platforms.includes(p)} onChange={(e) => setPlatforms((x) => (e.target.checked ? [...x, p] : x.filter((y) => y !== p)))} /> {p}</label>)}</div></div>
        <details className="lc-brief"><summary>🛒 Produk affiliate (opsional)</summary>
          <label className="lc-field">Produk<input value={affProduct} onChange={(e) => setAffProduct(e.target.value)} placeholder="mis. Sarung tangan las isolasi" /></label>
          <label className="lc-field">Link affiliate<input value={affLink} onChange={(e) => setAffLink(e.target.value)} placeholder="https://…" /></label>
        </details>
      </>}
      <div className="lc-row">
        <label className="lc-field sm">Prioritas<select value={priority} onChange={(e) => setPriority(e.target.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
        <button className="lc-primary grow" disabled={busy || !instruction.trim() || (type === 'web_update' && !projectId)}>{busy ? 'Mengirim…' : 'Kirim ke tim →'}</button>
      </div>
      {error && <p className="lc-error">{error}</p>}
    </form>
  );
}
