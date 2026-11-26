import type { Word } from './types';

export type Chunk = { words: string[]; start: number; end: number; highlight: number; color: string };

const STOP = new Set(('yang dan di ke dari ini itu ada untuk dengan atau juga akan bisa tidak bukan pada saat lalu jadi kalau karena tapi agar supaya sudah masih saja sangat lebih paling para kita kamu aku dia mereka kami nya the a an of to is in').split(' '));
const COLORS = ['#FFD23F', '#3FA9F5', '#FF5A5F', '#5CE65C', '#FF7AC6'];

/** Groups words into 1-3 word caption chunks, breaking at punctuation and pauses, and picks one keyword to colour. */
export function chunkWords(words: Word[], maxWords = 2): Chunk[] {
  const out: Chunk[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    const clean = cur.map((w) => w.text.replace(/[.,!?;:"“”()]/g, ''));
    let best = -1;
    clean.forEach((w, i) => {
      if (STOP.has(w.toLowerCase()) || w.length < 3) return;
      if (best < 0 || w.length > clean[best]!.length) best = i;
    });
    out.push({ words: clean, start: cur[0]!.start, end: cur[cur.length - 1]!.end, highlight: best, color: COLORS[out.length % COLORS.length]! });
    cur = [];
  };
  words.forEach((w, i) => {
    const next = words[i + 1];
    cur.push(w);
    const punct = /[.,!?;:]$/.test(w.text);
    const pause = next ? next.start - w.end > 0.35 : true;
    const short = cur.reduce((n, x) => n + x.text.length, 0) <= 7 && cur.length < 3;
    if (punct || pause || (cur.length >= maxWords && !short)) flush();
  });
  flush();
  // Each chunk stays until the next one starts (no flicker in gaps shorter than half a second).
  for (let i = 0; i < out.length - 1; i++) if (out[i + 1]!.start - out[i]!.end < 0.5) out[i]!.end = out[i + 1]!.start;
  return out;
}
