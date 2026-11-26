export type Word = { text: string; start: number; end: number };
export type Label = { text: string; x: number; y: number };
export type Card = { kind: 'none' | 'list' | 'stat' | 'compare' | 'steps' | 'quote' | 'chat' | 'phone'; heading: string; items: string[]; value: string; highlight: number };
export type Scene = { start: number; end: number; image: string | null; labels: Label[]; card: Card };
export type ShortProps = {
  template: 'explainer' | 'cards' | 'story';
  partLabel?: string;
  endLabel?: string;
  mainName?: string;
  fps: number;
  width: number;
  height: number;
  hookText: string;
  audio: string | null;
  scenes: Scene[];
  words: Word[];
  duration: number;
};

export const DEMO: ShortProps = {
  template: 'explainer',
  fps: 30,
  width: 720,
  height: 1280,
  hookText: 'Kenapa las bawah air tidak menyetrum?',
  audio: null,
  duration: 8,
  scenes: [
    { start: 0, end: 4, image: null, labels: [{ text: 'GELEMBUNG GAS', x: 0.6, y: 0.45 }], card: { kind: 'none', heading: '', items: [], value: '', highlight: -1 } },
    { start: 4, end: 8, image: null, labels: [], card: { kind: 'stat', heading: 'Suhu busur las', items: [], value: '4000', highlight: -1 } },
  ],
  words: 'kenapa las bawah air tidak menyetrum penyelamnya ternyata jawabannya ada di gelembung gas'.split(' ').map((w, i) => ({ text: w, start: i * 0.55, end: i * 0.55 + 0.5 })),
};
