import { create } from 'zustand';
import { notify } from '../components/common/Toast';
import { hashBlob } from '../lib/audio';
import { db } from '../lib/db';
import type { RefVideo } from '../lib/types';
import { useEditor } from '../store/editor';

/**
 * Reference video (dance practice, clip) watched alongside the stage.
 * The file stays on each device (its own IndexedDB store); its settings travel with the choreography
 * (other devices, shared rooms), so everyone only has to import the video on their side.
 * Everything about this feature lives in src/video.
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
  /** Video being prepared in the background (music imported from a video). */
  job: { choreoId: string; label: string; ratio?: number } | null;
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
  job: null,
}));

export function setRefVisible(visible: boolean) {
  store('fs-ref-visible', visible ? '1' : '0');
  useRefVideo.setState({ visible, expanded: false });
}

export function setRefCorner(corner: Corner) {
  store('fs-ref-corner', corner);
  useRefVideo.setState({ corner });
}

/** Changes the reference video settings like any edit: undoable, synced to other devices and shared rooms. */
export function updateRefVideo(patch: Partial<RefVideo> | null) {
  const s = useEditor.getState();
  if (!s.doc) return;
  s.update(patch === null ? 'Retirer la vidéo de référence' : 'Vidéo de référence', (d) => {
    d.video = patch === null ? null : ({ ...(d.video ?? {}), ...patch } as RefVideo);
  });
}

/** Loads the video file of this device into a playable URL. */
export async function loadRefVideo(hash: string | undefined, force = false) {
  const current = useRefVideo.getState();
  if (!force && current.hash === (hash ?? null) && (current.url || current.missing)) return;
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

/** The picked video does not last as long as the one set on the choreography. */
export class RefDurationMismatch extends Error {
  constructor(
    public found: number,
    public expected: number,
  ) {
    super('durée différente');
  }
}

/**
 * Reads a video, makes a light copy (about 480p, no sound) when it is big, and stores it on the device.
 * `keepHash`: the choreography already names this video (imported on another device): store it under that name.
 */
export async function prepareReferenceVideo(
  file: File,
  onStage: (stage: RefImportStage) => void,
  options: { keepHash?: string; expectDuration?: number; force?: boolean } = {},
): Promise<RefVideo> {
  const mb = await import('mediabunny');
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('Ce fichier ne contient pas d’image vidéo.');
  const width = track.displayWidth;
  const height = track.displayHeight;
  const duration = await input.computeDuration();
  if (options.expectDuration && !options.force && Math.abs(duration - options.expectDuration) > 1.5) throw new RefDurationMismatch(duration, options.expectDuration);

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
  const hash = options.keepHash ?? (await hashBlob(blob));
  await db.putVideo(hash, blob);
  return { hash, name: file.name.replace(/\.[^.]+$/, ''), duration: Math.round(duration * 100) / 100, width, height, offset: 0, mirror: false };
}

/**
 * Music imported from a video: keep its image as the reference video too, prepared in the background.
 * Never replaces a reference video the choreography already has.
 */
export async function attachReferenceVideo(choreoId: string, file: File) {
  useRefVideo.setState({ job: { choreoId, label: 'Préparation de la vidéo…' } });
  try {
    const info = await prepareReferenceVideo(file, (stage) => useRefVideo.setState({ job: { choreoId, ...stage } }));
    const s = useEditor.getState();
    if (s.doc?.id === choreoId) {
      if (s.doc.video) return;
      updateRefVideo(info);
    } else {
      // a choreography just created may still be saving: wait for it a moment
      let doc = await db.getChoreo(choreoId);
      for (let i = 0; !doc && i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        doc = await db.getChoreo(choreoId);
      }
      const open = useEditor.getState().doc;
      if (open?.id === choreoId) {
        if (open.video) return;
        updateRefVideo(info);
      } else if (doc && !doc.video) await db.saveChoreo({ ...doc, video: info, updatedAt: Date.now() });
      else return;
    }
    setRefVisible(true);
    notify('Vidéo de référence ajoutée · Plus → Vidéo de référence pour la retirer');
  } catch (e) {
    notify(`Vidéo de référence non gardée : ${(e as Error).message || 'vidéo illisible'}`);
  } finally {
    if (useRefVideo.getState().job?.choreoId === choreoId) useRefVideo.setState({ job: null });
  }
}

/** Removes the video from the choreography, and its file when no other choreography uses it. */
export async function removeRefVideo() {
  const s = useEditor.getState();
  const hash = s.doc?.video?.hash;
  const id = s.doc?.id;
  updateRefVideo(null);
  if (!hash) return;
  const others = (await db.listChoreos()).some((c) => c.id !== id && c.video?.hash === hash);
  if (!others) {
    await db.deleteVideo(hash);
    // what the detection found in it is useless without the video
    void import('../detect/analysis').then((m) => m.forgetAnalysis(hash));
  }
  void loadRefVideo(undefined);
}
