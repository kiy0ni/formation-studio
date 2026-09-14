import { dist } from './geometry';
import type { ID, StageSettings, Vec } from './types';

export type PresetCategory = 'Lignes' | 'Formes' | 'K-pop';

export interface Preset {
  id: string;
  name: string;
  category: PresetCategory;
  hint?: string;
  generate: (n: number, s: number) => Vec[];
}

const centered = (count: number, s: number, offset = 0) =>
  Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * s + offset);

/** Rows listed front → back. */
function rows(sizes: number[], s: number, depth: number, stagger: boolean): Vec[] {
  const out: Vec[] = [];
  const total = sizes.length;
  sizes.forEach((count, r) => {
    const prev = sizes[r - 1];
    const shift = stagger && r > 0 && (count % 2) === (prev % 2) ? (r % 2 ? s / 2 : 0) : 0;
    const y = ((total - 1) / 2 - r) * depth;
    centered(count, s, shift).forEach((x) => out.push({ x, y }));
  });
  const cx = out.reduce((a, p) => a + p.x, 0) / (out.length || 1);
  return out.map((p) => ({ x: p.x - cx, y: p.y }));
}

function splitRows(n: number, k: number): number[] {
  const base = Math.floor(n / k);
  const extra = n % k;
  // front rows get the extras
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0)).filter((c) => c > 0);
}

function perimeter(poly: Vec[], n: number, closed = true): Vec[] {
  const pts = closed ? [...poly, poly[0]] : poly;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];
  const out: Vec[] = [];
  const count = closed ? n : Math.max(1, n - 1);
  for (let k = 0; k < n; k++) {
    const target = n === 1 ? total / 2 : (k / count) * total;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < target) i++;
    const seg = cum[i] - cum[i - 1] || 1;
    const t = (target - cum[i - 1]) / seg;
    out.push({ x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t });
  }
  return out;
}

function curve(fn: (t: number) => Vec, n: number, closed: boolean, samples = 400): Vec[] {
  const poly = Array.from({ length: samples + (closed ? 0 : 1) }, (_, i) => fn(i / samples));
  return perimeter(poly, n, closed);
}

function vShape(n: number, s: number, pointFront: boolean): Vec[] {
  const out: Vec[] = [];
  const a = s * 0.75;
  if (n % 2) {
    out.push({ x: 0, y: 0 });
    for (let k = 1; k <= (n - 1) / 2; k++) out.push({ x: -k * a, y: -k * a * 0.9 }, { x: k * a, y: -k * a * 0.9 });
  } else {
    for (let k = 0; k < n / 2; k++)
      out.push({ x: -(k + 0.5) * a, y: -k * a * 0.9 }, { x: (k + 0.5) * a, y: -k * a * 0.9 });
  }
  return recenter(pointFront ? out : out.map((p) => ({ x: p.x, y: -p.y })));
}

export function recenter(pts: Vec[]): Vec[] {
  if (!pts.length) return pts;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return pts.map((p) => ({ x: p.x - cx, y: p.y - cy }));
}

function triangleRows(n: number): number[] {
  const out: number[] = [];
  let left = n;
  let k = 1;
  while (left > 0) {
    out.push(Math.min(k, left));
    left -= k;
    k++;
  }
  return out;
}

function hexCluster(n: number, s: number): Vec[] {
  const pts: Vec[] = [{ x: 0, y: 0 }];
  for (let ring = 1; pts.length < n; ring++) {
    for (let side = 0; side < 6 && pts.length < n; side++) {
      for (let k = 0; k < ring && pts.length < n; k++) {
        const a0 = (Math.PI / 3) * side + Math.PI / 2;
        const a1 = (Math.PI / 3) * (side + 1) + Math.PI / 2;
        const p0 = { x: Math.cos(a0) * ring, y: Math.sin(a0) * ring };
        const p1 = { x: Math.cos(a1) * ring, y: Math.sin(a1) * ring };
        const t = k / ring;
        pts.push({ x: (p0.x + (p1.x - p0.x) * t) * s, y: (p0.y + (p1.y - p0.y) * t) * s });
      }
    }
  }
  return pts;
}

