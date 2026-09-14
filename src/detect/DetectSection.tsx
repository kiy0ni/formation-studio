import { useEffect, useState } from 'react';
import { Icon } from '../components/common/Icon';
import { Toggle } from '../components/common/ui';
import { AUTO_DETECT_ENABLED } from '../lib/config';
import { useEditor } from '../store/editor';
import { useRefVideo } from '../video/refVideo';
import { loadApplied, loadMeta } from './analysis';
import { DetectDialog } from './DetectDialog';
import { placeFromFrame, setShowGhosts, useDetect } from './store';
import './detect.css';

/** Entry point, in the reference video settings. */
export function DetectSection() {
  const choreoId = useEditor((s) => s.doc?.id ?? '');
  const info = useEditor((s) => s.doc?.video ?? null);
  const readOnly = useEditor((s) => s.readOnly);
  const missing = useRefVideo((s) => s.missing);
  const open = useDetect((s) => s.open);
  const job = useDetect((s) => s.job);
  const placing = useDetect((s) => s.placing);
  const show = useDetect((s) => s.showGhosts);
  const ghostsFor = useDetect((s) => s.ghosts?.choreoId);
  const [state, setState] = useState<{ done: boolean; interrupted: boolean; applied: boolean }>({ done: false, interrupted: false, applied: false });

  useEffect(() => {
    if (!info?.hash) return;
    let alive = true;
    void Promise.all([loadMeta(info.hash), loadApplied(info.hash, choreoId)]).then(([meta, applied]) => {
      if (alive) setState({ done: !!meta?.done, interrupted: !!meta && !meta.done, applied: !!applied });
    });
    return () => {
      alive = false;
    };
  }, [info?.hash, choreoId, open, job === null, ghostsFor]);

  if (!AUTO_DETECT_ENABLED || !info || missing || readOnly) return null;
  const mine = job?.hash === info.hash ? job : null;

  return (
    <div className="panel-block detect-section">
      <div className="detect-title">
        <Icon name="wand" size={16} />
        <b>Détection automatique</b>
        <span className="detect-beta">Bêta</span>
      </div>
      <span className="hint">Repère les danseurs dans la vidéo et propose les formations et leurs timings.</span>
      {mine && (
        <button className="ref-busy detect-job" onClick={() => useDetect.setState({ open: true })}>
          <span>{mine.label}</span>
          {mine.ratio !== undefined && (
            <div className="progress-bar">
              <span style={{ width: `${Math.round(mine.ratio * 100)}%` }} />
            </div>
          )}
        </button>
      )}
      <div className="detect-actions">
        <button className="btn small primary" onClick={() => useDetect.setState({ open: true })}>
          <Icon name="wand" size={14} /> {mine ? 'Voir l’analyse' : state.done ? 'Voir la détection' : state.interrupted ? 'Reprendre l’analyse' : 'Analyser la vidéo'}
        </button>
        <button className="btn small" disabled={placing} onClick={() => void placeFromFrame()}>
          <Icon name="target" size={14} /> {placing ? 'Recherche…' : 'Placer depuis l’image'}
        </button>
      </div>
      <span className="hint">« Placer depuis l’image » : la formation affichée prend les positions de l’image de la vidéo à ce moment.</span>
      {state.applied && <Toggle checked={show} onChange={setShowGhosts} label="Voir les positions détectées sur la scène" />}
      {open && <DetectDialog onClose={() => useDetect.setState({ open: false })} />}
    </div>
  );
}
