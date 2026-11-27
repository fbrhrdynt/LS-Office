import { useEffect, useRef } from 'react';
import {
  AmbientLight,
  CircleGeometry,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Material,
  type BufferGeometry,
  OrthographicCamera,
  PointLight,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RUANGAN } from './config';
import { buatKitGaya } from './gaya';
import type { Dunia, Peran } from './gaya/alat';

type AgentKey = string;
import { fidgetAt, type DeskState, type Spot } from './office';
import { BACK_WALL_Z, BOUNDS, CORRIDOR, ENTRANCE, PLACES, ROOM_LABELS } from './layout';

/*
 * Kantor AI 3D (Three.js). Bentuk dan bahan datang dari gaya aktif (src/gaya/<id>.ts, `gaya`); tanpa model 3D, tekstur dari
 * kanvas, supaya ringan di HP. Label dan gelembung adalah HTML
 * di atas kanvas (`anchors`); komponen ini hanya memindahkannya tiap frame. `manual` (rekam): tanpa loop, halaman menggambar
 * frame t lewat `drive.current(t)`.
 */

export interface SceneProps {
  desks: readonly DeskState[];
  night: boolean;
  boardCount: number;
  anchors: React.RefObject<Map<AgentKey, HTMLElement>>;
  /** HTML labels for rooms (layout.ts ROOM_LABELS keys). */
  roomAnchors?: React.RefObject<Map<string, HTMLElement>>;
  boardAnchor: React.RefObject<HTMLElement | null>;
  /** Bigger, slowly orbiting, agents walking, lamps at night: the full-screen office. */
  cinematic?: boolean;
  manual?: boolean;
  drive?: React.RefObject<((t: number) => void) | null>;
  onReady?: () => void;
  onFail?: () => void;
  /** Id gaya 3D (src/gaya). Ganti = scene dibangun ulang. */
  gaya?: string;
}

const shade = (hex: string, f: number) => {
  const c = new Color(hex);
  c.multiplyScalar(f);
  return `#${c.getHexString()}`;
};
const ROOMS = RUANGAN.map((r) => ({ x0: r.x0, x1: r.x1, floor: r.warna, floorNight: shade(r.warna, 0.32), rug: r.karpet }));
const Z0 = -3.5;
const Z1 = 3;
const SKIN = ['#f1c7a5', '#d9a07b', '#c68863', '#e8b896', '#b97a56', '#f0c09c'];
const HAIR = ['#2b1d16', '#1b1330', '#5a3825', '#2b1d16', '#7a4a2a', '#1b1330'];
const BOARD = new Vector3(0.1, 0, -2.5);

interface Actor {
  key: AgentKey;
  root: Group;
  body: Mesh;
  head: Mesh;
  armL: Mesh;
  armR: Mesh;
  legL: Mesh;
  legR: Mesh;
  screen: Mesh;
  deskTop: Mesh;
  book: Mesh;
  lamp: Mesh;
  mug: Mesh;
  handMug: Mesh;
  light: PointLight | null;
  seat: Vector3;
  deskZ: number;
  /** Movement: current position, remaining waypoints, current goal. */
  pos: Vector3;
  route: Vector3[];
  goal: Goal | null;
  lastT: number;
  label: Vector3;
  phase: number;
  index: number;
}

const smooth = (x: number) => x * x * (3 - 2 * x);
interface Goal { key: string; x: number; z: number; rot: number; via: [number, number][]; pose: Spot }
const WALK_SPEED = 1.5; // m/s

