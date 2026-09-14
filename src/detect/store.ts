import { create } from 'zustand';
import { notify } from '../components/common/Toast';
import { db } from '../lib/db';
import { r2 } from '../lib/geometry';
import { clampToStage, computeFrame, sortedDancers } from '../lib/model';
import type { Position } from '../lib/types';
import { currentItem, useEditor } from '../store/editor';
import { playback } from '../store/playback';
import { analysisSize, loadAnalysis, loadApplied, runAnalysis, type Ghosts } from './analysis';
import { loadDetector } from './detector';
import { fitFloor, toFloor } from './floor';
import { alignToGrid, applyTransform, centred, DEFAULT_PLACEMENT, defaultMapping, placeTracks } from './formations';
import { trackPeople } from './track';

interface DetectUi {
  open: boolean;
  job: { hash: string; label: string; ratio?: number } | null;
  /** Last failure, for the video it happened on. */
  error: { hash: string; text: string } | null;
  /** Ghosts of the open choreography. */
  ghosts: { choreoId: string; data: Ghosts } | null;
  showGhosts: boolean;
  placing: boolean;
}

const readShow = () => {
  try {
    return localStorage.getItem('fs-detect-ghosts') === '1';
  } catch {
    return false;
  }
};

export const useDetect = create<DetectUi>(() => ({ open: false, job: null, error: null, ghosts: null, showGhosts: readShow(), placing: false }));

export function setShowGhosts(show: boolean) {
  try {
    localStorage.setItem('fs-detect-ghosts', show ? '1' : '0');
  } catch {
    /* private mode */
  }
  useDetect.setState({ showGhosts: show });
}

let controller: AbortController | null = null;

interface WakeLockSentinel {
  release: () => Promise<void>;
}
type WakeNavigator = Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> } };

/** Keeps a phone screen awake while working (asked again when the app comes back to the front). */
function keepAwake() {
  const wakeLock = (navigator as WakeNavigator).wakeLock;
  if (!wakeLock) return () => {};
  let lock: Promise<WakeLockSentinel | null> = Promise.resolve(null);
  let active = true;
  const request = () => {
    if (!active || document.visibilityState !== 'visible') return;
    lock = wakeLock.request('screen').catch(() => null);
  };
  document.addEventListener('visibilitychange', request);
  request();
  return () => {
    active = false;
    document.removeEventListener('visibilitychange', request);
    void lock.then((l) => l?.release().catch(() => {}));
  };
}

/** Runs in the background: the window can be closed and opened again while it works. */
export function startAnalysis(hash: string, fps?: number) {
  if (useDetect.getState().job) return;
  controller = new AbortController();
  const signal = controller.signal;
  useDetect.setState({ job: { hash, label: 'Préparation…' }, error: null });
  const release = keepAwake();
  runAnalysis(hash, (p) => useDetect.setState({ job: { hash, ...p } }), signal, fps)
    .then(() => notify('Analyse terminée'))
    .catch((e: Error) => {
      if (e.name !== 'AbortError') {
        console.warn('[detect]', e);
        useDetect.setState({ error: { hash, text: `Analyse impossible : ${e.message || 'erreur inconnue'}` } });
      }
    })
    .finally(() => {
      release();
      controller = null;
      useDetect.setState({ job: null });
    });
}

export function cancelAnalysis() {
  controller?.abort();
}

const keepExtras = (old: Position | undefined, p: { x: number; y: number }): Position => {
  const next: Position = { x: r2(p.x), y: r2(p.y) };
  if (old?.timing) next.timing = old.timing;
  if (old?.comment) next.comment = old.comment;
  return next;
};

