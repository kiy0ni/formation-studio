// Detection maths on a made-up video: 3 people with different clothes, two held formations and a crossing.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Analysis, Det } from '../src/detect/analysis';
import { fitFloor, toFloor } from '../src/detect/floor';
import { alignToGrid, defaultMapping, DEFAULT_PLACEMENT, findFormations, placeTracks, routeFrom } from '../src/detect/formations';
import { meanSignature, sigDistance, SIGNATURE_LENGTH } from '../src/detect/signature';
import { trackPeople } from '../src/detect/track';
import { defaultStage } from '../src/lib/model';

const WIDTH = 854;
const HEIGHT = 480;
const FPS = 5;
const H = 0.4; // everyone the same height on screen: a flat floor (no perspective)
const W = 0.15;

/** A look: one strong color bin per body part, different for each person. */
function look(person: number): number[] {
  const sig = new Array<number>(SIGNATURE_LENGTH).fill(0);
  for (let region = 0; region < 7; region++) sig[region * 28 + 4 + ((person * 3 + region) % 24)] = 255;
  return sig;
}

/** Where each person stands (fractions of the image) at time t: hold, walk (two of them cross), hold. */
function positionsAt(t: number): [number, number][] {
  const a: [number, number][] = [
    [0.25, 0.8],
    [0.5, 0.8],
    [0.75, 0.8],
  ];
  const b: [number, number][] = [
    [0.75, 0.6],
    [0.5, 0.9],
    [0.25, 0.6],
  ];
  const k = t < 4 ? 0 : t > 7 ? 1 : (t - 4) / 3;
  return a.map(([x, y], i) => [x + (b[i][0] - x) * k, y + (b[i][1] - y) * k]);
}

function synthetic(): { an: Analysis; truth: number[][] } {
  const times: number[] = [];
  for (let t = 0.1; t < 12; t += 1 / FPS) times.push(Math.round(t * 1000) / 1000);
  const frames: Det[][] = [];
  const truth: number[][] = [];
  times.forEach((t, i) => {
    const people = positionsAt(t).map(([fx, fy], person) => ({ person, det: { x: fx - W / 2, y: fy - H, w: W, h: H, s: 0.9, sig: look(person) } as Det }));
    // detections come in no particular order, and someone is missed now and then
    const order = people.sort(() => ((i * 7919) % 3) - 1);
    const kept = i % 17 === 5 ? order.slice(1) : order;
    frames.push(kept.map((e) => e.det));
    truth.push(kept.map((e) => e.person));
  });
  return { an: { version: 5, hash: 'test', fps: FPS, duration: 12, width: WIDTH, height: HEIGHT, times, frames, thumbs: [], createdAt: 0 }, truth };
}

test('looks: same person close, different people far, any scale of counts', () => {
  assert.equal(sigDistance(look(0), look(0)), 0);
  assert.ok(sigDistance(look(0), look(1)) > 0.9);
  const half = look(0).map((v) => v / 2);
  assert.equal(sigDistance(look(0), half), 0);
  const mean = meanSignature([look(0), look(0)]);
  assert.ok(sigDistance(mean, look(0)) < 1e-9);
});

test('tracking: each person followed through the crossing', () => {
  const { an, truth } = synthetic();
  const floor = fitFloor(an.frames.flat(), an.width, an.height);
  assert.equal(floor.perspective, false);
  const tracking = trackPeople(an, floor);
  assert.equal(tracking.suggested, 3);
  assert.equal(tracking.tracks.length, 3);
  for (const track of tracking.tracks) {
    const seen: Record<number, number> = {};
    let total = 0;
    track.det.forEach((k, i) => {
      if (k < 0) return;
      seen[truth[i][k]] = (seen[truth[i][k]] ?? 0) + 1;
      total++;
    });
    const best = Math.max(...Object.values(seen));
    assert.ok(total > an.times.length * 0.9, `person seen on ${total} of ${an.times.length} images`);
    assert.ok(best >= total * 0.97, `one person per track: ${JSON.stringify(seen)}`);
  }
  assert.ok(tracking.confidence.every((c) => c > 0.8), `sure of everyone: ${tracking.confidence.map((c) => c.toFixed(2))}`);
});