export default function OfficeScene({ desks, night, boardCount, anchors, roomAnchors, boardAnchor, cinematic, manual, drive, onReady, onFail, gaya }: SceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef({ desks, night, boardCount, dirty: true });
  live.current = { desks, night, boardCount, dirty: true };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: WebGLRenderer;
    const touch = window.matchMedia('(pointer: coarse)').matches;
    try {
      renderer = new WebGLRenderer({ antialias: !touch || !!manual, alpha: true, powerPreference: manual ? 'high-performance' : 'low-power', preserveDrawingBuffer: !!manual });
    } catch {
      onFail?.();
      return;
    }
    renderer.setPixelRatio(manual ? 1 : Math.min(window.devicePixelRatio || 1, touch ? 1.5 : 2));
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-hidden', 'true');

    const scene = new Scene();
    const K = buatKitGaya(gaya);
    if (cinematic && K.kabut) scene.fog = new Fog(K.kabut[0], 30, 48);
    const kantor = new Group();
    scene.add(kantor);
    const inti = new Group();
    kantor.add(inti);
    const camera = new OrthographicCamera(-10, 10, 6, -6, 0.1, 100);
    // Wider office: aim a little left so the musholla/pantry wing is not hidden behind the personnel panel.
    const target = new Vector3(K.dunia ? -0.3 : -1.9, 1.2, -0.3);

    const C = K.cahaya;
    const hemi = new HemisphereLight(C.langit, C.bumi, C.kuat);
    const sun = new DirectionalLight(C.matahari, C.mKuat);
    sun.position.set(-6, 12, 8);
    const amb = new AmbientLight('#ffffff', 0.35);
    scene.add(hemi, sun, amb);

    const disposables: { dispose(): void }[] = [];
    const geo = <T extends BufferGeometry>(g: T) => (disposables.push(g), g);
    // Semua bahan & bentuk lewat kit gaya; peran objek ikut di bahan (userData.peran) supaya bentuknya juga ikut gaya.
    const mat = (color: string, peran: Peran, emissive?: string) => K.bahan(color, peran, emissive);
    const peranDari = (m: Material) => (m.userData.peran ?? 'kayu') as Peran;
    const add = (mesh: Mesh, x: number, y: number, z: number, parent: Scene | Group | Mesh = inti) => {
      mesh.position.set(x, y, z);
      parent.add(mesh);
      K.hias?.(mesh, peranDari(mesh.material as Material));
      return mesh;
    };
    const box = (w: number, h: number, d: number, m: Material, x: number, y: number, z: number, parent?: Group) => add(new Mesh(K.kotak(w, h, d, peranDari(m)), m), x, y, z, parent);
    const cyl = (rt: number, rb: number, h: number, m: Material) => new Mesh(K.tabung(rt, rb, h, peranDari(m)), m);
    const ball = (r: number, m: Material, kubah = false) => new Mesh(K.bola(r, peranDari(m), kubah), m);
    const cone = (r: number, h: number, m: Material, open = false) => new Mesh(K.kerucut(r, h, peranDari(m), open), m);

    // ---------- the building ----------
    const lineM = mat('#cdb79c', 'garis');
    const floors: { m: ReturnType<typeof mat>; r: { floor: string; floorNight: string } }[] = ROOMS.map((r) => {
      const m = mat(r.floor, 'lantai');
      box(r.x1 - r.x0 - 0.04, 0.14, Z1 - Z0, m, (r.x0 + r.x1) / 2, -0.07, (Z0 + Z1) / 2);
      for (let z = Z0 + 0.5; z < Z1; z += 0.65) box(r.x1 - r.x0 - 0.1, 0.005, 0.02, lineM, (r.x0 + r.x1) / 2, 0.002, z);
      box(2.6, 0.02, 1.8, mat(r.rug, 'karpet'), (r.x0 + r.x1) / 2, 0.012, 0.8);
      return { m, r };
    });
    const W0 = BOUNDS.x0, W1 = BOUNDS.x1, WW = W1 - W0, ZM = (Z0 + Z1) / 2;
    box(WW + 0.6, 0.5, Z1 - Z0 + 0.6, mat('#3a2a5c', 'alas'), 0, -0.4, ZM + 0.15);
    const wallM = mat('#fbf6ef', 'dinding');
    const wallSideM = mat('#f1e8dc', 'dinding');
    const trimM = mat('#271b3f', 'bingkai');
    const woodM = mat('#a87c56', 'kayu');
    const meetingChairM = mat('#3a2a5c', 'kursi');
    const chairM0 = () => meetingChairM;
    box(WW, 3, 0.18, wallM, 0, 1.5, Z0 - 0.09);
    box(0.18, 3, Z1 - Z0, wallSideM, W0 - 0.09, 1.5, ZM);
    box(WW, 0.12, 0.22, woodM, 0, 0.06, Z0 - 0.02);
    box(0.22, 0.12, Z1 - Z0, woodM, W0 + 0.02, 0.06, ZM);
    // Low partitions between rooms, open at the corridor.
    for (const x of [-7, -1.8, 2, 7]) {
      box(0.14, 1.25, 2.6, wallSideM, x, 0.62, Z0 + 1.3);
      box(0.14, 1.25, 2.0, wallSideM, x, 0.62, Z1 - 1.0);
      box(0.18, 0.06, 2.6, woodM, x, 1.27, Z0 + 1.3);
      box(0.18, 0.06, 2.0, woodM, x, 1.27, Z1 - 1.0);
    }
    const glassM = mat('#bfe3ff', 'kaca', '#7fb8e6');
    for (const x of [-11.2, -8.4, -5.6, -3.4, 3.4, 5.6, 11.2]) {
      box(1.6, 1.2, 0.06, trimM, x, 1.8, Z0 + 0.02);
      box(1.44, 1.04, 0.04, glassM, x, 1.8, Z0 + 0.05);
      box(0.05, 1.04, 0.05, trimM, x, 1.8, Z0 + 0.07);
    }
    for (const z of [1.6]) {
      box(0.06, 1.1, 1.4, trimM, W0 + 0.02, 1.8, z);
      box(0.04, 0.96, 1.26, glassM, W0 + 0.05, 1.8, z);
    }
    // Back rooms of the wings (musholla, meeting room): a partition with a door to the corridor.
    const wingWall = (xa: number, xb: number, dx: number, glass: boolean) => {
      for (const [a0, a1] of [[xa, dx - 0.5], [dx + 0.5, xb]] as const) {
        const w = a1 - a0, cx = (a0 + a1) / 2;
        if (glass) {
          box(w, 0.08, 0.1, trimM, cx, 2.0, BACK_WALL_Z);
          box(w, 1.9, 0.04, glassM, cx, 1.0, BACK_WALL_Z);
          box(w, 0.1, 0.1, trimM, cx, 0.05, BACK_WALL_Z);
        } else {
          box(w, 1.25, 0.14, wallSideM, cx, 0.62, BACK_WALL_Z);
          box(w, 0.06, 0.18, woodM, cx, 1.27, BACK_WALL_Z);
        }
      }
    };
    wingWall(W0, -7.07, -9.8, false);
    wingWall(7.07, W1, 9.8, true);
    for (const r of ROOMS) box(1.6, 0.26, 0.04, mat(r.rug, 'catatan', r.rug), (r.x0 + r.x1) / 2, 2.75, Z0 + 0.03);

    // Mission Board with sticky notes for the open items.
    box(3.2, 1.6, 0.1, trimM, BOARD.x, 1.75, Z0 + 0.05);
    box(3.0, 1.4, 0.04, mat('#f7f2ea', 'papan'), BOARD.x, 1.75, Z0 + 0.11);
    const noteColors = ['#ffd166', '#f3355b', '#7bdff2', '#b2f7ef', '#f7aef8', '#cdb4db', '#ffd166', '#7bdff2'];
    const notes = noteColors.map((c, i) => {
      const n = box(0.5, 0.4, 0.02, mat(c, 'catatan', c), BOARD.x - 1.05 + (i % 4) * 0.7, 2.12 - Math.floor(i / 4) * 0.6, Z0 + 0.15);
      (n.material as MeshLambertMaterial).emissiveIntensity = K.selaluMalam ? 0.7 : 0.2;
      n.rotation.z = ((i * 37) % 7) / 60 - 0.05;
      return n;
    });

    // Furniture.
    const shelf = (x: number, z: number, rot = 0) => {
      const g = new Group();
      box(1.2, 1.8, 0.36, woodM, 0, 0.9, 0, g);
      const bookColors = ['#e4572e', '#2a9d8f', '#f2b134', '#3a86ff', '#8e6bd8', '#ff5d8f'];
      for (let row = 0; row < 3; row++) for (let i = 0; i < 6; i++) box(0.14, 0.34, 0.26, mat(bookColors[(i + row) % 6]!, 'buku'), -0.45 + i * 0.18, 0.4 + row * 0.55, 0.04, g);
      g.position.set(x, 0, z);
      g.rotation.y = rot;
      inti.add(g);
    };
    shelf(-6.75, -2.25, Math.PI / 2);
    shelf(6.2, -3.2);
    const potM = mat('#c26b3b', 'pot');
    const leafM = mat('#3f9b4f', 'daun');
    const leaf2M = mat('#5bbf5e', 'daun');
    const plant = (x: number, z: number, s = 1) => {
      add(cyl(0.2 * s, 0.16 * s, 0.4 * s, potM), x, 0.2 * s, z);
      add(cone(0.34 * s, 0.9 * s, leafM), x, 0.85 * s, z);
      add(ball(0.26 * s, leaf2M), x + 0.12 * s, 0.7 * s, z + 0.1 * s);
    };
    plant(-6.5, 2.6, 1.2);
    plant(1.5, -3.0);
    plant(6.55, 2.6, 1.2);
    plant(-2.3, -3.0);
    plant(2.5, 2.6, 0.9);
    // ---------- wings: musholla, pantry & coffee, meeting room, lounge ----------
    const wingFloor = (x0: number, x1: number, z0: number, z1: number, color: string) => {
      const m = mat(color, 'lantai');
      box(x1 - x0 - 0.04, 0.14, z1 - z0, m, (x0 + x1) / 2, -0.07, (z0 + z1) / 2);
      floors.push({ m, r: { floor: color, floorNight: shade(color, 0.32) } });
    };
    wingFloor(W0, -7, Z0, BACK_WALL_Z, '#dfe9d8');
    wingFloor(W0, -7, BACK_WALL_Z, Z1, '#f1e4cf');
    wingFloor(7, W1, Z0, BACK_WALL_Z, '#e6e1ee');
    wingFloor(7, W1, BACK_WALL_Z, Z1, '#f2ddd3');
    // Musholla: green carpet, prayer mats in rows, a mihrab panel, Quran shelf, shoe rack by the door.
    box(4.9, 0.02, 2.5, mat('#2f7d5b', 'karpet'), -9.75, 0.012, -2.12);
    const sajadah = ['#b23a48', '#2a6f97', '#c08b2c'];
    PLACES.musholla.forEach((p, i) => box(0.95, 0.015, 0.5, mat(sajadah[i % 3]!, 'karpet'), p.x - 0.3, 0.026, p.z));
    box(0.06, 1.7, 1.1, mat('#e9d8a6', 'papan'), W0 + 0.03, 1.15, -2.15);
    box(0.06, 0.5, 0.7, mat('#2f7d5b', 'catatan', '#1d5a40'), W0 + 0.05, 1.55, -2.15);
    box(0.3, 0.7, 0.9, woodM, -7.35, 0.35, -2.9);
    for (let i = 0; i < 4; i++) box(0.22, 0.28, 0.06, mat(['#2f7d5b', '#8c2f39', '#2a6f97', '#c08b2c'][i]!, 'buku'), -7.35, 0.85, -3.2 + i * 0.12);
    box(0.9, 0.35, 0.3, woodM, -10.95, 0.18, -0.3);
    // Pantry: counter + coffee machine along the wall, fridge, dining table with chairs.
    box(0.6, 0.95, 2.6, woodM, W0 + 0.32, 0.47, 1.85);
    box(0.64, 0.05, 2.64, mat('#ece6dc', 'meja'), W0 + 0.32, 0.97, 1.85);
    box(0.36, 0.46, 0.32, trimM, W0 + 0.32, 1.22, 1.15);
    add(cyl(0.05, 0.045, 0.1, mat('#ffffff', 'kertas')), W0 + 0.45, 1.05, 1.5);
    add(cyl(0.05, 0.045, 0.1, mat('#ffffff', 'kertas')), W0 + 0.45, 1.05, 2.35);
    box(0.3, 0.32, 0.3, mat('#d1a64b', 'pot'), W0 + 0.32, 1.15, 2.85);
    box(0.7, 1.8, 0.62, mat('#dfe6ea', 'kertas'), -7.6, 0.9, 2.62);
    box(2.0, 0.07, 0.9, mat('#c9a27c', 'meja'), -9.4, 0.74, 1.92);
    for (const [lx, lz] of [[-10.3, 1.55], [-8.5, 1.55], [-10.3, 2.3], [-8.5, 2.3]] as const) box(0.06, 0.72, 0.06, woodM, lx, 0.36, lz);
    for (const p of PLACES.makan) {
      box(0.42, 0.06, 0.42, mat('#8c5a3c', 'kursi'), p.x, 0.47, p.z);
      box(0.42, 0.45, 0.06, mat('#8c5a3c', 'kursi'), p.x, 0.72, p.z + (p.rot === 0 ? 0.22 : -0.22));
    }
    // Meeting room: long table, chairs, a TV on the back wall.
    box(2.6, 0.07, 1.1, mat('#5b4636', 'meja'), 9.8, 0.74, -2.05);
    box(2.3, 0.7, 0.8, mat('#3a2a5c', 'kaki'), 9.8, 0.36, -2.05);
    const tvM = mat('#1b1330', 'layar', '#3a86ff');
    box(1.9, 1.05, 0.06, trimM, 9.8, 1.75, Z0 + 0.04);
    box(1.75, 0.92, 0.02, tvM, 9.8, 1.75, Z0 + 0.08);
    for (const p of PLACES.rapat) {
      const back = p.rot === 0 ? [0, 0.22] : p.rot === Math.PI ? [0, -0.22] : p.rot > 0 ? [0.22, 0] : [-0.22, 0];
      box(0.44, 0.06, 0.44, chairM0(), p.x, 0.47, p.z);
      box(back[0] ? 0.06 : 0.44, 0.5, back[1] ? 0.06 : 0.44, chairM0(), p.x + back[0]!, 0.74, p.z + back[1]!);
    }
    // Lounge: two sofas, coffee table, rug, bean bags, plants.
    box(3.2, 0.02, 2.0, mat('#d97757', 'karpet'), 9.7, 0.012, 1.95);
    const sofaM = mat('#5b4a72', 'sofa');
    const sofaBackM = mat('#3a2a5c', 'sofa');
    box(2.6, 0.42, 0.72, sofaM, 9.5, 0.21, 2.6);
    box(2.6, 0.55, 0.2, sofaBackM, 9.5, 0.62, 2.92);
    box(0.72, 0.42, 1.6, sofaM, 12.05, 0.21, 1.7);
    box(0.2, 0.55, 1.6, sofaBackM, 12.38, 0.62, 1.7);
    box(1.2, 0.3, 0.6, woodM, 9.55, 0.15, 1.7);
    add(cyl(0.06, 0.05, 0.1, mat('#ffffff', 'kertas')), 9.3, 0.36, 1.7);
    add(ball(0.34, mat('#f2b134', 'sofa')), 7.9, 0.28, 1.4);
    // Entrance: door frame and a welcome mat at the end of the corridor.
    box(0.12, 2.3, 0.12, trimM, 12.55, 1.15, -0.55);
    box(0.12, 2.3, 0.12, trimM, 12.55, 1.15, 0.65);
    box(0.12, 0.14, 1.32, trimM, 12.55, 2.3, 0.05);
    box(0.9, 0.02, 1.0, mat('#8c5a3c', 'karpet'), 13.05, 0.012, 0.05);
    plant(-7.55, -0.95, 0.8);
    plant(12.2, -3.05, 1.1);
    plant(7.55, 2.7, 0.9);
    for (const r of [{ x: -9.8, c: '#2f7d5b' }, { x: 9.8, c: '#8e6bd8' }]) box(1.6, 0.26, 0.04, mat(r.c, 'catatan', r.c), r.x, 2.75, Z0 + 0.03);
    const pendant: Mesh[] = [];
    for (const [x, z] of [[-4.4, 0], [0.1, 0.2], [4.5, -0.2], [-9.8, -2.0], [-9.4, 1.9], [9.8, -2.0], [9.7, 1.9]] as const) {
      box(0.02, 0.9, 0.02, trimM, x, 3.15, z);
      pendant.push(add(cone(0.32, 0.3, mat('#271b3f', 'lampu', '#000000'), true), x, 2.6, z));
    }

    let grassM: Material & { color: Color } | null = null;
    // ---------- world building (gaya paduan) ----------
    const dunia: Dunia = K.dunia?.({
      scene,
      kantor,
      K,
      pasang: (g, m, x, y, z, induk = kantor) => {
        const me = new Mesh(g, m);
        me.position.set(x, y, z);
        induk.add(me);
        return me;
      },
    }) ?? {};
    // World styles were designed around the original 14.6 m building: shrink the wider office to that footprint.
    if (K.dunia) inti.scale.setScalar(14.6 / (WW + 0.6));
    const WIDE = K.dunia ? 1 : (WW + 0.6) / 14.6 * 1.12;
    const naik = dunia.tinggi ?? 0;
    kantor.position.y = naik;
    target.y += naik;
    // ---------- outside: lawn, trees, a stone path (full screen) ----------
    if (cinematic && !dunia.gantiLuar) {
      const L = K.luar;
      const grassMat = mat('#8cc672', 'tanah');
      grassM = grassMat;
      if (L.bentuk === 'bulat') add(cyl(L.ukuran / 2, L.ukuran / 2 + 0.3, 0.3, grassMat), 0, -0.8, -1);
      else box(L.ukuran, 0.2, L.ukuran, grassMat, 0, -0.75, L.ukuran < 40 ? -2 : 0);
      if (L.alas) box(L.ukuran + 0.6, 0.7, L.ukuran + 0.6, mat(L.alas, 'alas'), 0, -1.2, L.ukuran < 40 ? -2 : 0);
      const trunkM = mat('#7a4a2a', 'batang');
      const crownM = [mat('#4f9d4a', 'daun'), mat('#6dbb5a', 'daun'), mat('#f6a5c0', 'daun')];
      const tree = (x: number, z: number, s: number, c: number) => {
        add(cyl(0.12 * s, 0.16 * s, 1.0 * s, trunkM), x, -0.65 + 0.5 * s, z);
        add(ball(0.8 * s, crownM[c]!), x, -0.65 + 1.45 * s, z);
        add(ball(0.55 * s, crownM[c]!), x + 0.45 * s, -0.65 + 1.2 * s, z + 0.3 * s);
      };
      // Behind and left of the office only: nothing in front of the camera.
      const spots: [number, number, number, number][] = [
        [-15.2, -5.5, 1.3, 0], [-15.8, -1, 1.1, 1], [-15.4, 3.5, 1.4, 2], [-10, -6.8, 1.2, 1], [-5, -6.5, 1.2, 1], [-1, -6.8, 1.5, 0],
        [3.5, -6.5, 1.2, 2], [8, -6, 1.3, 1], [12.5, -6.4, 1.2, 0], [-17, 7, 1.2, 0], [16, -9, 1.4, 2], [-13, -8.5, 1.1, 2],
      ];
      const muat = (x: number, z: number) => (L.bentuk === 'bulat' ? Math.hypot(x, z + 1) < L.ukuran / 2 - 1 : Math.abs(x) < L.ukuran / 2 - 0.8 && Math.abs(z + (L.ukuran < 40 ? 2 : 0)) < L.ukuran / 2 - 0.8);
      for (const [x, z, s2, c] of spots) if (muat(x, z)) tree(x, z, s2, c);
      const stoneM = mat('#d8cfc2', 'batu');
      for (let i = 0; i < 7; i++) {
        const sx = W0 - 0.8 - i * 0.75;
        if (!muat(sx, 0.2)) continue;
        const st = add(cyl(0.35, 0.38, 0.06, stoneM), sx, -0.63, 0.2 + (i % 2) * 0.3);
        st.scale.set(1, 1, 0.7);
      }
      if (L.awan) {
        const awanM = mat('#ffffff', 'awan');
        for (const [cx, cy, cz] of [[-6, 6.5, -10], [5, 7.2, -11], [11, 6, -6]] as const) {
          add(ball(0.9, awanM), cx, cy, cz);
          add(ball(0.65, awanM), cx + 0.9, cy - 0.15, cz);
          add(ball(0.6, awanM), cx - 0.9, cy - 0.18, cz);
        }
      }
    }

    // ---------- desks and agents ----------
    const legM = mat('#4b3b62', 'kaki');
    const chairM = mat('#3a2a5c', 'kursi');
    const shadowM = new MeshBasicMaterial({ color: '#1b1330', transparent: true, opacity: 0.14, depthWrite: false });
    disposables.push(shadowM);
    const nightLights = !!cinematic && !touch;
    const hk = 0.24 * (K.agen.kepala - 1);
    const actors: Actor[] = desks.map((d, i) => {
      const { x, z } = d.desk;
      const deskTop = box(1.4, 0.08, 0.76, mat('#c9a27c', 'meja', '#000000'), x, 0.78, z);
      box(1.3, 0.7, 0.05, legM, x, 0.38, z - 0.32);
      box(0.06, 0.74, 0.66, woodM, x - 0.64, 0.38, z);
      box(0.06, 0.74, 0.66, woodM, x + 0.64, 0.38, z);
      box(0.66, 0.44, 0.05, trimM, x - 0.05, 1.12, z - 0.22);
      const screen = box(0.6, 0.36, 0.01, mat('#1b1330', 'layar', '#000000'), x - 0.05, 1.12, z - 0.19);
      box(0.08, 0.16, 0.08, trimM, x - 0.05, 0.9, z - 0.22);
      if (d.desk.room === 'bizdev') box(0.36, 0.26, 0.04, trimM, x + 0.45, 1.02, z - 0.12).rotation.set(0, -0.5, 0);
      box(0.52, 0.02, 0.18, mat('#efe9f6', 'kertas'), x - 0.05, 0.83, z + 0.08);
      add(cyl(0.06, 0.05, 0.12, mat(d.desk.color, 'pot')), x + 0.5, 0.88, z + 0.15);
      const book = box(0.34, 0.06, 0.26, mat('#f3355b', 'buku'), x + 0.32, 0.86, z + 0.12);
      const lamp = add(ball(0.1, mat('#fff3b0', 'lampu', '#ffcf4d')), x - 0.52, 1.1, z - 0.15);
      box(0.04, 0.28, 0.04, trimM, x - 0.52, 0.96, z - 0.15);
      let light: PointLight | null = null;
      if (nightLights) {
        light = new PointLight('#ffb35c', 0, 4.5, 1.6);
        light.position.set(x - 0.4, 1.5, z + 0.2);
        inti.add(light);
      }
      box(0.56, 0.08, 0.56, chairM, x, 0.5, z + 0.75);
      box(0.56, 0.62, 0.08, chairM, x, 0.84, z + 1.03);
      box(0.06, 0.46, 0.06, legM, x, 0.25, z + 0.75);
      const sh = add(new Mesh(geo(new CircleGeometry(0.95, 24)), shadowM), x, 0.006, z + 0.3);
      sh.rotation.x = -Math.PI / 2;
      const root = new Group();
      const seat = new Vector3(x, 0, z + 0.72);
      root.position.copy(seat);
      const shirt = mat(d.desk.color, 'baju');
      const pants = mat('#2b2340', 'celana');
      const skin = mat(SKIN[i % SKIN.length]!, 'kulit');
      const body = add(new Mesh(K.kapsul(0.23, 0.4, 'baju'), shirt), 0, 0.92, 0, root);
      body.scale.setScalar(K.agen.badan);
      const head = add(ball(0.22, skin), 0, 1.42 + hk, 0, root);
      const hair = add(ball(0.235, mat(HAIR[i % HAIR.length]!, 'rambut'), true), 0, 0.02, 0.02, head);
      hair.rotation.x = 0.35;
      // Kepala besar (chibi): skala dari leher, jadi tetap menempel di badan.
      head.scale.setScalar(K.agen.kepala);
      const limb = (r: number, len: number, m: Material, px: number, py: number) => {
        const g = K.kapsul(r, len, peranDari(m));
        g.translate(0, -len / 2 - r / 2, 0);
        return add(new Mesh(g, m), px, py, 0, root);
      };
      const armL = limb(0.07, 0.34, shirt, -0.29, 1.12);
      const armR = limb(0.07, 0.34, shirt, 0.29, 1.12);
      const legL = limb(0.085, 0.38, pants, -0.11, 0.62);
      const legR = limb(0.085, 0.38, pants, 0.11, 0.62);
      // Coffee mug: on the desk, or in the right hand while sipping.
      const mugM = mat('#f7f2ea', 'kertas');
      const mug = add(cyl(0.055, 0.05, 0.11, mugM), x + 0.18, 0.88, z + 0.26);
      const handMug = add(cyl(0.055, 0.05, 0.11, mugM), 0, -0.44, 0.06, armR);
      handMug.visible = false;
      inti.add(root);
      return { key: d.desk.key, root, body, head, armL, armR, legL, legR, screen, deskTop, book, lamp, mug, handMug, light, seat, deskZ: z, pos: seat.clone(), route: [], goal: null, lastT: 0, label: new Vector3(), phase: i * 1.7, index: i };
    });

    // ---------- camera ----------
    let portrait = false;
    const fit = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      const aspect = w / h;
      // Portrait full screen (reels): the camera turns toward the long side, so the office runs down the screen.
      portrait = !!cinematic && aspect < 0.8;
      let halfW = (cinematic ? (portrait ? 5.2 : 7.0) : 7.4) * (dunia.lebar ?? 1) * WIDE;
      let halfH = halfW / aspect;
      const minH = (cinematic ? (portrait ? 3 : 4.6) : 4.9) * (dunia.lebar ?? 1) * (K.dunia ? 1 : 1.15);
      if (halfH < minH) {
        halfH = minH;
        halfW = halfH * aspect;
      }
      camera.left = -halfW;
      camera.right = halfW;
      camera.top = halfH;
      camera.bottom = -halfH;
      camera.updateProjectionMatrix();
      live.current.dirty = true;
      // Rekam (manual): ukuran kanvas berubah = kanvas terhapus, jadi gambar ulang frame terakhir.
      redraw?.();
    };
    let redraw: (() => void) | null = null;
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    const reduce = !manual && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // The director (cinematic): a wide shot, then close-ups that glide from agent to agent, every SHOT seconds.
    const SHOT = 3.2;
    const home = target.clone();
    const shotAim = (i: number, out: Vector3): number => {
      if (i < 0 || i % 3 === 0 || !actors.length) {
        out.copy(home);
        return 1.02 * (dunia.zoomJauh ?? 1);
      }
      const shown = actors.filter((x) => x.root.visible);
      const pick = (shown.length ? shown : actors)[(i * 2 + Math.floor(i / 3)) % (shown.length || actors.length)]!;
      pick.root.getWorldPosition(out);
      out.y = 1.1 + naik;
      return portrait ? 1.7 : 1.6;
    };
    const aimA = new Vector3();
    const aimB = new Vector3();
    const look = new Vector3();
    // Manual orbit controls: drag/swipe to rotate, wheel/pinch to zoom, double-click to reset.
    let orbitYaw = 0;
    let orbitPitch = 0;
    let userZoom = 1;
    let userControlled = false;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDistance = 0;
    const canvas = renderer.domElement;
    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
    const pointerDown = (event: PointerEvent) => {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      canvas.setPointerCapture(event.pointerId);
      if (pointers.size === 2) {
        const pts = [...pointers.values()];
        pinchDistance = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      }
    };
    const pointerMove = (event: PointerEvent) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size >= 2) {
        const pts = [...pointers.values()];
        const distance = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
        if (pinchDistance > 0 && distance > 0) userZoom = clamp(userZoom * distance / pinchDistance, 0.65, 2.4);
        pinchDistance = distance;
      } else if (Math.abs(dx) + Math.abs(dy) > 0) {
        orbitYaw += dx * 0.008;
        orbitPitch = clamp(orbitPitch + dy * 0.006, -0.42, 0.72);
      }
      userControlled = true;
      live.current.dirty = true;
    };
    const pointerUp = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinchDistance = 0;
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      userZoom = clamp(userZoom * Math.exp(-event.deltaY * 0.001), 0.65, 2.4);
      userControlled = true;
      live.current.dirty = true;
    };
    const resetOrbit = () => {
      orbitYaw = 0;
      orbitPitch = 0;
      userZoom = 1;
      userControlled = false;
      live.current.dirty = true;
    };
    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerup', pointerUp);
    canvas.addEventListener('pointercancel', pointerUp);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('dblclick', resetOrbit);

    const placeCamera = (t: number) => {
      const swing = reduce ? 0 : cinematic ? (portrait ? 0.14 : 0.32) * Math.sin(t * 0.21) : 0.03 * Math.sin(t * 0.15);
      const a = (portrait ? 1.15 : K.dunia ? Math.PI / 4 : 0.5) + (userControlled ? 0 : swing) + orbitYaw;
      let zoom = userZoom;
      look.copy(home);
      if (cinematic && !reduce && !userControlled) {
        const i = Math.floor(t / SHOT);
        const zA = shotAim(i - 1, aimA);
        const zB = shotAim(i, aimB);
        const f = Math.min(1, (t - i * SHOT) / 1.1);
        const e = f * f * (3 - 2 * f);
        look.copy(aimA).lerp(aimB, e);
        zoom *= (zA + (zB - zA) * e) * (1 + 0.03 * Math.sin(t * 0.5));
      }
      const elevation = clamp(Math.atan2(13.5, Math.sqrt(17 * 17 + 17 * 17)) + orbitPitch, 0.08, 1.25);
      const horizontal = 17 * Math.SQRT2 * Math.cos(elevation);
      camera.position.set(look.x + horizontal * Math.sin(a), look.y + 17 * Math.SQRT2 * Math.sin(elevation), look.z + horizontal * Math.cos(a));
      camera.lookAt(look);
      if (camera.zoom !== zoom) {
        camera.zoom = zoom;
        camera.updateProjectionMatrix();
      }
    };

    const proj = new Vector3();
    const place = (node: HTMLElement | null | undefined, at: Vector3) => {
      if (!node) return;
      proj.copy(at).project(camera);
      const x = ((proj.x + 1) / 2) * el.clientWidth;
      const y = ((1 - proj.y) / 2) * el.clientHeight;
      node.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    };
    const boardAt = new Vector3();
    const labelAt = new Vector3();
    const CZ = CORRIDOR;
    const goalFor = (a: Actor, spot: Spot): Goal => {
      if (spot === 'rumah') return { key: 'rumah', x: ENTRANCE.x, z: ENTRANCE.z, rot: 0, via: [], pose: 'rumah' };
      if (spot === 'meja') {
        // Front-row desks are reached around the desk's side, never through it.
        const via: [number, number][] = a.deskZ > CZ ? [[a.seat.x + 0.95, a.seat.z], [a.seat.x + 0.95, CZ]] : [[a.seat.x, CZ]];
        return { key: 'meja', x: a.seat.x, z: a.seat.z, rot: 0, via, pose: 'meja' };
      }
      const list = PLACES[spot];
      const i = a.index % list.length;
      const p = list[i]!;
      return { key: spot + i, x: p.x, z: p.z, rot: p.rot, via: p.via, pose: spot };
    };
    const routeBetween = (a: Actor, from: Goal, to: Goal) => {
      const pts: [number, number][] = [];
      if (a.route.length) pts.push([a.pos.x, CZ]);
      else if (from.pose === 'rumah') a.pos.set(ENTRANCE.x, 0, ENTRANCE.z);
      else pts.push(...from.via);
      pts.push(...[...to.via].reverse(), [to.x, to.z]);
      return pts.map(([x, z]) => new Vector3(x, 0, z));
    };
    /** Sholat: qiyam, ruku, i'tidal, sujud, duduk, sujud, tahiyat (24 s loop), around the hip as pivot. */
    const prayer = (a: Actor, c: number, hk: number) => {
      const phase = c < 6 ? 'qiyam' : c < 9 ? 'ruku' : c < 10.5 ? 'itidal' : c < 14 ? 'sujud' : c < 16 ? 'duduk' : c < 19.5 ? 'sujud' : 'duduk';
      const kneel = phase === 'sujud' || phase === 'duduk';
      const hip = kneel ? 0.4 : 0.7;
      const tilt = phase === 'ruku' ? 1.25 : phase === 'sujud' ? 1.75 : 0;
      a.root.position.y = kneel ? -0.3 : 0;
      const at = (h: number) => ({ y: (kneel ? 0.7 : hip) + h * Math.cos(tilt), z: -h * Math.sin(tilt) });
      a.legL.position.set(-0.11, 0.7, 0);
      a.legR.position.set(0.11, 0.7, 0);
      a.legL.rotation.set(kneel ? -1.5 : 0, 0, 0);
      a.legR.rotation.set(kneel ? -1.5 : 0, 0, 0);
      const b = at(0.28);
      a.body.position.set(0, b.y, b.z);
      a.body.rotation.set(-tilt, 0, 0);
      const h = at(0.78 + hk);
      a.head.position.set(0, h.y, h.z);
      a.head.rotation.set(-tilt * 0.9, 0, 0);
      const sh = at(0.48);
      a.armL.position.set(-0.29, sh.y, sh.z);
      a.armR.position.set(0.29, sh.y, sh.z);
      if (phase === 'qiyam') { a.armL.rotation.set(-1.15, 0, 0.55); a.armR.rotation.set(-1.15, 0, -0.55); }
      else if (phase === 'sujud') { a.armL.rotation.set(-tilt - 0.2, 0, 0.1); a.armR.rotation.set(-tilt - 0.2, 0, -0.1); }
      else if (phase === 'ruku') { a.armL.rotation.set(-tilt + 0.35, 0, 0.05); a.armR.rotation.set(-tilt + 0.35, 0, -0.05); }
      else { a.armL.rotation.set(-0.35, 0, 0.1); a.armR.rotation.set(-0.35, 0, -0.1); }
    };
    let lastNight: boolean | null = null;
    const applyState = (t: number) => {
      const { desks: list, boardCount: count } = live.current;
      const isNight = live.current.night || !!K.selaluMalam;
      if (isNight !== lastNight) {
        lastNight = isNight;
        const w = K.warna;
        hemi.intensity = isNight ? 0.35 * (K.selaluMalam ? 2.4 : 1) : C.kuat;
        hemi.color.set(isNight ? (K.selaluMalam ? C.langit : '#7d8cff') : C.langit);
        sun.intensity = isNight ? 0.15 * (K.selaluMalam ? 3 : 1) : C.mKuat;
        sun.color.set(isNight ? '#8fa2ff' : C.matahari);
        amb.intensity = isNight ? 0.22 : 0.35;
        glassM.color.set(w(isNight ? '#18204a' : '#bfe3ff', 'kaca'));
        glassM.emissive.set(isNight ? '#10173a' : '#7fb8e6');
        for (const f of floors) f.m.color.set(w(isNight ? f.r.floorNight : f.r.floor, 'lantai'));
        grassM?.color.set(w(isNight ? '#2c4a33' : '#8cc672', 'tanah'));
        lineM.color.set(w(isNight ? '#3c3029' : '#cdb79c', 'garis'));
        for (const p of pendant) (p.material as MeshLambertMaterial).emissive.set(isNight ? '#ffb35c' : '#000000');
        if (scene.fog && K.kabut) (scene.fog as Fog).color.set(isNight ? K.kabut[1] : K.kabut[0]);
        dunia.malam?.(isNight);
      }
      notes.forEach((n, i) => (n.visible = i < count));
      for (const a of actors) {
        const d = list.find((x) => x.desk.key === a.key);
        const act = d?.doing.activity ?? 'pulang';
        const away = act === 'pulang';
        a.root.visible = !away;
        const busy = act === 'kerja' || act === 'laporan';
        const sm = a.screen.material as MeshLambertMaterial;
        sm.emissive.set(busy ? (act === 'laporan' ? '#7bdff2' : '#66e3a5') : act === 'menunggu' ? '#ffc94d' : act === 'kendala' ? '#ff5a6e' : act === 'belajar' ? '#ffd166' : act === 'siaga' ? '#5b4a92' : '#000000');
        sm.emissiveIntensity = busy ? 0.8 + (reduce ? 0 : 0.2 * Math.sin(t * 9 + a.phase)) : 0.6;
        a.book.visible = act === 'belajar';
        const lampOn = act === 'belajar' || act === 'menunggu' || (isNight && !away);
        a.lamp.visible = lampOn;
        if (a.light) a.light.intensity = lampOn && isNight ? 2.2 : 0;
        (a.lamp.material as MeshLambertMaterial).emissive.set(act === 'menunggu' ? '#ffb020' : '#ffcf4d');
        const dm = a.deskTop.material as MeshLambertMaterial;
        if (d?.urgent.length) {
          dm.emissive.set('#f3355b');
          dm.emissiveIntensity = reduce ? 0.5 : 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 6));
        } else dm.emissiveIntensity = 0;

        // Where should this person be? (schedule + real work state, decided in App). Walk there along the corridor.
        const spot: Spot = d?.spot ?? (away ? 'rumah' : 'meja');
        const goal = goalFor(a, spot);
        if (!a.goal) {
          a.pos.set(goal.x, 0, goal.z);
          a.route = [];
          a.goal = goal;
          a.lastT = t;
        } else if (a.goal.key !== goal.key) {
          a.route = manual || reduce ? [] : routeBetween(a, a.goal, goal);
          if (!a.route.length) a.pos.set(goal.x, 0, goal.z);
          a.goal = goal;
        }
        const dt = Math.min(0.1, Math.max(0, t - a.lastT));
        a.lastT = t;
        let walking = false;
        if (a.route.length) {
          walking = true;
          let left = WALK_SPEED * dt;
          while (left > 0 && a.route.length) {
            const nx = a.route[0]!;
            const dx = nx.x - a.pos.x, dz = nx.z - a.pos.z, dist = Math.hypot(dx, dz);
            if (dist <= left) { a.pos.copy(nx); a.route.shift(); left -= dist; }
            else { a.pos.x += (dx / dist) * left; a.pos.z += (dz / dist) * left; left = 0; }
            if (dist > 1e-4) a.root.rotation.set(0, Math.atan2(-dx, -dz), 0);
          }
          if (!a.route.length) walking = false;
        }
        const pose: Spot = walking ? 'meja' : goal.pose;
        a.root.visible = walking || pose !== 'rumah';
        a.root.position.set(a.pos.x, 0, a.pos.z);
        if (!walking) a.root.rotation.set(0, goal.rot, 0);
        const atDesk = !walking && pose === 'meja';
        if (!atDesk) {
          sm.emissive.set('#2a2340');
          sm.emissiveIntensity = 0.25;
          a.lamp.visible = false;
        }
        a.mug.visible = true;
        a.handMug.visible = false;
        const s = Math.sin(t * 9 + a.phase);
        const sitBase = () => {
          a.legL.position.y = a.legR.position.y = 0.62;
          a.legL.rotation.set(-1.4, 0, 0);
          a.legR.rotation.set(-1.4, 0, 0);
          a.legL.position.z = a.legR.position.z = 0;
          a.body.position.set(0, 0.92, 0);
          a.body.rotation.set(0, 0, 0);
          a.head.position.set(0, 1.42 + hk, 0);
          a.armL.position.set(-0.29, 1.12, 0);
          a.armR.position.set(0.29, 1.12, 0);
        };
        const standBase = () => {
          a.legL.position.set(-0.11, 0.7, 0);
          a.legR.position.set(0.11, 0.7, 0);
          a.legL.rotation.set(0, 0, 0);
          a.legR.rotation.set(0, 0, 0);
          a.body.position.set(0, 0.98, 0);
          a.body.rotation.set(0, 0, 0);
          a.head.position.set(0, 1.48 + hk, 0);
          a.head.rotation.set(0, 0, 0);
          a.armL.position.set(-0.29, 1.18, 0);
          a.armR.position.set(0.29, 1.18, 0);
          a.armL.rotation.set(0, 0, 0.08);
          a.armR.rotation.set(0, 0, -0.08);
        };
        const labelY = (h: number) => a.label.set(a.pos.x, h + hk * 2, a.pos.z);
        if (walking) {
          standBase();
          const bob = 0.03 * Math.abs(s);
          a.body.position.y += bob;
          a.head.position.y += bob;
          a.legL.rotation.set(0.6 * s, 0, 0);
          a.legR.rotation.set(-0.6 * s, 0, 0);
          a.armL.rotation.set(-0.5 * s, 0, 0.08);
          a.armR.rotation.set(0.5 * s, 0, -0.08);
          labelY(1.95);
          continue;
        }
        if (pose === 'rumah') continue;
        if (pose === 'kopi') {
          // Standing at the coffee bar with a mug, sipping now and then.
          standBase();
          const k = Math.max(0, Math.sin(t * 0.7 + a.phase));
          a.handMug.visible = true;
          a.mug.visible = false;
          a.armR.rotation.set(-0.7 - 1.5 * k, 0, -0.25 * k);
          a.armL.rotation.set(-0.2, 0, 0.1);
          a.head.rotation.set(-0.2 * k, 0.3 * Math.sin(t * 0.3 + a.phase), 0);
          labelY(1.95);
          continue;
        }
        if (pose === 'musholla') {
          prayer(a, (t + a.phase * 3) % 24, hk);
          labelY(a.root.position.y < -0.1 ? 1.35 : 1.95);
          continue;
        }
        sitBase();
        a.root.position.y = pose === 'lounge' ? -0.05 : 0;
        if (pose === 'makan') {
          a.armL.rotation.set(-0.95, 0, 0.12);
          a.armR.rotation.set(-1.0 - 0.45 * Math.max(0, Math.sin(t * 1.8 + a.phase)), 0, -0.12);
          a.head.rotation.set(0.15, 0.25 * Math.sin(t * 0.4 + a.phase), 0);
          labelY(1.75);
          continue;
        }
        if (pose === 'rapat') {
          a.armL.rotation.set(-0.8, 0, 0.12);
          a.armR.rotation.set(-0.8 - 0.6 * Math.max(0, Math.sin(t * 0.9 + a.phase)), 0, -0.12);
          a.head.rotation.set(0, 0.55 * Math.sin(t * 0.25 + a.phase), 0);
          labelY(1.75);
          continue;
        }
        if (pose === 'lounge') {
          a.body.rotation.set(0.15, 0, 0);
          a.armL.rotation.set(-0.5, 0, 0.15);
          a.armR.rotation.set(-1.35, 0, -0.05);
          a.head.rotation.set(0.3, 0.1 * Math.sin(t * 0.3 + a.phase), 0);
          labelY(1.7);
          continue;
        }

        // At the desk. Small, believable motions only (office.ts fidgetAt).
        a.label.set(a.seat.x, (cinematic ? 1.75 : 2.1) + hk * 2, a.seat.z);
        const fid = act === 'siaga' && !reduce ? fidgetAt(a.key, t) : { fidget: 'layar' as const, k: 0 };
        a.handMug.visible = fid.fidget === 'minum' && fid.k > 0.15;
        a.mug.visible = !a.handMug.visible;
        sitBase();
        if (reduce) continue;
        if (busy) {
          // Typing: both hands on the keyboard, small head movements toward the screen.
          a.armL.rotation.set(-1.15 + 0.12 * Math.sin(t * 16 + a.phase), 0, 0.1);
          a.armR.rotation.set(-1.15 + 0.12 * Math.sin(t * 16 + a.phase + 2), 0, -0.1);
          a.body.position.y = 0.92 + 0.012 * Math.abs(s);
          a.head.rotation.set(0.1 + 0.04 * Math.sin(t * 3 + a.phase), 0.08 * Math.sin(t * 1.3 + a.phase), 0);
        } else if (act === 'menunggu') {
          // Waiting for the Director: turns toward you and raises a hand now and then.
          const wave = Math.max(0, Math.sin(t * 0.9 + a.phase));
          a.armL.rotation.set(-0.5, 0, 0.12);
          a.armR.rotation.set(-0.6 - 2.3 * wave, 0, -0.15 - 0.25 * wave * Math.sin(t * 7));
          a.head.rotation.set(-0.05, 0.35, 0);
          a.body.rotation.set(0, 0.2, 0);
        } else if (act === 'kendala') {
          // Stuck: hands on the head, leaning forward.
          a.armL.rotation.set(-2.35, 0, 0.55);
          a.armR.rotation.set(-2.35, 0, -0.55);
          a.head.rotation.set(0.35 + 0.05 * Math.sin(t * 1.5 + a.phase), 0.15 * Math.sin(t * 0.7), 0);
          a.body.position.y = 0.9;
        } else if (act === 'belajar') {
          a.armL.rotation.set(-0.9, 0, 0.2);
          a.armR.rotation.set(-0.9 + 0.2 * Math.max(0, Math.sin(t * 0.8 + a.phase)), 0, -0.2);
          a.head.rotation.set(0.38 + 0.04 * Math.sin(t * 1.2 + a.phase), 0.32, 0);
        } else {
          // Available: reading the screen, scrolling, with an occasional sip, stretch, glance or note.
          const k = fid.k;
          a.armL.rotation.set(-0.95, 0, 0.12);
          a.armR.rotation.set(-0.95 + 0.06 * Math.sin(t * 2.2 + a.phase), 0, -0.12);
          a.head.rotation.set(0.05, 0.12 * Math.sin(t * 0.35 + a.phase), 0);
          a.body.position.y = 0.92 + 0.008 * Math.sin(t * 1.6 + a.phase);
          if (fid.fidget === 'minum') {
            a.armR.rotation.set(-0.95 - 1.35 * k, 0, -0.12 - 0.35 * k);
            a.head.rotation.set(-0.25 * k, 0, 0);
          } else if (fid.fidget === 'regang') {
            a.armL.rotation.set(-0.95 - 2.1 * k, 0, 0.12 + 0.25 * k);
            a.armR.rotation.set(-0.95 - 2.1 * k, 0, -0.12 - 0.25 * k);
            a.head.rotation.set(-0.3 * k, 0, 0);
            a.body.position.y = 0.92 + 0.03 * k;
          } else if (fid.fidget === 'tengok') {
            a.head.rotation.set(0, (a.index % 2 ? -1 : 1) * 0.9 * k, 0);
            a.body.rotation.set(0, (a.index % 2 ? -1 : 1) * 0.25 * k, 0);
          } else if (fid.fidget === 'catat') {
            a.armR.rotation.set(-0.75 + 0.08 * Math.sin(t * 12), 0, -0.05);
            a.head.rotation.set(0.35 * k, 0, 0);
          }
        }
      }
    };

    const draw = (t: number) => {
      placeCamera(t);
      applyState(t);
      renderer.render(scene, camera);
      for (const a of actors) {
        const node = anchors.current?.get(a.key);
        if (node) node.style.visibility = a.root.visible ? '' : 'hidden';
        place(node, inti.localToWorld(labelAt.set(a.label.x, a.label.y, a.label.z)));
      }
      place(boardAnchor.current, inti.localToWorld(boardAt.set(BOARD.x, 2.75, Z0 + 0.1)));
      for (const r of ROOM_LABELS) place(roomAnchors?.current?.get(r.key), inti.localToWorld(labelAt.set(r.x, r.y, r.z)));
      live.current.dirty = false;
    };
    let lastT = 0;
    if (drive) drive.current = (t: number) => draw((lastT = t));
    if (manual) redraw = () => draw(lastT);

    let raf = 0;
    let running = true;
    let visible = true;
    let last = 0;
    const minGap = touch ? 1000 / 30 : 0;
    const start = performance.now();
    const frame = (now: number) => {
      raf = 0;
      if (!running || !visible || document.hidden) return;
      if (now - last >= minGap) {
        last = now;
        draw((now - start) / 1000);
      }
      if (!reduce) raf = requestAnimationFrame(frame);
    };
    const kick = () => {
      if (!manual && !raf && running) raf = requestAnimationFrame(frame);
    };
    const poll = reduce ? window.setInterval(() => live.current.dirty && kick(), 250) : 0;
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      if (visible) kick();
    });
    io.observe(el);
    const onVis = () => !document.hidden && kick();
    document.addEventListener('visibilitychange', onVis);
    renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      onFail?.();
    });
    if (manual) draw(0);
    kick();
    onReady?.();

    return () => {
      running = false;
      if (drive) drive.current = null;
      if (raf) cancelAnimationFrame(raf);
      window.clearInterval(poll);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerUp);
      canvas.removeEventListener('pointercancel', pointerUp);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('dblclick', resetOrbit);
      for (const d of disposables) d.dispose();
      K.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
    // The scene is built once per set of desks; their state is read live from `live`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desks.map((d) => d.desk.key).join(','), cinematic, manual, gaya]);

  return <div ref={host} className="ko-canvas" />;
}
