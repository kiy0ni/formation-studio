import { addProp } from './model';
import type { Choreo, ID, PropShape } from './types';

export interface PropPreset {
  id: string;
  name: string;
  shape: PropShape;
  w: number;
  h: number;
  color: string;
}

/** Ready-made stage objects (sizes in meters). */
export const PROP_PRESETS: PropPreset[] = [
  { id: 'chair', name: 'Chaise', shape: 'rect', w: 0.5, h: 0.5, color: '#8b7355' },
  { id: 'stool', name: 'Tabouret', shape: 'ellipse', w: 0.45, h: 0.45, color: '#6b7280' },
  { id: 'bench', name: 'Banc', shape: 'rect', w: 1.6, h: 0.45, color: '#8b7355' },
  { id: 'table', name: 'Table', shape: 'rect', w: 1.2, h: 0.7, color: '#c0a062' },
  { id: 'podium', name: 'Podium', shape: 'rect', w: 2, h: 1.2, color: '#3f3f46' },
  { id: 'screen', name: 'Écran', shape: 'rect', w: 3, h: 0.25, color: '#0e7490' },
  { id: 'platform', name: 'Plateforme', shape: 'ellipse', w: 1.6, h: 1.6, color: '#be185d' },
  { id: 'mic', name: 'Micro', shape: 'ellipse', w: 0.3, h: 0.3, color: '#d4d4d8' },
];

export function addPropFromPreset(draft: Choreo, preset: PropPreset): ID {
  const id = addProp(draft, preset.shape, preset.name);
  for (const f of Object.values(draft.formations)) {
    const s = f.props[id];
    if (s) Object.assign(s, { w: preset.w, h: preset.h, color: preset.color });
  }
  return id;
}
