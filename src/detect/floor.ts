import type { Vec } from '../lib/types';

/** Height of a standing dancer (m): the ruler used to turn the image into meters. */
const PERSON_HEIGHT = 1.65;

/**
 * How the room floor looks in the video, learned from the dancers themselves: the further someone stands,
 * the smaller they look and the higher their feet are in the image. Nothing to calibrate by hand.
 */
export interface FloorModel {
  /** Height of a person (fraction of the image height) = slope × feet line + intercept. */
  slope: number;
  intercept: number;
  typical: number;
  perspective: boolean;
  /** Image width / height. */
  aspect: number;
  /** Focal length in image heights (usual phone / camera lens). */
  focal: number;
}

interface BoxLike {
  x: number;
  y: number;
  w: number;
  h: number;
  s: number;
}

const feet = (d: { x: number; y: number; w: number; h: number }) => ({ x: d.x + d.w / 2, y: Math.min(1, d.y + d.h) });

export function percentile(values: ArrayLike<number>, p: number) {
  if (!values.length) return 0;
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];
}
export const median = (values: ArrayLike<number>) => percentile(values, 0.5);

function linearFit(points: { y: number; h: number }[]) {
  const n = points.length;
  if (n < 10) return null;
  let sy = 0;
  let sh = 0;
  let syy = 0;
  let syh = 0;
  for (const p of points) {
    sy += p.y;
    sh += p.h;
    syy += p.y * p.y;
    syh += p.y * p.h;
  }
  const den = n * syy - sy * sy;
  if (Math.abs(den) < 1e-9) return null;
  const slope = (n * syh - sy * sh) / den;
  return { slope, intercept: (sh - slope * sy) / n };
}

export function fitFloor(dets: BoxLike[], width: number, height: number): FloorModel {
  const aspect = width / height;
  const focal = (0.71 * Math.max(width, height)) / height;
  // people standing, seen whole
  const standing = dets.filter((d) => d.s >= 0.45 && d.y > 0.005 && d.y + d.h < 0.985 && d.h > 0.06 && (d.h * height) / Math.max(1e-6, d.w * width) > 1.4);
  const pool = standing.length >= 5 ? standing : dets.filter((d) => d.s >= 0.3);
  const typical = median(pool.map((d) => d.h)) || 0.3;
  const model: FloorModel = { slope: 0, intercept: typical, typical, perspective: false, aspect, focal };
  if (standing.length < 30) return model;
  let points = standing.map((d) => ({ y: feet(d).y, h: d.h }));
  for (let pass = 0; pass < 3; pass++) {
    const fit = linearFit(points);
    if (!fit) break;
    model.slope = fit.slope;
    model.intercept = fit.intercept;
    // arms up, crouching, jumping: set aside and fit again
    points = points.filter((p) => Math.abs(p.h - (fit.slope * p.y + fit.intercept)) < 0.18 * Math.max(0.02, fit.slope * p.y + fit.intercept));
  }
  const ys = standing.map((d) => feet(d).y);
  const far = percentile(ys, 0.05);
  model.perspective = model.slope > 0.05 && percentile(ys, 0.95) - far > 0.04 && model.slope * far + model.intercept > 0.3 * typical;
  if (!model.perspective) {
    model.slope = 0;
    model.intercept = typical;
  }
  return model;
}

/** Usual height (fraction of the image) of a standing person whose feet are on this line of the image. */
export function personHeight(m: FloorModel, feetY: number) {
  return Math.max(0.35 * m.typical, m.perspective ? m.slope * feetY + m.intercept : m.typical);
}

/** Where a person stands on the floor, in meters (x: right as seen from the camera, y: towards the camera). */
export function toFloor(m: FloorModel, d: { x: number; y: number; w: number; h: number }): Vec {
  const f = feet(d);
  if (m.perspective) {
    const h = Math.max(0.35 * m.typical, m.slope * f.y + m.intercept);
    const meters = PERSON_HEIGHT / h;
    return { x: (f.x - 0.5) * m.aspect * meters, y: -m.focal * meters };
  }
  // camera without visible depth: the feet line gives a rough depth
  const meters = PERSON_HEIGHT / m.typical;
  return { x: (f.x - 0.5) * m.aspect * meters, y: f.y * meters * 2.5 };
}
