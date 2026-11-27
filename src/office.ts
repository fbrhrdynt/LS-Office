/** Logika kantor (murni, dites di scripts/test.mjs): siapa sedang apa jam berapa, timelapse, dan aktivitas santai. */
import { AGEN, BABAK, JADWAL, JAM_KANTOR, LAPORAN, type Agen, type RoomKey } from './config';

export type Activity = 'kerja' | 'laporan' | 'belajar' | 'siaga' | 'pulang' | 'menunggu' | 'kendala';
export interface Doing {
  activity: Activity;
  label: string;
}
export interface Desk {
  key: string;
  room: RoomKey;
  color: string;
  x: number;
  z: number;
}
export interface DeskState {
  desk: Desk;
  agen: Agen;
  doing: Doing;
  /** Where the person physically is (schedule + real work state). Default: at the desk. */
  spot?: Spot;
  bubble: string | null;
  /** Saying something in a conversation right now (scene gestures). */
  talking?: boolean;
  /** Their latest line in a conversation (speech bubble). */
  say?: string | null;
  waiting: string[];
  urgent: string[];
}

export const toMin = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Hari ISO (1 Senin … 7 Minggu) dari Date. */
export const isoDay = (d: Date) => (d.getDay() === 0 ? 7 : d.getDay());

/** Apa yang dikerjakan agen pada `hari` (1–7) jam `time` (HH:MM). `selaluKerja` = akhir pekan dianggap hari kerja. */
export function agentDoing(key: string, hari: number, time: string, selaluKerja = false): Doing {
  const wd = selaluKerja && hari > 5 ? 4 : hari;
  const t = toMin(time);
  for (const j of JADWAL) {
    if (j.agen !== '*' && !j.agen.includes(key)) continue;
    if (!j.hari.includes(wd)) continue;
    const s = toMin(j.mulai);
    if (t >= s && t < s + j.menit) return { activity: j.aktivitas, label: j.label };
  }
  if (wd <= 5 && t >= toMin(JAM_KANTOR.buka) && t < toMin(JAM_KANTOR.tutup)) return { activity: 'siaga', label: 'siap menerima perintah' };
  return { activity: 'pulang', label: wd > 5 ? 'libur akhir pekan' : 'di luar jam kerja' };
}

