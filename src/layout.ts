/**
 * Denah kantor: kampus 3 x 3 ruangan (meter, koordinat lokal scene; -z = belakang, +x = kanan).
 *
 *   belakang:  Creative Studio | Ruang Direksi      | Web Dev
 *   tengah:    Musholla        | Atrium & Lounge    | Ruang Rapat
 *   depan:     Pantry & Kopi   | Lobby (pintu masuk)| Marketing & Analytics
 *
 * Koridor: dua lorong melintang (z = ±3.7) dan dua lorong membujur (x = ±4.4) membentuk cincin di sekeliling atrium.
 * Fungsi di sini murni (dites di scripts/test.mjs).
 */
import type { Spot } from './office';

export const BOUNDS = { x0: -12.5, x1: 12.5, z0: -10.4, z1: 10.4 };
const COLS: [number, number][] = [[-12.5, -5.1], [-3.7, 3.7], [5.1, 12.5]];
const ROWS: [number, number][] = [[-10.4, -4.4], [-3.0, 3.0], [4.4, 10.4]];
export const HALL_Z = [-3.7, 3.7];
export const HALL_X = [-4.4, 4.4];
export const ENTRANCE = { x: 0, z: 12.2 };

export type DoorSide = 'front' | 'back' | 'left' | 'right' | 'open';
export interface Room {
  key: string;
  /** Corridor coordinate outside the door (x for side doors, z for front/back doors). */
  hallAt?: number;
  label: string;
  x0: number; x1: number; z0: number; z1: number;
  floor: string;
  accent: string;
  /** Wall with the door (towards a corridor); 'open' = no walls (atrium). */
  door: DoorSide;
  /** Door centre along that wall. */
  doorAt: number;
  /** Wall kind: solid low partition or glass. */
  glass?: boolean;
}

const room = (key: string, label: string, c: number, r: number, floor: string, accent: string, door: DoorSide, doorAt: number, glass = false): Room =>
  ({ key, label, x0: COLS[c]![0], x1: COLS[c]![1], z0: ROWS[r]![0], z1: ROWS[r]![1], floor, accent, door, doorAt, glass });

/** Main office building (3 x 3). */
export const OFFICE_ROOMS: Room[] = [
  room('creative', 'Creative Studio', 0, 0, '#efe2d0', '#e4572e', 'front', -8.8),
  room('direksi', 'Ruang Direksi', 1, 0, '#e8e0d6', '#271b3f', 'front', 0, true),
  room('webdev', 'Web Dev', 2, 0, '#e3dde9', '#3a86ff', 'front', 8.8),
  room('musholla', 'Musholla', 0, 1, '#dfe9d8', '#2f7d5b', 'right', 0),
  room('atrium', 'Atrium & Lounge', 1, 1, '#f3ece2', '#f2b134', 'open', 0),
  room('rapat', 'Ruang Rapat', 2, 1, '#e6e1ee', '#8e6bd8', 'left', 0, true),
  room('pantry', 'Pantry & Kopi', 0, 2, '#f1e4cf', '#c26b3b', 'back', -8.8),
  room('lobby', 'Lobby', 1, 2, '#f4efe8', '#35b8a5', 'back', 0),
  room('marketing', 'Marketing & Analytics', 2, 2, '#efe3cf', '#35b8a5', 'back', 8.8),
];
/** Mess karyawan (dormitory) east of the office: 9 bedrooms + a common room, along its own corridor (x = MESS_HALL). */
export const MESS = { x0: 14.6, x1: 23.4, z0: -10.4, z1: 10.4 };
export const MESS_HALL = 19;
const bed = (i: number, key: string, x0: number, x1: number, z0: number, z1: number, door: DoorSide): Room =>
  ({ key, label: 'Kamar ' + (i + 1), x0, x1, z0, z1, floor: i % 2 ? '#efe6dc' : '#e8e0ef', accent: '#8c5a3c', door, doorAt: (z0 + z1) / 2, hallAt: MESS_HALL });
const LEFT_Z: [number, number][] = [[-10.4, -7.3], [-7.3, -4.2], [-4.2, -1.1], [-1.1, 3.0]];
const RIGHT_Z: [number, number][] = [[-10.4, -6.24], [-6.24, -2.08], [-2.08, 2.08], [2.08, 6.24], [6.24, 10.4]];
export const BEDROOMS: Room[] = [
  ...LEFT_Z.map(([a, b], i) => bed(i, 'kamar' + (i + 1), MESS.x0, MESS_HALL - 0.6, a, b, 'right')),
  ...RIGHT_Z.map(([a, b], i) => bed(i + 4, 'kamar' + (i + 5), MESS_HALL + 0.6, MESS.x1, a, b, 'left')),
];
export const MESS_COMMON: Room = { key: 'mess', label: 'Ruang Santai Mess', x0: MESS.x0, x1: MESS_HALL - 0.6, z0: 4.4, z1: 10.4, floor: '#f0e2cc', accent: '#c26b3b', door: 'right', doorAt: 7.4, hallAt: MESS_HALL };
export const ROOMS: Room[] = [...OFFICE_ROOMS, MESS_COMMON, ...BEDROOMS];
export const roomByKey = (key: string) => ROOMS.find((r) => r.key === key)!;
export const roomCenter = (r: Room) => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });

