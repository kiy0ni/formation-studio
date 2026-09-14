const P: Record<string, string> = {
  back: 'M15 18l-6-6 6-6',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 18l6-6-6-6',
  undo: 'M9 14L4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'M15 14l5-5-5-5 M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  play: 'M7 4.5v15l12.5-7.5z',
  pause: 'M7 4h3.5v16H7z M13.5 4H17v16h-3.5z',
  prev: 'M18 5v14L8 12z M6 5v14',
  next: 'M6 5v14l10-7z M18 5v14',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
  trash: 'M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  up: 'M18 15l-6-6-6 6',
  down: 'M6 9l6 6 6-6',
  share: 'M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7 M16 6l-4-4-4 4 M12 2v13',
  download: 'M12 3v12 M7 10l5 5 5-5 M4 20h16',
  upload: 'M12 15V3 M7 8l5-5 5 5 M4 20h16',
  music: 'M9 18V5l11-2v13 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  users: 'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20 M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.3 M15.5 4.2a3.5 3.5 0 0 1 0 6.6',
  grid: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
  cube: 'M12 2l9 5v10l-9 5-9-5V7z M12 22V12 M21 7l-9 5-9-5',
  square: 'M4 4h16v16H4z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  flipH: 'M12 3v18 M8 7L3 12l5 5z M16 7l5 5-5 5z',
  flipV: 'M3 12h18 M7 8l5-5 5 5z M7 16l5 5 5-5z',
  rotateL: 'M3 4v6h6 M3.5 15a8.5 8.5 0 1 0 2-8.8L3 10',
  rotateR: 'M21 4v6h-6 M20.5 15a8.5 8.5 0 1 1-2-8.8L21 10',
  expand: 'M15 3h6v6 M9 21H3v-6 M21 3l-7 7 M3 21l7-7',
  compress: 'M4 14h6v6 M20 10h-6V4 M14 10l7-7 M3 21l7-7',
  alignH: 'M3 12h18 M7 8h2v8H7z M15 6h2v12h-2z',
  alignV: 'M12 3v18 M8 7h8v2H8z M6 15h12v2H6z',
  distH: 'M4 4v16 M20 4v16 M10 8h4v8h-4z',
  distV: 'M4 4h16 M4 20h16 M8 10h8v4H8z',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M12 12h.01',
  magnet: 'M6 3v8a6 6 0 0 0 12 0V3 M6 7h4 M14 7h4',
  route: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M6 15V9a3 3 0 0 1 3-3h5 M18 9v6a3 3 0 0 1-3 3h-5',
  ghost: 'M9 10h.01 M15 10h.01 M12 2a8 8 0 0 0-8 8v12l3-3 2.5 3 2.5-3 2.5 3 2.5-3 3 3V10a8 8 0 0 0-8-8z',
  tag: 'M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z M7.5 7.5h.01',
  note: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z M14 3v5h5 M9 13h6 M9 17h4',
  folder: 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M21 21l-5-5',
  settings: 'M4 6h10 M18 6h2 M4 12h4 M12 12h8 M4 18h12 M20 18h0 M16 4v4 M10 10v4 M18 16v4',
  close: 'M6 6l12 12 M18 6L6 18',
  check: 'M5 12l5 5L20 7',
  dots: 'M12 6h.01 M12 12h.01 M12 18h.01',
  sparkles: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  metronome: 'M8 21h8l-3-18h-2z M12 14l6-8 M6.5 17h11',
  loop: 'M17 2l4 4-4 4 M3 11V9a3 3 0 0 1 3-3h15 M7 22l-4-4 4-4 M21 13v2a3 3 0 0 1-3 3H3',
  cloud: 'M7 18a5 5 0 0 1-.5-10 6 6 0 0 1 11.5 2 4 4 0 0 1 0 8z',
  cloudOff: 'M3 3l18 18 M7 18a5 5 0 0 1-1.6-9.7 M9.5 5.5A6 6 0 0 1 18 10a4 4 0 0 1 2.3 7.3',
  lock: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  image: 'M4 4h16v16H4z M9 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M20 15l-5-5L5 20',
  print: 'M7 9V3h10v6 M7 18H4v-8h16v8h-3 M7 14h10v7H7z',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  swap: 'M7 4L3 8l4 4 M3 8h14 M17 20l4-4-4-4 M21 16H7',
  box: 'M4 7h16v10H4z',
  circle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2',
  stage: 'M3 5h18v10H3z M3 15l-1 4h20l-1-4 M9 19v2 M15 19v2',
  wave: 'M2 12h2 M6 8v8 M10 4v16 M14 7v10 M18 10v4 M22 12h-2',
  warning: 'M12 3l10 18H2z M12 10v4 M12 17h.01',
  focus: 'M3 8V4h4 M17 4h4v4 M21 16v4h-4 M7 20H3v-4 M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  mirror: 'M12 2v20 M4 6l5 3v6l-5 3z M20 6l-5 3v6l5 3z',
  text: 'M4 7V5h16v2 M12 5v14 M9 19h6',
  hand: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V12 M11 11.5v-8a1.5 1.5 0 0 1 3 0V12 M14 5.5a1.5 1.5 0 0 1 3 0V12 M17 8.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.4-2.6L3.4 15a1.5 1.5 0 0 1 2.3-2l2.3 2',
  wand: 'M15 4V2 M15 16v-2 M8 9h2 M20 9h2 M17.8 11.8l1.4 1.4 M17.8 6.2l1.4-1.4 M12.2 6.2l-1.4-1.4 M15 9L3 21',
  fit: 'M3 9V3h6 M21 9V3h-6 M3 15v6h6 M21 15v6h-6',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  split: 'M16 3h5v5 M8 3H3v5 M12 22v-8.3a4 4 0 0 0-1.2-2.9L3 3 M21 3l-7.8 7.8',
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 16, className, strokeWidth = 1.8 }: { name: IconName; size?: number; className?: string; strokeWidth?: number }) {
  const filled = name === 'play' || name === 'pause';
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={P[name]} />
    </svg>
  );
}
