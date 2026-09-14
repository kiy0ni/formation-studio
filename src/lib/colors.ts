/** Dancer palette — distinct, readable on dark stage. */
export const DANCER_COLORS = [
  '#ff4d8d', // pink
  '#7c5cff', // violet
  '#2ec5ff', // sky
  '#34d399', // mint
  '#ffb020', // amber
  '#ff6b3d', // coral
  '#f472d0', // orchid
  '#a3e635', // lime
  '#60a5fa', // blue
  '#facc15', // yellow
  '#fb7185', // rose
  '#22d3ee', // cyan
  '#c084fc', // lilac
  '#f97316', // orange
  '#4ade80', // green
  '#e5e7eb', // silver
];

export const FOLDER_COLORS = ['#ff4d8d', '#7c5cff', '#2ec5ff', '#34d399', '#ffb020', '#f472d0'];

export const PROP_COLORS = ['#8b7355', '#6b7280', '#c0a062', '#3f3f46', '#be185d', '#0e7490'];

export const pickColor = (i: number) => DANCER_COLORS[i % DANCER_COLORS.length];
