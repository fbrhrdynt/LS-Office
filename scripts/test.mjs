// Tes logika kantor: node scripts/test.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const O = (await runnerImport(path.join(root, 'src/office.ts'), { root, configFile: false, cacheDir: path.join(os.tmpdir(), 'kantor-vite'), logLevel: 'error' })).module;

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
};
t('jadwal pagi, laporan, belajar, libur', () => {
  assert.equal(O.agentDoing('raka', 1, '07:57').label, 'radar tender…');
  assert.equal(O.agentDoing('riska', 1, '07:32').activity, 'kerja');
  assert.equal(O.agentDoing('esok', 1, '15:50').activity, 'laporan');
  assert.equal(O.agentDoing('lita', 6, '21:00').activity, 'belajar');
  assert.equal(O.agentDoing('raka', 1, '10:00').activity, 'siaga');
  assert.equal(O.agentDoing('raka', 1, '23:00').activity, 'pulang');
  assert.equal(O.agentDoing('raka', 6, '07:57').activity, 'pulang');
  assert.equal(O.agentDoing('raka', 6, '07:57', true).activity, 'kerja');
});
t('timelapse tiga babak, berulang', () => {
  assert.equal(O.LAPSE_SECONDS, 30);
  assert.equal(O.lapseAt(0).time, '07:28');
  assert.equal(O.lapseAt(16).act, 1);
  assert.equal(O.lapseAt(30).time, '07:28');
});
t('agen santai pergi dan kembali', () => {
  const seen = new Set();
  for (let x = 0; x < 48; x += 0.5) seen.add(O.idleAt('raka', x).spot);
  assert.ok(seen.has('meja') && seen.size >= 3);
});
t('meja dan Mission Board', () => {
  const desks = O.officeDesks(1, '10:00');
  assert.equal(desks.length, 6);
  assert.ok(desks.every((d) => d.bubble));
  assert.ok(O.missionBoard(desks).items.length >= 4);
});
t('parameter URL', () => {
  assert.deepEqual(O.params(new URLSearchParams('timelapse=1&rekam=1&jam=08.10')), { lapse: true, rec: true, time: '08:10', alwaysWork: true });
});
t('status nyata dari backend', () => {
  assert.equal(O.runtimeDoing({ state: 'working', step: 'Naskah' }).activity, 'kerja');
  assert.equal(O.runtimeDoing({ state: 'waiting' }).activity, 'menunggu');
  assert.equal(O.runtimeDoing({ state: 'blocked' }).activity, 'kendala');
  assert.equal(O.runtimeDoing(undefined).activity, 'siaga');
});
t('gerak kecil di meja, tidak berjalan-jalan', () => {
  const seen = new Set();
  for (let x = 0; x < 120; x += 0.25) { const f = O.fidgetAt('nadia', x); seen.add(f.fidget); assert.ok(f.k >= 0 && f.k <= 1); }
  assert.ok(seen.has('layar') && seen.size >= 3);
});
const PT = (await runnerImport(path.join(root, 'src/prayer.ts'), { root, configFile: false, cacheDir: path.join(os.tmpdir(), 'kantor-vite'), logLevel: 'error' })).module;
t('jadwal sholat Jakarta mendekati jadwal Kemenag', () => {
  const p = PT.prayerTimes(new Date('2026-11-27T12:00:00'));
  assert.ok(Math.abs(p.Dzuhur - (11 * 60 + 40)) <= 4 && Math.abs(p.Ashar - (15 * 60 + 5)) <= 4 && Math.abs(p.Maghrib - (17 * 60 + 54)) <= 4);
});
t('hari kerja nyata: datang, rapat, sholat, makan, ngopi, pulang', () => {
  const s = { arrive: '07:52', leave: '16:58', prays: true, coffee: ['09:48'], lunch: '12:05', standup: '09:15' };
  const pt = { Dzuhur: 700, Ashar: 907, Maghrib: 1075 };
  const at = (hm, day = 4) => O.plannedSpot('nadia', s, O.toMin(hm), day, pt).spot;
  assert.equal(at('07:30'), 'rumah');
  assert.equal(at('09:20'), 'rapat');
  assert.equal(at('09:50'), 'kopi');
  assert.equal(O.plannedSpot('nadia', s, 700 + 8, 4, pt).spot, 'musholla');
  assert.equal(at('12:20'), 'makan');
  assert.equal(at('17:30'), 'rumah');
  assert.equal(at('10:00', 6), 'rumah');
  assert.equal(O.plannedSpot('felix', { ...s, prays: false }, 700 + 8, 4, pt).spot, 'meja');
});
const LY = (await runnerImport(path.join(root, 'src/layout.ts'), { root, configFile: false, cacheDir: path.join(os.tmpdir(), 'kantor-vite'), logLevel: 'error' })).module;
t('denah kampus: 9 ruangan, jalan lewat pintu & koridor', () => {
  assert.equal(LY.ROOMS.length, 9);
  const inside = (r, [x, z]) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;
  const onHall = ([x, z]) => LY.HALL_Z.some((h) => Math.abs(z - h) < 0.05) || LY.HALL_X.some((h) => Math.abs(x - h) < 0.05);
  // Musholla -> pantry: leaves through the musholla door, ends at the pantry place, every corner reachable in straight lines.
  const from = LY.PLACES.musholla[0], to = LY.PLACES.makan[0];
  const pts = LY.route(from, to);
  assert.deepEqual(pts.at(-1), [to.x, to.z]);
  const m = LY.roomByKey('musholla'), door = LY.doorPoints(m);
  assert.ok(pts.some((p) => p[0] === door.wall[0] && p[1] === door.wall[1]), 'lewat pintu musholla');
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i][0] === pts[i - 1][0] || pts[i][1] === pts[i - 1][1] || inside(LY.roomByKey('pantry'), pts[i]) || inside(m, pts[i - 1]), 'segmen lurus');
  assert.ok(LY.corridorPath([-8.8, -3.7], [8.8, 3.7]).every(onHall));
  assert.deepEqual(LY.route(LY.ENTRANCE_PLACE, LY.PLACES.lounge[0]).at(-1), [LY.PLACES.lounge[0].x, LY.PLACES.lounge[0].z]);
});
const G = (await runnerImport(path.join(root, 'src/gaya/daftar.ts'), { root, configFile: false, cacheDir: path.join(os.tmpdir(), 'kantor-vite'), logLevel: 'error' })).module;
t('16 gaya + asli, urutan pilihan gaya', () => {
  assert.equal(G.DAFTAR_GAYA.length, 17);
  assert.equal(new Set(G.DAFTAR_GAYA.map((g) => g.id)).size, 17);
  assert.equal(G.DAFTAR_GAYA.filter((g) => g.jenis === 'paduan').length, 9);
  assert.equal(G.gayaAwal('clay', 'voxel', 'asli'), 'clay');
  assert.equal(G.gayaAwal('ngawur', 'voxel', 'asli'), 'voxel');
  assert.equal(G.gayaAwal(null, null, 'taman'), 'taman');
  assert.equal(G.gayaAwal(null, 'x', 'y'), 'asli');
  assert.equal(G.cariGaya('ngawur').id, 'asli');
});
console.log(`${n} tes lulus`);
