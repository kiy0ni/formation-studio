import { useEffect, useState } from 'react';
import { create } from 'zustand';

/** Computer panels the user can resize: formations list, video + formations column, settings panel. */
export type PanelKind = 'left' | 'side' | 'right';
type Widths = Record<PanelKind, number | null>;

const KEY = 'fs-layout';

/** Smallest and largest width (px) of each panel. */
export const PANEL_LIMITS: Record<PanelKind, [number, number]> = {
  left: [160, 420],
  side: [240, 900],
  right: [260, 560],
};

const valid = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function read(): Widths {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { left: valid(saved.left), side: valid(saved.side), right: valid(saved.right) };
  } catch {
    return { left: null, side: null, right: null };
  }
}

/** `null` = usual size. */
export const useLayout = create<Widths>(read);

export function setPanelWidth(kind: PanelKind, width: number | null, keep = true) {
  useLayout.setState({ [kind]: width });
  if (!keep) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(useLayout.getState()));
  } catch {
    /* private mode */
  }
}

export function useMedia(query: string) {
  const [matches, setMatches] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const on = () => setMatches(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return matches;
}
