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

export const ROOMS: Room[] = [
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
export const roomByKey = (key: string) => ROOMS.find((r) => r.key === key)!;
export const roomCenter = (r: Room) => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });

/** Door point on the wall and the matching point in the corridor outside it. */
export function doorPoints(r: Room): { wall: [number, number]; hall: [number, number]; inside: [number, number] } {
  if (r.door === 'front') return { wall: [r.doorAt, r.z1], hall: [r.doorAt, HALL_Z[0]!], inside: [r.doorAt, r.z1 - 0.9] };
  if (r.door === 'back') return { wall: [r.doorAt, r.z0], hall: [r.doorAt, HALL_Z[1]!], inside: [r.doorAt, r.z0 + 0.9] };
  if (r.door === 'right') return { wall: [r.x1, r.doorAt], hall: [HALL_X[0]!, r.doorAt], inside: [r.x1 - 0.9, r.doorAt] };
  if (r.door === 'left') return { wall: [r.x0, r.doorAt], hall: [HALL_X[1]!, r.doorAt], inside: [r.x0 + 0.9, r.doorAt] };
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

/* ---------- corridor routing (rectangle ring around the atrium + four arms) ---------- */

const onHallZ = (p: [number, number]) => HALL_Z.some((z) => Math.abs(p[1] - z) < 0.05);
const onHallX = (p: [number, number]) => HALL_X.some((x) => Math.abs(p[0] - x) < 0.05);
const NODES: [number, number][] = HALL_X.flatMap((x) => HALL_Z.map((z) => [x, z] as [number, number]));

/** Shortest corridor path between two corridor points (Manhattan along corridor lines via the 4 crossings). */
export function corridorPath(a: [number, number], b: [number, number]): [number, number][] {
  const same = (onHallZ(a) && onHallZ(b) && Math.abs(a[1] - b[1]) < 0.05) || (onHallX(a) && onHallX(b) && Math.abs(a[0] - b[0]) < 0.05);
  if (same) return [b];
  const near = (p: [number, number]) => NODES.filter((n) => (onHallZ(p) && Math.abs(n[1] - p[1]) < 0.05) || (onHallX(p) && Math.abs(n[0] - p[0]) < 0.05));
  const d = (p: [number, number], q: [number, number]) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]);
  let best: [number, number][] = [b];
  let bestLen = Infinity;
  for (const n1 of near(a)) for (const n2 of near(b)) {
    const shared = n1[0] === n2[0] || n1[1] === n2[1];
    const mid: [number, number][] = n1 === n2 ? [n1] : shared ? [n1, n2] : [n1, [n1[0], n2[1]], n2];
    const pts = [a, ...mid, b];
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += d(pts[i - 1]!, pts[i]!);
    if (len < bestLen) { bestLen = len; best = [...mid, b]; }
  }
  return best;
}

export interface Place { x: number; z: number; rot: number; via: [number, number][] }
const place = (roomKey: string, x: number, z: number, rot: number): Place => ({ x, z, rot, via: exitVia(roomKey, x, z) });

const musholla = roomByKey('musholla');
const rapat = roomByKey('rapat');
/** Places for activities away from the desk (one per person: index % length). Rotation 0 = facing -z (back). */
export const PLACES: Record<Exclude<Spot, 'meja' | 'rumah'>, Place[]> = {
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
  lounge: [
    ...[-1.6, -0.8, 0.0].map((x) => place('atrium', x, 1.75, 0)),
    ...[0.9, 1.7].map((z) => place('atrium', 2.05, z, Math.PI / 2)),
  ],
};

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
