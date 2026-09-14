import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/common/Icon';
import { notify } from '../components/common/Toast';
import { Modal, Segmented, Stepper, Toggle } from '../components/common/ui';
import { initials, textOn } from '../lib/geometry';
import { clampToStage, computeFrame, formatTime, sortedDancers, stageBounds } from '../lib/model';
import type { ID } from '../lib/types';
import { useEditor } from '../store/editor';
import { loadAnalysis, PRECISION, saveAnalysis, type Analysis, type Precision, type Swap } from './analysis';
import { fitFloor } from './floor';
import { alignToGrid, applyDetection, applySwaps, buildGhosts, DEFAULT_PLACEMENT, defaultMapping, findFormations, placeTracks, positionsOver, type ApplyMode, type Placement } from './formations';
import { cancelAnalysis, startAnalysis, useDetect } from './store';
import { thumbFor, trackPeople } from './track';

export function DetectDialog({ onClose }: { onClose: () => void }) {
  const video = useEditor((s) => s.doc?.video ?? null);
  const hash = video?.hash ?? '';
  const job = useDetect((s) => (s.job?.hash === hash ? s.job : null));
  const running = !!job;
  const error = useDetect((s) => s.error);
  const [analysis, setAnalysis] = useState<Analysis | null | undefined>(undefined);
  const [again, setAgain] = useState(false);

  useEffect(() => {
    if (running || !hash) return;
    let alive = true;
    void loadAnalysis(hash).then((a) => {
      if (!alive) return;
      setAnalysis(a);
      setAgain(false);
    });
    return () => {
      alive = false;
    };
  }, [hash, running]);

  const [precision, setPrecision] = useState<Precision>('precise');
  if (!video) return null;
  const intro = !analysis || again || running;

  return (
    <Modal title="Détection automatique" onClose={onClose} width={intro ? 480 : 900}>
      {analysis === undefined ? (
        <div className="detect-loading">
          <div className="spinner" />
        </div>
      ) : intro ? (
        <div className="detect-intro">
          <p>L’app repère les danseurs dans la vidéo, puis propose les formations et leurs timings. Rien ne change dans la choré avant « Appliquer ».</p>
          <ul className="detect-tips">
            <li>
              <Icon name="video" size={16} /> Idéal : caméra fixe, danseurs filmés de face
            </li>
            <li>
              <Icon name="lock" size={16} /> Tout se calcule sur cet appareil
            </li>
            <li>
              <Icon name="clock" size={16} /> Environ {estimate(video.duration, PRECISION[precision])} · gardez l’écran allumé
            </li>
          </ul>
          {!job && (
            <div className="detect-row">
              <span>Analyse</span>
              <Segmented
                value={precision}
                options={[
                  { value: 'fast', label: 'Rapide' },
                  { value: 'precise', label: 'Précise' },
                ]}
                onChange={setPrecision}
              />
            </div>
          )}
          {job ? (
            <div className="detect-progress" role="status">
              <span>{job.label}</span>
              <div className="progress-bar">
                <span style={{ width: `${Math.round((job.ratio ?? 0) * 100)}%` }} />
              </div>
              <div className="detect-foot">
                <span className="hint grow">Vous pouvez fermer cette fenêtre, l’analyse continue.</span>
                <button className="btn" onClick={cancelAnalysis}>
                  Arrêter
                </button>
              </div>
            </div>
          ) : (
            <div className="detect-foot">
              {analysis && (
                <button className="btn ghost" onClick={() => setAgain(false)}>
                  Retour
                </button>
              )}
              <span className="grow" />
              <button className="btn primary" onClick={() => startAnalysis(hash, PRECISION[precision])}>
                <Icon name="wand" size={16} /> {analysis ? 'Relancer l’analyse' : 'Lancer l’analyse'}
              </button>
            </div>
          )}
          {error && <p className="error-text">{error}</p>}
        </div>
      ) : (
        <Review key={analysis.createdAt} analysis={analysis} onClose={onClose} onAgain={() => setAgain(true)} />
      )}
    </Modal>
  );
}

function estimate(duration: number, fps: number) {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const minutes = Math.round((duration * fps * (coarse ? 0.3 : 0.13)) / 60);
  return minutes < 1 ? 'moins d’une minute' : `${minutes} min`;
}

