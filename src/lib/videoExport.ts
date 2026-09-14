import { decodeAudio } from './audio';
import { db } from './db';
import type { Choreo } from './types';
import { createRenderer, FPS, videoSize, type VideoOptions } from './videoRender';
import { createReferenceRenderer, type FrameRenderer, type ReferenceInput } from '../video/referenceRender';

export interface VideoResult {
  blob: Blob;
  ext: 'mp4' | 'webm';
  mode: 'fast' | 'realtime';
  hasAudio: boolean;
  width: number;
  height: number;
}

export interface VideoProgress {
  ratio: number;
  mode: 'fast' | 'realtime';
}

type Renderer = FrameRenderer;

/** Video export settings; `reference` adds the reference video beside / above the stage. */
export type VideoExportOptions = VideoOptions & { reference?: ReferenceInput };

const abortError = () => new DOMException('Export annulé', 'AbortError');
export const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

/** Yields to the event loop without being throttled like setTimeout in background tabs. */
const yieldUi = () =>
  new Promise<void>((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(0);
  });

async function audioSlice(hash: string, start: number, end: number): Promise<AudioBuffer | null> {
  const blob = await db.getAudio(hash);
  if (!blob) return null;
  const buf = await decodeAudio(blob);
  const s0 = Math.max(0, Math.floor(start * buf.sampleRate));
  const s1 = Math.min(buf.length, Math.ceil(end * buf.sampleRate));
  if (s1 - s0 < buf.sampleRate * 0.05) return null;
  const out = new AudioBuffer({ length: s1 - s0, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(s0, s1), c);
  return out;
}

/** Rejects if the encoder makes no progress for `ms` (so we can fall back to real-time recording). */
function stallGuard<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Encodeur bloqué')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function splitAudio(buf: AudioBuffer, seconds: number): AudioBuffer[] {
  const size = Math.round(buf.sampleRate * seconds);
  const out: AudioBuffer[] = [];
  for (let s = 0; s < buf.length; s += size) {
    const len = Math.min(size, buf.length - s);
    const part = new AudioBuffer({ length: len, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
    for (let c = 0; c < buf.numberOfChannels; c++) part.copyToChannel(buf.getChannelData(c).subarray(s, s + len), c);
    out.push(part);
  }
  return out;
}

export async function exportVideo(doc: Choreo, o: VideoExportOptions, onProgress: (p: VideoProgress) => void, signal: AbortSignal): Promise<VideoResult> {
  const { width, height } = videoSize(o.aspect, o.resolution);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const renderer: Renderer = o.reference ? createReferenceRenderer(doc, width, height, o, o.reference) : createRenderer(doc, width, height, o);
  const duration = Math.max(0.5, o.range.end - o.range.start);
  const audio = o.includeAudio && doc.music.hash ? await audioSlice(doc.music.hash, o.range.start, o.range.end).catch(() => null) : null;
  if (signal.aborted) throw abortError();

  if (typeof VideoEncoder !== 'undefined') {
    try {
      const res = await encodeFast(doc, canvas, ctx, renderer, o, duration, audio, onProgress, signal);
      if (res) return res;
    } catch (e) {
      if (isAbort(e)) throw e;
      console.warn('Encodage rapide impossible, enregistrement en temps réel', e);
    }
  }
  return recordRealtime(canvas, ctx, renderer, o, duration, audio, onProgress, signal);
}

async function encodeFast(
  _doc: Choreo,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  renderer: Renderer,
  o: VideoOptions,
  duration: number,
  audio: AudioBuffer | null,
  onProgress: (p: VideoProgress) => void,
  signal: AbortSignal,
): Promise<VideoResult | null> {
  const mb = await import('mediabunny');
  const vcodec = await mb.getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], { width: canvas.width, height: canvas.height });
  if (!vcodec) return null;

  let acodec: 'aac' | 'opus' | null = null;
  if (audio) {
    const aopts = { numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate };
    if (await mb.canEncodeAudio('aac', aopts)) acodec = 'aac';
    else {
      try {
        // AAC keeps the MP4 playable everywhere (QuickTime, Photos, WhatsApp, Instagram)
        const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
        registerAacEncoder();
        if (await mb.canEncodeAudio('aac', aopts)) acodec = 'aac';
      } catch (e) {
        console.warn('Encodeur AAC indisponible', e);
      }
    }
    if (!acodec && (await mb.canEncodeAudio('opus', aopts))) acodec = 'opus';
  }

  const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() });
  const video = new mb.CanvasSource(canvas, { codec: vcodec, quality: mb.QUALITY_HIGH, keyFrameInterval: 2 });
  output.addVideoTrack(video, { frameRate: FPS });
  const audioSource = audio && acodec ? new mb.AudioBufferSource({ codec: acodec, quality: mb.QUALITY_HIGH }) : null;
  if (audioSource) output.addAudioTrack(audioSource);
  await output.start();

  const frames = Math.max(1, Math.round(duration * FPS));
  // audio is fed in 1 s slices alongside the frames so the muxer can interleave both tracks
  const chunks = audio && audioSource ? splitAudio(audio, 1) : [];
  let audioTime = 0;
  let chunk = 0;
  try {
    for (let i = 0; i < frames; i++) {
      if (signal.aborted) throw abortError();
      const t = i / FPS;
      while (audioSource && chunk < chunks.length && audioTime <= t + 0.5) {
        await stallGuard(audioSource.add(chunks[chunk]), i === 0 ? 45_000 : 30_000);
        audioTime += chunks[chunk].duration;
        chunk++;
      }
      if (renderer.prepare) await stallGuard(renderer.prepare(o.range.start + t), 30_000);
      renderer.draw(ctx, o.range.start + t);
      await stallGuard(video.add(t, 1 / FPS), i === 0 ? 45_000 : 30_000);
      if (i % 8 === 0) {
        onProgress({ ratio: (i / frames) * 0.95, mode: 'fast' });
        await yieldUi();
      }
    }
    while (audioSource && chunk < chunks.length) await audioSource.add(chunks[chunk++]);
    onProgress({ ratio: 0.98, mode: 'fast' });
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  }
  return {
    blob: new Blob([output.target.buffer!], { type: 'video/mp4' }),
    ext: 'mp4',
    mode: 'fast',
    hasAudio: !!audioSource,
    width: canvas.width,
    height: canvas.height,
  };
}

