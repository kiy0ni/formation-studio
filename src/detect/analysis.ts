import { createStore, del, get, set } from 'idb-keyval';
import { db } from '../lib/db';
import type { ID } from '../lib/types';
import { loadDetector } from './detector';
import { signature } from './signature';

/** A person seen on one analysed image (fractions of the image) with the colors of their clothes. */
export interface Det {
  x: number;
  y: number;
  w: number;
  h: number;
  s: number;
  /** Clothes colors (top and bottom), to tell people apart. */
  sig: number[];
}

export interface Keyframe {
  index: number;
  url: string;
}

export interface Swap {
  from: number;
  a: number;
  b: number;
}

/** Choices made when reviewing the detection, kept for the next time. */
export interface ReviewSettings {
  people: number;
  swaps: Swap[];
  placement: { flip: boolean; spread: number; depth: number; fill: boolean };
  sensitivity: number;
  mapping: (ID | null)[];
  mode: 'all' | 'positions' | 'timings';
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
  keyframes: Keyframe[];
  createdAt: number;
  review?: ReviewSettings;
  ghosts?: Ghosts;
}

const VERSION = 1;
/** Images analysed per second of video. */
export const FPS = 3;
const KEYFRAME_EVERY = 2;

/** Results stay on the device, one per video. */
const store = createStore('fs-detect', 'kv');

export async function loadAnalysis(hash: string): Promise<Analysis | null> {
  const a = await get<Analysis>(hash, store).catch(() => undefined);
  return a && a.version === VERSION ? a : null;
}
export const saveAnalysis = (a: Analysis) => set(a.hash, a, store);
export const deleteAnalysis = (hash: string) => del(hash, store);

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

function formatLeft(seconds: number) {
  if (seconds < 50) return 'moins d’une minute';
  const m = Math.round(seconds / 60);
  return `${m} min`;
}

/** Looks for the dancers on every analysed image of the reference video. */
export async function runAnalysis(hash: string, onProgress: (p: Progress) => void, signal: AbortSignal): Promise<Analysis> {
  const blob = await db.getVideo(hash);
  if (!blob) throw new Error('Vidéo absente sur cet appareil.');
  onProgress({ label: 'Chargement de la détection…' });
  const [detector, mb] = await Promise.all([loadDetector(), import('mediabunny')]);
  const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('Ce fichier ne contient pas d’image vidéo.');
  const duration = await input.computeDuration();
  const { width, height } = analysisSize(track.displayWidth, track.displayHeight);
  const sink = new mb.CanvasSink(track, { width, height, fit: 'fill', poolSize: 1 });

  const times: number[] = [];
  for (let t = 0.05; t < duration - 0.05; t += 1 / FPS) times.push(Math.round(t * 1000) / 1000);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const thumb = document.createElement('canvas');
  thumb.width = Math.round(width / 2);
  thumb.height = Math.round(height / 2);
  const thumbCtx = thumb.getContext('2d')!;

  const frames: Det[][] = [];
  const keyframes: Keyframe[] = [];
  const keyEvery = Math.round(FPS * KEYFRAME_EVERY);
  const started = performance.now();
  onProgress({ label: 'Analyse…', ratio: 0 });
  for await (const wrapped of sink.canvasesAtTimestamps(times)) {
    if (signal.aborted) throw new DOMException('Analyse annulée', 'AbortError');
    const i = frames.length;
    if (!wrapped) {
      frames.push([]);
      continue;
    }
    ctx.drawImage(wrapped.canvas, 0, 0, width, height);
    const boxes = detector.detect(canvas);
    const pixels = boxes.length ? ctx.getImageData(0, 0, width, height) : null;
    frames.push(boxes.map((b) => ({ x: r4(b.x), y: r4(b.y), w: r4(b.w), h: r4(b.h), s: r4(b.score), sig: signature(pixels!, b) })));
    if (i % keyEvery === 0) {
      thumbCtx.drawImage(canvas, 0, 0, thumb.width, thumb.height);
      keyframes.push({ index: i, url: thumb.toDataURL('image/jpeg', 0.7) });
    }
    const ratio = frames.length / times.length;
    const elapsed = (performance.now() - started) / 1000;
    onProgress({ label: ratio > 0.04 ? `Analyse… encore ${formatLeft(elapsed / ratio - elapsed)}` : 'Analyse…', ratio });
    // let the page breathe (progress bar, cancel button)
    if (i % 2 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  while (frames.length < times.length) frames.push([]);

  const analysis: Analysis = { version: VERSION, hash, fps: FPS, duration, width, height, times, frames, keyframes, createdAt: Date.now() };
  await saveAnalysis(analysis);
  return analysis;
}
