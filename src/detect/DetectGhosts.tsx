import { useEffect } from 'react';
import { AUTO_DETECT_ENABLED } from '../lib/config';
import { useEditor } from '../store/editor';
import { loadAnalysis } from './analysis';
import { useDetect } from './store';
import './detect.css';

/** Positions found in the video, drawn faintly under the dancers to compare. */
export function DetectGhosts({ time, radius }: { time: number; radius: number }) {
  const hash = useEditor((s) => s.doc?.video?.hash);
  const offset = useEditor((s) => s.doc?.video?.offset ?? 0);
  const show = useDetect((s) => s.showGhosts);
  const ghosts = useDetect((s) => s.ghosts);

  useEffect(() => {
    if (!AUTO_DETECT_ENABLED || !show || !hash || ghosts?.hash === hash) return;
    let alive = true;
    void loadAnalysis(hash).then((a) => {
      if (alive && a?.ghosts) useDetect.setState({ ghosts: a.ghosts });
    });
    return () => {
      alive = false;
    };
  }, [show, hash, ghosts?.hash]);

  if (!AUTO_DETECT_ENABLED || !show || !ghosts || ghosts.hash !== hash) return null;
  const length = ghosts.tracks[0]?.xs.length ?? 0;
  const f = (time + offset - ghosts.start) * ghosts.fps;
  if (!length || f < -2 || f > length + 2) return null;
  const i = Math.max(0, Math.min(length - 1, Math.floor(f)));
  const j = Math.min(length - 1, i + 1);
  const k = Math.max(0, Math.min(1, f - i));
  return (
    <g className="detect-ghosts" pointerEvents="none">
      {ghosts.tracks.map((t, n) => (
        <circle key={n} cx={t.xs[i] + (t.xs[j] - t.xs[i]) * k} cy={t.ys[i] + (t.ys[j] - t.ys[i]) * k} r={radius} stroke={t.color} fill={t.color} />
      ))}
    </g>
  );
}
