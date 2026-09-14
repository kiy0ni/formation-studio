export async function hashBlob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  if (crypto.subtle) {
    const d = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(d).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Non-secure context fallback (LAN over http): 2×FNV-1a
  const bytes = new Uint8Array(buf);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 0x01000193);
    h2 = Math.imul(h2 ^ bytes[bytes.length - 1 - i], 0x01000193);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0') + bytes.length.toString(16);
}

let ctx: AudioContext | null = null;
export function audioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

export async function decodeAudio(blob: Blob): Promise<AudioBuffer> {
  const buf = await blob.arrayBuffer();
  return audioContext().decodeAudioData(buf);
}

/** Max-abs peaks, `perSecond` values per second of audio. */
export function computePeaks(buffer: AudioBuffer, perSecond = 100): Float32Array {
  const len = Math.ceil(buffer.duration * perSecond);
  const out = new Float32Array(len);
  const block = buffer.sampleRate / perSecond;
  const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) => buffer.getChannelData(c));
  for (let i = 0; i < len; i++) {
    const s = Math.floor(i * block);
    const e = Math.min(channels[0].length, Math.floor((i + 1) * block));
    let max = 0;
    for (let j = s; j < e; j += 4) {
      for (const ch of channels) {
        const v = Math.abs(ch[j]);
        if (v > max) max = v;
      }
    }
    out[i] = max;
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, v);
  if (peak > 0) for (let i = 0; i < len; i++) out[i] /= peak;
  return out;
}

/** Tempo estimation via onset-envelope autocorrelation. */
export function detectBpm(buffer: AudioBuffer): { bpm: number; offset: number } | null {
  const sr = buffer.sampleRate;
  const hop = 512;
  const win = 1024;
  const start = Math.floor(Math.min(buffer.duration * 0.1, 5) * sr);
  const end = Math.min(buffer.length, start + Math.floor(90 * sr));
  if (end - start < sr * 8) return null;
  const a = buffer.getChannelData(0);
  const b = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : a;
  const frames = Math.floor((end - start - win) / hop);
  const energy = new Float32Array(frames);
  let lp = 0;
  for (let f = 0; f < frames; f++) {
    let e = 0;
    const off = start + f * hop;
    for (let i = 0; i < win; i += 2) {
      const v = (a[off + i] + b[off + i]) * 0.5;
      lp += 0.25 * (v - lp); // emphasize kick / bass
      e += lp * lp + v * v * 0.3;
    }
    energy[f] = Math.log1p(e * 100);
  }
  const onset = new Float32Array(frames);
  for (let f = 1; f < frames; f++) onset[f] = Math.max(0, energy[f] - energy[f - 1]);
  // remove local mean
  const smooth = new Float32Array(frames);
  const W = 8;
  let acc = 0;
  for (let f = 0; f < frames; f++) {
    acc += onset[f] - (f >= 2 * W ? onset[f - 2 * W] : 0);
    smooth[f] = Math.max(0, onset[Math.max(0, f - W)] - acc / (2 * W));
  }
  const fps = sr / hop;
  let best = { bpm: 0, score: -Infinity };
  const scores: number[] = [];
  for (let bpm = 70; bpm <= 180; bpm += 0.5) {
    const lag = (60 * fps) / bpm;
    let s = 0;
    for (const mult of [1, 2]) {
      const L = lag * mult;
      const li = Math.floor(L);
      const frac = L - li;
      for (let f = 0; f + li + 1 < frames; f++) s += smooth[f] * (smooth[f + li] * (1 - frac) + smooth[f + li + 1] * frac) / mult;
    }
    const weight = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    s *= weight;
    scores.push(s);
    if (s > best.score) best = { bpm, score: s };
  }
  if (!best.bpm) return null;
  let bpm = best.bpm;
  if (Math.abs(bpm - Math.round(bpm)) <= 0.5) bpm = Math.round(bpm);
  const lag = (60 * fps) / bpm;
  let bestPhase = 0;
  let bestSum = -1;
  for (let p = 0; p < lag; p++) {
    let sum = 0;
    for (let k = p; k < frames; k += lag) sum += smooth[Math.round(k)] ?? 0;
    if (sum > bestSum) {
      bestSum = sum;
      bestPhase = p;
    }
  }
  const beat = 60 / bpm;
  let offset = (start + bestPhase * hop + win / 2) / sr;
  offset = offset % beat;
  return { bpm, offset: Math.round(offset * 1000) / 1000 };
}

export function click(accent: boolean) {
  const c = audioContext();
  const o = c.createOscillator();
  const g = c.createGain();
  o.frequency.value = accent ? 1760 : 1100;
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.3, c.currentTime + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.06);
  o.connect(g).connect(c.destination);
  o.start();
  o.stop(c.currentTime + 0.07);
}
