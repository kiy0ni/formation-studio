import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/common/Icon';
import { notify } from '../components/common/Toast';
import { Modal, Segmented, Stepper, Toggle } from '../components/common/ui';
import { initials, textOn } from '../lib/geometry';
import { clampToStage, computeFrame, formatTime, sortedDancers, stageBounds } from '../lib/model';
import type { ID } from '../lib/types';
import { useEditor } from '../store/editor';
import { loadAnalysis, loadApplied, PRECISION, saveApplied, type Analysis, type Precision, type ReviewSettings, type Swap } from './analysis';
import { fitFloor } from './floor';
import { alignToGrid, applyDetection, applySwaps, buildGhosts, centerFormations, centreOf, DEFAULT_PLACEMENT, defaultMapping, findFormations, placeTracks, positionsOver, type ApplyMode, type Placement } from './formations';
import { cancelAnalysis, startAnalysis, useDetect } from './store';
import { crops, thumbFor, trackPeople } from './track';

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

export function DetectDialog({ onClose }: { onClose: () => void }) {
  const choreoId = useEditor((s) => s.doc?.id ?? '');
  const video = useEditor((s) => s.doc?.video ?? null);
  const hash = video?.hash ?? '';
  const job = useDetect((s) => (s.job?.hash === hash ? s.job : null));
  const running = !!job;
  const error = useDetect((s) => (s.error?.hash === hash ? s.error.text : ''));
  const [loaded, setLoaded] = useState<{ analysis: Analysis | null; saved: ReviewSettings | null } | null>(null);
  const [again, setAgain] = useState(false);
  const [precision, setPrecision] = useState<Precision>('precise');

  // loaded again when an analysis ends (the window can stay open meanwhile)
  useEffect(() => {
    if (!hash) return;
    let alive = true;
    void Promise.all([loadAnalysis(hash), loadApplied(hash, choreoId)]).then(([analysis, applied]) => {
      if (!alive) return;
      setLoaded({ analysis, saved: applied?.review ?? null });
      setAgain(false);
    });
    return () => {
      alive = false;
    };
  }, [hash, choreoId, running]);

  if (!video) return null;
  const analysis = loaded?.analysis ?? null;
  const intro = !analysis || again || running;

  return (
    <Modal title="Détection automatique" onClose={onClose} width={intro ? 480 : 900}>
      {!loaded ? (
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
        <Review key={analysis.createdAt} analysis={analysis} saved={loaded.saved} onClose={onClose} onAgain={() => setAgain(true)} />
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

/** A picture cut out of an analysis thumbnail. */
function Crop({ url, box, width, height, className }: { url: string; box: { x: number; y: number; w: number; h: number }; width: number; height: number; className: string }) {
  return (
    <span
      className={className}
      style={{
        backgroundImage: `url(${url})`,
        aspectRatio: `${box.w * width} / ${box.h * height}`,
        backgroundSize: `${100 / box.w}% ${100 / box.h}%`,
        backgroundPosition: `${box.w < 1 ? (box.x / (1 - box.w)) * 100 : 0}% ${box.h < 1 ? (box.y / (1 - box.h)) * 100 : 0}%`,
      }}
    />
  );
}

function Review({ analysis, saved, onClose, onAgain }: { analysis: Analysis; saved: ReviewSettings | null; onClose: () => void; onAgain: () => void }) {
  const doc = useEditor((s) => s.doc!);
  const video = doc.video!;
  const dancers = sortedDancers(doc);
  const { stage } = doc;

  const floor = useMemo(() => fitFloor(analysis.frames.flat(), analysis.width, analysis.height), [analysis]);
  const [people, setPeopleValue] = useState(saved?.people ?? 0);
  const tracking = useMemo(() => trackPeople(analysis, floor, people || undefined), [analysis, floor, people]);
  const [swaps, setSwaps] = useState<Swap[]>(saved?.swaps ?? []);
  const tracks = useMemo(() => applySwaps(tracking.tracks, swaps), [tracking, swaps]);
  // choices saved before 2.2.1 centred every formation on its middle dancer: start again from the middle of the room
  const [placement, setPlacement] = useState<Placement>(saved?.placement?.centre ? saved.placement : { ...(saved?.placement ?? DEFAULT_PLACEMENT), centre: 'room', shift: 0, center: undefined });
  // formations come from the tracking before any exchange: exchanging two people changes who, not when
  const unswapped = useMemo(() => placeTracks(tracking.tracks, stage, placement), [tracking, stage, placement]);
  const placed = useMemo(() => (swaps.length ? placeTracks(tracks, stage, placement) : unswapped), [swaps.length, tracks, stage, placement, unswapped]);
  const [sensitivity, setSensitivity] = useState(saved?.sensitivity ?? 0.5);
  const found = useMemo(() => findFormations(unswapped.tracks, analysis.times, analysis.fps, sensitivity), [unswapped, analysis, sensitivity]);
  const formations = useMemo(() => {
    const raw = placed === unswapped ? found : found.map((f) => ({ ...f, positions: positionsOver(placed.tracks, f.ranges) }));
    return centreOf(placement) === 'group' ? centerFormations(raw) : raw;
  }, [found, placed, unswapped, placement]);
  const [selected, setSelected] = useState(0);
  const index = Math.max(0, Math.min(selected, formations.length - 1));
  const current = formations[index];
  const [picked, setPicked] = useState<number[]>([]);
  const [mode, setMode] = useState<ApplyMode>(saved?.mode ?? 'all');
  const [snap, setSnap] = useState(saved?.snap ?? true);
  // off by default: dancers stay where they are in the video (the one in the middle stays in the middle)
  const [regroup, setRegroup] = useState(saved?.regroup ?? false);
  const [grid, setGrid] = useState(saved?.grid ?? stage.snap);
  const [paths, setPaths] = useState(saved?.paths ?? true);
  const [checking, setChecking] = useState(false);

  // who dances who: the saved choice when it still fits, else left to right; reset when the number of people changes
  const count = placed.tracks.length;
  const defaults = useMemo(() => {
    const first = formations[0];
    const at = computeFrame(doc, Math.max(0, (first?.start ?? 0) - video.offset));
    const positions = first?.positions ?? placed.tracks.map((t) => ({ x: t.xs[0], y: t.ys[0] }));
    return defaultMapping(positions, dancers.map((d) => ({ id: d.id, x: at.dancers[d.id]?.x ?? 0 })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, tracking]);
  const [chosen, setChosen] = useState<{ count: number; mapping: (ID | null)[] } | null>(() =>
    saved && saved.mapping.length === count && saved.mapping.every((id) => !id || doc.dancers[id]) ? { count, mapping: saved.mapping } : null,
  );
  const mapping = chosen && chosen.count === count ? chosen.mapping : defaults;

  const thumbs = useMemo(() => tracks.map((t) => thumbFor(analysis, t)), [analysis, tracks]);
  const strips = useMemo(() => (checking ? tracks.map((t) => crops(analysis, t, 6)) : []), [analysis, tracks, checking]);
  const unsure = tracking.confidence.map((c) => c < 0.5);

  const setPeople = (value: number) => {
    setPeopleValue(value);
    setSwaps([]);
    setPicked([]);
    setChosen(null);
  };
  const choose = (k: number, id: ID | null) => {
    const next = [...mapping];
    const other = id ? next.indexOf(id) : -1;
    if (other >= 0 && other !== k) next[other] = next[k] ?? null;
    next[k] = id;
    setChosen({ count, mapping: next });
  };
  const pick = (k: number) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k].slice(-2)));
  const swapFromHere = () => {
    if (picked.length !== 2 || !current) return;
    const from = Math.max(0, analysis.times.findIndex((t) => t >= current.start - 0.01));
    setSwaps([...swaps, { from, a: picked[0], b: picked[1] }]);
    setPicked([]);
  };

  const frameUrl = useMemo(() => {
    if (!current || !analysis.thumbs.length) return null;
    const mid = (current.start + current.end) / 2;
    let best = analysis.thumbs[0];
    for (const th of analysis.thumbs) if (Math.abs(analysis.times[th.index] - mid) < Math.abs(analysis.times[best.index] - mid)) best = th;
    return best.url;
  }, [current, analysis]);

  const apply = () => {
    const before = useEditor.getState().doc!;
    let result: ReturnType<typeof applyDetection> = { message: '', anchors: [] };
    useEditor.getState().update('Détection automatique', (d) => {
      result = applyDetection(d, before, { mode, formations, tracks: placed.tracks, times: analysis.times, mapping, recenter: regroup, snap, grid, paths, center: centreOf(placement) === 'group' });
    });
    const { message } = result;
    const ghosts = buildGhosts(analysis, placed.tracks, mapping, before.dancers, result.anchors);
    const review: ReviewSettings = { people, swaps, placement, sensitivity, mapping, mode, snap, regroup, grid, paths, transform: placed.transform };
    void saveApplied(analysis.hash, before.id, { review, ghosts });
    useDetect.setState({ ghosts: { choreoId: before.id, data: ghosts } });
    notify(`${message} · Annuler pour revenir en arrière`);
    onClose();
  };

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

  if (!count) {
    return (
      <div className="detect-intro">
        <p>Aucun danseur n’a été reconnu dans cette vidéo. La détection marche avec une caméra fixe et des danseurs vus en entier, de face.</p>
        <div className="detect-foot">
          <button className="btn ghost small" onClick={onAgain}>
            Relancer l’analyse
          </button>
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="detect-review">
        <div className="detect-col">
          <div className="detect-summary">
            <b>{plural(formations.length, 'formation')}</b> · {plural(count, 'personne')} suivie{count > 1 ? 's' : ''}
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
          <div className="detect-row">
            <span>Centre de la scène</span>
            <Segmented
              value={centreOf(placement)}
              options={[
                { value: 'room', label: 'Milieu de la salle' },
                { value: 'group', label: 'Milieu du groupe' },
              ]}
              onChange={(centre) => setPlacement({ ...placement, centre, center: undefined })}
            />
          </div>
          <span className="hint">
            {centreOf(placement) === 'room'
              ? 'Le milieu de la vidéo est le centre de la scène : chacun garde sa place par rapport à la salle.'
              : 'Chaque formation est centrée sur son danseur du milieu (caméra pas au milieu de la salle).'}
          </span>
          {centreOf(placement) === 'room' && (
            <div className="detect-row">
              <span>Décaler le centre</span>
              <Stepper
                value={placement.shift ?? 0}
                min={-3}
                max={3}
                step={0.25}
                onChange={(shift) => setPlacement({ ...placement, shift })}
                label="Décaler le centre"
                format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(2).replace('.', ',')} m`}
              />
            </div>
          )}
          <Toggle checked={placement.fill} onChange={(fill) => setPlacement({ ...placement, fill })} label="Agrandir pour occuper la scène" />
          <Toggle checked={placement.flip} onChange={(flip) => setPlacement({ ...placement, flip })} label="Inverser gauche / droite" />
          <Toggle checked={grid} onChange={setGrid} label="Aligner sur les repères de la scène" />
          {doc.music.bpm ? <Toggle checked={snap} onChange={setSnap} label="Caler sur les temps de la musique" /> : null}

          <div className="detect-subhead">
            <h4>Qui danse qui</h4>
            <button className="btn small ghost" onClick={() => setChecking(!checking)} aria-pressed={checking}>
              <Icon name="eye" size={14} /> {checking ? 'Masquer les images' : 'Vérifier'}
            </button>
          </div>
          {unsure.some(Boolean) && !checking && (
            <span className="hint">
              <Icon name="warning" size={13} /> Des personnes se ressemblent : touchez « Vérifier » pour voir chacune à plusieurs moments.
            </span>
          )}
          <div className="detect-people">
            {placed.tracks.map((_, k) => {
              const t = thumbs[k];
              const d = mapping[k] ? doc.dancers[mapping[k]!] : null;
              return (
                <div className={`detect-person ${unsure[k] ? 'unsure' : ''}`} key={k}>
                  {t ? <Crop url={t.url} box={t.box} width={analysis.width} height={analysis.height} className="detect-thumb" /> : <span className="detect-thumb empty" />}
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
                  {unsure[k] && <span className="detect-unsure">À vérifier</span>}
                  {checking && strips[k] && (
                    <div className="detect-strip">
                      {strips[k].map((c, i) => (
                        <span key={i} className="detect-strip-item">
                          <Crop url={c.url} box={c.box} width={analysis.width} height={analysis.height} className="detect-thumb small" />
                          <small>{formatTime(Math.max(0, c.time - video.offset), false)}</small>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {checking && <span className="hint">Chaque ligne doit montrer la même personne. Sinon : touchez deux personnes sur la scène pour les échanger à partir d’une formation.</span>}
          {mapped > 0 && mapped < count && (
            <>
              <Toggle checked={regroup} onChange={setRegroup} label="Resserrer les danseurs gardés au centre" />
              <span className="hint">{regroup ? 'Les danseurs gardés se rapprochent du centre (leurs places changent).' : 'Chacun garde sa place de la vidéo : celui du milieu reste au milieu.'}</span>
            </>
          )}

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
        <button className="btn primary" disabled={!formations.length || (!mapped && mode !== 'timings')} onClick={apply}>
          Appliquer
        </button>
      </div>
    </>
  );
}
