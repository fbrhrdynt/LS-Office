/**
 * Denah kantor (meter, koordinat lokal scene). Ruang kerja (Creative / Marketing / Web Dev) di tengah x -7..7,
 * sayap kiri: musholla (belakang) + pantry & kopi (depan), sayap kanan: ruang rapat (belakang) + lounge (depan).
 * Koridor memanjang di z = CORRIDOR; pintu masuk di ujung kanan.
 */
import type { Spot } from './office';

export const BOUNDS = { x0: -12.6, x1: 12.6, z0: -3.5, z1: 3 };
export const CORRIDOR = 0.05;
export const ENTRANCE = { x: 13.6, z: CORRIDOR };
/** Partisi ruang belakang di sayap (z), dengan pintu di tengah. */
export const BACK_WALL_Z = -0.6;

export interface Place {
  /** Titik berdiri/duduk. */
  x: number;
  z: number;
  /** Arah hadap (radian, rotasi y; 0 = menghadap -z). */
  rot: number;
  /** Titik-titik dari tempat ini menuju koridor (tanpa titik awal). */
  via: [number, number][];
}

const door = (dx: number): [number, number][] => [[dx, BACK_WALL_Z - 0.55], [dx, CORRIDOR]];

/** Tempat untuk tiap aktivitas di luar meja, dipilih per karyawan (indeks % jumlah tempat). */
export const PLACES: Record<Exclude<Spot, 'meja' | 'rumah'>, Place[]> = {
  musholla: Array.from({ length: 9 }, (_, i) => {
    const x = -11.2 + Math.floor(i / 3) * 0.95;
    const z = -2.85 + (i % 3) * 0.7;
    return { x, z, rot: Math.PI / 2, via: [[x, -1.25], ...door(-9.8)] };
  }),
  kopi: [0, 1, 2, 3].map((i) => ({ x: -11.55, z: 0.95 + i * 0.6, rot: Math.PI / 2, via: [[-10.9, 0.95 + i * 0.6], [-10.9, CORRIDOR]] as [number, number][] })),
  makan: [
    ...[-10.1, -9.4, -8.7].map((x) => ({ x, z: 1.25, rot: Math.PI, via: [[x, CORRIDOR]] as [number, number][] })),
    ...[-10.1, -9.4, -8.7].map((x) => ({ x, z: 2.6, rot: 0, via: [[-7.75, 2.6], [-7.75, CORRIDOR]] as [number, number][] })),
  ],
  rapat: [
    ...[8.9, 9.8, 10.7].map((x) => ({ x, z: -2.85, rot: Math.PI, via: [[x, -3.05], [8.0, -3.05], [8.0, -1.25], ...door(9.8)] as [number, number][] })),
    ...[8.9, 9.8, 10.7].map((x) => ({ x, z: -1.25, rot: 0, via: [[x, -1.05], ...door(9.8)] as [number, number][] })),
    { x: 11.65, z: -2.05, rot: Math.PI / 2, via: [[11.65, -1.05], ...door(9.8)] },
    { x: 7.95, z: -2.05, rot: -Math.PI / 2, via: [[7.95, -1.05], ...door(9.8)] },
  ],
  lounge: [
    ...[8.7, 9.5, 10.3].map((x) => ({ x, z: 2.45, rot: 0, via: [[x, 1.35], [x, CORRIDOR]] as [number, number][] })),
    ...[1.35, 2.05].map((z) => ({ x: 11.85, z, rot: Math.PI / 2, via: [[11.2, z], [11.2, CORRIDOR]] as [number, number][] })),
  ],
};

/** Label ruangan (HTML di atas kanvas). */
export const ROOM_LABELS: { key: string; label: string; x: number; y: number; z: number }[] = [
  { key: 'musholla', label: '🕌 Musholla', x: -9.8, y: 2.4, z: -3.2 },
  { key: 'pantry', label: '☕ Pantry & Kopi', x: -9.8, y: 1.9, z: 2.9 },
  { key: 'creative', label: 'Creative', x: -4.4, y: 2.95, z: -3.3 },
  { key: 'marketing', label: 'Marketing', x: 1.35, y: 3.2, z: -3.3 },
  { key: 'webdev', label: 'Web Dev', x: 4.5, y: 2.95, z: -3.3 },
  { key: 'rapat', label: '🗓️ Ruang Rapat', x: 9.8, y: 2.4, z: -3.2 },
  { key: 'lounge', label: '🛋️ Lounge', x: 9.8, y: 1.9, z: 2.9 },
];
