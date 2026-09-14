import { findCollisions, type Collision } from '../lib/model';
import type { Choreo } from '../lib/types';
import { useEditor } from './editor';

let cache: { f: Choreo['formations']; d: Choreo['dancers']; size: number; res: Collision[] } | null = null;

export function collisionsOf(doc: Choreo): Collision[] {
  if (cache && cache.f === doc.formations && cache.d === doc.dancers && cache.size === doc.stage.dancerSize) return cache.res;
  const res = findCollisions(doc);
  cache = { f: doc.formations, d: doc.dancers, size: doc.stage.dancerSize, res };
  return res;
}

const EMPTY: Collision[] = [];
export function useCollisions(): Collision[] {
  return useEditor((s) => (s.doc ? collisionsOf(s.doc) : EMPTY));
}
