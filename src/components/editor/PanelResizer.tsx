import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { PANEL_LIMITS, setPanelWidth, type PanelKind } from '../../store/layout';

/** The stage always keeps at least this width (px). */
const STAGE_MIN = 320;

/** Edge of a panel (computer): drag to resize, double-click for the usual size. */
export function PanelResizer({ kind }: { kind: PanelKind }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; width: number; max: number } | null>(null);
  const side = kind === 'right' ? 'right' : 'left';

  const measure = () => {
    const panel = ref.current!.parentElement!;
    const main = panel.parentElement!;
    const other = side === 'left' ? main.lastElementChild : main.firstElementChild;
    const width = panel.getBoundingClientRect().width;
    const [, limit] = PANEL_LIMITS[kind];
    const room = main.getBoundingClientRect().width - (other && other !== panel ? other.getBoundingClientRect().width : 0) - STAGE_MIN;
    return { width, max: Math.max(PANEL_LIMITS[kind][0], Math.min(limit, room)) };
  };
  const clamp = (w: number, max: number) => Math.round(Math.max(PANEL_LIMITS[kind][0], Math.min(max, w)));

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const { width, max } = measure();
    drag.current = { x: e.clientX, width, max };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.classList.add('dragging');
    document.body.classList.add('resizing-panels');
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    setPanelWidth(kind, clamp(side === 'left' ? d.width + dx : d.width - dx, d.max), false);
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.classList.remove('dragging');
    document.body.classList.remove('resizing-panels');
    const { width } = measure();
    setPanelWidth(kind, Math.round(width));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const { width, max } = measure();
    const grow = (e.key === 'ArrowRight') === (side === 'left');
    setPanelWidth(kind, clamp(width + (grow ? 20 : -20), max));
  };

  return (
    <div
      ref={ref}
      className={`panel-resizer ${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Redimensionner le panneau"
      title="Glisser pour redimensionner · double-clic : taille normale"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => setPanelWidth(kind, null)}
      onKeyDown={onKeyDown}
    />
  );
}