export const PRESETS: Preset[] = [
  { id: 'line', name: 'Ligne', category: 'Lignes', generate: (n, s) => centered(n, s).map((x) => ({ x, y: 0 })) },
  {
    id: 'two-rows',
    name: 'Deux lignes',
    category: 'Lignes',
    generate: (n, s) => rows(splitRows(n, 2), s, s * 1.1, false),
  },
  {
    id: 'window',
    name: 'Quinconce',
    hint: 'Lignes décalées pour que tout le monde soit visible',
    category: 'Lignes',
    generate: (n, s) => rows(splitRows(n, n >= 9 ? 3 : 2), s, s * 0.9, true),
  },
  {
    id: 'three-rows',
    name: 'Trois lignes',
    category: 'Lignes',
    generate: (n, s) => rows(splitRows(n, Math.min(3, n)), s, s, false),
  },
  {
    id: 'column',
    name: 'Colonne',
    category: 'Lignes',
    generate: (n, s) => centered(n, s * 0.8).map((y) => ({ x: 0, y })),
  },
  {
    id: 'diagonal',
    name: 'Diagonale',
    category: 'Lignes',
    generate: (n, s) => centered(n, 1).map((k) => ({ x: k * s * 0.85, y: k * s * 0.6 })),
  },
  {
    id: 'zigzag',
    name: 'Zigzag',
    category: 'Lignes',
    generate: (n, s) => centered(n, s * 0.8).map((x, i) => ({ x, y: i % 2 ? -s * 0.45 : s * 0.45 })),
  },
  { id: 'v', name: 'V', hint: 'Pointe vers le public', category: 'Formes', generate: (n, s) => vShape(n, s, true) },
  { id: 'lambda', name: 'V inversé', hint: 'Pointe au fond', category: 'Formes', generate: (n, s) => vShape(n, s, false) },
  {
    id: 'triangle',
    name: 'Pyramide',
    hint: 'Centre devant, rangs derrière',
    category: 'Formes',
    generate: (n, s) => rows(triangleRows(n), s, s * 0.85, false),
  },
  {
    id: 'triangle-inv',
    name: 'Pyramide inversée',
    category: 'Formes',
    generate: (n, s) => rows(triangleRows(n).reverse(), s, s * 0.85, false),
  },
  {
    id: 'circle',
    name: 'Cercle',
    category: 'Formes',
    generate: (n, s) => {
      const r = Math.max(s * 0.9, (n * s) / (2 * Math.PI));
      return Array.from({ length: n }, (_, i) => {
        const a = Math.PI / 2 + (2 * Math.PI * i) / n;
        return { x: Math.cos(a) * r, y: Math.sin(a) * r };
      });
    },
  },
  {
    id: 'arc',
    name: 'Arc (bow)',
    hint: 'Extrémités vers le public',
    category: 'Formes',
    generate: (n, s) => {
      const span = Math.PI * 0.8;
      const r = Math.max(s * 1.2, (n * s) / span);
      return recenter(
        Array.from({ length: n }, (_, i) => {
          const a = n === 1 ? 0 : -span / 2 + (span * i) / (n - 1);
          return { x: Math.sin(a) * r, y: -Math.cos(a) * r };
        }),
      );
    },
  },
  {
    id: 'arc-inv',
    name: 'Arc inversé',
    hint: 'Centre vers le public',
    category: 'Formes',
    generate: (n, s) => {
      const span = Math.PI * 0.8;
      const r = Math.max(s * 1.2, (n * s) / span);
      return recenter(
        Array.from({ length: n }, (_, i) => {
          const a = n === 1 ? 0 : -span / 2 + (span * i) / (n - 1);
          return { x: Math.sin(a) * r, y: Math.cos(a) * r };
        }),
      );
    },
  },
  {
    id: 'diamond',
    name: 'Losange',
    category: 'Formes',
    generate: (n, s) => {
      if (n <= 3) return centered(n, s).map((x) => ({ x, y: 0 }));
      const inner = n >= 5 && n % 4 === 1 ? 1 : 0;
      const r = Math.max(s, ((n - inner) * s) / 5.2);
      const pts = perimeter(
        [
          { x: 0, y: r },
          { x: r, y: 0 },
          { x: 0, y: -r },
          { x: -r, y: 0 },
        ],
        n - inner,
      );
      return inner ? [{ x: 0, y: 0 }, ...pts] : pts;
    },
  },
  {
    id: 'x',
    name: 'X',
    category: 'Formes',
    generate: (n, s) => {
      const out: Vec[] = n % 2 ? [{ x: 0, y: 0 }] : [];
      const arms = n - out.length;
      for (let k = 0; k < arms; k++) {
        const ring = Math.floor(k / 4) + (out.length ? 1 : 0.6);
        const d = ring * s * 0.75;
        const q = k % 4;
        out.push({ x: q === 0 || q === 3 ? -d : d, y: q < 2 ? d * 0.85 : -d * 0.85 });
      }
      return out;
    },
  },
  {
    id: 'grid',
    name: 'Grille',
    category: 'Formes',
    generate: (n, s) => {
      const cols = Math.ceil(Math.sqrt(n * 1.4));
      return rows(splitRows(n, Math.ceil(n / cols)), s, s * 0.9, false);
    },
  },
  {
    id: 'square',
    name: 'Carré',
    category: 'Formes',
    generate: (n, s) => {
      const half = Math.max(s * 0.8, (n * s) / 8);
      return perimeter(
        [
          { x: -half, y: half },
          { x: half, y: half },
          { x: half, y: -half },
          { x: -half, y: -half },
        ],
        n,
      );
    },
  },
  {
    id: 'double-circle',
    name: 'Double cercle',
    category: 'Formes',
    generate: (n, s) => {
      const inner = Math.max(1, Math.round(n / 3));
      const outer = n - inner;
      const ro = Math.max(s * 1.6, (outer * s) / (2 * Math.PI));
      const ri = ro * 0.45;
      const ring = (count: number, r: number, off: number) =>
        Array.from({ length: count }, (_, i) => {
          const a = Math.PI / 2 + off + (2 * Math.PI * i) / count;
          return { x: Math.cos(a) * r, y: Math.sin(a) * r };
        });
      return [...ring(inner, inner === 1 ? 0 : ri, Math.PI / inner), ...ring(outer, ro, 0)];
    },
  },
  {
    id: 'heart',
    name: 'Cœur',
    hint: 'Pose de fin',
    category: 'Formes',
    generate: (n, s) => {
      const scale = Math.max(0.12, (n * s) / 100);
      return recenter(
        curve(
          (t) => {
            const a = t * Math.PI * 2;
            return {
              x: 16 * Math.pow(Math.sin(a), 3) * scale,
              y: -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) * scale,
            };
          },
          n,
          true,
        ),
      );
    },
  },
  {
    id: 'center-wings',
    name: 'Centre + ailes',
    hint: 'Le/la center devant, les autres en ailes',
    category: 'K-pop',
    generate: (n, s) => {
      const out: Vec[] = [{ x: 0, y: s * 0.9 }];
      for (let k = 0; k < n - 1; k++) {
        const side = k % 2 ? 1 : -1;
        const step = Math.floor(k / 2);
        out.push({ x: side * s * (0.9 + step * 0.9), y: -step * s * 0.35 });
      }
      return recenter(out);
    },
  },
  {
    id: 'center-back',
    name: 'Centre + rang arrière',
    hint: 'Solo devant, groupe en ligne derrière',
    category: 'K-pop',
    generate: (n, s) => [{ x: 0, y: s * 1.2 }, ...centered(n - 1, s).map((x) => ({ x, y: -s * 0.6 }))],
  },
  {
    id: 'split',
    name: 'Deux groupes',
    hint: 'Sous-unités gauche / droite',
    category: 'K-pop',
    generate: (n, s) => {
      const left = Math.ceil(n / 2);
      const make = (count: number, cx: number) =>
        rows(splitRows(count, count > 3 ? 2 : 1), s * 0.75, s * 0.75, true).map((p) => ({ x: p.x + cx, y: p.y }));
      const gap = s * (1.5 + Math.ceil(left / 2) * 0.5);
      return [...make(left, -gap), ...make(n - left, gap)];
    },
  },
  {
    id: 'cluster',
    name: 'Groupe serré',
    hint: 'Pour les poses de groupe / bloc',
    category: 'K-pop',
    generate: (n, s) => hexCluster(n, s * 0.62),
  },
  {
    id: 'stairs',
    name: 'Escalier',
    hint: 'Diagonale par paires (effet canon)',
    category: 'K-pop',
    generate: (n, s) => {
      const pairs = Math.ceil(n / 2);
      const out: Vec[] = [];
      for (let i = 0; i < n; i++) {
        const p = Math.floor(i / 2);
        out.push({ x: (i % 2 ? 0.45 : -0.45) * s + (p - (pairs - 1) / 2) * s * 0.7, y: (p - (pairs - 1) / 2) * s * 0.7 });
      }
      return out;
    },
  },
  {
    id: 'wedge',
    name: 'Flèche',
    hint: 'V rempli, pointe devant',
    category: 'K-pop',
    generate: (n, s) => {
      const sizes = triangleRows(n);
      return rows(sizes, s * 0.85, s * 0.7, true);
    },
  },
];

