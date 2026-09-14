import { exportSvgAsPng } from '../../lib/exporters';
import { currentItem, useEditor } from '../../store/editor';
import { playback } from '../../store/playback';
import { stageSvg } from './Stage2D';

/** PNG of the stage as shown (switches to the 2D view first if needed). */
export function exportPng() {
  const s = useEditor.getState();
  if (s.view !== '2d') s.set({ view: '2d' });
  setTimeout(() => {
    const st = useEditor.getState();
    const { item } = currentItem(st.doc!, st.time);
    if (stageSvg.current) exportSvgAsPng(stageSvg.current, `${st.doc!.name} - ${item?.f.name ?? ''}`);
  }, 80);
}

/** Formation being edited; leaves a transition first. */
export function editableFormationId(): string | null {
  const s = useEditor.getState();
  if (!s.doc) return null;
  const { items, index, item } = currentItem(s.doc, s.time);
  if (!item) return null;
  if (s.time > item.holdEnd + 1e-6 && items[index + 1]) {
    const progress = (s.time - item.holdEnd) / (item.f.transition || 1);
    const target = progress >= 0.5 ? items[index + 1] : item;
    playback.seek(target.start);
    return target.f.id;
  }
  return item.f.id;
}
