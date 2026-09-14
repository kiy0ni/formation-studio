import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useCollab } from '../../collab/client';
import { DetectGhosts } from '../../detect/DetectGhosts';
import { dist, initials, r2, samplePath, textOn } from '../../lib/geometry';
import {
  clampToStage,
  computeFrame,
  countAt,
  snapVec,
  sortedDancers,
  sortedFormations,
  sortedProps,
  stageBounds,
  timeline,
} from '../../lib/model';
import type { ID, StageSettings, Vec } from '../../lib/types';
import { useEditor } from '../../store/editor';
import { playback } from '../../store/playback';
import { Icon } from '../common/Icon';

export const stageSvg: { current: SVGSVGElement | null } = { current: null };

const MARGIN = 0.5;
const BAND = 1.4;

type Drag =
  | { kind: 'dancers'; primary: ID; start: Vec; orig: Record<ID, Vec>; fid: ID; moved: boolean }
  | { kind: 'box'; start: Vec; base: ID[] }
  | { kind: 'handle'; did: ID; index: number; fid: ID; moved: boolean }
  | { kind: 'prop'; pid: ID; start: Vec; orig: Vec; fid: ID; moved: boolean }
  | { kind: 'resize'; pid: ID; fid: ID; moved: boolean }
  | { kind: 'pan'; sx: number; sy: number; ox: number; oy: number; scale: number };

function segDist(p: Vec, a: Vec, b: Vec) {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (!l2) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2));
  return dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}

