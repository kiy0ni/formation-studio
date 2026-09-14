import { decodeAudio } from './audio';

/** File picker filter: songs and videos (only the sound of a video is kept). */
export const MEDIA_ACCEPT = 'audio/*,video/*,.mp3,.wav,.m4a,.aac,.ogg,.oga,.opus,.flac,.mp4,.m4v,.mov,.webm,.mkv,.3gp';

const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac)$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|3gp|avi)$/i;

export const isVideoFile = (f: File) => f.type.startsWith('video/') || (!f.type.startsWith('audio/') && VIDEO_EXT.test(f.name));
export const isMediaFile = (f: File) => f.type.startsWith('audio/') || f.type.startsWith('video/') || AUDIO_EXT.test(f.name) || VIDEO_EXT.test(f.name);

export class NoSoundError extends Error {
  constructor() {
    super('Cette vidéo ne contient pas de son.');
  }
}

/**
 * Pulls the sound track out of a video into a small audio file.
 * The audio is copied as-is when possible (fast, no quality loss); otherwise the browser decodes it into a WAV.
 */
export async function extractAudio(file: File): Promise<Blob> {
  try {
    const mb = await import('mediabunny');
    const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new NoSoundError();
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() });
    const conversion = await mb.Conversion.init({ input, output, tracks: 'primary', video: { discard: true } });
    if (!conversion.isValid) throw new Error('conversion impossible');
    await conversion.execute();
    if (!output.target.buffer) throw new Error('aucune donnée audio');
    return new Blob([output.target.buffer], { type: 'audio/mp4' });
  } catch (e) {
    if (e instanceof NoSoundError) throw e;
    console.warn('Extraction directe impossible, décodage complet de la vidéo', e);
    try {
      return audioBufferToWav(await decodeAudio(file));
    } catch {
      throw new Error('Impossible de lire le son de cette vidéo.');
    }
  }
}

/** 16-bit PCM WAV, readable by every browser. */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const channels = Math.min(2, buffer.numberOfChannels);
  const length = buffer.length;
  const bytes = 44 + length * channels * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const text = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, length * channels * 2, true);
  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < channels; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([view.buffer], { type: 'audio/wav' });
}