/** Places the dancers of the formation on screen from the video image at the playhead. */
export async function placeFromFrame() {
  const start = useEditor.getState();
  const video = start.doc?.video;
  if (!start.doc || !video || start.readOnly || useDetect.getState().placing) return;
  useDetect.setState({ placing: true });
  let input: { dispose: () => void } | null = null;
  try {
    const blob = await db.getVideo(video.hash);
    if (!blob) throw new Error('vidéo absente sur cet appareil');
    const [detector, mb] = await Promise.all([loadDetector(), import('mediabunny')]);
    const source = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
    input = source;
    const track = await source.getPrimaryVideoTrack();
    if (!track) throw new Error('pas d’image dans la vidéo');
    const { width, height } = analysisSize(track.displayWidth, track.displayHeight);
    const sink = new mb.CanvasSink(track, { width, height, fit: 'fill', poolSize: 1 });
    const duration = await source.computeDuration();
    const at = Math.max(0, Math.min(duration - 0.05, start.time + video.offset));
    const frame = await sink.getCanvas(at);
    if (!frame) throw new Error('image introuvable à ce moment');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.drawImage(frame.canvas, 0, 0, width, height);
    const boxes = detector.detect(canvas).filter((b) => b.score >= 0.3);
    if (!boxes.length) return notify('Aucune personne trouvée sur cette image');

    const s = useEditor.getState();
    const doc = s.doc;
    if (!doc || doc.id !== start.doc.id) return;
    const dets = boxes.map((b) => ({ ...b, s: b.score, sig: [] }));
    let points: { x: number; y: number }[];
    const analysis = await loadAnalysis(video.hash);
    if (analysis) {
      // same scale and placement as the full analysis (as reviewed for this choreography when it was)
      const floor = fitFloor(analysis.frames.flat(), analysis.width, analysis.height);
      const applied = await loadApplied(video.hash, doc.id);
      const transform = applied?.review.transform ?? placeTracks(trackPeople(analysis, floor).tracks, doc.stage, DEFAULT_PLACEMENT).transform;
      points = dets.map((d) => applyTransform(transform, toFloor(floor, d)));
    } else {
      const floor = fitFloor(dets, width, height);
      const single = dets.map((d) => {
        const p = toFloor(floor, d);
        return { xs: Float32Array.of(p.x), ys: Float32Array.of(p.y), seen: Uint8Array.of(1), det: Int16Array.of(0), sig: [] };
      });
      const placed = placeTracks(single, doc.stage, { ...DEFAULT_PLACEMENT, fill: false });
      points = placed.tracks.map((t) => ({ x: t.xs[0], y: t.ys[0] }));
    }

    const { items, index } = currentItem(doc, s.time);
    const now = computeFrame(doc, s.time);
    const target = now.progress >= 0.5 && items[index + 1] ? items[index + 1] : items[index];
    if (!target) return;
    const dancers = sortedDancers(doc);
    // same centre as the detection of this choreography: the room (camera axis, already in the placement) or the group
    if (analysis && (await loadApplied(video.hash, doc.id))?.review.placement.centre === 'group') points = centred(points);
    if (doc.stage.snap) points = alignToGrid(points, doc.stage);
    const mapping = defaultMapping(points, dancers.map((d) => ({ id: d.id, x: target.f.positions[d.id]?.x ?? 0 })));
    let placed = 0;
    s.update('Placer depuis la vidéo', (d) => {
      const f = d.formations[target.f.id];
      mapping.forEach((id, k) => {
        if (!id || !d.dancers[id]) return;
        f.positions[id] = keepExtras(f.positions[id], clampToStage(points[k], d.stage));
        placed++;
      });
    });
    if (now.progress > 0 && !s.playing) playback.seek(target.start);
    notify(`${placed} danseur${placed > 1 ? 's' : ''} placé${placed > 1 ? 's' : ''} d’après la vidéo · ${boxes.length} personne${boxes.length > 1 ? 's' : ''} vue${boxes.length > 1 ? 's' : ''}`);
  } catch (e) {
    console.warn('[detect]', e);
    notify(`Détection impossible : ${(e as Error).message || 'erreur inconnue'}`);
  } finally {
    input?.dispose();
    useDetect.setState({ placing: false });
  }
}