/** Door point on the wall and the matching point in the corridor outside it. */
export function doorPoints(r: Room): { wall: [number, number]; hall: [number, number]; inside: [number, number] } {
  if (r.door === 'front') return { wall: [r.doorAt, r.z1], hall: [r.doorAt, r.hallAt ?? HALL_Z[0]!], inside: [r.doorAt, r.z1 - 0.9] };
  if (r.door === 'back') return { wall: [r.doorAt, r.z0], hall: [r.doorAt, r.hallAt ?? HALL_Z[1]!], inside: [r.doorAt, r.z0 + 0.9] };
  if (r.door === 'right') return { wall: [r.x1, r.doorAt], hall: [r.hallAt ?? HALL_X[0]!, r.doorAt], inside: [r.x1 - 0.9, r.doorAt] };
  if (r.door === 'left') return { wall: [r.x0, r.doorAt], hall: [r.hallAt ?? HALL_X[1]!, r.doorAt], inside: [r.x0 + 0.9, r.doorAt] };
  return { wall: [roomCenter(r).x, r.z1], hall: [roomCenter(r).x, HALL_Z[1]!], inside: [roomCenter(r).x, r.z1 - 0.5] };
}

/** Exit path from a point inside a room to the corridor: aisle -> inside the door -> door -> corridor. */
export function exitVia(roomKey: string, x: number, z: number): [number, number][] {
  const r = roomByKey(roomKey);
  const d = doorPoints(r);
  if (r.door === 'open') return [[x, d.hall[1]]];
  const horizontalDoor = r.door === 'front' || r.door === 'back';
  const aisle: [number, number] = horizontalDoor ? [d.inside[0], z] : [x, d.inside[1]];
  return [aisle, d.inside, d.wall, d.hall];
}

/* ---------- corridor routing: a small graph of straight corridors ---------- */

type Line = { z: number; x0: number; x1: number } | { x: number; z0: number; z1: number };
/** Office corridors (two across, two along) + covered walkway to the mess + the mess corridor. */
export const LINES: Line[] = [
  { z: HALL_Z[0]!, x0: -12.5, x1: 12.5 },
  { z: HALL_Z[1]!, x0: -12.5, x1: MESS_HALL },
  { x: HALL_X[0]!, z0: -10.4, z1: 10.4 },
  { x: HALL_X[1]!, z0: -10.4, z1: 10.4 },
  { x: MESS_HALL, z0: -10.4, z1: 10.4 },
];
const onLine = (l: Line, p: [number, number]) => ('z' in l ? Math.abs(p[1] - l.z) < 0.05 && p[0] >= l.x0 - 0.05 && p[0] <= l.x1 + 0.05 : Math.abs(p[0] - l.x) < 0.05 && p[1] >= l.z0 - 0.05 && p[1] <= l.z1 + 0.05);
const CROSSINGS: [number, number][] = [];
for (const a of LINES) for (const b of LINES) {
  if ('z' in a && 'x' in b) { const p: [number, number] = [b.x, a.z]; if (onLine(a, p) && onLine(b, p)) CROSSINGS.push(p); }
}

/** Shortest path along corridors between two corridor points (Dijkstra over the crossings). */
export function corridorPath(a: [number, number], b: [number, number]): [number, number][] {
  const pts: [number, number][] = [a, b, ...CROSSINGS];
  const linked = (p: [number, number], q: [number, number]) => LINES.some((l) => onLine(l, p) && onLine(l, q));
  const dist = pts.map(() => Infinity);
  const prev: number[] = pts.map(() => -1);
  const done = pts.map(() => false);
  dist[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < pts.length; i++) if (!done[i] && dist[i]! < Infinity && (u < 0 || dist[i]! < dist[u]!)) u = i;
    if (u < 0 || u === 1) break;
    done[u] = true;
    for (let v = 0; v < pts.length; v++) {
      if (done[v] || !linked(pts[u]!, pts[v]!)) continue;
      const d = dist[u]! + Math.abs(pts[u]![0] - pts[v]![0]) + Math.abs(pts[u]![1] - pts[v]![1]);
      if (d < dist[v]!) { dist[v] = d; prev[v] = u; }
    }
  }
  if (prev[1] === -1 && !linked(a, b)) return [b];
  const out: [number, number][] = [];
  for (let v = 1; v !== 0 && v !== -1; v = prev[v]!) out.unshift(pts[v]!);
  return out.length ? out : [b];
}

