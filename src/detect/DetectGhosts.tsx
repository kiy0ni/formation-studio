import { useEffect } from 'react';
import { AUTO_DETECT_ENABLED } from '../lib/config';
import { useEditor } from '../store/editor';
import { loadApplied } from './analysis';
import { ghostAt } from './formations';
import { useDetect } from './store';
import './detect.css';

/** Positions found in the video, drawn faintly under the dancers to compare. */
export function DetectGhosts({ time, radius }: { time: number; radius: number }) {
  const choreoId = useEditor((s) => s.doc?.id);
  const hash = useEditor((s) => s.doc?.video?.hash);
  const offset = useEditor((s) => s.doc?.video?.offset ?? 0);
  const show = useDetect((s) => s.showGhosts);
  const ghosts = useDetect((s) => {
    const g = s.ghosts;
    return g && g.choreoId === choreoId && g.data.hash === hash ? g.data : null;
  });

  useEffect(() => {
    if (!AUTO_DETECT_ENABLED || !show || !hash || !choreoId || ghosts) return;
    let alive = true;
    void loadApplied(hash, choreoId).then((a) => {
      if (alive && a?.ghosts) useDetect.setState({ ghosts: { choreoId, data: a.ghosts } });
    });
    return () => {
      alive = false;
    };
  }, [show, hash, choreoId, ghosts]);

  if (!AUTO_DETECT_ENABLED || !show || !ghosts) return null;
  const length = ghosts.tracks[0]?.xs.length ?? 0;
  // same clock and same placement as the formations that were written (beats, centring, stage marks)
  const at = ghostAt(ghosts, time, offset);
  const f = (at.v - ghosts.start) * ghosts.fps;
  if (!length || f < -2 || f > length + 2) return null;
  const i = Math.max(0, Math.min(length - 1, Math.floor(f)));
  const j = Math.min(length - 1, i + 1);
  const k = Math.max(0, Math.min(1, f - i));
  return (
    <g className="detect-ghosts" pointerEvents="none">
      {ghosts.tracks.map((t, n) => (
        <circle
          key={n}
          cx={t.xs[i] + (t.xs[j] - t.xs[i]) * k + (at.dx?.[n] ?? 0)}
          cy={t.ys[i] + (t.ys[j] - t.ys[i]) * k + (at.dy?.[n] ?? 0)}
          r={radius}
          stroke={t.color}
          fill={t.color}
        />
      ))}
    </g>
  );
}
