import type { Box } from './detector';

/**
 * What a person looks like: colors of the hair, top, arms (sleeves or skin), pants and shoes.
 * With a fixed camera the empty room is known, so only the person's own pixels are counted
 * (a white wall no longer looks like blond hair).
 */

const BINS = 28;
type Rect = [number, number, number, number];
/** Parts of the body inside the box ([x0, x1, y0, y1]) and their weight when comparing two people. */
const REGIONS: { rects: Rect[]; weight: number }[] = [
  { rects: [[0.3, 0.7, 0.0, 0.14]], weight: 1.3 }, // hair
  { rects: [[0.22, 0.78, 0.15, 0.32]], weight: 1 }, // chest
  { rects: [[0.24, 0.76, 0.32, 0.5]], weight: 1 }, // belly
  { rects: [[0.0, 0.22, 0.16, 0.52], [0.78, 1.0, 0.16, 0.52]], weight: 1 }, // arms: sleeves or skin
  { rects: [[0.1, 0.9, 0.52, 0.72]], weight: 1 }, // thighs
  { rects: [[0.1, 0.9, 0.72, 0.88]], weight: 1 }, // lower legs
  { rects: [[0.1, 0.9, 0.88, 1.0]], weight: 0.5 }, // shoes
];
export const SIGNATURE_LENGTH = BINS * REGIONS.length;
/** Looks measured by earlier versions stay comparable with each other. */
const OLDER_WEIGHTS: Record<number, number[]> = {
  [4 * BINS]: [1.3, 1, 1, 0.4],
  [6 * BINS]: [1.3, 1, 1, 1, 1, 0.5],
};

/** Picture of the room without the dancers (smaller image), or null when the camera moves. */
export interface Background {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Each pixel = its median color over images spread across the video: people move, the room stays. */
export function medianBackground(images: ImageData[]): Background | null {
  if (images.length < 5) return null;
  const { width, height } = images[0];
  const data = new Uint8ClampedArray(width * height * 4);
  const values = new Uint8Array(images.length);
  const mid = images.length >> 1;
  for (let p = 0; p < width * height * 4; p += 4) {
    for (let c = 0; c < 3; c++) {
      for (let k = 0; k < images.length; k++) values[k] = images[k].data[p + c];
      values.sort();
      data[p + c] = values[mid];
    }
    data[p + 3] = 255;
  }
  return { data, width, height };
}

function bin(r: number, g: number, b: number) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max / 255;
  const s = max ? (max - min) / max : 0;
  if (v < 0.18) return 0;
  if (s < 0.18) return v < 0.45 ? 1 : v < 0.72 ? 2 : 3;
  let hue: number;
  if (max === r) hue = ((g - b) / (max - min)) % 6;
  else if (max === g) hue = (b - r) / (max - min) + 2;
  else hue = (r - g) / (max - min) + 4;
  hue = (hue * 60 + 360) % 360;
  return 4 + Math.floor(hue / 30) * 2 + (v < 0.6 ? 0 : 1);
}

export function signature(img: ImageData, box: Box, background: Background | null): number[] {
  const out = new Array<number>(SIGNATURE_LENGTH).fill(0);
  const person: number[] = [];
  const all: number[] = [];
  REGIONS.forEach(({ rects }, r) => {
    person.length = 0;
    all.length = 0;
    for (const [x0, x1, y0, y1] of rects) {
      const px0 = Math.max(0, Math.floor((box.x + box.w * x0) * img.width));
      const px1 = Math.min(img.width - 1, Math.ceil((box.x + box.w * x1) * img.width));
      const py0 = Math.max(0, Math.floor((box.y + box.h * y0) * img.height));
      const py1 = Math.min(img.height - 1, Math.ceil((box.y + box.h * y1) * img.height));
      if (px1 <= px0 || py1 <= py0) continue;
      const step = Math.max(1, Math.floor(Math.min(px1 - px0, py1 - py0) / 10));
      for (let y = py0; y <= py1; y += step)
        for (let x = px0; x <= px1; x += step) {
          const k = (y * img.width + x) * 4;
          const R = img.data[k];
          const G = img.data[k + 1];
          const B = img.data[k + 2];
          const b = bin(R, G, B);
          all.push(b);
          if (background) {
            const bx = Math.min(background.width - 1, Math.floor((x * background.width) / img.width));
            const by = Math.min(background.height - 1, Math.floor((y * background.height) / img.height));
            const q = (by * background.width + bx) * 4;
            if (Math.abs(R - background.data[q]) + Math.abs(G - background.data[q + 1]) + Math.abs(B - background.data[q + 2]) < 48) continue;
          }
          person.push(b);
        }
    }
    // almost nothing differs from the room (dancer standing still the whole video): use every pixel
    const used = background && person.length >= all.length * 0.25 ? person : all;
    // arms tight against the body: nothing of the person on the sides
    if (!used.length || (r === 3 && background && person.length < all.length * 0.1)) return;
    const offset = r * BINS;
    for (const b of used) out[offset + b]++;
    for (let i = 0; i < BINS; i++) out[offset + i] = Math.round((out[offset + i] / used.length) * 1000) / 1000;
  });
  return out;
}

/** 0 = looks the same, 1 = nothing in common. */
export function sigDistance(a: number[], b: number[]) {
  if (!a.length || a.length !== b.length || a.length % BINS) return 0.35;
  const weights = a.length === SIGNATURE_LENGTH ? REGIONS.map((r) => r.weight) : (OLDER_WEIGHTS[a.length] ?? new Array<number>(a.length / BINS).fill(1));
  let total = 0;
  let used = 0;
  weights.forEach((w, r) => {
    let sa = 0;
    let sb = 0;
    let d = 0;
    for (let i = r * BINS; i < (r + 1) * BINS; i++) {
      sa += a[i];
      sb += b[i];
      d += Math.abs(a[i] - b[i]);
    }
    if (sa < 0.5 || sb < 0.5) return;
    total += (w * d) / 2;
    used += w;
  });
  return used ? total / used : 0.35;
}

/** Average look, each look counted `weights[i]` times. */
export function meanSignature(sigs: number[][], weights?: number[]) {
  const length = sigs.find((s) => s.length)?.length ?? SIGNATURE_LENGTH;
  const out = new Array<number>(length).fill(0);
  let total = 0;
  sigs.forEach((s, k) => {
    if (s.length !== length) return;
    const w = weights?.[k] ?? 1;
    for (let i = 0; i < length; i++) out[i] += s[i] * w;
    total += w;
  });
  return total ? out.map((v) => v / total) : out;
}
