import { produce } from 'immer';
import { create } from 'zustand';
import { hashBlob } from '../lib/audio';
import { db } from '../lib/db';
import type { RefVideo } from '../lib/types';
import { useEditor } from '../store/editor';

/**
 * Reference video (dance practice, clip) watched alongside the stage.
 * The file stays on each device (its own IndexedDB store); the choreography only keeps its settings.
 * Everything about this feature lives in src/video and is switched by VIDEO_REFERENCE_ENABLED.
 */

export const REF_VIDEO_ACCEPT = 'video/*,.mp4,.m4v,.mov,.webm,.mkv,.3gp';

export type Corner = 'tl' | 'tr' | 'bl' | 'br';

interface RefVideoUi {
  visible: boolean;
  expanded: boolean;
  corner: Corner;
  hash: string | null;
  url: string | null;
  missing: boolean;
}

const stored = (key: string, fallback: string) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
};

export const useRefVideo = create<RefVideoUi>(() => ({
  visible: stored('fs-ref-visible', '1') === '1',
  expanded: false,
  corner: stored('fs-ref-corner', 'tr') as Corner,
  hash: null,
  url: null,
  missing: false,
}));

export function setRefVisible(visible: boolean) {
  store('fs-ref-visible', visible ? '1' : '0');
  useRefVideo.setState({ visible, expanded: false });
}

export function setRefCorner(corner: Corner) {
  store('fs-ref-corner', corner);
  useRefVideo.setState({ corner });
}

/** Changes the reference video settings (not part of undo, not sent to shared rooms). */
export function updateRefVideo(patch: Partial<RefVideo> | null) {
  const s = useEditor.getState();
  if (!s.doc) return;
  const next = produce(s.doc, (d) => {
    d.video = patch === null ? null : ({ ...(d.video ?? {}), ...patch } as RefVideo);
    d.updatedAt = Date.now();
  });
  useEditor.setState({ doc: next });
}

/** Loads the video file of this device into a playable URL. */
export async function loadRefVideo(hash: string | undefined) {
  const current = useRefVideo.getState();
  if (current.hash === (hash ?? null) && (current.url || current.missing)) return;
  if (current.url) URL.revokeObjectURL(current.url);
  if (!hash) return void useRefVideo.setState({ hash: null, url: null, missing: false });
  useRefVideo.setState({ hash, url: null, missing: false });
  const blob = await db.getVideo(hash);
  if (useRefVideo.getState().hash !== hash) return;
  useRefVideo.setState(blob ? { url: URL.createObjectURL(blob) } : { missing: true });
}

export interface RefImportStage {
  label: string;
  ratio?: number;
}

/** Reads a video, makes a light copy (about 480p, no sound) when it is big, and stores it on the device. */
export async function prepareReferenceVideo(file: File, onStage: (stage: RefImportStage) => void): Promise<RefVideo> {
  const mb = await import('mediabunny');
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('Ce fichier ne contient pas d’image vidéo.');
  const width = track.displayWidth;
  const height = track.displayHeight;
  const duration = await input.computeDuration();

  let blob: Blob = file;
  if (Math.max(width, height) > 900 || file.size > 60 * 1024 * 1024) {
    try {
      onStage({ label: 'Allègement de la vidéo…', ratio: 0 });
      const landscape = width >= height;
      const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() });
      const conversion = await mb.Conversion.init({
        input,
        output,
        video: { width: landscape ? 854 : 480, height: landscape ? 480 : 854, fit: 'contain', bitrate: 1_200_000, frameRate: 30 },
        audio: { discard: true },
      });
      if (!conversion.isValid) throw new Error('conversion impossible');
      conversion.onProgress = (ratio) => onStage({ label: 'Allègement de la vidéo…', ratio });
      await conversion.execute();
      if (output.target.buffer) blob = new Blob([output.target.buffer], { type: 'video/mp4' });
    } catch (e) {
      console.warn('[video] light copy impossible, original kept', e);
      if (file.size > 400 * 1024 * 1024) throw new Error('Vidéo trop lourde pour cet appareil (plus de 400 Mo). Essayez une version plus courte.');
      blob = file;
    }
  }

  onStage({ label: 'Enregistrement…' });
  const hash = await hashBlob(blob);
  await db.putVideo(hash, blob);
  return { hash, name: file.name.replace(/\.[^.]+$/, ''), duration: Math.round(duration * 100) / 100, width, height, offset: 0, mirror: false };
}

/** Removes the video from the choreography, and its file when no other choreography uses it. */
export async function removeRefVideo() {
  const s = useEditor.getState();
  const hash = s.doc?.video?.hash;
  const id = s.doc?.id;
  updateRefVideo(null);
  if (!hash) return;
  const others = (await db.listChoreos()).some((c) => c.id !== id && c.video?.hash === hash);
  if (!others) await db.deleteVideo(hash);
  void loadRefVideo(undefined);
}