export const PRESET_BY_ID = Object.fromEntries(PRESETS.map((p) => [p.id, p]));

/** Scales the layout down if it doesn't fit, then moves it to `center`. */
export function fitLayout(pts: Vec[], stage: StageSettings, center: Vec): Vec[] {
  if (!pts.length) return pts;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  const maxW = stage.width * 0.92;
  const maxH = stage.depth * 0.88;
  const k = Math.min(1, w > 0 ? maxW / w : 1, h > 0 ? maxH / h : 1);
  const moved = pts.map((p) => ({ x: p.x * k + center.x, y: p.y * k + center.y }));
  // keep inside stage
  const mx = Math.max(...moved.map((p) => p.x)) - stage.width / 2;
  const nx = -stage.width / 2 - Math.min(...moved.map((p) => p.x));
  const my = Math.max(...moved.map((p) => p.y)) - stage.depth / 2;
  const ny = -stage.depth / 2 - Math.min(...moved.map((p) => p.y));
  const dx = mx > 0 ? -mx : nx > 0 ? nx : 0;
  const dy = my > 0 ? -my : ny > 0 ? ny : 0;
  return moved.map((p) => ({ x: Math.round((p.x + dx) * 100) / 100, y: Math.round((p.y + dy) * 100) / 100 }));
}

/** Classic O(n³) Hungarian algorithm — returns assignment[row] = col. */
export function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  const m = cost[0]?.length ?? 0;
  const u = new Array(n + 1).fill(0);
  const v = new Array(m + 1).fill(0);
  const p = new Array(m + 1).fill(0);
  const way = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(Infinity);
    const used = new Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const ans = new Array(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j]) ans[p[j] - 1] = j - 1;
  return ans;
}

export type AssignMode = 'nearest' | 'order';

export function assignSlots(ids: ID[], current: Vec[], slots: Vec[], mode: AssignMode): Record<ID, Vec> {
  const out: Record<ID, Vec> = {};
  if (mode === 'order') {
    const sorted = slots
      .map((p, i) => ({ p, i }))
      .sort((a, b) => (Math.abs(a.p.x - b.p.x) < 0.05 ? b.p.y - a.p.y : a.p.x - b.p.x));
    ids.forEach((id, i) => (out[id] = sorted[i].p));
    return out;
  }
  const cost = current.map((c) => slots.map((s) => (c.x - s.x) ** 2 + (c.y - s.y) ** 2));
  const res = hungarian(cost);
  ids.forEach((id, i) => (out[id] = slots[res[i]]));
  return out;
}
