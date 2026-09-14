import { create } from 'zustand';
import { notify } from '../components/common/Toast';
import { db } from '../lib/db';
import { r2 } from '../lib/geometry';
import { clampToStage, computeFrame, sortedDancers } from '../lib/model';
import type { Position } from '../lib/types';
import { currentItem, useEditor } from '../store/editor';
import { playback } from '../store/playback';
import { analysisSize, loadAnalysis, runAnalysis, type Ghosts } from './analysis';
import { loadDetector } from './detector';
import { fitFloor, toFloor } from './floor';
import { applyTransform, DEFAULT_PLACEMENT, defaultMapping, placeTracks } from './formations';
import { trackPeople } from './track';

interface DetectUi {
  open: boolean;
  job: { hash: string; label: string; ratio?: number } | null;
  error: string;
  ghosts: Ghosts | null;
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

export const useDetect = create<DetectUi>(() => ({ open: false, job: null, error: '', ghosts: null, showGhosts: readShow(), placing: false }));

export function setShowGhosts(show: boolean) {
  try {
    localStorage.setItem('fs-detect-ghosts', show ? '1' : '0');
  } catch {
    /* private mode */
  }
  useDetect.setState({ showGhosts: show });
}

let controller: AbortController | null = null;

/** Runs in the background: the window can be closed and opened again while it works. */
export function startAnalysis(hash: string) {
  if (useDetect.getState().job) return;
  controller = new AbortController();
  const signal = controller.signal;
  useDetect.setState({ job: { hash, label: 'Préparation…' }, error: '' });
  let lock: { release: () => Promise<void> } | null = null;
  // keeps a phone screen awake during the analysis
  (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
    ?.request('screen')
    .then((l) => (lock = l))
    .catch(() => {});
  runAnalysis(hash, (p) => useDetect.setState({ job: { hash, ...p } }), signal)
    .then(() => notify('Analyse terminée'))
    .catch((e: Error) => {
      if (e.name !== 'AbortError') {
        console.warn('[detect]', e);
        useDetect.setState({ error: `Analyse impossible : ${e.message || 'erreur inconnue'}` });
      }
    })
    .finally(() => {
      void lock?.release().catch(() => {});
      controller = null;
      useDetect.setState({ job: null });
    });
}

export function cancelAnalysis() {
  controller?.abort();
}

/** Places the dancers of the formation on screen from the video image at the playhead. */
export async function placeFromFrame() {
  const start = useEditor.getState();
  const video = start.doc?.video;
  if (!start.doc || !video || start.readOnly || useDetect.getState().placing) return;
  useDetect.setState({ placing: true });
  try {
    const blob = await db.getVideo(video.hash);
    if (!blob) throw new Error('vidéo absente sur cet appareil');
    const [detector, mb] = await Promise.all([loadDetector(), import('mediabunny')]);
    const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('pas d’image dans la vidéo');
    const { width, height } = analysisSize(track.displayWidth, track.displayHeight);
    const sink = new mb.CanvasSink(track, { width, height, fit: 'fill', poolSize: 1 });
    const at = Math.max(0, Math.min(video.duration - 0.05, start.time + video.offset));
    const frame = await sink.getCanvas(at);
    if (!frame) throw new Error('image introuvable à ce moment');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.drawImage(frame.canvas, 0, 0, width, height);
    const boxes = detector.detect(canvas).filter((b) => b.score >= 0.3);
    if (!boxes.length) return notify('Personne trouvé sur cette image');

    const s = useEditor.getState();
    const doc = s.doc;
    if (!doc || doc.id !== start.doc.id) return;
    const analysis = await loadAnalysis(video.hash);
    const dets = boxes.map((b) => ({ ...b, s: b.score, sig: [] }));
    let points;
    if (analysis) {
      // same scale and placement as the full analysis
      const floor = fitFloor(analysis.frames.flat(), analysis.width, analysis.height);
      const transform = analysis.review?.transform ?? placeTracks(trackPeople(analysis, floor).tracks, doc.stage, DEFAULT_PLACEMENT).transform;
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
    const mapping = defaultMapping(points, dancers.map((d) => ({ id: d.id, x: target.f.positions[d.id]?.x ?? 0 })));
    let placed = 0;
    s.update('Placer depuis la vidéo', (d) => {
      const f = d.formations[target.f.id];
      mapping.forEach((id, k) => {
        if (!id || !d.dancers[id]) return;
        const old = f.positions[id];
        const p = clampToStage(points[k], d.stage);
        const next: Position = { x: r2(p.x), y: r2(p.y) };
        if (old?.timing) next.timing = old.timing;
        if (old?.comment) next.comment = old.comment;
        f.positions[id] = next;
        placed++;
      });
    });
    if (now.progress > 0 && !s.playing) playback.seek(target.start);
    notify(`${placed} danseur${placed > 1 ? 's' : ''} placé${placed > 1 ? 's' : ''} d’après la vidéo · ${boxes.length} personne${boxes.length > 1 ? 's' : ''} vue${boxes.length > 1 ? 's' : ''}`);
  } catch (e) {
    console.warn('[detect]', e);
    notify(`Détection impossible : ${(e as Error).message || 'erreur inconnue'}`);
  } finally {
    useDetect.setState({ placing: false });
  }
}