const DEPTHS = { tight: 0.7, normal: 1, wide: 1.4 } as const;
type Depth = keyof typeof DEPTHS;
const depthOf = (v: number): Depth => (v < 0.85 ? 'tight' : v > 1.2 ? 'wide' : 'normal');

const MODE_HINT: Record<ApplyMode, string> = {
  all: 'Remplace les formations par celles de la vidéo : positions et timings.',
  positions: 'Garde vos formations et leurs timings, place les danseurs d’après la vidéo.',
  timings: 'Garde vos positions, cale la durée de chaque formation sur la vidéo.',
};

function Review({ analysis, onClose, onAgain }: { analysis: Analysis; onClose: () => void; onAgain: () => void }) {
  const doc = useEditor((s) => s.doc!);
  const video = doc.video!;
  const dancers = sortedDancers(doc);
  const saved = analysis.review;

  const floor = useMemo(() => fitFloor(analysis.frames.flat(), analysis.width, analysis.height), [analysis]);
  const [people, setPeopleValue] = useState(saved?.people ?? 0);
  const tracking = useMemo(() => trackPeople(analysis, floor, people || undefined), [analysis, floor, people]);
  const [swaps, setSwaps] = useState<Swap[]>(saved?.swaps ?? []);
  const tracks = useMemo(() => applySwaps(tracking.tracks, swaps), [tracking, swaps]);
  const [placement, setPlacement] = useState<Placement>(saved?.placement ?? DEFAULT_PLACEMENT);
  // formations come from the tracking before any exchange: exchanging two people changes who, not when
  const unswapped = useMemo(() => placeTracks(tracking.tracks, doc.stage, placement), [tracking, doc.stage, placement]);
  const placed = useMemo(() => (swaps.length ? placeTracks(tracks, doc.stage, placement) : unswapped), [swaps.length, tracks, doc.stage, placement, unswapped]);
  const [sensitivity, setSensitivity] = useState(saved?.sensitivity ?? 0.5);
  const found = useMemo(() => findFormations(unswapped.tracks, analysis.times, analysis.fps, sensitivity), [unswapped, analysis, sensitivity]);
  const formations = useMemo(() => (placed === unswapped ? found : found.map((f) => ({ ...f, positions: positionsOver(placed.tracks, f.ranges) }))), [found, placed, unswapped]);
  const [selected, setSelected] = useState(0);
  const index = Math.max(0, Math.min(selected, formations.length - 1));
  const current = formations[index];
  const [picked, setPicked] = useState<number[]>([]);
  const [mode, setMode] = useState<ApplyMode>(saved?.mode ?? 'all');
  const [snap, setSnap] = useState(saved?.snap ?? true);
  const [recenter, setRecenter] = useState(saved?.recenter ?? true);
  const [grid, setGrid] = useState(saved?.grid ?? doc.stage.snap);
  const [paths, setPaths] = useState(saved?.paths ?? true);

  const count = placed.tracks.length;
  const [mapping, setMapping] = useState<(ID | null)[]>(() =>
    saved && saved.mapping.length === count && saved.mapping.every((id) => !id || doc.dancers[id]) ? saved.mapping : [],
  );
  useEffect(() => {
    if (mapping.length === count) return;
    const first = formations[0];
    const at = computeFrame(doc, Math.max(0, (first?.start ?? 0) - video.offset));
    const positions = first?.positions ?? placed.tracks.map((t) => ({ x: t.xs[0], y: t.ys[0] }));
    setMapping(defaultMapping(positions, dancers.map((d) => ({ id: d.id, x: at.dancers[d.id]?.x ?? 0 }))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  const thumbs = useMemo(() => tracks.map((t) => thumbFor(analysis, t)), [analysis, tracks]);

  const setPeople = (value: number) => {
    setPeopleValue(value);
    setSwaps([]);
    setPicked([]);
    setMapping([]);
  };
  const choose = (k: number, id: ID | null) => {
    const next = [...mapping];
    const other = id ? next.indexOf(id) : -1;
    if (other >= 0 && other !== k) next[other] = next[k] ?? null;
    next[k] = id;
    setMapping(next);
  };
  const pick = (k: number) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k].slice(-2)));
  const swapFromHere = () => {
    if (picked.length !== 2 || !current) return;
    const from = Math.max(0, analysis.times.findIndex((t) => t >= current.start - 0.01));
    setSwaps([...swaps, { from, a: picked[0], b: picked[1] }]);
    setPicked([]);
  };

  const frameUrl = useMemo(() => {
    if (!current || !analysis.keyframes.length) return null;
    const mid = (current.start + current.end) / 2;
    let best = analysis.keyframes[0];
    for (const kf of analysis.keyframes) if (Math.abs(analysis.times[kf.index] - mid) < Math.abs(analysis.times[best.index] - mid)) best = kf;
    return best.url;
  }, [current, analysis]);

  const apply = () => {
    const before = useEditor.getState().doc!;
    let message = '';
    useEditor.getState().update('Détection automatique', (d) => {
      message = applyDetection(d, before, { mode, formations, tracks: placed.tracks, times: analysis.times, mapping, recenter, snap, grid, paths });
    });
    const ghosts = buildGhosts(analysis, placed.tracks, mapping, before.dancers);
    void saveAnalysis({ ...analysis, ghosts, review: { people, swaps, placement, sensitivity, mapping, mode, snap, recenter, grid, paths, transform: placed.transform } });
    useDetect.setState({ ghosts });
    notify(`${message} · Annuler pour revenir en arrière`);
    onClose();
  };

  const { stage } = doc;
  const b = stageBounds(stage);
  const size = stage.dancerSize;
  const mapped = mapping.filter(Boolean).length;
  // as they will land on the stage: kept on the stage, on the marks when asked
  const shown = useMemo(() => {
    if (!current) return [];
    const inside = current.positions.map((p) => clampToStage(p, stage));
    return grid ? alignToGrid(inside, stage) : inside;
  }, [current, stage, grid]);
  const marks = useMemo(() => {
    const step = stage.gridStep > 0 ? stage.gridStep : 0.5;
    const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (let x = 0; x <= stage.width / 2 + 1e-6; x += step) for (const sx of x ? [x, -x] : [0]) out.push({ x1: sx, y1: -stage.depth / 2, x2: sx, y2: stage.depth / 2 });
    for (let y = -stage.depth / 2; y <= stage.depth / 2 + 1e-6; y += step) out.push({ x1: -stage.width / 2, y1: y, x2: stage.width / 2, y2: y });
    return out;
  }, [stage]);

  return (
    <>
      <div className="detect-review">
        <div className="detect-col">
          <div className="detect-summary">
            <b>
              {formations.length} formation{formations.length > 1 ? 's' : ''}
            </b>{' '}
            · {count} personne{count > 1 ? 's' : ''} suivie{count > 1 ? 's' : ''}
          </div>
          <div className="detect-chips" role="tablist">
            {formations.map((f, i) => (
              <button key={i} role="tab" aria-selected={i === index} className={i === index ? 'on' : ''} onClick={() => setSelected(i)}>
                {i + 1}
                <small>{formatTime(Math.max(0, f.start - video.offset), false)}</small>
              </button>
            ))}
          </div>
          <div className="detect-compare">
            {frameUrl && <img className="detect-frame" src={frameUrl} alt="Image de la vidéo" />}
            <svg className="detect-stage" viewBox={`${b.minX} ${-stage.depth / 2 - 0.4} ${b.maxX - b.minX} ${stage.depth + 1.3}`}>
              <rect x={-stage.width / 2} y={-stage.depth / 2} width={stage.width} height={stage.depth} className="detect-floor" />
              {marks.map((m, i) => (
                <line key={i} {...m} className={m.x1 === 0 && m.x2 === 0 ? 'detect-mark middle' : 'detect-mark'} />
              ))}
              <text x={0} y={stage.depth / 2 + 0.6} className="detect-audience">
                PUBLIC
              </text>
              {shown.map((p, k) => {
                const d = mapping[k] ? doc.dancers[mapping[k]!] : null;
                const color = d?.color ?? '#55555f';
                return (
                  <g key={k} transform={`translate(${p.x} ${p.y})`} className={`detect-dot ${picked.includes(k) ? 'on' : ''}`} onClick={() => pick(k)}>
                    <circle r={size / 2} fill={color} />
                    <text dy={size * 0.13} fontSize={size * 0.36} fill={textOn(color)}>
                      {d ? initials(d.name) : `P${k + 1}`}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
          {picked.length ? (
            <div className="detect-swap">
              {picked.length === 1 ? (
                <span className="hint grow">Touchez la deuxième personne à échanger</span>
              ) : (
                <button className="btn small primary" onClick={swapFromHere}>
                  <Icon name="swap" size={14} /> Échanger P{picked[0] + 1} et P{picked[1] + 1} à partir d’ici
                </button>
              )}
              <button className="btn small ghost" onClick={() => setPicked([])}>
                Annuler
              </button>
            </div>
          ) : (
            <span className="hint">Deux personnes confondues ? Touchez-les sur la scène pour les échanger à partir de cette formation.</span>
          )}
        </div>

        <div className="detect-col">
          <h4>Réglages</h4>
          <div className="detect-row">
            <span>Personnes dans la vidéo</span>
            <Stepper value={tracking.people} min={1} max={20} onChange={setPeople} label="Personnes" />
          </div>
          <label className="detect-range">
            <span>Formations</span>
            <small>moins</small>
            <input type="range" min={0} max={1} step={0.05} value={sensitivity} onChange={(e) => setSensitivity(Number(e.target.value))} />
            <small>plus</small>
          </label>
          <div className="detect-row">
            <span>Profondeur</span>
            <Segmented
              value={depthOf(placement.depth)}
              options={[
                { value: 'tight', label: 'Serrée' },
                { value: 'normal', label: 'Normale' },
                { value: 'wide', label: 'Large' },
              ]}
              onChange={(v) => setPlacement({ ...placement, depth: DEPTHS[v] })}
            />
          </div>
          <Toggle checked={placement.fill} onChange={(fill) => setPlacement({ ...placement, fill })} label="Agrandir pour occuper la scène" />
          <Toggle checked={placement.flip} onChange={(flip) => setPlacement({ ...placement, flip })} label="Inverser gauche / droite" />
          <Toggle checked={grid} onChange={setGrid} label="Aligner sur les repères de la scène" />
          {doc.music.bpm ? <Toggle checked={snap} onChange={setSnap} label="Caler sur les temps de la musique" /> : null}

          <h4>Qui danse qui</h4>
          <div className="detect-people">
            {placed.tracks.map((_, k) => {
              const t = thumbs[k];
              const d = mapping[k] ? doc.dancers[mapping[k]!] : null;
              return (
                <div className="detect-person" key={k}>
                  {t ? (
                    <span
                      className="detect-thumb"
                      style={{
                        backgroundImage: `url(${t.url})`,
                        aspectRatio: `${t.box.w * analysis.width} / ${t.box.h * analysis.height}`,
                        backgroundSize: `${100 / t.box.w}% ${100 / t.box.h}%`,
                        backgroundPosition: `${t.box.w < 1 ? (t.box.x / (1 - t.box.w)) * 100 : 0}% ${t.box.h < 1 ? (t.box.y / (1 - t.box.h)) * 100 : 0}%`,
                      }}
                    />
                  ) : (
                    <span className="detect-thumb empty" />
                  )}
                  <span className="detect-tag" style={{ background: d?.color ?? '#55555f', color: textOn(d?.color ?? '#55555f') }}>
                    P{k + 1}
                  </span>
                  <select value={mapping[k] ?? ''} onChange={(e) => choose(k, e.target.value || null)} aria-label={`Danseur pour P${k + 1}`}>
                    <option value="">Ignorer</option>
                    {dancers.map((dn) => (
                      <option key={dn.id} value={dn.id}>
                        {dn.name}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
          {mapped > 0 && mapped < count && <Toggle checked={recenter} onChange={setRecenter} label="Recentrer les danseurs gardés" />}

          <h4>Appliquer</h4>
          <Segmented
            value={mode}
            options={[
              { value: 'all', label: 'Tout' },
              { value: 'positions', label: 'Positions' },
              { value: 'timings', label: 'Timings' },
            ]}
            onChange={setMode}
          />
          <span className="hint">{MODE_HINT[mode]}</span>
          {mode === 'all' && <Toggle checked={paths} onChange={setPaths} label="Trajets et départs comme dans la vidéo" />}
        </div>
      </div>
      <div className="detect-foot">
        <button className="btn ghost small" onClick={onAgain}>
          Relancer l’analyse
        </button>
        <span className="grow" />
        <button className="btn" onClick={onClose}>
          Fermer
        </button>
        <button className="btn primary" disabled={!formations.length || mapping.length !== count || (!mapped && mode !== 'timings')} onClick={apply}>
          Appliquer
        </button>
      </div>
    </>
  );
}
