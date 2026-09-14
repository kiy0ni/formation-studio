import { initials, samplePath, textOn } from './geometry';
import { computeFrame, countAt, formatTime, sortedDancers, sortedFormations, sortedProps, stageBounds, timeline } from './model';
import type { Choreo, ID } from './types';

export type Aspect = 'landscape' | 'square' | 'portrait';

export interface RenderOptions {
  audienceTop: boolean;
  showNames: boolean;
  showPaths: boolean;
  showCounts: boolean;
  showNotes: boolean;
  focusDancer: ID | null;
  range: { start: number; end: number };
}

export interface VideoOptions extends RenderOptions {
  aspect: Aspect;
  resolution: 720 | 1080;
  includeAudio: boolean;
}

export const FPS = 30;

export function videoSize(aspect: Aspect, res: 720 | 1080) {
  const long = Math.round((res * 16) / 9 / 2) * 2;
  if (aspect === 'landscape') return { width: long, height: res };
  if (aspect === 'square') return { width: res, height: res };
  return { width: res, height: long };
}

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

type Ctx = CanvasRenderingContext2D;

/** Draws choreography frames on a canvas for video export (and its preview). */
export function createRenderer(doc: Choreo, W: number, H: number, o: RenderOptions) {
  const u = Math.min(W, H) / 100;
  const pad = u * 4;
  const headerH = u * 14;
  const footerH = u * (o.showNotes ? 10 : 6);
  const stage = doc.stage;
  const hw = stage.width / 2;
  const hd = stage.depth / 2;
  const b = stageBounds(stage);
  const f = o.audienceTop ? -1 : 1;

  // world box in (possibly rotated) view space
  // frame the stage floor, widened only where dancers or props actually go (wings, backstage)
  let minX = -hw;
  let maxX = hw;
  let minY = -hd;
  for (const fm of Object.values(doc.formations)) {
    for (const p of Object.values(fm.positions)) {
      minX = Math.min(minX, p.x - 0.5);
      maxX = Math.max(maxX, p.x + 0.5);
      minY = Math.min(minY, p.y - 0.5);
    }
    for (const st of Object.values(fm.props)) {
      if (!st.visible) continue;
      const e = Math.max(st.w, st.h) / 2;
      minX = Math.min(minX, st.x - e);
      maxX = Math.max(maxX, st.x + e);
      minY = Math.min(minY, st.y - e);
    }
  }
  minX = Math.max(minX, b.minX);
  maxX = Math.min(maxX, b.maxX);
  minY = Math.max(minY, b.minY);
  const wx = [minX - 0.35, maxX + 0.35].map((v) => v * f);
  const wy = [minY - 0.35, b.maxY + 1.25].map((v) => v * f);
  const fx0 = Math.min(...wx);
  const fx1 = Math.max(...wx);
  const fy0 = Math.min(...wy);
  const fy1 = Math.max(...wy);
  const areaX = pad;
  const areaY = headerH;
  const areaW = W - pad * 2;
  const areaH = H - headerH - footerH - pad * 0.5;
  const s = Math.min(areaW / (fx1 - fx0), areaH / (fy1 - fy0));
  const ox = areaX + (areaW - (fx1 - fx0) * s) / 2 - fx0 * s;
  const oy = areaY + (areaH - (fy1 - fy0) * s) / 2 - fy0 * s;
  const X = (x: number) => ox + f * x * s;
  const Y = (y: number) => oy + f * y * s;

  const items = timeline(doc);
  const dancers = sortedDancers(doc);
  const props = sortedProps(doc);
  const formations = sortedFormations(doc);
  const r = Math.max((stage.dancerSize / 2) * s, u * 1.8);

  const worldRect = (g: Ctx, x0: number, y0: number, x1: number, y1: number) => {
    const a = X(x0);
    const c = X(x1);
    const p = Y(y0);
    const q = Y(y1);
    g.rect(Math.min(a, c), Math.min(p, q), Math.abs(c - a), Math.abs(q - p));
  };

  const line = (g: Ctx, x0: number, y0: number, x1: number, y1: number) => {
    g.beginPath();
    g.moveTo(X(x0), Y(y0));
    g.lineTo(X(x1), Y(y1));
    g.stroke();
  };

  // static layer rendered once
  const bg = document.createElement('canvas');
  bg.width = W;
  bg.height = H;
  {
    const g = bg.getContext('2d')!;
    const grad = g.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, Math.max(W, H) * 0.75);
    grad.addColorStop(0, '#1b1628');
    grad.addColorStop(1, '#0a0810');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    // keep wings / backstage out of the header and footer
    g.save();
    g.beginPath();
    g.rect(0, areaY - u, W, areaH + u * 2);
    g.clip();

    g.fillStyle = '#110e18';
    g.beginPath();
    worldRect(g, -hw - stage.wingWidth, -hd - stage.backstageDepth, -hw, hd);
    worldRect(g, hw, -hd - stage.backstageDepth, hw + stage.wingWidth, hd);
    g.fill();
    g.fillStyle = '#15111d';
    g.beginPath();
    worldRect(g, -hw, -hd - stage.backstageDepth, hw, -hd);
    g.fill();

    g.fillStyle = stage.floorColor;
    g.strokeStyle = 'rgba(255,255,255,0.14)';
    g.lineWidth = Math.max(1, u * 0.15);
    g.beginPath();
    worldRect(g, -hw, -hd, hw, hd);
    g.fill();
    g.stroke();

    if (stage.showGrid && stage.gridStep > 0) {
      for (let x = -hw + stage.gridStep; x < hw - 1e-6; x += stage.gridStep) {
        const major = Math.abs(x - Math.round(x)) < 1e-6;
        g.strokeStyle = major ? 'rgba(255,255,255,0.11)' : 'rgba(255,255,255,0.05)';
        g.lineWidth = Math.max(1, u * 0.08);
        line(g, x, -hd, x, hd);
      }
      for (let y = -hd + stage.gridStep; y < hd - 1e-6; y += stage.gridStep) {
        const major = Math.abs(y - Math.round(y)) < 1e-6;
        g.strokeStyle = major ? 'rgba(255,255,255,0.11)' : 'rgba(255,255,255,0.05)';
        g.lineWidth = Math.max(1, u * 0.08);
        line(g, -hw, y, hw, y);
      }
    }
    g.setLineDash([u * 1, u * 0.7]);
    g.strokeStyle = 'rgba(255,77,141,0.5)';
    g.lineWidth = Math.max(1, u * 0.2);
    line(g, 0, -hd, 0, hd);
    g.setLineDash([]);
    g.strokeStyle = '#ff4d8d';
    g.lineWidth = Math.max(2, u * 0.5);
    line(g, -hw, hd, hw, hd);
    g.restore();

    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (stage.showNumbers) {
      g.font = `700 ${Math.max(10, s * 0.26)}px ${FONT}`;
      for (let k = -Math.floor(hw); k <= Math.floor(hw); k++) {
        g.fillStyle = k === 0 ? '#ff4d8d' : 'rgba(255,255,255,0.6)';
        g.fillText(String(Math.abs(k)), X(k), Y(hd + 0.42));
      }
    }
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.font = `800 ${Math.max(10, s * 0.3)}px ${FONT}`;
    g.fillText('P U B L I C', X(0), Y(hd + 0.95));
    g.font = `700 ${Math.max(8, s * 0.17)}px ${FONT}`;
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.fillText('JARDIN', X(-hw + 0.7), Y(hd + 0.95));
    g.fillText('COUR', X(hw - 0.7), Y(hd + 0.95));

    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillStyle = 'rgba(239,234,247,0.55)';
    g.font = `600 ${u * 2.5}px ${FONT}`;
    g.fillText(ellipsize(g, doc.name, W * 0.55), pad, pad + u * 2.2);

    g.textAlign = 'right';
    g.fillStyle = 'rgba(239,234,247,0.28)';
    g.font = `600 ${u * 1.7}px ${FONT}`;
    g.fillText('Lineup', W - pad, H - u * 1.3);
  }

  function drawArrow(g: Ctx, a: { x: number; y: number }, z: { x: number; y: number }, size: number) {
    const ang = Math.atan2(Y(z.y) - Y(a.y), X(z.x) - X(a.x));
    g.beginPath();
    g.moveTo(X(z.x), Y(z.y));
    g.lineTo(X(z.x) - size * Math.cos(ang - 0.45), Y(z.y) - size * Math.sin(ang - 0.45));
    g.lineTo(X(z.x) - size * Math.cos(ang + 0.45), Y(z.y) - size * Math.sin(ang + 0.45));
    g.closePath();
    g.fill();
  }

  function draw(g: Ctx, t: number) {
    g.drawImage(bg, 0, 0);
    const fr = computeFrame(doc, t);
    const it = items[fr.index];
    const next = items[fr.index + 1];
    const holding = fr.progress === 0;

    // props
    for (const p of props) {
      const st = fr.props[p.id];
      if (!st?.visible) continue;
      g.save();
      g.translate(X(st.x), Y(st.y));
      g.rotate(((st.rotation + (o.audienceTop ? 180 : 0)) * Math.PI) / 180);
      g.fillStyle = st.color;
      g.strokeStyle = 'rgba(0,0,0,0.45)';
      g.lineWidth = Math.max(1, u * 0.12);
      g.beginPath();
      if (p.shape === 'rect') g.rect((-st.w / 2) * s, (-st.h / 2) * s, st.w * s, st.h * s);
      else g.ellipse(0, 0, (st.w / 2) * s, (st.h / 2) * s, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.restore();
    }

    // upcoming / current paths
    if (o.showPaths && it && next) {
      g.lineWidth = Math.max(1.5, s * 0.045);
      g.lineCap = 'round';
      g.lineJoin = 'round';
      for (const d of dancers) {
        const a = it.f.positions[d.id];
        const z = next.f.positions[d.id];
        if (!a || !z || (Math.hypot(a.x - z.x, a.y - z.y) < 0.05 && !z.path)) continue;
        const dim = o.focusDancer && o.focusDancer !== d.id;
        g.globalAlpha = dim ? 0.08 : holding ? 0.3 : 0.55;
        const pts = samplePath(a, z, z.path, 32);
        g.strokeStyle = d.color;
        g.fillStyle = d.color;
        g.beginPath();
        pts.forEach((p, i) => (i ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y))));
        g.stroke();
        drawArrow(g, pts[pts.length - 2], pts[pts.length - 1], Math.max(6, s * 0.18));
      }
      g.globalAlpha = 1;
    }

    // full route of the highlighted dancer
    const focus = o.focusDancer ? doc.dancers[o.focusDancer] : null;
    if (focus) {
      const route = formations.map((fm) => fm.positions[focus.id]).filter(Boolean);
      g.strokeStyle = focus.color;
      g.globalAlpha = 0.7;
      g.lineWidth = Math.max(1.5, s * 0.035);
      g.setLineDash([s * 0.14, s * 0.1]);
      g.beginPath();
      route.forEach((p, i) => (i ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y))));
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `700 ${Math.max(9, s * 0.17)}px ${FONT}`;
      route.forEach((p, i) => {
        g.fillStyle = '#0f0d17';
        g.strokeStyle = focus.color;
        g.lineWidth = Math.max(1, s * 0.03);
        g.beginPath();
        g.arc(X(p.x), Y(p.y), Math.max(7, s * 0.17), 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.fillStyle = '#fff';
        g.fillText(String(i + 1), X(p.x), Y(p.y) + 0.5);
      });
    }

    // dancers (highlighted one on top)
    const order = focus ? [...dancers.filter((d) => d.id !== focus.id), focus] : dancers;
    const nameSize = Math.max(u * 1.5, r * 0.62);
    for (const d of order) {
      const p = fr.dancers[d.id];
      if (!p) continue;
      const px = X(p.x);
      const py = Y(p.y);
      g.globalAlpha = focus && focus.id !== d.id ? 0.22 : 1;
      if (focus?.id === d.id) {
        g.fillStyle = d.color;
        g.globalAlpha = 0.25;
        g.beginPath();
        g.arc(px, py, r * 1.7, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
      }
      g.fillStyle = d.color;
      g.strokeStyle = 'rgba(0,0,0,0.55)';
      g.lineWidth = Math.max(1, r * 0.08);
      g.beginPath();
      g.arc(px, py, r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = textOn(d.color);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `800 ${r * 0.72}px ${FONT}`;
      g.fillText(initials(d.name), px, py + r * 0.04);
      if (o.showNames && !(focus && focus.id !== d.id)) {
        g.font = `600 ${nameSize}px ${FONT}`;
        const label = d.name.length > 12 ? `${d.name.slice(0, 11)}…` : d.name;
        g.lineWidth = nameSize * 0.3;
        g.strokeStyle = 'rgba(10,8,16,0.85)';
        g.lineJoin = 'round';
        g.strokeText(label, px, py + r + nameSize * 0.8);
        g.fillStyle = '#fff';
        g.fillText(label, px, py + r + nameSize * 0.8);
      }
    }
    g.globalAlpha = 1;

    // header
    if (it) {
      g.textAlign = 'left';
      g.textBaseline = 'alphabetic';
      g.font = `800 ${u * 5}px ${FONT}`;
      g.fillStyle = '#fff';
      const title = ellipsize(g, it.f.name, W * 0.6);
      g.fillText(title, pad, pad + u * 8.4);
      if (!holding && next) {
        const w = g.measureText(title).width;
        g.font = `600 ${u * 3.2}px ${FONT}`;
        g.fillStyle = 'rgba(239,234,247,0.6)';
        g.fillText(ellipsize(g, `→ ${next.f.name}`, W * 0.9 - w - pad * 3 - u * 16), pad + w + u * 2, pad + u * 8.4);
      }
    }
    const count = o.showCounts ? countAt(doc.music, t) : null;
    g.textAlign = 'right';
    if (count) {
      const bw = u * 15;
      const bh = u * 7.5;
      const bx = W - pad - bw;
      const by = pad + u * 1.2;
      const gr = g.createLinearGradient(bx, by, bx + bw, by + bh);
      gr.addColorStop(0, '#ff4d8d');
      gr.addColorStop(1, '#7c5cff');
      g.fillStyle = gr;
      g.beginPath();
      g.roundRect(bx, by, bw, bh, bh / 2);
      g.fill();
      g.textBaseline = 'middle';
      g.textAlign = 'center';
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.font = `600 ${u * 2.3}px ${FONT}`;
      g.fillText(`${count.phrase} ·`, bx + bw * 0.36, by + bh / 2);
      g.fillStyle = '#fff';
      g.font = `800 ${u * 4.6}px ${FONT}`;
      g.fillText(String(count.count), bx + bw * 0.66, by + bh / 2 + u * 0.2);
      g.textBaseline = 'alphabetic';
      g.textAlign = 'right';
      g.fillStyle = 'rgba(239,234,247,0.55)';
      g.font = `600 ${u * 2.1}px ${FONT}`;
      g.fillText(formatTime(t, false), W - pad, by + bh + u * 3);
    } else {
      g.fillStyle = '#fff';
      g.font = `700 ${u * 3.4}px ${FONT}`;
      g.fillText(formatTime(t, false), W - pad, pad + u * 7);
    }

    // footer: note + progress bar with formation segments
    const barY = H - pad - u * 1.6;
    const barH = u * 1.3;
    const barX = pad;
    const barW = W - pad * 2 - u * 18;
    const span = Math.max(0.01, o.range.end - o.range.start);
    const toBar = (tt: number) => barX + (Math.min(Math.max(tt, o.range.start), o.range.end) - o.range.start) / span * barW;
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.beginPath();
    g.roundRect(barX, barY, barW, barH, barH / 2);
    g.fill();
    for (const item of items) {
      if (item.end < o.range.start || item.start > o.range.end) continue;
      const x0 = toBar(item.start);
      const x1 = toBar(item.holdEnd);
      g.fillStyle = item.index === fr.index ? '#ff4d8d' : '#4a3d6d';
      if (x1 - x0 > 1) {
        g.beginPath();
        g.roundRect(x0 + 1, barY, Math.max(1, x1 - x0 - 2), barH, barH / 2);
        g.fill();
      }
      if (item.index < items.length - 1) {
        const x2 = toBar(item.end);
        g.fillStyle = 'rgba(124,92,255,0.35)';
        if (x2 - x1 > 1) g.fillRect(x1, barY + barH * 0.3, x2 - x1, barH * 0.4);
      }
    }
    const ph = toBar(t);
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(ph, barY + barH / 2, barH * 0.9, 0, Math.PI * 2);
    g.fill();

    if (o.showNotes && it?.f.note && holding) {
      g.textAlign = 'left';
      g.textBaseline = 'alphabetic';
      g.font = `italic 500 ${u * 2.4}px ${FONT}`;
      g.fillStyle = 'rgba(239,234,247,0.75)';
      g.fillText(ellipsize(g, it.f.note.replace(/\s+/g, ' '), W - pad * 2), pad, barY - u * 2);
    }
  }

  return { draw, width: W, height: H };
}

function ellipsize(g: Ctx, text: string, max: number): string {
  if (max <= 0) return '';
  if (g.measureText(text).width <= max) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (g.measureText(text.slice(0, mid) + '…').width <= max) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + '…';
}
