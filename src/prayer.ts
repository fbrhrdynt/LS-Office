/**
 * Jadwal sholat (perhitungan astronomis, parameter Kemenag RI: Subuh 20°, Isya 18°, Ashar Syafi'i, ihtiyat 2 menit).
 * Default lokasi Jakarta. Fungsi murni, dites di scripts/test.mjs.
 */
export type PrayerName = 'Subuh' | 'Dzuhur' | 'Ashar' | 'Maghrib' | 'Isya';
export type PrayerTimes = Record<PrayerName, number>; // menit sejak 00:00 waktu lokal

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

function sun(jd: number) {
  const D = jd - 2451545.0;
  const g = (357.529 + 0.98560028 * D) % 360;
  const q = (280.459 + 0.98564736 * D) % 360;
  const L = (q + 1.915 * Math.sin(rad(g)) + 0.02 * Math.sin(rad(2 * g))) % 360;
  const e = 23.439 - 0.00000036 * D;
  const RA = deg(Math.atan2(Math.cos(rad(e)) * Math.sin(rad(L)), Math.cos(rad(L)))) / 15;
  const decl = deg(Math.asin(Math.sin(rad(e)) * Math.sin(rad(L))));
  let eqt = q / 15 - ((RA + 24) % 24);
  eqt = ((eqt + 12) % 24 + 24) % 24 - 12;
  return { decl, eqt };
}

export function prayerTimes(date: Date, lat = -6.2, lon = 106.85, tz = 7): PrayerTimes {
  const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
  const A = Math.floor((14 - m) / 12), Y = y + 4800 - A, M = m + 12 * A - 3;
  const jd = d + Math.floor((153 * M + 2) / 5) + 365 * Y + Math.floor(Y / 4) - Math.floor(Y / 100) + Math.floor(Y / 400) - 32045 - 0.5;
  const { decl, eqt } = sun(jd + 0.5 - lon / 360);
  const noon = 12 + tz - lon / 15 - eqt;
  const hourAngle = (angle: number) => deg(Math.acos((-Math.sin(rad(angle)) - Math.sin(rad(lat)) * Math.sin(rad(decl))) / (Math.cos(rad(lat)) * Math.cos(rad(decl))))) / 15;
  const asrAngle = -deg(Math.atan(1 / (1 + Math.tan(rad(Math.abs(lat - decl))))));
  const ihtiyat = 2 / 60;
  const h = {
    Subuh: noon - hourAngle(20) + ihtiyat,
    Dzuhur: noon + ihtiyat,
    Ashar: noon + hourAngle(asrAngle) + ihtiyat,
    Maghrib: noon + hourAngle(0.833) + ihtiyat,
    Isya: noon + hourAngle(18) + ihtiyat,
  };
  return Object.fromEntries(Object.entries(h).map(([k, v]) => [k, Math.round(v * 60)])) as PrayerTimes;
}

export const fmtMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}.${String(Math.round(m % 60)).padStart(2, '0')}`;
