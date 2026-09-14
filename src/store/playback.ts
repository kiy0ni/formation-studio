import { click } from '../lib/audio';
import { beatLength, totalDuration } from '../lib/model';
import { useEditor } from './editor';

/**
 * Playback clock. A performance.now() clock drives the animation; while the <audio>
 * element is actually progressing it is the master and the clock re-anchors to it.
 * If audio stalls (buffering, no output device) visuals keep moving.
 */
class Playback {
  audio: HTMLAudioElement;
  private url: string | null = null;
  private raf = 0;
  private anchorTime = 0;
  private anchorNow = 0;
  private lastAudioTime = -1;
  /** When audio.currentTime last changed (it moves in coarse steps). */
  private audioSampleNow = 0;
  private lastPlayAttempt = 0;
  private lastBeat = -1;

  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    (this.audio as any).preservesPitch = true;
  }

  setBlob(blob: Blob | null) {
    this.pause();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = blob ? URL.createObjectURL(blob) : null;
    if (this.url) this.audio.src = this.url;
    else this.audio.removeAttribute('src');
  }

  get hasAudio() {
    return !!this.url && Number.isFinite(this.audio.duration);
  }

  play() {
    const s = useEditor.getState();
    if (!s.doc || s.playing) return;
    const end = totalDuration(s.doc);
    if (s.time >= end - 0.05) s.setTime(s.loop ? s.loop.a : 0);
    useEditor.setState({ playing: true });
    this.anchor(useEditor.getState().time);
    this.startAudio(useEditor.getState().time);
    this.lastBeat = -1;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  private anchor(t: number, now = performance.now()) {
    this.anchorTime = t;
    this.anchorNow = now;
  }

  private startAudio(t: number) {
    if (!this.url) return;
    const dur = this.audio.duration;
    this.audio.playbackRate = useEditor.getState().rate;
    if (Number.isFinite(dur) && t < dur) {
      this.audio.currentTime = t;
      this.lastAudioTime = -1;
      this.lastPlayAttempt = performance.now();
      if (this.audio.paused) this.audio.play().catch(() => {});
    } else if (!this.audio.paused) this.audio.pause();
  }

  pause() {
    cancelAnimationFrame(this.raf);
    if (!this.audio.paused) this.audio.pause();
    if (useEditor.getState().playing) useEditor.setState({ playing: false });
  }

  toggle() {
    if (useEditor.getState().playing) this.pause();
    else this.play();
  }

  seek(t: number) {
    const s = useEditor.getState();
    s.setTime(t);
    if (s.playing) {
      const now = useEditor.getState().time;
      this.anchor(now);
      this.startAudio(now);
    }
  }

  setRate(rate: number) {
    const s = useEditor.getState();
    if (s.playing) this.anchor(s.time);
    useEditor.setState({ rate });
    this.audio.playbackRate = rate;
  }

  private tick = (now: number) => {
    const s = useEditor.getState();
    if (!s.playing || !s.doc) return;
    const end = totalDuration(s.doc);
    let t = this.anchorTime + ((now - this.anchorNow) / 1000) * s.rate;

    const dur = this.audio.duration;
    if (this.url && Number.isFinite(dur)) {
      if (t < dur) {
        if (!this.audio.paused) {
          const at = this.audio.currentTime;
          if (at !== this.lastAudioTime) {
            // currentTime advances in coarse steps (about 250 ms in Safari) and is read late when the page is busy
            // (e.g. decoding the reference video): extrapolate it instead of snapping the clock back to a stale value
            this.lastAudioTime = at;
            this.audioSampleNow = now;
          }
          const audioNow = at + ((now - this.audioSampleNow) / 1000) * s.rate;
          const drift = audioNow - t;
          if (Math.abs(drift) > 0.5) {
            // real jump (audio stalled or restarted): follow the music
            this.anchor(audioNow, now);
            t = audioNow;
          } else if (Math.abs(drift) > 0.03) {
            // small drift: ease towards the music, never visibly backwards
            this.anchorTime += drift * 0.08;
            t = Math.max(s.time, this.anchorTime + ((now - this.anchorNow) / 1000) * s.rate);
          }
        } else if (now - this.lastPlayAttempt > 1000) this.startAudio(t);
      } else if (!this.audio.paused) this.audio.pause();
    }

    if (s.loop && t >= s.loop.b) {
      t = s.loop.a;
      s.setTime(t);
      this.anchor(t, now);
      this.startAudio(t);
    } else if (t >= end) {
      s.setTime(end);
      this.pause();
      return;
    } else {
      s.setTime(t);
    }

    if (s.metronome) {
      const bl = beatLength(s.doc.music);
      if (bl) {
        const beat = Math.floor((t - (s.doc.music.beatOffset ?? 0)) / bl);
        if (beat !== this.lastBeat && beat >= 0) {
          if (this.lastBeat !== -1) click(beat % (s.doc.music.countsPerPhrase || 8) === 0);
          this.lastBeat = beat;
        }
      }
    }
    this.raf = requestAnimationFrame(this.tick);
  };
}

export const playback = new Playback();
