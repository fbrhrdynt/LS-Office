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
  Plane,
  PointLight,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { buatKitGaya } from './gaya';
import type { Dunia, Peran } from './gaya/alat';
import { fidgetAt, type DeskState, type Spot } from './office';
import { BEDROOMS, BOUNDS, ENTRANCE_PLACE, MESS, MESS_COMMON, MESS_HALL, OFFICE_ROOMS, PLACES, ROOMS, bedroomOf, deskVia, roomByKey, roomCenter, route, type Place, type Room } from './layout';

/*
 * Kantor AI 3D (Three.js): kampus 3 x 3 ruangan (src/layout.ts). Bentuk dan bahan datang dari gaya aktif (src/gaya);
 * tanpa model 3D, tekstur dari kanvas, supaya ringan di HP. Label adalah HTML di atas kanvas yang dipindah tiap frame.
 * Kamera: geser (1 jari / drag kiri), zoom ke titik (pinch / scroll), putar (2 jari memutar / drag kanan / shift+drag),
 * fokus & ikuti karyawan, lompat ke ruangan, tur otomatis opsional. `manual` (rekam): frame digambar lewat `drive`.
 */

export interface OfficeControls {
  focusPerson(key: string): void;
  focusRoom(key: string): void;
  overview(): void;
  setTour(on: boolean): void;
}

export interface SceneProps {
  desks: readonly DeskState[];
  night: boolean;
  boardCount: number;
  anchors: React.RefObject<Map<string, HTMLElement>>;
  roomAnchors?: React.RefObject<Map<string, HTMLElement>>;
  boardAnchor: React.RefObject<HTMLElement | null>;
  controls?: React.RefObject<OfficeControls | null>;
  /** Camera mode changes (for HUD buttons). */
  onCamera?: (state: { following: string | null; tour: boolean; zoomed: boolean }) => void;
  cinematic?: boolean;
  manual?: boolean;
  drive?: React.RefObject<((t: number) => void) | null>;
  onReady?: () => void;
  onFail?: () => void;
  gaya?: string;
}

const shade = (hex: string, f: number) => {
  const c = new Color(hex);
  c.multiplyScalar(f);
  return `#${c.getHexString()}`;
};
const SKIN = ['#f1c7a5', '#d9a07b', '#c68863', '#e8b896', '#b97a56', '#f0c09c'];
const HAIR = ['#2b1d16', '#1b1330', '#5a3825', '#2b1d16', '#7a4a2a', '#1b1330'];
const BOARD = { x: 0, z: -2.3 };
const WALK_SPEED = 1.7;

interface Goal { key: string; place: Place; pose: Spot }
interface Actor {
  key: string;
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
  roomKey: string;
  pos: Vector3;
  path: Vector3[];
  goal: Goal | null;
  lastT: number;
  label: Vector3;
  phase: number;
  index: number;
}

