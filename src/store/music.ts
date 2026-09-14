import { create } from 'zustand';
import { computePeaks, decodeAudio, detectBpm, hashBlob } from '../lib/audio';
import { db } from '../lib/db';
import type { MusicInfo } from '../lib/types';
import { playback } from './playback';

interface MusicState {
  hash?: string;
  peaks: Float32Array | null;
  duration: number;
  loading: boolean;
  missing: boolean;
}

export const useMusic = create<MusicState>(() => ({ peaks: null, duration: 0, loading: false, missing: false }));

let token = 0;

export async function loadMusic(hash: string | undefined, fetchRemote?: (hash: string) => Promise<Blob | null>) {
  const current = useMusic.getState();
  if (hash && current.hash === hash && (current.peaks || current.loading)) return;
  const my = ++token;
  if (!hash) {
    playback.setBlob(null);
    useMusic.setState({ hash: undefined, peaks: null, duration: 0, loading: false, missing: false });
    return;
  }
  useMusic.setState({ hash, loading: true, missing: false, peaks: null });
  let blob = (await db.getAudio(hash)) ?? null;
  if (!blob && fetchRemote) blob = await fetchRemote(hash);
  if (my !== token) return;
  if (!blob) {
    playback.setBlob(null);
    useMusic.setState({ loading: false, missing: true });
    return;
  }
  playback.setBlob(blob);
  try {
    const buffer = await decodeAudio(blob);
    if (my !== token) return;
    useMusic.setState({ peaks: computePeaks(buffer), duration: buffer.duration, loading: false });
  } catch {
    useMusic.setState({ loading: false, missing: true });
  }
}

/** Stores the file offline, decodes it and estimates BPM. */
export async function importMusicFile(file: File): Promise<MusicInfo> {
  const hash = await hashBlob(file);
  await db.putAudio(hash, file);
  const buffer = await decodeAudio(file);
  const tempo = detectBpm(buffer);
  const my = ++token;
  playback.setBlob(file);
  useMusic.setState({ hash, peaks: computePeaks(buffer), duration: buffer.duration, loading: false, missing: false });
  void my;
  return {
    hash,
    name: file.name.replace(/\.[^.]+$/, ''),
    duration: Math.round(buffer.duration * 100) / 100,
    bpm: tempo?.bpm,
    beatOffset: tempo?.offset ?? 0,
    countsPerPhrase: 8,
  };
}

export async function redetectBpm(hash: string) {
  const blob = await db.getAudio(hash);
  if (!blob) return null;
  return detectBpm(await decodeAudio(blob));
}
