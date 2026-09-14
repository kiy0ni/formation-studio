import { createStore, del, get, keys, set } from 'idb-keyval';
import { db } from '../lib/db';
import type { ID } from '../lib/types';
import { loadDetector } from './detector';
import { medianBackground, signature, type Background } from './signature';

/** A person seen on one analysed image (fractions of the image) with the colors of their clothes. */
export interface Det {
  x: number;
  y: number;
  w: number;
  h: number;
  s: number;
  /** Look (hair, top, arms, pants, shoes), 0..255 per bin: see signature.ts. */
  sig: number[];
}

/** A small picture of the video at an analysed image (JPEG data URL). */
export interface Thumb {
  index: number;
  url: string;
}

export interface Swap {
  from: number;
  a: number;
  b: number;
}

/** Choices made when reviewing the detection for one choreography, kept for the next time. */
export interface ReviewSettings {
  people: number;
  swaps: Swap[];
  placement: { flip: boolean; spread: number; depth: number; fill: boolean; center?: boolean };
  sensitivity: number;
  mapping: (ID | null)[];
  mode: 'all' | 'positions' | 'timings';
  /** Positions put on the stage marks. */
  grid?: boolean;
  /** Routes and start times during transitions taken from the video. */
  paths?: boolean;
  snap: boolean;
  recenter: boolean;
  transform: { flip: boolean; spread: number; depth: number; ox: number; oy: number; s: number };
}

/** Detected positions over time (video time), drawn faintly on the stage. */
export interface Ghosts {
  hash: string;
  start: number;
  fps: number;
  tracks: { color: string; xs: number[]; ys: number[] }[];
}

export interface Analysis {
  version: number;
  hash: string;
  fps: number;
  duration: number;
  width: number;
  height: number;
  times: number[];
  frames: Det[][];
  thumbs: Thumb[];
  createdAt: number;
  /** Images still to analyse (analysis interrupted: the tab was closed): resumes from here. */
  next?: number;
}

/** What one choreography made of the analysis (its own stage, dancers and colors). */
export interface Applied {
  review: ReviewSettings;
  ghosts: Ghosts;
}

/** 6: image times carried explicitly (downstream code never assumes even spacing). Older analyses are run again. */
const VERSION = 6;
/** Images analysed per second of video: quick, or precise (crossings followed more closely). */
export const PRECISION = { fast: 3, precise: 5 } as const;
export type Precision = keyof typeof PRECISION;
const THUMB_EVERY_S = 2;
const SAVE_EVERY = 60;

/**
 * Results stay on the device, one analysis per video ("a:<hash>"), what each choreography made of it
 * ("r:<hash>:<choreo>"), plus a small summary ("m:<hash>") read without loading the whole analysis.
 */
const store = createStore('fs-detect', 'kv');
const aKey = (hash: string) => `a:${hash}`;
const rKey = (hash: string, choreoId: ID) => `r:${hash}:${choreoId}`;
const mKey = (hash: string) => `m:${hash}`;

export interface AnalysisMeta {
  version: number;
  fps: number;
  done: boolean;
}

export const loadMeta = async (hash: string): Promise<AnalysisMeta | null> => {
  const m = await get<AnalysisMeta>(mKey(hash), store).catch(() => undefined);
  return m && m.version === VERSION ? m : null;
};

/** The finished analysis of a video, or null (an interrupted one is only used by runAnalysis). */
export async function loadAnalysis(hash: string, { partial = false } = {}): Promise<Analysis | null> {
  const a = await get<Analysis>(aKey(hash), store).catch(() => undefined);
  if (!a) return null;
  if (a.version !== VERSION) {
    await forgetAnalysis(hash);
    return null;
  }
  return a.next === undefined || partial ? a : null;
}

async function saveAnalysis(a: Analysis) {
  await set(aKey(a.hash), a, store);
  await set(mKey(a.hash), { version: a.version, fps: a.fps, done: a.next === undefined } satisfies AnalysisMeta, store);
}

export const loadApplied = (hash: string, choreoId: ID) => get<Applied>(rKey(hash, choreoId), store).catch(() => undefined);
export const saveApplied = (hash: string, choreoId: ID, applied: Applied) => set(rKey(hash, choreoId), applied, store);

/** Removes the analysis of a video and everything made from it (video removed from the device). */
export async function forgetAnalysis(hash: string) {
  const all = await keys<string>(store).catch(() => [] as string[]);
  await Promise.all(all.filter((k) => k === aKey(hash) || k === mKey(hash) || k.startsWith(`r:${hash}:`)).map((k) => del(k, store)));
}

/** Images are analysed at about 480p: enough for the model, light for phones. */
export function analysisSize(width: number, height: number) {
  const k = Math.min(1, 854 / Math.max(width, height));
  return { width: Math.max(2, Math.round((width * k) / 2) * 2), height: Math.max(2, Math.round((height * k) / 2) * 2) };
}