export default function OfficeScene({ desks, night, boardCount, anchors, roomAnchors, boardAnchor, controls, onCamera, cinematic, manual, drive, onReady, onFail, gaya }: SceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef({ desks, night, boardCount, dirty: true });
  live.current = { desks, night, boardCount, dirty: true };
  const camCb = useRef(onCamera);
  camCb.current = onCamera;

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
    if (cinematic && K.kabut) scene.fog = new Fog(K.kabut[0], 60, 110);
    const kantor = new Group();
    scene.add(kantor);
    const inti = new Group();
    kantor.add(inti);
    const camera = new OrthographicCamera(-10, 10, 6, -6, 0.1, 200);

    const C = K.cahaya;
    const hemi = new HemisphereLight(C.langit, C.bumi, C.kuat);
    const sun = new DirectionalLight(C.matahari, C.mKuat);
    sun.position.set(-10, 20, 12);
    const amb = new AmbientLight('#ffffff', 0.35);
    scene.add(hemi, sun, amb);

    const disposables: { dispose(): void }[] = [];
    const geo = <T extends BufferGeometry>(g: T) => (disposables.push(g), g);
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

    /* ================================================================== the campus */
    const { x0: X0, x1: X1, z0: Z0, z1: Z1 } = BOUNDS;
    const W = X1 - X0, D = Z1 - Z0;
    const wallM = mat('#fbf6ef', 'dinding');
    const wallSideM = mat('#f1e8dc', 'dinding');
    const trimM = mat('#271b3f', 'bingkai');
    const woodM = mat('#a87c56', 'kayu');
    const darkWoodM = mat('#5b4636', 'kayu');
    const glassM = mat('#bfe3ff', 'kaca', '#7fb8e6');
    const lineM = mat('#cdb79c', 'garis');
    const chairM = mat('#3a2a5c', 'kursi');
    const legM = mat('#4b3b62', 'kaki');
    const potM = mat('#c26b3b', 'pot');
    const leafM = mat('#3f9b4f', 'daun');
    const leaf2M = mat('#5bbf5e', 'daun');
    const sofaM = mat('#5b4a72', 'sofa');
    const sofaBackM = mat('#3a2a5c', 'sofa');
    const paperM = mat('#efe9f6', 'kertas');
    const whiteM = mat('#ffffff', 'kertas');

    box(W + 1.2, 0.5, D + 1.2, mat('#3a2a5c', 'alas'), 0, -0.4, 0);
    const hallM = mat('#e9dfd2', 'lantai');
    box(W, 0.12, D, hallM, 0, -0.08, 0);
    const floors: { m: ReturnType<typeof mat>; day: string; night: string }[] = [{ m: hallM, day: '#e9dfd2', night: shade('#e9dfd2', 0.32) }];
    for (let z = Z0 + 0.6; z < Z1; z += 1.2) box(W - 0.1, 0.004, 0.02, lineM, 0, -0.015, z);
    // Mess karyawan (east): its own base and corridor, joined to the office by a covered walkway (z = 3.7).
    const MW = MESS.x1 - MESS.x0, MD = MESS.z1 - MESS.z0, MX = (MESS.x0 + MESS.x1) / 2;
    box(MW + 1.2, 0.5, MD + 1.2, mat('#3a2a5c', 'alas'), MX, -0.4, 0);
    box(MW, 0.12, MD, hallM, MX, -0.08, 0);
    box(MESS.x0 - X1 + 0.2, 0.12, 1.4, hallM, (X1 + MESS.x0) / 2, -0.08, 3.7);
    box(MESS.x0 - X1 + 0.2, 0.08, 1.6, trimM, (X1 + MESS.x0) / 2, 2.4, 3.7);
    for (const x of [X1 + 0.3, MESS.x0 - 0.3]) for (const z of [3.0, 4.4]) box(0.1, 2.4, 0.1, trimM, x, 1.2, z);
    box(MW, 3, 0.2, wallM, MX, 1.5, Z0 - 0.1);
    box(MW, 0.12, 0.24, woodM, MX, 0.06, Z0 - 0.02);

    // Outer walls on the far sides (back and left); the near sides stay open like a dollhouse.
    box(W, 3, 0.2, wallM, 0, 1.5, Z0 - 0.1);
    box(0.2, 3, D, wallSideM, X0 - 0.1, 1.5, 0);
    box(W, 0.12, 0.24, woodM, 0, 0.06, Z0 - 0.02);
    box(0.24, 0.12, D, woodM, X0 + 0.02, 0.06, 0);
    const windowAt = (x: number, z: number, alongX: boolean) => {
      if (alongX) {
        box(1.7, 1.25, 0.06, trimM, x, 1.85, z);
        box(1.54, 1.08, 0.04, glassM, x, 1.85, z + 0.03);
      } else {
        box(0.06, 1.25, 1.7, trimM, x, 1.85, z);
        box(0.04, 1.08, 1.54, glassM, x + 0.03, 1.85, z);
      }
    };
    for (const x of [-10.6, -7.0, -1.8, 1.8, 7.0, 10.6]) windowAt(x, Z0 + 0.02, true);
    for (const z of [-7.4, 6.0, 8.8]) windowAt(X0 + 0.02, z, false);

    // Rooms: floor, low partitions (or glass) with a door gap, a coloured sign strip on the back wall.
    const wallSeg = (x0: number, z0: number, x1: number, z1: number, glass: boolean) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 0.05) return;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, alongX = Math.abs(z1 - z0) < 0.01;
      if (glass) {
        box(alongX ? len : 0.08, 0.08, alongX ? 0.08 : len, trimM, cx, 1.45, cz);
        box(alongX ? len : 0.04, 1.35, alongX ? 0.04 : len, glassM, cx, 0.75, cz);
        box(alongX ? len : 0.1, 0.1, alongX ? 0.1 : len, trimM, cx, 0.05, cz);
      } else {
        box(alongX ? len : 0.12, 1.15, alongX ? 0.12 : len, wallSideM, cx, 0.57, cz);
        box(alongX ? len : 0.16, 0.06, alongX ? 0.16 : len, woodM, cx, 1.17, cz);
      }
    };
    type Side = 'front' | 'back' | 'left' | 'right';
    const side = (r: Room, s: Side) => {
      const outer = (s === 'back' && r.z0 <= Z0 + 0.01) || (s === 'left' && r.x0 <= X0 + 0.01);
      if (outer || r.door === 'open') return;
      const pts: Record<Side, [number, number, number, number]> = {
        front: [r.x0, r.z1, r.x1, r.z1], back: [r.x0, r.z0, r.x1, r.z0], left: [r.x0, r.z0, r.x0, r.z1], right: [r.x1, r.z0, r.x1, r.z1],
      };
      const [ax, az, bx, bz] = pts[s];
      const lobbyFront = r.key === 'lobby' && s === 'front';
      const isDoor = r.door === s || lobbyFront;
      if (!isDoor) return wallSeg(ax, az, bx, bz, !!r.glass);
      const c = lobbyFront ? 0 : r.doorAt;
      const w = r.key === 'lobby' ? (lobbyFront ? 1.8 : 3.0) : 1.3;
      if (az === bz) { wallSeg(ax, az, c - w / 2, az, !!r.glass); wallSeg(c + w / 2, az, bx, az, !!r.glass); }
      else { wallSeg(ax, az, ax, c - w / 2, !!r.glass); wallSeg(ax, c + w / 2, ax, bz, !!r.glass); }
    };
    for (const r of ROOMS) {
      const m = mat(r.floor, 'lantai');
      box(r.x1 - r.x0 - 0.06, 0.02, r.z1 - r.z0 - 0.06, m, (r.x0 + r.x1) / 2, 0.0, (r.z0 + r.z1) / 2);
      floors.push({ m, day: r.floor, night: shade(r.floor, 0.32) });
      for (const s of ['front', 'back', 'left', 'right'] as const) side(r, s);
      if (r.z0 <= Z0 + 0.01 && !r.key.startsWith('kamar')) box(1.6, 0.26, 0.04, mat(r.accent, 'catatan', r.accent), (r.x0 + r.x1) / 2, 2.75, Z0 + 0.03);
    }

    // Shared furniture helpers.
    const plant = (x: number, z: number, s = 1) => {
      add(cyl(0.2 * s, 0.16 * s, 0.4 * s, potM), x, 0.2 * s, z);
      add(cone(0.34 * s, 0.9 * s, leafM), x, 0.85 * s, z);
      add(ball(0.26 * s, leaf2M), x + 0.12 * s, 0.7 * s, z + 0.1 * s);
    };
    const shelf = (x: number, z: number, rot = 0) => {
      const g = new Group();
      box(1.2, 1.8, 0.36, woodM, 0, 0.9, 0, g);
      const bookColors = ['#e4572e', '#2a9d8f', '#f2b134', '#3a86ff', '#8e6bd8', '#ff5d8f'];
      for (let row = 0; row < 3; row++) for (let i = 0; i < 6; i++) box(0.14, 0.34, 0.26, mat(bookColors[(i + row) % 6]!, 'buku'), -0.45 + i * 0.18, 0.4 + row * 0.55, 0.04, g);
      g.position.set(x, 0, z);
      g.rotation.y = rot;
      inti.add(g);
    };
    const rug = (x: number, z: number, w: number, d: number, c: string) => box(w, 0.02, d, mat(c, 'karpet'), x, 0.022, z);
    const chair = (x: number, z: number, rot: number, m: Material = chairM) => {
      const g = new Group();
      box(0.44, 0.06, 0.44, m, 0, 0.47, 0, g);
      box(0.44, 0.5, 0.06, m, 0, 0.74, 0.22, g);
      g.position.set(x, 0, z);
      g.rotation.y = rot;
      inti.add(g);
    };
    const sofa = (x: number, z: number, len: number, rot: number) => {
      const g = new Group();
      box(len, 0.42, 0.72, sofaM, 0, 0.21, 0, g);
      box(len, 0.55, 0.2, sofaBackM, 0, 0.62, 0.32, g);
      box(0.18, 0.55, 0.72, sofaBackM, -len / 2, 0.45, 0, g);
      box(0.18, 0.55, 0.72, sofaBackM, len / 2, 0.45, 0, g);
      g.position.set(x, 0, z);
      g.rotation.y = rot;
      inti.add(g);
    };
    const pendant: Mesh[] = [];
    const lampAt = (x: number, z: number) => {
      box(0.02, 0.8, 0.02, trimM, x, 3.2, z);
      pendant.push(add(cone(0.32, 0.3, mat('#271b3f', 'lampu', '#000000'), true), x, 2.7, z));
    };

    // Creative Studio: moodboard, shelf, rug.
    const cr = roomByKey('creative');
    rug(-8.8, -7.5, 3.2, 3.6, '#e4572e');
    box(2.4, 1.2, 0.06, mat('#f7f2ea', 'papan'), -8.8, 1.9, Z0 + 0.06);
    for (let i = 0; i < 6; i++) box(0.5, 0.36, 0.02, mat(['#ffd166', '#f3355b', '#7bdff2', '#b2f7ef', '#f7aef8', '#cdb4db'][i]!, 'catatan'), -9.7 + (i % 3) * 0.85, 2.1 - Math.floor(i / 3) * 0.5, Z0 + 0.1);
    shelf(cr.x0 + 0.35, -5.6, Math.PI / 2);
    plant(cr.x1 - 0.5, cr.z0 + 0.5, 1.1);
    // Ruang Direksi: executive desk, bookcases, sofa set (Alex coordinates from here).
    box(2.2, 0.08, 0.95, darkWoodM, 0, 0.8, -8.5);
    box(2.0, 0.76, 0.8, darkWoodM, 0, 0.38, -8.5);
    box(0.7, 0.45, 0.05, trimM, 0, 1.12, -8.85);
    box(0.62, 0.36, 0.01, mat('#1b1330', 'layar', '#3a86ff'), 0, 1.12, -8.82);
    chair(0, -7.7, Math.PI, mat('#271b3f', 'kursi'));
    shelf(-2.6, -9.9);
    shelf(2.6, -9.9);
    sofa(0, -5.4, 2.2, Math.PI);
    box(1.1, 0.3, 0.55, woodM, 0, 0.15, -6.3);
    plant(-3.2, -5.0, 1.0);
    // Web Dev: server rack, whiteboard.
    const wd = roomByKey('webdev');
    rug(8.8, -7.5, 3.2, 3.6, '#3a86ff');
    box(0.7, 1.9, 0.7, trimM, wd.x1 - 0.5, 0.95, Z0 + 0.5);
    for (let i = 0; i < 5; i++) box(0.6, 0.06, 0.02, mat('#66e3a5', 'layar', '#66e3a5'), wd.x1 - 0.5, 0.4 + i * 0.32, Z0 + 0.86);
    box(2.2, 1.1, 0.05, whiteM, 8.8, 1.85, Z0 + 0.06);
    plant(wd.x0 + 0.5, wd.z0 + 0.5, 1.0);
    // Musholla: carpet, sajadah per place, mihrab on the qibla wall, Quran shelf, wudhu corner, shoe rack outside.
    const mu = roomByKey('musholla');
    rug((mu.x0 + mu.x1) / 2 - 0.3, 0, 5.6, 4.6, '#2f7d5b');
    const sajadah = ['#b23a48', '#2a6f97', '#c08b2c'];
    PLACES.musholla.forEach((p, i) => box(0.95, 0.015, 0.5, mat(sajadah[i % 3]!, 'karpet'), p.x - 0.3, 0.04, p.z));
    box(0.06, 1.9, 1.3, mat('#e9d8a6', 'papan'), X0 + 0.04, 1.15, 0);
    box(0.06, 0.6, 0.8, mat('#2f7d5b', 'catatan', '#1d5a40'), X0 + 0.07, 1.6, 0);
    box(0.32, 0.75, 1.0, woodM, mu.x1 - 0.5, 0.37, mu.z0 + 0.7);
    for (let i = 0; i < 4; i++) box(0.24, 0.28, 0.06, mat(['#2f7d5b', '#8c2f39', '#2a6f97', '#c08b2c'][i]!, 'buku'), mu.x1 - 0.5, 0.88, mu.z0 + 0.4 + i * 0.14);
    box(1.0, 0.8, 0.45, mat('#dfe6ea', 'kertas'), mu.x1 - 1.0, 0.4, mu.z1 - 0.4);
    box(1.0, 0.32, 0.3, woodM, mu.x1 + 0.45, 0.16, 1.2);
    // Atrium & Lounge: Mission Board, sofas, coffee table, a small pond and plants.
    box(3.2, 1.6, 0.1, trimM, BOARD.x, 1.75, BOARD.z);
    box(3.0, 1.4, 0.04, mat('#f7f2ea', 'papan'), BOARD.x, 1.75, BOARD.z + 0.06);
    box(0.12, 1.0, 0.12, trimM, BOARD.x - 1.4, 0.5, BOARD.z);
    box(0.12, 1.0, 0.12, trimM, BOARD.x + 1.4, 0.5, BOARD.z);
    const noteColors = ['#ffd166', '#f3355b', '#7bdff2', '#b2f7ef', '#f7aef8', '#cdb4db', '#ffd166', '#7bdff2'];
    const notes = noteColors.map((c, i) => {
      const n = box(0.5, 0.4, 0.02, mat(c, 'catatan', c), BOARD.x - 1.05 + (i % 4) * 0.7, 2.12 - Math.floor(i / 4) * 0.6, BOARD.z + 0.1);
      (n.material as MeshLambertMaterial).emissiveIntensity = K.selaluMalam ? 0.7 : 0.2;
      n.rotation.z = ((i * 37) % 7) / 60 - 0.05;
      return n;
    });
    rug(-0.6, 1.2, 4.2, 2.6, '#d97757');
    sofa(-0.8, 2.15, 2.6, 0);
    sofa(2.4, 1.3, 1.6, Math.PI / 2);
    box(1.2, 0.3, 0.6, woodM, -0.8, 0.15, 1.0);
    add(cyl(0.06, 0.05, 0.1, whiteM), -1.0, 0.36, 1.0);
    box(2.0, 0.12, 1.3, mat('#7a5c40', 'batu'), -2.4, 0.06, -0.9);
    box(1.8, 0.06, 1.1, mat('#5fb7d6', 'kaca', '#2f8fb0'), -2.4, 0.13, -0.9);
    plant(-3.3, -2.5, 1.3);
    plant(3.3, -2.5, 1.3);
    plant(-3.3, 2.6, 0.9);
    // Ruang Rapat: long table, chairs per place, TV.
    const ra = roomByKey('rapat');
    box(3.0, 0.07, 1.3, darkWoodM, 9.0, 0.74, 0);
    box(2.7, 0.7, 1.0, legM, 9.0, 0.36, 0);
    for (const p of PLACES.rapat) chair(p.x, p.z, p.rot + Math.PI);
    box(0.08, 1.15, 2.0, trimM, ra.x1 - 0.3, 1.6, 0);
    box(0.04, 1.0, 1.84, mat('#1b1330', 'layar', '#3a86ff'), ra.x1 - 0.35, 1.6, 0);
    plant(ra.x1 - 0.5, ra.z1 - 0.5, 1.0);
    // Pantry & Kopi: counter, coffee machine, fridge, dining table.
    const pa = roomByKey('pantry');
    box(0.6, 0.95, 3.0, woodM, X0 + 0.35, 0.47, 6.3);
    box(0.64, 0.05, 3.04, mat('#ece6dc', 'meja'), X0 + 0.35, 0.97, 6.3);
    box(0.36, 0.46, 0.32, trimM, X0 + 0.35, 1.22, 5.1);
    for (const z of [5.6, 6.6, 7.4]) add(cyl(0.05, 0.045, 0.1, whiteM), X0 + 0.48, 1.05, z);
    box(0.7, 1.8, 0.62, mat('#dfe6ea', 'kertas'), pa.x1 - 0.5, 0.9, pa.z1 - 0.45);
    box(2.6, 0.07, 0.9, mat('#c9a27c', 'meja'), -8.8, 0.74, 7.65);
    for (const [lx, lz] of [[-9.9, 7.3], [-7.7, 7.3], [-9.9, 8.0], [-7.7, 8.0]] as const) box(0.06, 0.72, 0.06, woodM, lx, 0.36, lz);
    for (const p of PLACES.makan) chair(p.x, p.z, p.rot + Math.PI, mat('#8c5a3c', 'kursi'));
    plant(pa.x1 - 0.5, pa.z0 + 0.6, 0.9);
    // Lobby: reception desk, waiting sofa, entrance doors, welcome mat.
    box(2.4, 1.0, 0.7, darkWoodM, -1.9, 0.5, 8.3);
    box(2.5, 0.06, 0.8, mat('#f2b134', 'meja'), -1.9, 1.02, 8.3);
    sofa(2.4, 8.6, 1.8, Math.PI / 2);
    plant(-3.2, 9.8, 1.2);
    plant(3.2, 9.8, 1.2);
    box(0.12, 2.4, 0.12, trimM, -0.9, 1.2, Z1);
    box(0.12, 2.4, 0.12, trimM, 0.9, 1.2, Z1);
    box(1.92, 0.14, 0.14, trimM, 0, 2.4, Z1);
    box(1.6, 0.02, 1.0, mat('#8c5a3c', 'karpet'), 0, 0.02, Z1 + 0.6);
    // Marketing & Analytics: KPI screen, rug.
    const mk = roomByKey('marketing');
    rug(8.8, 7.7, 3.2, 3.4, '#35b8a5');
    box(0.08, 1.0, 1.8, trimM, mk.x1 - 0.3, 1.7, 7.4);
    box(0.04, 0.86, 1.66, mat('#1b1330', 'layar', '#f2b134'), mk.x1 - 0.35, 1.7, 7.4);
    plant(mk.x1 - 0.5, mk.z1 - 0.5, 1.0);
    for (const r of [...OFFICE_ROOMS, MESS_COMMON]) { const c = roomCenter(r); lampAt(c.x, c.z); }
    for (const z of [-7.0, 0, 7.0]) lampAt(MESS_HALL, z);
    // Mess common room: TV on the west wall, two sofas and stools facing it, fridge and a dining counter.
    const mc = MESS_COMMON;
    rug(16.3, 7.4, 2.6, 5.4, '#c26b3b');
    box(0.08, 0.9, 1.6, trimM, mc.x0 + 0.08, 1.45, 7.4);
    box(0.04, 0.78, 1.46, mat('#1b1330', 'layar', '#3a86ff'), mc.x0 + 0.13, 1.45, 7.4);
    box(0.5, 0.5, 1.8, woodM, mc.x0 + 0.3, 0.25, 7.4);
    sofa(16.3, 5.65, 2.2, Math.PI / 2);
    sofa(16.3, 9.15, 2.2, Math.PI / 2);
    for (const p of PLACES.mess.slice(6)) { add(cyl(0.24, 0.26, 0.45, mat('#f2b134', 'sofa')), p.x + 0.05, 0.22, p.z); }
    box(0.7, 1.8, 0.62, mat('#dfe6ea', 'kertas'), mc.x1 - 0.5, 0.9, mc.z0 + 0.45);
    plant(mc.x1 - 0.45, mc.z1 - 0.45, 0.9);
    // Bedrooms: bed along the outer wall (pillow at the far end), blanket, nightstand + lamp, wardrobe, small desk.
    const blankets = ['#3a86ff', '#e4572e', '#2a9d8f', '#8e6bd8', '#f2b134', '#ff5d8f', '#35b8a5', '#c26b3b', '#5b4a72'];
    BEDROOMS.forEach((r, i) => {
      const b = bedroomOf(i).bed;
      const hd = b.headDir;
      box(2.1, 0.32, 1.06, darkWoodM, b.x, 0.16, b.z);
      box(2.0, 0.18, 1.0, whiteM, b.x, 0.41, b.z);
      box(0.12, 0.75, 1.1, darkWoodM, b.x + hd * 1.05, 0.37, b.z);
      box(0.4, 0.12, 0.7, mat('#f7f2ea', 'kertas'), b.x + hd * 0.72, 0.55, b.z);
      box(1.2, 0.06, 1.04, mat(blankets[i % blankets.length]!, 'karpet'), b.x - hd * 0.35, 0.53, b.z);
      const nx = b.x + hd * 0.75, nz = b.z + 0.85;
      box(0.42, 0.48, 0.4, woodM, nx, 0.24, nz);
      pendant.push(add(ball(0.11, mat('#fff3b0', 'lampu', '#000000')), nx, 0.62, nz));
      box(1.0, 1.9, 0.5, woodM, hd < 0 ? r.x1 - 0.6 : r.x0 + 0.6, 0.95, r.z0 + 0.32);
      box(0.9, 0.06, 0.5, mat('#c9a27c', 'meja'), b.x + hd * 0.4, 0.74, r.z1 - 0.35);
      box(0.06, 0.72, 0.44, woodM, b.x + hd * 0.4 - 0.4, 0.36, r.z1 - 0.35);
      box(0.06, 0.72, 0.44, woodM, b.x + hd * 0.4 + 0.4, 0.36, r.z1 - 0.35);
      rug(b.x - hd * 0.1, b.z + 1.0, 1.4, 0.7, '#cdb4db');
    });

    /* ================================================================== world (gaya paduan) & outside */
    let grassM: (Material & { color: Color }) | null = null;
    const dunia: Dunia = K.dunia?.({
      scene, kantor, K,
      pasang: (g, m, x, y, z, induk = kantor) => {
        const me = new Mesh(g, m);
        me.position.set(x, y, z);
        induk.add(me);
        return me;
      },
    }) ?? {};
    // World styles were designed around the original 14.6 m building: shrink the campus to fit.
    if (K.dunia) inti.scale.setScalar(0.5);
    const naik = dunia.tinggi ?? 0;
    kantor.position.y = naik;
    if (cinematic && !dunia.gantiLuar) {
      const L = K.luar;
      const size = Math.max(L.ukuran, 60);
      const grassMat = mat('#8cc672', 'tanah');
      grassM = grassMat;
      if (L.bentuk === 'bulat') add(cyl(size / 2, size / 2 + 0.3, 0.3, grassMat), 0, -0.8, 0, kantor);
      else box(size, 0.2, size, grassMat, 0, -0.75, 0, kantor);
      if (L.alas) box(size + 0.6, 0.7, size + 0.6, mat(L.alas, 'alas'), 0, -1.2, 0, kantor);
      const trunkM = mat('#7a4a2a', 'batang');
      const crownM = [mat('#4f9d4a', 'daun'), mat('#6dbb5a', 'daun'), mat('#f6a5c0', 'daun')];
      const tree = (x: number, z: number, s: number, c: number) => {
        add(cyl(0.12 * s, 0.16 * s, 1.0 * s, trunkM), x, -0.65 + 0.5 * s, z, kantor);
        add(ball(0.8 * s, crownM[c]!), x, -0.65 + 1.45 * s, z, kantor);
        add(ball(0.55 * s, crownM[c]!), x + 0.45 * s, -0.65 + 1.2 * s, z + 0.3 * s, kantor);
      };
      const spots: [number, number, number, number][] = [
        [-15.5, -12.5, 1.4, 0], [-9, -13.2, 1.2, 1], [-2, -13.4, 1.5, 2], [5, -13.0, 1.2, 0], [11.5, -13.3, 1.4, 1], [15.8, -11, 1.2, 2],
        [-16, -6, 1.3, 1], [-16.2, 0, 1.1, 2], [-15.8, 6, 1.4, 0], [-15.5, 11.5, 1.2, 1], [-8, 13.6, 1.1, 2], [8, 13.6, 1.1, 0],
        [26, -8, 1.2, 0], [26.2, 1, 1.3, 2], [25.6, 9.8, 1.1, 1], [19, -13.2, 1.3, 1], [19, 13.4, 1.1, 2],
      ];
      for (const [x, z, s2, c] of spots) if (Math.abs(x) < size / 2 - 0.8 && Math.abs(z) < size / 2 - 0.8) tree(x, z, s2, c);
      const stoneM = mat('#d8cfc2', 'batu');
      for (let i = 0; i < 6; i++) {
        const st = add(cyl(0.38, 0.4, 0.06, stoneM), (i % 2) * 0.3 - 0.15, -0.63, Z1 + 1.6 + i * 0.8, kantor);
        st.scale.set(1, 1, 0.7);
      }
      if (L.awan) {
        const awanM = mat('#ffffff', 'awan');
        for (const [cx, cy, cz] of [[-9, 9, -18], [6, 10, -19], [17, 8.5, -10]] as const) {
          add(ball(1.1, awanM), cx, cy, cz, kantor);
          add(ball(0.8, awanM), cx + 1.1, cy - 0.2, cz, kantor);
          add(ball(0.75, awanM), cx - 1.1, cy - 0.22, cz, kantor);
        }
      }
    }

    /* ================================================================== desks and people */
    const shadowM = new MeshBasicMaterial({ color: '#1b1330', transparent: true, opacity: 0.14, depthWrite: false });
    disposables.push(shadowM);
    const nightLights = !!cinematic && !touch;
    const hk = 0.24 * (K.agen.kepala - 1);
    const actors: Actor[] = desks.map((d, i) => {
      const { x, z } = d.desk;
      const roomKey = ROOMS.find((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1)?.key ?? 'creative';
      const deskTop = box(1.4, 0.08, 0.76, mat('#c9a27c', 'meja', '#000000'), x, 0.78, z);
      box(1.3, 0.7, 0.05, legM, x, 0.38, z - 0.32);
      box(0.06, 0.74, 0.66, woodM, x - 0.64, 0.38, z);
      box(0.06, 0.74, 0.66, woodM, x + 0.64, 0.38, z);
      box(0.66, 0.44, 0.05, trimM, x - 0.05, 1.12, z - 0.22);
      const screen = box(0.6, 0.36, 0.01, mat('#1b1330', 'layar', '#000000'), x - 0.05, 1.12, z - 0.19);
      box(0.08, 0.16, 0.08, trimM, x - 0.05, 0.9, z - 0.22);
      if (roomKey === 'creative') box(0.36, 0.26, 0.04, trimM, x + 0.45, 1.02, z - 0.12).rotation.set(0, -0.5, 0);
      box(0.52, 0.02, 0.18, paperM, x - 0.05, 0.83, z + 0.08);
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
      const sh = add(new Mesh(geo(new CircleGeometry(0.95, 24)), shadowM), x, 0.03, z + 0.3);
      sh.rotation.x = -Math.PI / 2;
      const root = new Group();
      const seat = new Vector3(x, 0, z + 0.72);
      const shirt = mat(d.desk.color, 'baju');
      const pants = mat('#2b2340', 'celana');
      const skin = mat(SKIN[i % SKIN.length]!, 'kulit');
      const body = add(new Mesh(K.kapsul(0.23, 0.4, 'baju'), shirt), 0, 0.92, 0, root);
      body.scale.setScalar(K.agen.badan);
      const head = add(ball(0.22, skin), 0, 1.42 + hk, 0, root);
      const hair = add(ball(0.235, mat(HAIR[i % HAIR.length]!, 'rambut'), true), 0, 0.02, 0.02, head);
      hair.rotation.x = 0.35;
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
      const mugM = mat('#f7f2ea', 'kertas');
      const mug = add(cyl(0.055, 0.05, 0.11, mugM), x + 0.18, 0.88, z + 0.26);
      const handMug = add(cyl(0.055, 0.05, 0.11, mugM), 0, -0.44, 0.06, armR);
      handMug.visible = false;
      inti.add(root);
      root.position.copy(seat);
      return { key: d.desk.key, root, body, head, armL, armR, legL, legR, screen, deskTop, book, lamp, mug, handMug, light, seat, roomKey, pos: seat.clone(), path: [], goal: null, lastT: 0, label: new Vector3(), phase: i * 1.7, index: i };
    });

    /* ================================================================== camera */
    const reduce = !manual && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
    type Cam = { target: Vector3; yaw: number; pitch: number; zoom: number };
    const HOME: Cam = { target: new Vector3(K.dunia ? 0.4 : 5.4, 0.6, 0.3), yaw: Math.PI / 4, pitch: 0.62, zoom: 0.96 };
    const cam: Cam = { target: HOME.target.clone(), yaw: HOME.yaw, pitch: HOME.pitch, zoom: HOME.zoom };
    let anim: { from: Cam; to: Cam; t0: number; dur: number } | null = null;
    let following: Actor | null = null;
    let tour = !!manual;
    let tourIndex = 0;
    let tourNext = 0;
    let nowT = 0;
    let halfW = 14;
    const notify = () => camCb.current?.({ following: following?.key ?? null, tour, zoomed: cam.zoom > 1.15 || anim !== null });

    let redraw: (() => void) | null = null;
    const fit = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      const aspect = w / h;
      // Show the whole campus: wide enough for a portrait phone, tall enough for a wide screen.
      const span = K.dunia ? 9 * (dunia.lebar ?? 1) : aspect < 0.8 ? 21 : 19;
      halfW = Math.max(span * 0.62 * aspect, span);
      let halfH = halfW / aspect;
      if (halfH < span * 0.62) { halfH = span * 0.62; halfW = halfH * aspect; }
      camera.left = -halfW;
      camera.right = halfW;
      camera.top = halfH;
      camera.bottom = -halfH;
      camera.updateProjectionMatrix();
      live.current.dirty = true;
      redraw?.();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);

    const placeCamera = () => {
      const dist = 40;
      camera.position.set(
        cam.target.x + dist * Math.cos(cam.pitch) * Math.sin(cam.yaw),
        cam.target.y + naik + dist * Math.sin(cam.pitch),
        cam.target.z + dist * Math.cos(cam.pitch) * Math.cos(cam.yaw),
      );
      camera.lookAt(cam.target.x, cam.target.y + naik, cam.target.z);
      if (camera.zoom !== cam.zoom) {
        camera.zoom = cam.zoom;
        camera.updateProjectionMatrix();
      }
      camera.updateMatrixWorld();
    };
    const ease = (x: number) => x * x * (3 - 2 * x);
    const flyTo = (to: Partial<Cam>, dur = 0.9) => {
      anim = { from: { target: cam.target.clone(), yaw: cam.yaw, pitch: cam.pitch, zoom: cam.zoom }, to: { target: (to.target ?? cam.target).clone(), yaw: to.yaw ?? cam.yaw, pitch: to.pitch ?? cam.pitch, zoom: to.zoom ?? cam.zoom }, t0: nowT, dur };
      live.current.dirty = true;
      kick();
    };
    const worldOf = (x: number, y: number, z: number) => inti.localToWorld(new Vector3(x, y, z)).sub(new Vector3(0, naik, 0));
    const focusRoomKey = (key: string) => {
      const r = ROOMS.find((x) => x.key === key);
      if (!r) return;
      following = null;
      const c = roomCenter(r);
      flyTo({ target: worldOf(c.x, 0.6, c.z), zoom: K.dunia ? 2.6 : 2.3 });
      notify();
    };
    const focusActor = (a: Actor) => {
      following = a;
      flyTo({ target: worldOf(a.pos.x, 1.0, a.pos.z), zoom: K.dunia ? 5.5 : 4.2 });
      notify();
    };
    const overview = () => {
      following = null;
      tour = false;
      flyTo(HOME);
      notify();
    };
    if (controls) controls.current = {
      focusPerson: (key) => { const a = actors.find((x) => x.key === key); if (a) { tour = false; focusActor(a); } },
      focusRoom: (key) => { tour = false; focusRoomKey(key); },
      overview,
      setTour: (on) => { if (on) { tour = true; tourNext = 0; kick(); notify(); } else overview(); },
    };

    // ---------- input: pan / zoom-to-point / rotate, mouse and touch ----------
    const canvas = renderer.domElement;
    canvas.style.touchAction = 'none';
    const pointers = new Map<number, { x: number; y: number; button: number }>();
    let gesture: { dist: number; angle: number; mid: { x: number; y: number } } | null = null;
    const ray = new Raycaster();
    const ground = new Plane(new Vector3(0, 1, 0), 0);
    const ndc = new Vector2();
    const groundAt = (clientX: number, clientY: number, out: Vector3) => {
      const rect = canvas.getBoundingClientRect();
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      placeCamera();
      ray.setFromCamera(ndc, camera);
      ground.constant = -naik;
      return ray.ray.intersectPlane(ground, out);
    };
    const userMoved = () => {
      anim = null;
      tour = false;
      following = null;
      live.current.dirty = true;
      notify();
      kick();
    };
    const limitTarget = () => {
      const lim = K.dunia ? 8 : 15;
      cam.target.x = clamp(cam.target.x, -lim, K.dunia ? lim : 25);
      cam.target.z = clamp(cam.target.z, -lim, lim);
    };
    const pan = (dx: number, dy: number) => {
      const u = (2 * halfW) / cam.zoom / (el.clientWidth || 1);
      const right = new Vector3(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
      const forward = new Vector3(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
      cam.target.addScaledVector(right, -dx * u).addScaledVector(forward, (dy * u) / Math.max(0.3, Math.sin(cam.pitch)));
      limitTarget();
    };
    const zoomAt = (factor: number, clientX: number, clientY: number) => {
      const before = new Vector3();
      const after = new Vector3();
      const hit1 = groundAt(clientX, clientY, before);
      cam.zoom = clamp(cam.zoom * factor, 0.7, 7);
      const hit2 = groundAt(clientX, clientY, after);
      if (hit1 && hit2) cam.target.add(before.sub(after));
      limitTarget();
    };
    const rotate = (dx: number, dy: number) => {
      cam.yaw -= dx * 0.008;
      cam.pitch = clamp(cam.pitch + dy * 0.005, 0.3, 1.35);
    };
    const pointerDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button });
      canvas.setPointerCapture(e.pointerId);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        gesture = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), angle: Math.atan2(b!.y - a!.y, b!.x - a!.x), mid: { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 } };
      }
    };
    const pointerMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      prev.x = e.clientX;
      prev.y = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) < 0.5) return;
      if (pointers.size >= 2 && gesture) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        const angle = Math.atan2(b!.y - a!.y, b!.x - a!.x);
        const mid = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
        if (gesture.dist > 0 && dist > 0) zoomAt(dist / gesture.dist, mid.x, mid.y);
        pan(mid.x - gesture.mid.x, mid.y - gesture.mid.y);
        cam.yaw -= angle - gesture.angle;
        gesture = { dist, angle, mid };
      } else if (prev.button === 2 || e.shiftKey || e.ctrlKey) rotate(dx, dy);
      else pan(dx, dy);
      userMoved();
    };
    const pointerUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) gesture = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY);
      userMoved();
    };
    const dbl = () => overview();
    const ctxMenu = (e: Event) => e.preventDefault();
    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerup', pointerUp);
    canvas.addEventListener('pointercancel', pointerUp);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('dblclick', dbl);
    canvas.addEventListener('contextmenu', ctxMenu);

    const updateCamera = (t: number) => {
      if (anim) {
        const k = ease(Math.min(1, (t - anim.t0) / anim.dur));
        cam.target.copy(anim.from.target).lerp(anim.to.target, k);
        cam.yaw = anim.from.yaw + (anim.to.yaw - anim.from.yaw) * k;
        cam.pitch = anim.from.pitch + (anim.to.pitch - anim.from.pitch) * k;
        cam.zoom = anim.from.zoom + (anim.to.zoom - anim.from.zoom) * k;
        if (k >= 1) { anim = null; notify(); }
      } else if (following) {
        // Keep the followed person in frame while they walk.
        cam.target.lerp(worldOf(following.pos.x, 1.0, following.pos.z), 0.08);
      }
      if (tour && !reduce && t >= tourNext) {
        // Guided tour: every room, then the people who are in the office.
        const stops: ({ room: string } | { actor: Actor })[] = [...[...OFFICE_ROOMS, MESS_COMMON].map((r) => ({ room: r.key })), ...actors.filter((a) => a.root.visible).map((a) => ({ actor: a }))];
        const stop = stops[tourIndex++ % stops.length]!;
        if ('room' in stop) {
          following = null;
          const c = roomCenter(roomByKey(stop.room));
          flyTo({ target: worldOf(c.x, 0.6, c.z), zoom: 2.1, yaw: HOME.yaw + 0.25 * Math.sin(tourIndex) }, 1.4);
        } else {
          following = stop.actor;
          flyTo({ target: worldOf(stop.actor.pos.x, 1.0, stop.actor.pos.z), zoom: 3.6 }, 1.4);
        }
        tourNext = t + (manual ? 3.2 : 6);
      }
      placeCamera();
    };

    /* ================================================================== movement & poses */
    const proj = new Vector3();
    const place = (node: HTMLElement | null | undefined, at: Vector3) => {
      if (!node) return;
      proj.copy(at).project(camera);
      const x = ((proj.x + 1) / 2) * el.clientWidth;
      const y = ((1 - proj.y) / 2) * el.clientHeight;
      node.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    };
    const labelAt = new Vector3();
    const goalFor = (a: Actor, spot: Spot): Goal => {
      if (spot === 'rumah') return { key: 'rumah', place: ENTRANCE_PLACE, pose: 'rumah' };
      if (spot === 'meja') return { key: 'meja', place: { x: a.seat.x, z: a.seat.z, rot: 0, via: deskVia(a.roomKey, a.seat.x, a.seat.z) }, pose: 'meja' };
      if (spot === 'kamar' || spot === 'tidur') {
        const b = bedroomOf(a.index);
        return { key: spot, place: spot === 'tidur' ? b.sleep : b.sit, pose: spot };
      }
      const list = PLACES[spot];
      const i = a.index % list.length;
      return { key: spot + i, place: list[i]!, pose: spot };
    };
    const prayer = (a: Actor, c: number) => {
      const phase = c < 6 ? 'qiyam' : c < 9 ? 'ruku' : c < 10.5 ? 'itidal' : c < 14 ? 'sujud' : c < 16 ? 'duduk' : c < 19.5 ? 'sujud' : 'duduk';
      const kneel = phase === 'sujud' || phase === 'duduk';
      const tilt = phase === 'ruku' ? 1.25 : phase === 'sujud' ? 1.75 : 0;
      a.root.position.y = kneel ? -0.3 : 0;
      const at = (h: number) => ({ y: 0.7 + h * Math.cos(tilt), z: -h * Math.sin(tilt) });
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
    const sitBase = (a: Actor) => {
      a.legL.position.set(-0.11, 0.62, 0);
      a.legR.position.set(0.11, 0.62, 0);
      a.legL.rotation.set(-1.4, 0, 0);
      a.legR.rotation.set(-1.4, 0, 0);
      a.body.position.set(0, 0.92, 0);
      a.body.rotation.set(0, 0, 0);
      a.head.position.set(0, 1.42 + hk, 0);
      a.head.rotation.set(0, 0, 0);
      a.armL.position.set(-0.29, 1.12, 0);
      a.armR.position.set(0.29, 1.12, 0);
    };
    const standBase = (a: Actor) => {
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
        for (const f of floors) f.m.color.set(w(isNight ? f.night : f.day, 'lantai'));
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
        const busy = act === 'kerja' || act === 'laporan';
        const sm = a.screen.material as MeshLambertMaterial;
        const dm = a.deskTop.material as MeshLambertMaterial;
        if (d?.urgent.length) {
          dm.emissive.set('#f3355b');
          dm.emissiveIntensity = reduce ? 0.5 : 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 6));
        } else dm.emissiveIntensity = 0;
        a.book.visible = act === 'belajar';

        // Where should this person be (schedule + real work state, decided in App)? Walk there through the corridors.
        const spot: Spot = d?.spot ?? (act === 'pulang' ? 'rumah' : 'meja');
        const goal = goalFor(a, spot);
        if (!a.goal) {
          a.pos.set(goal.place.x, 0, goal.place.z);
          a.goal = goal;
          a.lastT = t;
        } else if (a.goal.key !== goal.key) {
          if (manual || reduce) { a.path = []; a.pos.set(goal.place.x, 0, goal.place.z); }
          else {
            let from: Place = a.goal.place;
            if (a.goal.pose === 'rumah' && !a.path.length) { a.pos.set(ENTRANCE_PLACE.x, 0, ENTRANCE_PLACE.z); from = ENTRANCE_PLACE; }
            a.path = [...a.path, ...route(from, goal.place).map(([x, z]) => new Vector3(x, 0, z))];
          }
          a.goal = goal;
        }
        const dt = Math.min(0.1, Math.max(0, t - a.lastT));
        a.lastT = t;
        let walking = false;
        if (a.path.length) {
          walking = true;
          let left = WALK_SPEED * dt;
          while (left > 0 && a.path.length) {
            const nx = a.path[0]!;
            const dx = nx.x - a.pos.x, dz = nx.z - a.pos.z, dist = Math.hypot(dx, dz);
            if (dist > 1e-4) { a.root.rotation.order = 'XYZ'; a.root.rotation.set(0, Math.atan2(-dx, -dz), 0); }
            if (dist <= left) { a.pos.copy(nx); a.path.shift(); left -= dist; }
            else { a.pos.x += (dx / dist) * left; a.pos.z += (dz / dist) * left; left = 0; }
          }
          if (!a.path.length) walking = false;
        }
        const pose: Spot = walking ? 'meja' : goal.pose;
        a.root.visible = walking || pose !== 'rumah';
        a.root.position.set(a.pos.x, 0, a.pos.z);
        a.root.rotation.order = 'XYZ';
        a.body.scale.setScalar(K.agen.badan);
        if (!walking) a.root.rotation.set(0, goal.place.rot, 0);
        const atDesk = !walking && pose === 'meja';
        sm.emissive.set(!atDesk ? '#2a2340' : busy ? (act === 'laporan' ? '#7bdff2' : '#66e3a5') : act === 'menunggu' ? '#ffc94d' : act === 'kendala' ? '#ff5a6e' : act === 'belajar' ? '#ffd166' : '#5b4a92');
        sm.emissiveIntensity = !atDesk ? 0.25 : busy ? 0.8 + (reduce ? 0 : 0.2 * Math.sin(t * 9 + a.phase)) : 0.6;
        const lampOn = atDesk && (act === 'belajar' || act === 'menunggu' || isNight);
        a.lamp.visible = lampOn;
        (a.lamp.material as MeshLambertMaterial).emissive.set(act === 'menunggu' ? '#ffb020' : '#ffcf4d');
        if (a.light) a.light.intensity = lampOn && isNight ? 2.2 : 0;
        a.mug.visible = true;
        a.handMug.visible = false;
        const s = Math.sin(t * 9 + a.phase);
        const labelY = (h: number) => a.label.set(a.pos.x, h + hk * 2, a.pos.z);

        if (walking) {
          standBase(a);
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
          standBase(a);
          const k = Math.max(0, Math.sin(t * 0.7 + a.phase));
          a.handMug.visible = true;
          a.mug.visible = false;
          a.armR.rotation.set(-0.7 - 1.5 * k, 0, -0.25 * k);
          a.armL.rotation.set(-0.2, 0, 0.1);
          a.head.rotation.set(-0.2 * k, 0.3 * Math.sin(t * 0.3 + a.phase), 0);
          labelY(1.95);
          continue;
        }
        if (pose === 'tidur') {
          // Lying on the back along the bed, head on the pillow, breathing slowly.
          standBase(a);
          const b = bedroomOf(a.index).bed;
          a.root.rotation.order = 'YXZ';
          a.root.rotation.set(Math.PI / 2, b.headDir > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
          a.root.position.set(b.x - b.headDir * 0.85, 0.72, b.z);
          a.armL.rotation.set(0, 0, 0.12);
          a.armR.rotation.set(-0.5, 0, -0.3);
          a.head.rotation.set(-0.15, 0, 0);
          a.body.scale.y = K.agen.badan * (1 + (reduce ? 0 : 0.02 * Math.sin(t * 1.3 + a.phase)));
          a.label.set(b.x, 1.25 + hk * 2, b.z);
          continue;
        }
        if (pose === 'ngobrol') {
          // Standing in a circle: the one speaking gestures, the others nod and look around.
          standBase(a);
          const talk = !!d?.talking && !reduce;
          const g = Math.sin(t * 3.1 + a.phase);
          if (talk) {
            a.armR.rotation.set(-0.9 - 0.5 * Math.max(0, g), 0, -0.25 - 0.2 * g);
            a.armL.rotation.set(-0.6 - 0.3 * Math.max(0, -g), 0, 0.25);
            a.head.rotation.set(0.05 * Math.sin(t * 5), 0.25 * Math.sin(t * 0.8 + a.phase), 0);
          } else {
            a.armL.rotation.set(-0.15, 0, 0.12);
            a.armR.rotation.set(-0.15, 0, -0.12);
            a.head.rotation.set(0.08 * Math.max(0, Math.sin(t * 1.4 + a.phase)), 0.35 * Math.sin(t * 0.35 + a.phase), 0);
          }
          labelY(1.95);
          continue;
        }
        if (pose === 'musholla') {
          prayer(a, (t + a.phase * 3) % 24);
          labelY(a.root.position.y < -0.1 ? 1.35 : 1.95);
          continue;
        }
        sitBase(a);
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
        if (pose === 'kamar') {
          // Sitting on the bed edge with the phone.
          a.root.position.y = -0.08;
          a.armL.rotation.set(-1.25, 0, 0.35);
          a.armR.rotation.set(-1.25, 0, -0.35);
          a.head.rotation.set(0.45, 0.06 * Math.sin(t * 0.5 + a.phase), 0);
          labelY(1.7);
          continue;
        }
        if (pose === 'mess') {
          const talk = !!d?.talking && !reduce;
          a.root.position.y = -0.05;
          a.body.rotation.set(0.12, 0, 0);
          a.armL.rotation.set(-0.5, 0, 0.15);
          a.armR.rotation.set(talk ? -1.1 - 0.4 * Math.max(0, Math.sin(t * 3 + a.phase)) : -0.55, 0, -0.15);
          a.head.rotation.set(0.1, talk ? 0.4 * Math.sin(t * 0.9 + a.phase) : 0.15 * Math.sin(t * 0.3 + a.phase), 0);
          labelY(1.7);
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

        // At the desk: typing, waiting with a raised hand, stuck, or small idle motions (office.ts fidgetAt).
        labelY(1.85);
        const fid = act === 'siaga' && !reduce ? fidgetAt(a.key, t) : { fidget: 'layar' as const, k: 0 };
        a.handMug.visible = fid.fidget === 'minum' && fid.k > 0.15;
        a.mug.visible = !a.handMug.visible;
        if (reduce) continue;
        if (busy) {
          a.armL.rotation.set(-1.15 + 0.12 * Math.sin(t * 16 + a.phase), 0, 0.1);
          a.armR.rotation.set(-1.15 + 0.12 * Math.sin(t * 16 + a.phase + 2), 0, -0.1);
          a.body.position.y = 0.92 + 0.012 * Math.abs(s);
          a.head.rotation.set(0.1 + 0.04 * Math.sin(t * 3 + a.phase), 0.08 * Math.sin(t * 1.3 + a.phase), 0);
        } else if (act === 'menunggu') {
          const wave = Math.max(0, Math.sin(t * 0.9 + a.phase));
          a.armL.rotation.set(-0.5, 0, 0.12);
          a.armR.rotation.set(-0.6 - 2.3 * wave, 0, -0.15 - 0.25 * wave * Math.sin(t * 7));
          a.head.rotation.set(-0.05, 0.35, 0);
          a.body.rotation.set(0, 0.2, 0);
        } else if (act === 'kendala') {
          a.armL.rotation.set(-2.35, 0, 0.55);
          a.armR.rotation.set(-2.35, 0, -0.55);
          a.head.rotation.set(0.35 + 0.05 * Math.sin(t * 1.5 + a.phase), 0.15 * Math.sin(t * 0.7), 0);
          a.body.position.y = 0.9;
        } else {
          const k = fid.k;
          a.armL.rotation.set(-0.95, 0, 0.12);
          a.armR.rotation.set(-0.95 + 0.06 * Math.sin(t * 2.2 + a.phase), 0, -0.12);
          a.head.rotation.set(0.05, 0.12 * Math.sin(t * 0.35 + a.phase), 0);
          a.body.position.y = 0.92 + 0.008 * Math.sin(t * 1.6 + a.phase);
          if (fid.fidget === 'minum') { a.armR.rotation.set(-0.95 - 1.35 * k, 0, -0.12 - 0.35 * k); a.head.rotation.set(-0.25 * k, 0, 0); }
          else if (fid.fidget === 'regang') { a.armL.rotation.set(-0.95 - 2.1 * k, 0, 0.37); a.armR.rotation.set(-0.95 - 2.1 * k, 0, -0.37); a.head.rotation.set(-0.3 * k, 0, 0); }
          else if (fid.fidget === 'tengok') { a.head.rotation.set(0, (a.index % 2 ? -1 : 1) * 0.9 * k, 0); a.body.rotation.set(0, (a.index % 2 ? -1 : 1) * 0.25 * k, 0); }
          else if (fid.fidget === 'catat') { a.armR.rotation.set(-0.75 + 0.08 * Math.sin(t * 12), 0, -0.05); a.head.rotation.set(0.35 * k, 0, 0); }
        }
      }
    };

    const draw = (t: number) => {
      nowT = t;
      applyState(t);
      updateCamera(t);
      renderer.render(scene, camera);
      for (const a of actors) {
        const node = anchors.current?.get(a.key);
        if (node) node.style.visibility = a.root.visible ? '' : 'hidden';
        place(node, inti.localToWorld(labelAt.set(a.label.x, a.label.y, a.label.z)));
      }
      place(boardAnchor.current, inti.localToWorld(labelAt.set(BOARD.x, 2.75, BOARD.z)));
      for (const r of ROOMS) {
        const c = roomCenter(r);
        const atrium = r.key === 'atrium';
        place(roomAnchors?.current?.get(r.key), inti.localToWorld(labelAt.set(c.x, atrium ? 0.2 : 1.6, atrium ? r.z1 - 0.3 : r.z0 + 0.5)));
      }
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
      if (!reduce || anim) raf = requestAnimationFrame(frame);
    };
    function kick() {
      if (!manual && !raf && running) raf = requestAnimationFrame(frame);
    }
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
    notify();
    onReady?.();

    return () => {
      running = false;
      if (drive) drive.current = null;
      if (controls) controls.current = null;
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
      canvas.removeEventListener('dblclick', dbl);
      canvas.removeEventListener('contextmenu', ctxMenu);
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