test('formations: two holds at the right moments, positions as seen', () => {
  const { an } = synthetic();
  const floor = fitFloor(an.frames.flat(), an.width, an.height);
  const tracking = trackPeople(an, floor);
  const placed = placeTracks(tracking.tracks, defaultStage(), DEFAULT_PLACEMENT);
  const formations = findFormations(placed.tracks, an.times, an.fps, 0.5);
  assert.equal(formations.length, 2, `found ${formations.map((f) => `${f.start}-${f.end}`).join(' ')}`);
  assert.ok(formations[0].start < 0.5 && Math.abs(formations[0].end - 4) < 0.6);
  assert.ok(Math.abs(formations[1].start - 7) < 0.6 && formations[1].end > 11);
  // the two on the sides crossed: whoever was left is right afterwards, the middle one stays in the middle
  const order = placed.tracks.map((_, k) => k).sort((a, b) => formations[0].positions[a].x - formations[0].positions[b].x);
  const first = order.map((k) => formations[0].positions[k].x);
  const second = order.map((k) => formations[1].positions[k].x);
  assert.ok(second[0] > second[1] && second[1] > second[2], `after the crossing: ${second.map((x) => x.toFixed(1))}`);
  // real distances: 0.25 of the image ≈ 1.8 m between neighbours here
  assert.ok(first[2] - first[0] > 2 && first[2] - first[0] < 5, `spread ${(first[2] - first[0]).toFixed(1)} m`);
});

test('routes: a dancer who waits before moving gets a late start', () => {
  const n = 20;
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  for (let i = 0; i < n; i++) xs[i] = i < 10 ? 0 : ((i - 10) / 9) * 3;
  const route = routeFrom({ xs, ys, seen: new Uint8Array(n).fill(1) }, 0, n - 1, { x: 0, y: 0 }, { x: 3, y: 0 }, defaultStage());
  assert.ok(route.timing && route.timing.start >= 0.4, JSON.stringify(route));
  assert.equal(route.path, undefined);
});

test('grid: the nearest mark, never two dancers on the same one', () => {
  const stage = { ...defaultStage(), gridStep: 0.5 };
  const out = alignToGrid(
    [
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.2 },
      { x: 1.3, y: -0.4 },
    ],
    stage,
  );
  assert.deepEqual(out[0], { x: 0, y: 0 });
  assert.deepEqual(out[1], { x: 0.2, y: 0.2 });
  assert.deepEqual(out[2], { x: 1.5, y: -0.5 });
});

test('who dances who: left to right, extra people ignored', () => {
  const mapping = defaultMapping(
    [
      { x: 2, y: 0 },
      { x: -2, y: 0 },
      { x: 0, y: 0 },
    ],
    [
      { id: 'left', x: -1.5 },
      { id: 'right', x: 1.5 },
    ],
  );
  assert.deepEqual(mapping, ['right', 'left', null]);
});

test('floor: further away means smaller, positions come back in meters', () => {
  const dets = [];
  for (let k = 0; k < 60; k++) {
    const feet = 0.55 + (k % 12) * 0.035;
    const h = 0.12 + (feet - 0.55) * 0.9;
    dets.push({ x: 0.2 + (k % 5) * 0.12, y: feet - h, w: h / 2.8, h, s: 0.9 });
  }
  const floor = fitFloor(dets, WIDTH, HEIGHT);
  assert.equal(floor.perspective, true);
  const near = toFloor(floor, dets[11]);
  const far = toFloor(floor, dets[0]);
  assert.ok(near.y > far.y, 'closer to the camera = larger y');
});

test('crossings: noticed when two people come together or part', async () => {
  const { crossingBetween } = await import('../src/detect/crossing');
  const box = (cx: number) => ({ x: cx - 0.075, y: 0.4, w: 0.15, h: 0.4 });
  const apart = [box(0.2), box(0.6)];
  const together = [box(0.35), box(0.45)];
  assert.equal(crossingBetween(apart, together), true);
  assert.equal(crossingBetween(together, apart), true);
  assert.equal(crossingBetween(apart, [box(0.22), box(0.58)]), false);
  assert.equal(crossingBetween([box(0.5)], together), false);
});
