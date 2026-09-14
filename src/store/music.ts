import { create } from 'zustand';
import { computePeaks, decodeAudio, detectBpm, hashBlob } from '../lib/audio';
import { db } from '../lib/db';
import { audioBufferToWav, extractAudio, isVideoFile } from '../lib/media';
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
  let blob: Blob | null = (await db.getAudio(hash)) ?? null;
  if (blob && !(blob instanceof Blob)) blob = null; // unreadable entry
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

export type ImportStage = 'extract' | 'analyze';

/**
 * Stores the song offline, decodes it and estimates BPM.
 * Videos are accepted: only their sound track is kept.
 */
export async function importMusicFile(file: File, onStage?: (stage: ImportStage) => void): Promise<MusicInfo & { fromVideo: boolean }> {
  const fromVideo = isVideoFile(file);
  let audio: Blob = file;
  if (fromVideo) {
    onStage?.('extract');
    audio = await extractAudio(file);
  }
  onStage?.('analyze');
  let buffer: AudioBuffer;
  try {
    buffer = await decodeAudio(audio);
  } catch (e) {
    if (!fromVideo) throw e;
    // the extracted track isn't playable here: decode the video itself and keep a WAV
    buffer = await decodeAudio(file);
    audio = audioBufferToWav(buffer);
  }
  const hash = await hashBlob(audio);
  await db.putAudio(hash, audio);
  const tempo = detectBpm(buffer);
  ++token;
  playback.setBlob(audio);
  useMusic.setState({ hash, peaks: computePeaks(buffer), duration: buffer.duration, loading: false, missing: false });
  return {
    hash,
    name: file.name.replace(/\.[^.]+$/, ''),
    duration: Math.round(buffer.duration * 100) / 100,
    bpm: tempo?.bpm,
    beatOffset: tempo?.offset ?? 0,
    countsPerPhrase: 8,
    fromVideo,
  };
}

export async function redetectBpm(hash: string) {
  const blob = await db.getAudio(hash);
  if (!blob) return null;
  return detectBpm(await decodeAudio(blob));
}
