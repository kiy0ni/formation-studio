import type { Box } from './detector';

/** Colors of the top (torso) and bottom (legs) of a person: dark, grey, light, or one of 8 hues. */
export function signature(img: ImageData, b: Box): number[] {
  const out = new Array<number>(22).fill(0);
  const region = (x0: number, x1: number, y0: number, y1: number, offset: number) => {
    const px0 = Math.max(0, Math.floor((b.x + b.w * x0) * img.width));
    const px1 = Math.min(img.width - 1, Math.ceil((b.x + b.w * x1) * img.width));
    const py0 = Math.max(0, Math.floor((b.y + b.h * y0) * img.height));
    const py1 = Math.min(img.height - 1, Math.ceil((b.y + b.h * y1) * img.height));
    const step = Math.max(1, Math.floor(Math.min(px1 - px0, py1 - py0) / 12));
    let n = 0;
    for (let y = py0; y <= py1; y += step)
      for (let x = px0; x <= px1; x += step) {
        const k = (y * img.width + x) * 4;
        const r = img.data[k];
        const g = img.data[k + 1];
        const bl = img.data[k + 2];
        const max = Math.max(r, g, bl);
        const min = Math.min(r, g, bl);
        const v = max / 255;
        const s = max ? (max - min) / max : 0;
        let bin: number;
        if (v < 0.22) bin = 0;
        else if (s < 0.25) bin = v < 0.7 ? 1 : 2;
        else {
          let hue = 0;
          if (max === r) hue = ((g - bl) / (max - min)) % 6;
          else if (max === g) hue = (bl - r) / (max - min) + 2;
          else hue = (r - g) / (max - min) + 4;
          hue = (hue * 60 + 360) % 360;
          bin = 3 + (Math.floor(hue / 45) % 8);
        }
        out[offset + bin]++;
        n++;
      }
    if (n) for (let i = 0; i < 11; i++) out[offset + i] = Math.round((out[offset + i] / n) * 1000) / 1000;
  };
  region(0.25, 0.75, 0.18, 0.5, 0);
  region(0.3, 0.7, 0.55, 0.9, 11);
  return out;
}

/** 0 = same clothes, 1 = nothing in common. */
export function sigDistance(a: number[], b: number[]) {
  if (a.length !== 22 || b.length !== 22) return 0.3;
  let d = 0;
  for (let i = 0; i < 22; i++) d += Math.abs(a[i] - b[i]);
  return d / 4;
}
