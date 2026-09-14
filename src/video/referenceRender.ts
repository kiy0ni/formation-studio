import type { Choreo, RefVideo } from '../lib/types';
import { createRenderer, FPS, type Aspect, type VideoOptions } from '../lib/videoRender';

/** What the video exporter needs from a frame renderer. */
export interface FrameRenderer {
  draw: (ctx: CanvasRenderingContext2D, t: number) => void;
  /** Fast export: called before each frame, in order. */
  prepare?: (t: number) => Promise<void>;
  /** Real-time recording fallback. */
  startRealtime?: (t: number) => Promise<void>;
  stopRealtime?: () => void;
}

export interface ReferenceInput {
  blob: Blob;
  info: RefVideo;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 16:9 → video beside the stage; 9:16 and square → video above the stage. */
export function referenceLayout(W: number, H: number, aspect: Aspect): { video: Rect; stage: Rect } {
  if (aspect === 'landscape') {
    const w = Math.round((W * 0.46) / 2) * 2;
    return { video: { x: 0, y: 0, w, h: H }, stage: { x: w, y: 0, w: W - w, h: H } };
  }
  const h = Math.round((H * (aspect === 'portrait' ? 0.4 : 0.45)) / 2) * 2;
  return { video: { x: 0, y: 0, w: W, h }, stage: { x: 0, y: h, w: W, h: H - h } };
}

export function createReferenceRenderer(doc: Choreo, W: number, H: number, o: VideoOptions, ref: ReferenceInput) {
  const layout = referenceLayout(W, H, o.aspect);
  const stage = createRenderer(doc, layout.stage.w, layout.stage.h, o);
  const stageCanvas = document.createElement('canvas');
  stageCanvas.width = layout.stage.w;
  stageCanvas.height = layout.stage.h;
  const stageCtx = stageCanvas.getContext('2d', { alpha: false })!;
  const u = Math.min(W, H) / 100;

  let frame: CanvasImageSource | null = null;
  let frameW = ref.info.width;
  let frameH = ref.info.height;
  const videoTime = (t: number) => Math.max(0, Math.min(Math.max(0, ref.info.duration - 0.04), t + ref.info.offset));

  const setFrame = (source: CanvasImageSource | null, w?: number, h?: number) => {
    frame = source;
    if (w && h) {
      frameW = w;
      frameH = h;
    }
  };

  const drawVideo = (ctx: CanvasRenderingContext2D) => {
    const r = layout.video;
    ctx.fillStyle = '#000';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    if (frame && frameW && frameH) {
      const s = Math.min(r.w / frameW, r.h / frameH);
      const dw = frameW * s;
      const dh = frameH * s;
      const dx = r.x + (r.w - dw) / 2;
      const dy = r.y + (r.h - dh) / 2;
      ctx.save();
      if (ref.info.mirror) {
        ctx.translate(dx + dw, dy);
        ctx.scale(-1, 1);
        ctx.drawImage(frame, 0, 0, dw, dh);
      } else ctx.drawImage(frame, dx, dy, dw, dh);
      ctx.restore();
    }
    const label = ref.info.mirror ? 'Référence · miroir' : 'Référence';
    ctx.font = `600 ${Math.round(u * 2.4)}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
    const tw = ctx.measureText(label).width;
    const px = r.x + u * 2;
    const py = r.y + u * 2;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    ctx.roundRect(px, py, tw + u * 3, u * 4.6, u * 2.3);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, px + u * 1.5, py + u * 2.3);
  };

  const draw = (ctx: CanvasRenderingContext2D, t: number) => {
    stage.draw(stageCtx, t);
    ctx.drawImage(stageCanvas, layout.stage.x, layout.stage.y);
    drawVideo(ctx);
  };

  // fast export: frames decoded in order by the video library
  let frames: AsyncIterator<{ canvas: HTMLCanvasElement | OffscreenCanvas } | null> | null = null;
  let unavailable = false;
  const prepare = async () => {
    if (unavailable) return;
    if (!frames) {
      const mb = await import('mediabunny');
      const input = new mb.Input({ source: new mb.BlobSource(ref.blob), formats: mb.ALL_FORMATS });
      const track = await input.getPrimaryVideoTrack();
      if (!track) {
        unavailable = true;
        return;
      }
      const r = layout.video;
      const s = Math.min(r.w / track.displayWidth, r.h / track.displayHeight);
      const sink = new mb.CanvasSink(track, { width: Math.max(2, Math.round(track.displayWidth * s)), height: Math.max(2, Math.round(track.displayHeight * s)), fit: 'fill' });
      const count = Math.max(1, Math.round(Math.max(0.5, o.range.end - o.range.start) * FPS));
      const times = (function* () {
        for (let i = 0; i < count; i++) yield videoTime(o.range.start + i / FPS);
      })();
      frames = sink.canvasesAtTimestamps(times)[Symbol.asyncIterator]();
    }
    const next = await frames.next();
    if (!next.done && next.value) {
      const c = next.value.canvas;
      setFrame(c as CanvasImageSource, c.width, c.height);
    }
  };

  // real-time recording: a playing <video> element
  let element: HTMLVideoElement | null = null;
  let url: string | null = null;
  const startRealtime = async (t: number) => {
    url = URL.createObjectURL(ref.blob);
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.src = url;
    element = v;
    await new Promise<void>((resolve) => {
      v.onloadeddata = () => resolve();
      v.onerror = () => resolve();
      setTimeout(resolve, 4000);
    });
    v.currentTime = videoTime(t);
    await new Promise<void>((resolve) => {
      v.onseeked = () => resolve();
      setTimeout(resolve, 1500);
    });
    setFrame(v, v.videoWidth, v.videoHeight);
    await v.play().catch(() => {});
  };
  const stopRealtime = () => {
    element?.pause();
    element = null;
    if (url) URL.revokeObjectURL(url);
    url = null;
  };

  return { draw, prepare, startRealtime, stopRealtime, setFrame, layout };
}