export function Stage2D() {
  const doc = useEditor((s) => s.doc!);
  const time = useEditor((s) => s.time);
  const playing = useEditor((s) => s.playing);
  const selected = useEditor((s) => s.selected);
  const selectedProp = useEditor((s) => s.selectedProp);
  const audienceTop = useEditor((s) => s.audienceTop);
  const showPaths = useEditor((s) => s.showPaths);
  const showGhost = useEditor((s) => s.showGhost);
  const showNames = useEditor((s) => s.showNames);
  const focusDancer = useEditor((s) => s.focusDancer);
  const readOnly = useEditor((s) => s.readOnly);
  const peers = useCollab((s) => s.peers);

  const svgRef = useRef<SVGSVGElement>(null);
  const contentRef = useRef<SVGGElement>(null);
  const drag = useRef<Drag | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number; mid: { x: number; y: number }; cam: { x: number; y: number }; scale: number } | null>(null);
  const [cam, setCam] = useState({ zoom: 1, x: 0, y: 0 });
  const [box, setBox] = useState<{ a: Vec; b: Vec } | null>(null);

  const { stage } = doc;
  const frame = useMemo(() => computeFrame(doc, time), [doc, time]);
  const items = timeline(doc);
  const item = items[frame.index];
  const next = items[frame.index + 1];
  const prev = items[frame.index - 1];
  const holding = frame.progress === 0;
  const pathFrom = holding ? prev?.f : item?.f;
  const pathTo = holding ? item?.f : next?.f;
  const dancers = sortedDancers(doc);
  const r = stage.dancerSize / 2;
  const editable = !readOnly && !playing;
  const selSet = new Set(selected);
  const count = countAt(doc.music, time);

  // finger-sized grab area around each dancer (at least ~24 px on screen)
  const [pxPerM, setPxPerM] = useState(60);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => {
      const rect = svg.getBoundingClientRect();
      const vb = svg.viewBox.baseVal;
      if (vb && vb.width && vb.height) setPxPerM(Math.min(rect.width / vb.width, rect.height / vb.height));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(svg);
    return () => ro.disconnect();
  }, [cam.zoom, audienceTop]);
  const touchR = Math.max((doc.stage.dancerSize / 2) * 1.35, 24 / Math.max(1, pxPerM));

  useEffect(() => {
    stageSvg.current = svgRef.current;
    return () => {
      stageSvg.current = null;
    };
  }, []);

  // view box (rotated when looking from the dancers' side)
  const b = stageBounds(stage);
  let [x0, x1, y0, y1] = [b.minX - MARGIN, b.maxX + MARGIN, b.minY - MARGIN, b.maxY + BAND];
  if (audienceTop) [x0, x1, y0, y1] = [-x1, -x0, -y1, -y0];
  const vw = (x1 - x0) / cam.zoom;
  const vh = (y1 - y0) / cam.zoom;
  const vcx = (x0 + x1) / 2 + cam.x;
  const vcy = (y0 + y1) / 2 + cam.y;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > 0) {
        e.preventDefault();
        const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
        setCam((c) => ({ ...c, zoom: Math.max(0.5, Math.min(5, c.zoom * k)) }));
      }
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const toStage = (e: { clientX: number; clientY: number }): Vec => {
    const m = contentRef.current?.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  /** Editing happens on a held formation: jump out of a transition first. */
  const ensureHold = (): ID | null => {
    if (!item) return null;
    if (holding) return item.f.id;
    const target = frame.progress >= 0.5 && next ? next : item;
    playback.seek(target.start);
    return target.f.id;
  };

  const capture = (e: React.PointerEvent) => svgRef.current?.setPointerCapture(e.pointerId);

  const onDancerDown = (e: React.PointerEvent, id: ID) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (playing) playback.pause();
    const st = useEditor.getState();
    let sel = st.selected;
    if (e.shiftKey || e.metaKey || e.ctrlKey) sel = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
    else if (!sel.includes(id)) sel = [id];
    st.select(sel);
    if (readOnly || !sel.includes(id)) return;
    const fid = ensureHold();
    if (!fid) return;
    const f = useEditor.getState().doc!.formations[fid];
    const orig: Record<ID, Vec> = {};
    for (const sid of sel) if (f.positions[sid]) orig[sid] = { x: f.positions[sid].x, y: f.positions[sid].y };
    if (!orig[id]) return;
    drag.current = { kind: 'dancers', primary: id, start: toStage(e), orig, fid, moved: false };
    capture(e);
  };

  const onPropDown = (e: React.PointerEvent, pid: ID, resize = false) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (playing) playback.pause();
    useEditor.setState({ selectedProp: pid, selected: [], tab: 'props' });
    if (readOnly) return;
    const fid = ensureHold();
    if (!fid) return;
    const s = useEditor.getState().doc!.formations[fid].props[pid];
    if (!s) return;
    drag.current = resize ? { kind: 'resize', pid, fid, moved: false } : { kind: 'prop', pid, start: toStage(e), orig: { x: s.x, y: s.y }, fid, moved: false };
    capture(e);
  };

  const onHandleDown = (e: React.PointerEvent, did: ID, index: number) => {
    e.stopPropagation();
    if (!pathTo || readOnly) return;
    const fid = pathTo.id;
    if (e.altKey) {
      useEditor.getState().update('Supprimer un point', (d) => {
        const p = d.formations[fid]?.positions[did];
        if (!p?.path) return;
        p.path.points.splice(index, 1);
        if (!p.path.points.length) delete p.path;
      });
      return;
    }
    drag.current = { kind: 'handle', did, index, fid, moved: false };
    capture(e);
  };

  const onPathDouble = (e: React.MouseEvent, did: ID) => {
    if (!editable || !holding || !prev || !item) return;
    e.stopPropagation();
    const p = toStage(e);
    const fid = item.f.id;
    const from = prev.f.positions[did];
    if (!from) return;
    useEditor.getState().select([did]);
    useEditor.getState().update('Ajouter un point de passage', (d) => {
      const pos = d.formations[fid].positions[did];
      if (!pos) return;
      const pts = pos.path && pos.path.kind !== 'linear' ? [...pos.path.points] : [];
      const chain = [from, ...pts, pos];
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < chain.length - 1; i++) {
        const dd = segDist(p, chain[i], chain[i + 1]);
        if (dd < bestD) {
          bestD = dd;
          best = i;
        }
      }
      pts.splice(best, 0, { x: r2(p.x), y: r2(p.y) });
      pos.path = { kind: 'points', points: pts };
    });
  };

  const onBgDown = (e: React.PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    // two fingers on the stage: pinch to zoom, move to pan
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size === 2) {
        const [p1, p2] = [...touches.current.values()];
        pinch.current = {
          dist: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1,
          zoom: cam.zoom,
          mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
          cam: { x: cam.x, y: cam.y },
          scale: Math.max(vw / rect.width, vh / rect.height),
        };
        drag.current = null;
        setBox(null);
        capture(e);
        return;
      }
    }
    if (e.button === 1 || e.altKey || (e.button === 0 && cam.zoom > 1 && e.shiftKey && e.metaKey)) {
      const scale = Math.max(vw / rect.width, vh / rect.height);
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: cam.x, oy: cam.y, scale };
      capture(e);
      return;
    }
    if (e.button !== 0) return;
    const st = useEditor.getState();
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (!additive) st.set({ selected: [], selectedProp: null });
    const p = toStage(e);
    drag.current = { kind: 'box', start: p, base: additive ? st.selected : [] };
    setBox({ a: p, b: p });
    capture(e);
  };

  const onMove = (e: React.PointerEvent) => {
    if (pinch.current && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pts = [...touches.current.values()];
      if (pts.length >= 2) {
        const pc = pinch.current;
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        setCam({
          zoom: Math.max(0.5, Math.min(5, (pc.zoom * dist) / pc.dist)),
          x: pc.cam.x - (mid.x - pc.mid.x) * pc.scale,
          y: pc.cam.y - (mid.y - pc.mid.y) * pc.scale,
        });
      }
      return;
    }
    const d = drag.current;
    if (!d) return;
    const st = useEditor.getState();
    switch (d.kind) {
      case 'pan':
        setCam((c) => ({ ...c, x: d.ox - (e.clientX - d.sx) * d.scale, y: d.oy - (e.clientY - d.sy) * d.scale }));
        return;
      case 'box': {
        const p = toStage(e);
        setBox({ a: d.start, b: p });
        const lx = Math.min(d.start.x, p.x);
        const hx = Math.max(d.start.x, p.x);
        const ly = Math.min(d.start.y, p.y);
        const hy = Math.max(d.start.y, p.y);
        const inside = Object.entries(frame.dancers)
          .filter(([, v]) => v.x >= lx && v.x <= hx && v.y >= ly && v.y <= hy)
          .map(([id]) => id);
        const next = [...new Set([...d.base, ...inside])];
        if (next.join() !== st.selected.join()) st.select(next);
        return;
      }
      case 'dancers': {
        const p = toStage(e);
        const dx = p.x - d.start.x;
        const dy = p.y - d.start.y;
        if (!d.moved) {
          if (Math.hypot(dx, dy) < 0.04) return;
          d.moved = true;
          st.beginGesture(Object.keys(d.orig).length > 1 ? 'Déplacer le groupe' : 'Déplacer');
        }
        const o = d.orig[d.primary];
        let target = clampToStage({ x: o.x + dx, y: o.y + dy }, st.doc!.stage);
        target = e.altKey ? { x: r2(target.x), y: r2(target.y) } : snapVec(target, st.doc!.stage);
        const ddx = target.x - o.x;
        const ddy = target.y - o.y;
        st.update('Déplacer', (draft) => {
          const f = draft.formations[d.fid];
          if (!f) return;
          for (const id in d.orig) {
            const pos = f.positions[id];
            if (!pos) continue;
            const c = clampToStage({ x: d.orig[id].x + ddx, y: d.orig[id].y + ddy }, draft.stage);
            pos.x = r2(c.x);
            pos.y = r2(c.y);
          }
        });
        return;
      }
      case 'handle': {
        if (!d.moved) {
          d.moved = true;
          st.beginGesture('Modifier la trajectoire');
        }
        const p = toStage(e);
        st.update('Modifier la trajectoire', (draft) => {
          const pos = draft.formations[d.fid]?.positions[d.did];
          if (pos?.path?.points[d.index]) pos.path.points[d.index] = { x: r2(p.x), y: r2(p.y) };
        });
        return;
      }
      case 'prop': {
        const p = toStage(e);
        if (!d.moved) {
          d.moved = true;
          st.beginGesture('Déplacer l’accessoire');
        }
        let target = { x: d.orig.x + p.x - d.start.x, y: d.orig.y + p.y - d.start.y };
        target = e.altKey ? { x: r2(target.x), y: r2(target.y) } : snapVec(target, st.doc!.stage);
        st.update('Déplacer l’accessoire', (draft) => {
          const s = draft.formations[d.fid]?.props[d.pid];
          if (s) {
            s.x = target.x;
            s.y = target.y;
          }
        });
        return;
      }
      case 'resize': {
        const p = toStage(e);
        if (!d.moved) {
          d.moved = true;
          st.beginGesture('Redimensionner l’accessoire');
        }
        st.update('Redimensionner l’accessoire', (draft) => {
          const s = draft.formations[d.fid]?.props[d.pid];
          if (!s) return;
          const a = (-s.rotation * Math.PI) / 180;
          const lx = (p.x - s.x) * Math.cos(a) - (p.y - s.y) * Math.sin(a);
          const ly = (p.x - s.x) * Math.sin(a) + (p.y - s.y) * Math.cos(a);
          s.w = r2(Math.max(0.2, Math.abs(lx) * 2));
          s.h = r2(Math.max(0.2, Math.abs(ly) * 2));
        });
        return;
      }
    }
  };

  const onUp = (e: React.PointerEvent) => {
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2) pinch.current = null;
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'box') setBox(null);
    if ('moved' in d && d.moved) useEditor.getState().endGesture();
  };

  // live collisions in the current frame
  const hit = new Set<ID>();
  const ids = Object.keys(frame.dancers);
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++)
      if (dist(frame.dancers[ids[i]], frame.dancers[ids[j]]) < stage.dancerSize * 0.85) {
        hit.add(ids[i]);
        hit.add(ids[j]);
      }

  const flipText = (x: number, y: number) => (audienceTop ? `rotate(180 ${x} ${y})` : undefined);

  const floor = useMemo(() => <StageFloor stage={stage} audienceTop={audienceTop} />, [stage, audienceTop]);

  const focusRoute = focusDancer
    ? sortedFormations(doc)
        .map((f) => f.positions[focusDancer])
        .filter(Boolean)
    : [];

  return (
    <div className="stage2d">
      <svg
        ref={svgRef}
        className="stage-svg"
        viewBox={`${vcx - vw / 2} ${vcy - vh / 2} ${vw} ${vh}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onBgDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
          </marker>
        </defs>
        <g ref={contentRef} transform={audienceTop ? 'rotate(180)' : undefined}>
          {floor}

          {/* props */}
          {sortedProps(doc).map((p) => {
            const s = frame.props[p.id];
            if (!s || (!s.visible && p.id !== selectedProp)) return null;
            const sel = p.id === selectedProp;
            return (
              <g key={p.id} transform={`translate(${s.x} ${s.y}) rotate(${s.rotation})`} className={`stage-prop ${sel ? 'sel' : ''}`} opacity={s.visible ? 1 : 0.35} onPointerDown={(e) => onPropDown(e, p.id)}>
                {p.shape === 'rect' ? (
                  <rect x={-s.w / 2} y={-s.h / 2} width={s.w} height={s.h} rx={0.05} fill={s.color} />
                ) : (
                  <ellipse rx={s.w / 2} ry={s.h / 2} fill={s.color} />
                )}
                <text className="stage-prop-label" fontSize={0.2} dy={0.07} transform={audienceTop ? 'rotate(180)' : undefined}>
                  {p.name}
                </text>
                {sel && editable && <circle className="stage-handle" cx={s.w / 2} cy={s.h / 2} r={0.12} onPointerDown={(e) => onPropDown(e, p.id, true)} />}
              </g>
            );
          })}

          <DetectGhosts time={time} radius={r} />

          {/* ghost of previous formation */}
          {showGhost && !playing && holding && prev &&
            dancers.map((d) => {
              const p = prev.f.positions[d.id];
              return p ? <circle key={d.id} cx={p.x} cy={p.y} r={r} className="stage-ghost" stroke={d.color} /> : null;
            })}

          {/* paths */}
          {showPaths && !playing && pathFrom && pathTo &&
            dancers.map((d) => {
              const a = pathFrom.positions[d.id];
              const z = pathTo.positions[d.id];
              if (!a || !z || (dist(a, z) < 0.02 && !z.path)) return null;
              const pts = samplePath(a, z, z.path, 40);
              const sel = selSet.has(d.id) || focusDancer === d.id;
              const dim = focusDancer && focusDancer !== d.id;
              return (
                <g key={d.id} opacity={dim ? 0.15 : sel ? 1 : 0.45}>
                  <polyline points={pts.map((p) => `${p.x},${p.y}`).join(' ')} className="stage-path" stroke={d.color} markerEnd="url(#arrow)" />
                  {editable && holding && <polyline points={pts.map((p) => `${p.x},${p.y}`).join(' ')} className="stage-path-hit" onDoubleClick={(e) => onPathDouble(e, d.id)} />}
                </g>
              );
            })}

          {/* path handles for the selection */}
          {showPaths && editable && holding && prev && item &&
            selected.map((id) => {
              const a = prev.f.positions[id];
              const z = item.f.positions[id];
              if (!a || !z?.path || z.path.kind === 'linear') return null;
              const chain = [a, ...z.path.points, z];
              return (
                <g key={id}>
                  <polyline points={chain.map((p) => `${p.x},${p.y}`).join(' ')} className="stage-handle-line" />
                  {z.path.points.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r={0.13} className="stage-handle" onPointerDown={(e) => onHandleDown(e, id, i)}>
                      <title>Glisser pour ajuster · Alt+clic pour supprimer</title>
                    </circle>
                  ))}
                </g>
              );
            })}

          {/* focus route across all formations */}
          {focusRoute.length > 1 && (
            <g className="stage-focus-route">
              <polyline points={focusRoute.map((p) => `${p.x},${p.y}`).join(' ')} stroke={doc.dancers[focusDancer!]?.color} />
              {focusRoute.map((p, i) => (
                <g key={i} transform={`translate(${p.x} ${p.y})`}>
                  <circle r={0.16} stroke={doc.dancers[focusDancer!]?.color} />
                  <text fontSize={0.17} dy={0.06} transform={audienceTop ? 'rotate(180)' : undefined}>
                    {i + 1}
                  </text>
                </g>
              ))}
            </g>
          )}

          {/* peers' selections */}
          {Object.values(peers).map((peer) =>
            peer.selected.map((id) => {
              const p = frame.dancers[id];
              return p ? <circle key={peer.clientId + id} cx={p.x} cy={p.y} r={r + 0.16} className="stage-peer" stroke={peer.color} /> : null;
            }),
          )}

          {/* dancers */}
          {dancers.map((d) => {
            const p = frame.dancers[d.id];
            if (!p) return null;
            const sel = selSet.has(d.id);
            const dim = focusDancer && focusDancer !== d.id;
            const pos = item?.f.positions[d.id];
            return (
              <g
                key={d.id}
                className={`dancer ${sel ? 'sel' : ''} ${hit.has(d.id) ? 'hit' : ''} ${editable ? 'editable' : ''}`}
                transform={`translate(${p.x} ${p.y})${audienceTop ? ' rotate(180)' : ''}`}
                opacity={dim ? 0.22 : 1}
                onPointerDown={(e) => onDancerDown(e, d.id)}
                onDoubleClick={() => useEditor.setState({ tab: 'presets', sheetOpen: true })}
              >
                <circle r={touchR} className="dancer-touch" />
                {hit.has(d.id) && <circle r={r + 0.14} className="dancer-hit" />}
                {sel && <circle r={r + 0.08} className="dancer-sel" />}
                <circle r={r} fill={d.color} className="dancer-body" />
                <text className="dancer-initials" fontSize={r * 0.7} dy={r * 0.25} fill={textOn(d.color)}>
                  {initials(d.name)}
                </text>
                {showNames && (
                  <text className="dancer-name" y={r + 0.25} fontSize={0.19}>
                    {d.name.length > 10 ? `${d.name.slice(0, 9)}…` : d.name}
                  </text>
                )}
                {holding && pos?.comment && <circle cx={r * 0.72} cy={-r * 0.72} r={0.085} className="dancer-comment" />}
              </g>
            );
          })}

          {box && (
            <rect
              className="stage-box"
              x={Math.min(box.a.x, box.b.x)}
              y={Math.min(box.a.y, box.b.y)}
              width={Math.abs(box.a.x - box.b.x)}
              height={Math.abs(box.a.y - box.b.y)}
            />
          )}
          <text className="stage-audience" x={0} y={b.maxY + 1.05} fontSize={0.32} transform={flipText(0, b.maxY + 1.05)}>
            PUBLIC
          </text>
        </g>
      </svg>

      <div className="stage-overlay top-left">
        <div className="stage-chip">
          <strong>{item?.f.name}</strong>
          {!holding && next && (
            <span>
              <Icon name="chevronRight" size={12} /> {next.f.name}
            </span>
          )}
          <em>
            {frame.index + 1}/{items.length}
          </em>
        </div>
        {count && (
          <div className="count-chip" key={count.beat}>
            <span className="count-phrase">{count.phrase}</span>
            <span className="count-num">{count.count}</span>
          </div>
        )}
      </div>

      {item?.f.note && holding && (
        <div className="stage-overlay top-right note-chip">
          <Icon name="note" size={13} /> {item.f.note}
        </div>
      )}

      <div className="stage-overlay bottom-right zoom-ctl">
        <button className="icon-btn" onClick={() => setCam((c) => ({ ...c, zoom: Math.max(0.5, c.zoom / 1.25) }))} title="Dézoomer">
          <Icon name="minus" size={14} />
        </button>
        <button className="icon-btn" onClick={() => setCam({ zoom: 1, x: 0, y: 0 })} title="Recentrer">
          <Icon name="fit" size={14} />
        </button>
        <button className="icon-btn" onClick={() => setCam((c) => ({ ...c, zoom: Math.min(5, c.zoom * 1.25) }))} title="Zoomer">
          <Icon name="plus" size={14} />
        </button>
      </div>

      {editable && !selected.length && <div className="stage-overlay bottom-left hint-chip hide-sm">Glissez un danseur · cadre = plusieurs</div>}
    </div>
  );
}

function StageFloor({ stage, audienceTop }: { stage: StageSettings; audienceTop: boolean }) {
  const hw = stage.width / 2;
  const hd = stage.depth / 2;
  const els: ReactNode[] = [];
  const flip = (x: number, y: number) => (audienceTop ? `rotate(180 ${x} ${y})` : undefined);

  // wings + backstage
  els.push(
    <rect key="wl" x={-hw - stage.wingWidth} y={-hd - stage.backstageDepth} width={stage.wingWidth} height={stage.depth + stage.backstageDepth} className="stage-wing" />,
    <rect key="wr" x={hw} y={-hd - stage.backstageDepth} width={stage.wingWidth} height={stage.depth + stage.backstageDepth} className="stage-wing" />,
  );
  if (stage.backstageDepth > 0)
    els.push(<rect key="bs" x={-hw} y={-hd - stage.backstageDepth} width={stage.width} height={stage.backstageDepth} className="stage-back" />);
  els.push(<rect key="floor" x={-hw} y={-hd} width={stage.width} height={stage.depth} fill={stage.floorColor} className="stage-floor" />);

  if (stage.showGrid && stage.gridStep > 0) {
    const s = stage.gridStep;
    for (let x = s; x < hw - 1e-6; x += s) {
      const major = Math.abs(x - Math.round(x)) < 1e-6;
      els.push(<line key={`gx${x}`} x1={x} x2={x} y1={-hd} y2={hd} className={major ? 'stage-grid major' : 'stage-grid'} />);
      els.push(<line key={`gx-${x}`} x1={-x} x2={-x} y1={-hd} y2={hd} className={major ? 'stage-grid major' : 'stage-grid'} />);
    }
    for (let y = s; y < hd - 1e-6; y += s) {
      const major = Math.abs(y - Math.round(y)) < 1e-6;
      els.push(<line key={`gy${y}`} y1={y} y2={y} x1={-hw} x2={hw} className={major ? 'stage-grid major' : 'stage-grid'} />);
      els.push(<line key={`gy-${y}`} y1={-y} y2={-y} x1={-hw} x2={hw} className={major ? 'stage-grid major' : 'stage-grid'} />);
    }
  }
  els.push(<line key="cx" x1={0} x2={0} y1={-hd} y2={hd} className="stage-centerline" />);
  els.push(<line key="cy" x1={-hw} x2={hw} y1={0} y2={0} className="stage-centerline faint" />);
  els.push(<line key="front" x1={-hw} x2={hw} y1={hd} y2={hd} className="stage-front" />);

  if (stage.showNumbers) {
    for (let k = -Math.floor(hw); k <= Math.floor(hw); k++) {
      const y = hd + 0.36;
      els.push(<line key={`tick${k}`} x1={k} x2={k} y1={hd} y2={hd + 0.12} className="stage-tick" />);
      els.push(
        <text key={`n${k}`} x={k} y={y} fontSize={0.24} className={`stage-number ${k === 0 ? 'zero' : ''}`} transform={flip(k, y - 0.08)}>
          {Math.abs(k)}
        </text>,
      );
    }
    for (let k = -Math.floor(hd); k <= Math.floor(hd); k++) {
      if (k === 0) continue;
      const x = -hw - 0.22;
      els.push(
        <text key={`d${k}`} x={x} y={k + 0.08} fontSize={0.2} className="stage-number side" transform={flip(x, k)}>
          {k > 0 ? `+${k}` : k}
        </text>,
      );
    }
  }

  const label = (key: string, x: number, y: number, text: string, size = 0.22) => (
    <text key={key} x={x} y={y} fontSize={size} className="stage-label" transform={flip(x, y)}>
      {text}
    </text>
  );
  if (stage.wingWidth >= 0.8) {
    els.push(label('lw', -hw - stage.wingWidth / 2, 0, 'COULISSE'), label('rw', hw + stage.wingWidth / 2, 0, 'COULISSE'));
  }
  if (stage.backstageDepth >= 0.6) els.push(label('bk', 0, -hd - stage.backstageDepth / 2 + 0.08, 'FOND DE SCÈNE'));
  els.push(label('jardin', -hw + 0.6, hd + 0.8, 'JARDIN', 0.18), label('cour', hw - 0.6, hd + 0.8, 'COUR', 0.18));
  return <g className="stage-floor-layer">{els}</g>;
}