export interface Place { x: number; z: number; rot: number; via: [number, number][] }
const place = (roomKey: string, x: number, z: number, rot: number): Place => ({ x, z, rot, via: exitVia(roomKey, x, z) });

const musholla = roomByKey('musholla');
const rapat = roomByKey('rapat');
/** Places for activities away from the desk (one per person: index % length). Rotation 0 = facing -z (back). */
export type SharedSpot = 'musholla' | 'kopi' | 'makan' | 'rapat' | 'lounge' | 'ngobrol' | 'mess';
export const PLACES: Record<SharedSpot, Place[]> = {
  // Rows facing the qibla wall (west, -x).
  musholla: Array.from({ length: 9 }, (_, i) => place('musholla', musholla.x0 + 1.4 + Math.floor(i / 3) * 0.95, -0.8 + (i % 3) * 0.8, Math.PI / 2)),
  kopi: [0, 1, 2, 3].map((i) => place('pantry', -11.75, 5.4 + i * 0.6, Math.PI / 2)),
  makan: [-9.6, -8.8, -8.0].flatMap((x) => [place('pantry', x, 7.0, Math.PI), place('pantry', x, 8.3, 0)]),
  rapat: [
    ...[8.1, 9.0, 9.9].map((x) => place('rapat', x, -1.05, Math.PI)),
    ...[8.1, 9.0, 9.9].map((x) => place('rapat', x, 1.05, 0)),
    place('rapat', rapat.x1 - 1.4, 0, Math.PI / 2),
    place('rapat', rapat.x0 + 1.6, 0, -Math.PI / 2),
  ],
  ngobrol: Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2, cx = 0.9, cz = -0.75;
    const x = cx + Math.cos(a) * 0.85, z = cz + Math.sin(a) * 0.85;
    return place('atrium', x, z, Math.atan2(-(cx - x), -(cz - z)));
  }),
  // Two sofas + three stools facing the TV on the west wall; step forward first, then down the aisle (z = doorAt).
  mess: ([[15.9, 4.95], [15.9, 5.65], [15.9, 6.35], [15.9, 8.45], [15.9, 9.15], [15.9, 9.85], [17.5, 5.4], [17.5, 6.3], [17.5, 8.7]] as const).map(([x, z]) => {
    const d = doorPoints(MESS_COMMON);
    return { x, z, rot: Math.PI / 2, via: [[x - 0.5, z], [x - 0.5, d.inside[1]], d.inside, d.wall, d.hall] as [number, number][] };
  }),
  lounge: [
    ...[-1.6, -0.8, 0.0].map((x) => place('atrium', x, 1.75, 0)),
    ...[0.9, 1.7].map((z) => place('atrium', 2.05, z, Math.PI / 2)),
  ],
};

/** Each person's own bedroom (by index): the bed (towards the back wall) and a spot sitting on its edge. */
export function bedroomOf(index: number) {
  const r = BEDROOMS[index % BEDROOMS.length]!;
  const left = r.door === 'right';
  const bedX = left ? r.x0 + 1.05 : r.x1 - 1.05;
  const zc = (r.z0 + r.z1) / 2;
  const d = doorPoints(r);
  const front = zc + 0.25;
  const via: [number, number][] = [[bedX, front], [d.inside[0], front], d.inside, d.wall, d.hall];
  return {
    room: r,
    bed: { x: bedX, z: zc - 0.6, headDir: left ? -1 : 1 },
    /** Sitting on the bed edge, facing the room. */
    sit: { x: bedX, z: zc - 0.32, rot: Math.PI, via } as Place,
    /** Lying in bed (the scene lays the body along the bed). */
    sleep: { x: bedX, z: zc - 0.6, rot: 0, via } as Place,
  };
}

/** Desk exit path: from the chair (in front of the desk, +z) to the corridor. */
export const deskVia = (roomKey: string, seatX: number, seatZ: number) => exitVia(roomKey, seatX, seatZ);

/** Whole route between two places (each given with its exit path), through the corridors. */
export function route(from: { x: number; z: number; via: [number, number][] }, to: { x: number; z: number; via: [number, number][] }): [number, number][] {
  const out = [...from.via];
  const a = (from.via.at(-1) ?? [from.x, from.z]) as [number, number];
  const b = (to.via.at(-1) ?? [to.x, to.z]) as [number, number];
  out.push(...corridorPath(a, b));
  out.push(...[...to.via].reverse().slice(1), [to.x, to.z]);
  return out;
}

/** Entrance (outside the lobby doors) as a place: walk in through the lobby to the corridor. */
export const ENTRANCE_PLACE: Place = { x: ENTRANCE.x, z: ENTRANCE.z, rot: Math.PI, via: [[0, 10.4], [0, 6.0], [0, HALL_Z[1]!]] };
