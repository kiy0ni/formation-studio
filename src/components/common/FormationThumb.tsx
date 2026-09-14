import { memo } from 'react';
import { sortedProps } from '../../lib/model';
import type { Choreo, Formation } from '../../lib/types';

/** Small static stage preview. Circles animate between formations via CSS transforms. */
export const FormationThumb = memo(function FormationThumb({
  doc,
  formation,
  className,
  animate,
}: {
  doc: Pick<Choreo, 'stage' | 'dancers' | 'props'>;
  formation: Formation | undefined;
  className?: string;
  animate?: boolean;
}) {
  const { stage } = doc;
  const pad = 0.4;
  const w = stage.width + pad * 2;
  const h = stage.depth + pad * 2;
  const r = Math.max(stage.dancerSize / 2, Math.min(stage.width, stage.depth) * 0.035);
  return (
    <svg className={`thumb ${className ?? ''}`} viewBox={`${-w / 2} ${-h / 2} ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
      <rect x={-stage.width / 2} y={-stage.depth / 2} width={stage.width} height={stage.depth} rx={0.2} className="thumb-floor" />
      <line x1={0} x2={0} y1={-stage.depth / 2} y2={stage.depth / 2} className="thumb-center" />
      <line x1={-stage.width / 2} x2={stage.width / 2} y1={stage.depth / 2} y2={stage.depth / 2} className="thumb-front" />
      {formation &&
        sortedProps(doc as Choreo).map((p) => {
          const s = formation.props[p.id];
          if (!s?.visible) return null;
          return p.shape === 'rect' ? (
            <rect key={p.id} x={s.x - s.w / 2} y={s.y - s.h / 2} width={s.w} height={s.h} fill={s.color} opacity={0.7} transform={`rotate(${s.rotation} ${s.x} ${s.y})`} />
          ) : (
            <ellipse key={p.id} cx={s.x} cy={s.y} rx={s.w / 2} ry={s.h / 2} fill={s.color} opacity={0.7} />
          );
        })}
      {formation &&
        Object.values(doc.dancers).map((d) => {
          const p = formation.positions[d.id];
          if (!p) return null;
          return (
            <circle
              key={d.id}
              r={r}
              fill={d.color}
              style={{ transform: `translate(${p.x}px, ${p.y}px)`, transition: animate ? 'transform 900ms cubic-bezier(.65,0,.35,1)' : undefined }}
            />
          );
        })}
    </svg>
  );
});
