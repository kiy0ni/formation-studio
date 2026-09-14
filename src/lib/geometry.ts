import type { Easing, PathSpec, Vec } from './types';

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const round = (v: number, step = 0.01) => Math.round(v / step) * step;
export const r2 = (v: number) => Math.round(v * 100) / 100;

export const vlerp = (a: Vec, b: Vec, t: number): Vec => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

export function ease(kind: Easing, t: number): number {
  t = clamp(t, 0, 1);
  switch (kind) {
    case 'linear':
      return t;
    case 'easeIn':
      return t * t * t;
    case 'easeOut':
      return 1 - Math.pow(1 - t, 3);
    default:
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
}

function quad(a: Vec, c: Vec, b: Vec, t: number): Vec {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

function catmull(p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) };
}

/** Samples a path as a polyline (not arc-length parametrized). */
export function samplePath(from: Vec, to: Vec, path: PathSpec | undefined, steps = 32): Vec[] {
  if (!path || path.kind === 'linear' || path.points.length === 0) return [from, to];
  if (path.kind === 'curve') {
    const c = path.points[0];
    const out: Vec[] = [];
    for (let i = 0; i <= steps; i++) out.push(quad(from, c, to, i / steps));
    return out;
  }
  const pts = [from, ...path.points, to];
  const out: Vec[] = [from];
  const per = Math.max(4, Math.round(steps / (pts.length - 1)));
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 1; s <= per; s++) out.push(catmull(p0, p1, p2, p3, s / per));
  }
  return out;
}

const polyCache = new WeakMap<PathSpec, { key: string; poly: Vec[]; cum: number[] }>();

/** Point along a path at normalized arc-length t. */
export function pointOnPath(from: Vec, to: Vec, path: PathSpec | undefined, t: number): Vec {
  if (!path || path.kind === 'linear' || path.points.length === 0) return vlerp(from, to, t);
  const key = `${from.x},${from.y},${to.x},${to.y}`;
  let entry = polyCache.get(path);
  if (!entry || entry.key !== key) {
    const poly = samplePath(from, to, path, 64);
    const cum = [0];
    for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + dist(poly[i - 1], poly[i]));
    entry = { key, poly, cum };
    polyCache.set(path, entry);
  }
  const { poly, cum } = entry;
  const total = cum[cum.length - 1];
  if (total === 0) return from;
  const target = clamp(t, 0, 1) * total;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < target) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  return vlerp(poly[i - 1], poly[i], (target - cum[i - 1]) / seg);
}

export function pathLength(from: Vec, to: Vec, path?: PathSpec) {
  const poly = samplePath(from, to, path, 64);
  let l = 0;
  for (let i = 1; i < poly.length; i++) l += dist(poly[i - 1], poly[i]);
  return l;
}

export function centroid(pts: Vec[]): Vec {
  if (!pts.length) return { x: 0, y: 0 };
  const s = pts.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
  return { x: s.x / pts.length, y: s.y / pts.length };
}

export function rotateAround(p: Vec, c: Vec, deg: number): Vec {
  const a = (deg * Math.PI) / 180;
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * Math.cos(a) - dy * Math.sin(a), y: c.y + dx * Math.sin(a) + dy * Math.cos(a) };
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  const n = parseInt(full.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function lerpColor(a: string, b: string, t: number): string {
  if (a === b) return a;
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const c = ca.map((v, i) => Math.round(lerp(v, cb[i], t)));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Readable text color on a given background. */
export function textOn(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#15121f' : '#ffffff';
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) {
    const n = parts[0];
    const digits = n.match(/\d+$/);
    if (digits && n.length > digits[0].length) return (n[0] + digits[0]).toUpperCase().slice(0, 3);
    return n.slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
