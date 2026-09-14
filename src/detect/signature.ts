import type { Box } from './detector';

/**
 * What a person looks like: colors of the hair, top, pants and shoes.
 * With a fixed camera the empty room is known, so only the person's own pixels are counted
 * (a white wall no longer looks like blond hair).
 */

const BINS = 28;
/** head, top, pants, shoes: [x0, x1, y0, y1] inside the box, and weight when comparing */
const REGIONS: [number, number, number, number, number][] = [
  [0.3, 0.7, 0.0, 0.14, 1.3],
  [0.25, 0.75, 0.18, 0.48, 1],
  [0.3, 0.7, 0.52, 0.85, 1],
  [0.15, 0.85, 0.88, 1, 0.4],
];
export const SIGNATURE_LENGTH = BINS * REGIONS.length;

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
  REGIONS.forEach(([x0, x1, y0, y1], r) => {
    const px0 = Math.max(0, Math.floor((box.x + box.w * x0) * img.width));
    const px1 = Math.min(img.width - 1, Math.ceil((box.x + box.w * x1) * img.width));
    const py0 = Math.max(0, Math.floor((box.y + box.h * y0) * img.height));
    const py1 = Math.min(img.height - 1, Math.ceil((box.y + box.h * y1) * img.height));
    if (px1 <= px0 || py1 <= py0) return;
    const step = Math.max(1, Math.floor(Math.min(px1 - px0, py1 - py0) / 14));
    person.length = 0;
    all.length = 0;
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
    // almost nothing differs from the room (dancer standing still the whole video): use every pixel
    const used = background && person.length >= all.length * 0.25 ? person : all;
    if (!used.length) return;
    const offset = r * BINS;
    for (const b of used) out[offset + b]++;
    for (let i = 0; i < BINS; i++) out[offset + i] = Math.round((out[offset + i] / used.length) * 1000) / 1000;
  });
  return out;
}

/** 0 = looks the same, 1 = nothing in common. */
export function sigDistance(a: number[], b: number[]) {
  if (a.length !== SIGNATURE_LENGTH || b.length !== SIGNATURE_LENGTH) return 0.35;
  let total = 0;
  let weights = 0;
  REGIONS.forEach(([, , , , w], r) => {
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
    weights += w;
  });
  return weights ? total / weights : 0.35;
}

/** Average look, each look counted `weights[i]` times. */
export function meanSignature(sigs: number[][], weights?: number[]) {
  const out = new Array<number>(SIGNATURE_LENGTH).fill(0);
  let total = 0;
  sigs.forEach((s, k) => {
    if (s.length !== SIGNATURE_LENGTH) return;
    const w = weights?.[k] ?? 1;
    for (let i = 0; i < SIGNATURE_LENGTH; i++) out[i] += s[i] * w;
    total += w;
  });
  return total ? out.map((v) => v / total) : out;
}
