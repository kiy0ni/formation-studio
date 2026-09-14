import type { ObjectDetector } from '@mediapipe/tasks-vision';
import simdLoader from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import simdBinary from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import plainLoader from '@mediapipe/tasks-vision/vision_wasm_nosimd_internal.js?url';
import plainBinary from '@mediapipe/tasks-vision/vision_wasm_nosimd_internal.wasm?url';

/** A person found in an image, in fractions of the image size (0..1). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

/** Person detector (MediaPipe, EfficientDet-Lite0): downloaded on first use, then works offline. */
const MODEL = 'detect/person-detector.tflite';

// tiny module using a SIMD instruction: tells whether the faster build can run here
const SIMD_TEST = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

const abs = (url: string) => new URL(url, document.baseURI).href;

let loading: Promise<PersonDetector> | null = null;

export function loadDetector(): Promise<PersonDetector> {
  loading ??= (async () => {
    if (typeof WebAssembly !== 'object') throw new Error('Cet appareil ne peut pas lancer la détection.');
    const simd = WebAssembly.validate(SIMD_TEST);
    const vision = await import('@mediapipe/tasks-vision');
    const detector = await vision.ObjectDetector.createFromOptions(
      { wasmLoaderPath: abs(simd ? simdLoader : plainLoader), wasmBinaryPath: abs(simd ? simdBinary : plainBinary) },
      {
        baseOptions: { modelAssetPath: abs(MODEL), delegate: 'CPU' },
        runningMode: 'IMAGE',
        categoryAllowlist: ['person'],
        scoreThreshold: 0.15,
        maxResults: 20,
      },
    );
    return new PersonDetector(detector);
  })().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

interface Found extends Box {
  /** Touches the inner edge of its half of the image: probably cut in two. */
  cut: 'left' | 'right' | 'top' | 'bottom' | null;
}

const area = (b: Box) => b.w * b.h;
function overlap(a: Box, b: Box) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export class PersonDetector {
  private tile = document.createElement('canvas');
  private tileCtx = this.tile.getContext('2d')!;

  constructor(private detector: ObjectDetector) {}

  /**
   * People in the image. Wide images are looked at in two overlapping halves: dancers appear bigger to the
   * model and fewer are missed (tested on a 6-person dance practice: 5 or 6 found on 33 frames out of 40).
   */
  detect(image: HTMLCanvasElement): Box[] {
    const W = image.width;
    const H = image.height;
    const found: Found[] = [];
    const run = (sx: number, sy: number, sw: number, sh: number, first: boolean, horizontal: boolean) => {
      let source: HTMLCanvasElement = image;
      if (sw !== W || sh !== H) {
        this.tile.width = sw;
        this.tile.height = sh;
        this.tileCtx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
        source = this.tile;
      }
      for (const d of this.detector.detect(source).detections) {
        const b = d.boundingBox;
        if (!b) continue;
        const edge = 3;
        let cut: Found['cut'] = null;
        if (sw !== W || sh !== H) {
          if (horizontal) cut = first ? (b.originX + b.width >= sw - edge ? 'right' : null) : b.originX <= edge ? 'left' : null;
          else cut = first ? (b.originY + b.height >= sh - edge ? 'bottom' : null) : b.originY <= edge ? 'top' : null;
        }
        found.push({ x: (b.originX + sx) / W, y: (b.originY + sy) / H, w: b.width / W, h: b.height / H, score: d.categories[0]?.score ?? 0, cut });
      }
    };
    const long = Math.max(W, H);
    const short = Math.min(W, H);
    if (long / short < 1.3) run(0, 0, W, H, true, true);
    else if (W >= H) {
      const tw = Math.min(W, Math.max(H, Math.ceil(W * 0.625)));
      run(0, 0, tw, H, true, true);
      run(W - tw, 0, tw, H, false, true);
    } else {
      const th = Math.min(H, Math.max(W, Math.ceil(H * 0.625)));
      run(0, 0, W, th, true, false);
      run(0, H - th, W, th, false, false);
    }
    return merge(found);
  }
}

function merge(found: Found[]): Box[] {
  let list = [...found].sort((a, b) => b.score - a.score);
  // a person cut by the middle line is usually seen whole in the other half
  list = list.filter((b) => !b.cut || !list.some((o) => o !== b && !o.cut && overlap(o, b) > area(b) * 0.5));
  // two halves of the same person: join them
  const joined: Found[] = [];
  const used = new Set<Found>();
  for (const a of list) {
    if (used.has(a)) continue;
    if (a.cut === 'right' || a.cut === 'bottom') {
      const horizontal = a.cut === 'right';
      const b = list.find((o) => {
        if (used.has(o) || o === a || o.cut !== (horizontal ? 'left' : 'top')) return false;
        if (horizontal) {
          const common = Math.min(a.y + a.h, o.y + o.h) - Math.max(a.y, o.y);
          return o.x < a.x + a.w && common > 0.6 * Math.min(a.h, o.h);
        }
        const common = Math.min(a.x + a.w, o.x + o.w) - Math.max(a.x, o.x);
        return o.y < a.y + a.h && common > 0.6 * Math.min(a.w, o.w);
      });
      if (b) {
        used.add(b);
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        joined.push({ x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y, score: Math.max(a.score, b.score), cut: null });
        used.add(a);
        continue;
      }
    }
    joined.push(a);
  }
  // the same person found twice
  const kept: Box[] = [];
  for (const b of joined.sort((a, c) => c.score - a.score)) {
    if (b.h < 0.05) continue;
    if (kept.some((k) => overlap(k, b) > 0.6 * Math.min(area(k), area(b)))) continue;
    kept.push({ x: b.x, y: b.y, w: b.w, h: b.h, score: b.score });
  }
  return kept;
}