export const isNight = (time: string) => toMin(time) >= toMin('18:30') || toMin(time) < toMin('06:00');

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…`);

export function officeDesks(hari: number, time: string, selaluKerja = false): DeskState[] {
  return AGEN.map((a) => {
    const r = LAPORAN[a.key] ?? {};
    return {
      desk: { key: a.key, room: a.ruang, color: a.warna, x: a.x, z: a.z },
      agen: a,
      doing: agentDoing(a.key, hari, time, selaluKerja),
      bubble: r.ringkasan ? clip(r.ringkasan, 110) : null,
      waiting: r.menunggu ?? [],
      urgent: r.mendesak ?? [],
    };
  });
}

export function missionBoard(desks: readonly DeskState[]) {
  return {
    items: desks.flatMap((d) => d.waiting.map((text) => ({ key: d.agen.key, name: d.agen.nama, color: d.agen.warna, text }))),
    metrics: desks.flatMap((d) => (LAPORAN[d.agen.key]?.angka ?? []).map((m) => ({ ...m, name: d.agen.nama }))),
  };
}

/* ---------- timelapse ---------- */

export const LAPSE_SECONDS = BABAK.reduce((n, a) => n + a.detik, 0);

export function lapseAt(t: number): { time: string; act: number; title: string; inAct: number } {
  let s = ((t % LAPSE_SECONDS) + LAPSE_SECONDS) % LAPSE_SECONDS;
  for (let i = 0; i < BABAK.length; i++) {
    const a = BABAK[i]!;
    if (s < a.detik || i === BABAK.length - 1) {
      const m = Math.min(Math.floor(toMin(a.dari) + Math.min(1, s / a.detik) * (toMin(a.sampai) - toMin(a.dari))), toMin(a.sampai));
      return { time: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, act: i, title: a.judul, inAct: s };
    }
    s -= a.detik;
  }
  return { time: BABAK[0]!.dari, act: 0, title: BABAK[0]!.judul, inAct: 0 };
}

/* ---------- agen santai: ngopi, lihat papan, ngobrol ---------- */

export type IdleSpot = 'meja' | 'papan' | 'kopi' | 'sofa';
export const IDLE_LABEL: Record<IdleSpot, string> = { meja: 'siap menerima perintah', papan: 'lihat Mission Board', kopi: 'ngopi dulu', sofa: 'ngobrol di sofa' };
const SPOTS: readonly IdleSpot[] = ['papan', 'kopi', 'sofa'];

export function idleAt(key: string, t: number): { spot: IdleSpot; k: number; walking: boolean } {
  const i = Math.max(0, AGEN.findIndex((a) => a.key === key));
  const shifted = t + i * 5.3;
  const cycle = ((shifted % 16) + 16) % 16;
  const n = Math.floor(shifted / 16);
  const spot = SPOTS[(((n + i) % 3) + 3) % 3]!;
  const ease = (x: number) => x * x * (3 - 2 * x);
  if (cycle < 2.5) return { spot, k: ease(cycle / 2.5), walking: true };
  if (cycle < 8) return { spot, k: 1, walking: false };
  if (cycle < 10.5) return { spot, k: 1 - ease((cycle - 8) / 2.5), walking: true };
  return { spot: 'meja', k: 0, walking: false };
}

/** URL: ?timelapse=1 (satu hari 30 detik), &rekam=1 (gambar per frame untuk skrip rekam), &jam=08.10 (jam tetap). */
export function params(q: URLSearchParams) {
  const jam = q.get('jam');
  return {
    lapse: q.get('timelapse') === '1',
    rec: q.get('rekam') === '1',
    time: jam && /^([01]\d|2[0-3])[:.][0-5]\d$/.test(jam) ? jam.replace('.', ':') : null,
    /** Default true: kantor contoh tetap bekerja di akhir pekan. ?libur=1 untuk jadwal sungguhan. */
    alwaysWork: q.get('libur') !== '1',
  };
}

/* ---------- kantor nyata: status dari backend, gerak kecil di meja (tanpa mondar-mandir) ---------- */

export type RuntimeState = 'working' | 'waiting' | 'blocked' | 'available';
export interface RuntimeEntry { state: RuntimeState; title?: string; step?: string; taskId?: string; queued?: number }

/** Status karyawan dari data backend (task/step yang benar-benar berjalan). */
export function runtimeDoing(e: RuntimeEntry | undefined): Doing {
  if (!e) return { activity: 'siaga', label: 'siap menerima perintah' };
  if (e.state === 'working') return { activity: 'kerja', label: e.step ? e.step.toLowerCase() + '…' : 'mengerjakan task…' };
  if (e.state === 'waiting') return { activity: 'menunggu', label: 'menunggu keputusanmu' };
  if (e.state === 'blocked') return { activity: 'kendala', label: 'ada kendala, perlu dicek' };
  return { activity: 'siaga', label: e.queued ? e.queued + ' tugas menunggu giliran' : 'siap menerima perintah' };
}

export type Fidget = 'layar' | 'minum' | 'regang' | 'tengok' | 'catat';
/** Gerak kecil saat santai di meja: sebagian besar menatap layar, sesekali minum kopi, peregangan, menengok, mencatat. */
export function fidgetAt(key: string, t: number): { fidget: Fidget; k: number } {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) % 997;
  const period = 13 + (h % 7);
  const shifted = t + h * 0.37;
  const n = Math.floor(shifted / period);
  const cycle = shifted - n * period;
  const acts: Fidget[] = ['minum', 'catat', 'tengok', 'minum', 'regang'];
  const act = acts[(n + h) % acts.length]!;
  const len = act === 'regang' ? 3 : 2.6;
  if (cycle < period - len) return { fidget: 'layar', k: 0 };
  const x = (cycle - (period - len)) / len;
  return { fidget: act, k: Math.sin(Math.PI * x) };
}

/* ---------- hari kerja yang nyata: datang, rapat, ngopi, sholat, makan, istirahat, pulang ---------- */

export type Spot = 'rumah' | 'meja' | 'kopi' | 'makan' | 'musholla' | 'lounge' | 'rapat' | 'ngobrol' | 'mess' | 'kamar' | 'tidur';
export interface Schedule { arrive: string; leave: string; prays: boolean; coffee: string[]; lunch: string; standup: string; sleep?: string; wake?: string }
export interface Planned { spot: Spot; label: string }

const within = (t: number, start: number, minutes: number) => t >= start && t < start + minutes;
const offsetOf = (key: string, span: number) => { let h = 0; for (const c of key) h = (h * 31 + c.charCodeAt(0)) % 997; return h % span; };

/**
 * Where a person is (by their own schedule) at minute `t` of an ISO weekday `day`. Real work state from the backend
 * overrides this in App (an employee with a task stays at the desk).
 */
export function plannedSpot(key: string, s: Schedule | undefined, t: number, day: number, pt: Record<string, number>): Planned {
  if (!s) return { spot: 'meja', label: 'siap menerima perintah' };
  const arrive = toMin(s.arrive), leave = toMin(s.leave);
  const sleep = toMin(s.sleep ?? '22:30'), wake = toMin(s.wake ?? '04:45');
  const asleep = sleep > wake ? t >= sleep || t < wake : t >= sleep && t < wake;
  if (asleep) return { spot: 'tidur', label: 'tidur' };
  const o = offsetOf(key, 8);
  const workday = day <= 5;
  const atWork = workday && t >= arrive && t < leave;
  if (s.prays) {
    for (const name of ['Subuh', 'Dzuhur', 'Ashar', 'Maghrib', 'Isya'] as const) {
      const p = pt[name];
      if (p !== undefined && within(t, p + o, 13)) return { spot: 'musholla', label: 'sholat ' + name };
    }
  }
  if (atWork) {
    if (t < arrive + 6) return { spot: 'meja', label: 'baru datang' };
    if (within(t, toMin(s.standup), 15)) return { spot: 'rapat', label: 'rapat pagi tim' };
    if (within(t, toMin(s.lunch), 35)) return { spot: 'makan', label: 'makan siang' };
    for (const c of s.coffee) if (within(t, toMin(c), 10)) return { spot: 'kopi', label: 'ngopi di pantry' };
    if (within(t, toMin('15:50') + offsetOf(key, 25), 12)) return { spot: 'lounge', label: 'istirahat sebentar di lounge' };
    return { spot: 'meja', label: 'siap menerima perintah' };
  }
  // Life at the mess: morning routine, evening routine, weekends.
  if (t >= wake && t < wake + 25) return { spot: 'kamar', label: 'bangun, mandi & siap-siap' };
  if (workday && t < arrive) return t >= arrive - 35 ? { spot: 'mess', label: 'sarapan di mess' } : { spot: 'kamar', label: 'santai pagi di kamar' };
  if (workday && t >= leave && t < leave + 25) return { spot: 'kamar', label: 'pulang, mandi & ganti baju' };
  if (!workday && t >= 16 * 60 + offsetOf(key, 40) && t < 18 * 60 + 30) return { spot: 'rumah', label: 'jalan-jalan keluar' };
  if (!workday && within(t, 12 * 60 + offsetOf(key, 30), 40)) return { spot: 'makan', label: 'makan siang di pantry' };
  if (t >= 18 * 60 + 40 && t < 19 * 60 + 25) return { spot: 'mess', label: 'makan malam di mess' };
  if (t >= 19 * 60 + 25 && t < 21 * 60) return { spot: 'mess', label: 'santai di ruang santai mess' };
  return { spot: 'kamar', label: !workday && t < 16 * 60 ? 'libur, santai di kamar' : 'santai di kamar' };
}