async function recordRealtime(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  renderer: Renderer,
  o: VideoOptions,
  duration: number,
  audio: AudioBuffer | null,
  onProgress: (p: VideoProgress) => void,
  signal: AbortSignal,
): Promise<VideoResult> {
  if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) {
    throw new Error('Ce navigateur ne permet pas l’export vidéo. Essayez avec Chrome ou Safari à jour.');
  }
  const types = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t));
  const ac = new AudioContext();
  await ac.resume();
  const stream = canvas.captureStream(FPS);
  let src: AudioBufferSourceNode | null = null;
  if (audio) {
    src = ac.createBufferSource();
    src.buffer = audio;
    const dest = ac.createMediaStreamDestination();
    src.connect(dest);
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  }
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: o.resolution >= 1080 ? 10_000_000 : 6_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((resolve) => (rec.onstop = () => resolve()));

  await renderer.startRealtime?.(o.range.start);
  renderer.draw(ctx, o.range.start);
  rec.start(250);
  const t0 = ac.currentTime + 0.15;
  src?.start(t0);
  try {
    await new Promise<void>((resolve, reject) => {
      const tick = () => {
        if (signal.aborted) return reject(abortError());
        const elapsed = ac.currentTime - t0;
        renderer.draw(ctx, o.range.start + Math.max(0, Math.min(duration, elapsed)));
        onProgress({ ratio: Math.max(0, Math.min(1, elapsed / duration)), mode: 'realtime' });
        if (elapsed >= duration) return resolve();
        setTimeout(tick, 1000 / (FPS * 2));
      };
      tick();
    });
  } finally {
    if (rec.state !== 'inactive') rec.stop();
    try {
      src?.stop();
    } catch {
      /* already stopped */
    }
    stream.getTracks().forEach((t) => t.stop());
    renderer.stopRealtime?.();
  }
  await stopped;
  ac.close();
  const type = (rec.mimeType || mimeType || 'video/webm').split(';')[0];
  return {
    blob: new Blob(chunks, { type }),
    ext: type.includes('mp4') ? 'mp4' : 'webm',
    mode: 'realtime',
    hasAudio: !!audio,
    width: canvas.width,
    height: canvas.height,
  };
}