export interface Progress {
  label: string;
  ratio?: number;
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;

export function formatMinutes(seconds: number) {
  if (seconds < 50) return 'moins d’une minute';
  const m = Math.round(seconds / 60);
  return `${m} min`;
}

const cancelled = () => new DOMException('Analyse annulée', 'AbortError');

/** Looks for the dancers on every analysed image of the reference video (resumes an interrupted analysis). */
export async function runAnalysis(hash: string, onProgress: (p: Progress) => void, signal: AbortSignal, fps: number = PRECISION.precise): Promise<Analysis> {
  const blob = await db.getVideo(hash);
  if (!blob) throw new Error('Vidéo absente sur cet appareil.');
  onProgress({ label: 'Chargement de la détection…' });
  const [detector, mb] = await Promise.all([loadDetector(), import('mediabunny')]);
  if (signal.aborted) throw cancelled();
  const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('Ce fichier ne contient pas d’image vidéo.');
    const duration = await input.computeDuration();
    const { width, height } = analysisSize(track.displayWidth, track.displayHeight);
    const sink = new mb.CanvasSink(track, { width, height, fit: 'fill', poolSize: 1 });

    const previous = await loadAnalysis(hash, { partial: true });
    const resume = previous && previous.next !== undefined && previous.fps === fps && previous.width === width ? previous : null;
    const times: number[] = resume?.times ?? [];
    if (!resume) for (let t = 0.05; t < duration - 0.05; t += 1 / fps) times.push(Math.round(t * 1000) / 1000);

    // the empty room, from images spread across the video (fixed camera)
    onProgress({ label: 'Analyse… repérage de la salle', ratio: 0 });
    const small = document.createElement('canvas');
    small.width = Math.round(width / 2);
    small.height = Math.round(height / 2);
    const smallCtx = small.getContext('2d', { willReadFrequently: true })!;
    const roomImages: ImageData[] = [];
    const roomTimes = Array.from({ length: 13 }, (_, k) => Math.round(duration * (0.03 + (0.94 * k) / 12) * 1000) / 1000);
    for await (const wrapped of sink.canvasesAtTimestamps(roomTimes)) {
      if (signal.aborted) throw cancelled();
      if (!wrapped) continue;
      smallCtx.drawImage(wrapped.canvas, 0, 0, small.width, small.height);
      roomImages.push(smallCtx.getImageData(0, 0, small.width, small.height));
    }
    const room: Background | null = medianBackground(roomImages);
    roomImages.length = 0;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const thumb = document.createElement('canvas');
    thumb.width = Math.round(width * 0.375);
    thumb.height = Math.round(height * 0.375);
    const thumbCtx = thumb.getContext('2d')!;

    const analysis: Analysis = resume ?? { version: VERSION, hash, fps, duration, width, height, times, frames: [], thumbs: [], createdAt: Date.now(), next: 0 };
    const frames = analysis.frames;
    const thumbs = analysis.thumbs;
    const thumbEvery = Math.round(fps * THUMB_EVERY_S);
    const from = analysis.next ?? 0;
    const started = performance.now();
    onProgress({ label: from ? 'Analyse… reprise' : 'Analyse…', ratio: from / Math.max(1, times.length) });
    let i = from;
    for await (const wrapped of sink.canvasesAtTimestamps(times.slice(from))) {
      if (signal.aborted) {
        analysis.next = i;
        await saveAnalysis(analysis);
        throw cancelled();
      }
      if (!wrapped) frames[i] = [];
      else {
        ctx.drawImage(wrapped.canvas, 0, 0, width, height);
        const boxes = detector.detect(canvas);
        // only the part of the image where people stand is read back (the whole image is 1.6 MB each time)
        let pixels: ImageData | null = null;
        let view = { x: 0, y: 0, width, height };
        if (boxes.length) {
          const x0 = Math.max(0, Math.floor(Math.min(...boxes.map((b) => b.x)) * width));
          const y0 = Math.max(0, Math.floor(Math.min(...boxes.map((b) => b.y)) * height));
          const x1 = Math.min(width, Math.ceil(Math.max(...boxes.map((b) => b.x + b.w)) * width));
          const y1 = Math.min(height, Math.ceil(Math.max(...boxes.map((b) => b.y + b.h)) * height));
          pixels = ctx.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
          view = { x: x0, y: y0, width, height };
        }
        frames[i] = boxes.map((b) => ({ x: r4(b.x), y: r4(b.y), w: r4(b.w), h: r4(b.h), s: r4(b.score), sig: signature(pixels!, b, room, view) }));
        if (i % thumbEvery === 0) {
          thumbCtx.drawImage(canvas, 0, 0, thumb.width, thumb.height);
          thumbs.push({ index: i, url: thumb.toDataURL('image/jpeg', 0.6) });
        }
      }
      i++;
      const ratio = i / times.length;
      const elapsed = (performance.now() - started) / 1000;
      const doneShare = (i - from) / times.length;
      onProgress({ label: doneShare > 0.04 ? `Analyse… encore ${formatMinutes(elapsed / doneShare - elapsed)}` : 'Analyse…', ratio });
      if (i % SAVE_EVERY === 0) {
        analysis.next = i;
        await saveAnalysis(analysis);
      }
      // let the page breathe (progress bar, cancel button)
      if (i % 2 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    while (frames.length < times.length) frames.push([]);
    delete analysis.next;
    analysis.createdAt = Date.now();
    await saveAnalysis(analysis);
    return analysis;
  } finally {
    input.dispose();
  }
}
