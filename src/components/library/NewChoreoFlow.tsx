import { produce } from 'immer';
import { useEffect, useRef, useState } from 'react';
import { r2 } from '../../lib/geometry';
import { isMediaFile, MEDIA_ACCEPT } from '../../lib/media';
import { createChoreo, defaultMembers, formatTime, sortedFormations, STAGE_PRESETS } from '../../lib/model';
import type { Choreo, Folder, MusicInfo, Team } from '../../lib/types';
import { importMusicFile } from '../../store/music';
import { attachReferenceVideo } from '../../video/refVideo';
import { Icon } from '../common/Icon';
import { Stepper } from '../common/ui';

type Step = 'dancers' | 'stage' | 'music' | 'name';
const STEPS: Step[] = ['dancers', 'stage', 'music', 'name'];

/** Step-by-step creation, full screen on phones. */
export function NewChoreoFlow({
  teams,
  folders,
  initialTeamId,
  initialFolderId,
  initialFile,
  onClose,
  onCreate,
}: {
  teams: Team[];
  folders: Folder[];
  initialTeamId?: string;
  initialFolderId: string | null;
  initialFile?: File;
  onClose: () => void;
  onCreate: (doc: Choreo) => void;
}) {
  const [step, setStep] = useState<Step>('dancers');
  const [count, setCount] = useState(5);
  const [teamId, setTeamId] = useState<string | null>(initialTeamId ?? null);
  const [width, setWidth] = useState(10);
  const [depth, setDepth] = useState(8);
  const [music, setMusic] = useState<MusicInfo | null>(null);
  /** Music taken from a video: its image can become the reference video. */
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [keepVideo, setKeepVideo] = useState(true);
  const [busy, setBusy] = useState<'' | 'extract' | 'analyze'>('');
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [folderId, setFolderId] = useState<string | null>(initialFolderId);
  const fileRef = useRef<HTMLInputElement>(null);
  const index = STEPS.indexOf(step);
  const team = teams.find((t) => t.id === teamId);
  const members = team ? team.members : defaultMembers(count);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const loadFile = async (file: File) => {
    if (!isMediaFile(file)) return setError('Choisissez une musique ou une vidéo.');
    setError(null);
    setBusy('analyze');
    try {
      const { fromVideo, ...info } = await importMusicFile(file, setBusy);
      setMusic(info);
      setVideoFile(fromVideo ? file : null);
      setName((n) => n || info.name || '');
    } catch (e) {
      const msg = (e as Error)?.message ?? '';
      setError(msg.startsWith('Cette') || msg.startsWith('Impossible') ? msg : 'Fichier illisible.');
    } finally {
      setBusy('');
    }
  };

  useEffect(() => {
    if (initialFile) loadFile(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  const next = () => (index < STEPS.length - 1 ? setStep(STEPS[index + 1]) : create());
  const prev = () => (index > 0 ? setStep(STEPS[index - 1]) : onClose());

  const create = () => {
    let doc = createChoreo({
      name: name.trim() || music?.name || (team ? team.name : 'Nouvelle chorégraphie'),
      members,
      stage: { width, depth },
      folderId,
    });
    if (music) {
      doc = produce(doc, (d) => {
        d.music = music;
        if (music.bpm) {
          const bl = 60 / music.bpm;
          const f = sortedFormations(d)[0];
          f.duration = r2((music.beatOffset ?? 0) + 8 * bl);
          f.transition = r2(4 * bl);
        }
      });
    }
    onCreate(doc);
    if (keepVideo && videoFile && music) void attachReferenceVideo(doc.id, videoFile);
  };

  return (
    <div className="flow-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flow" role="dialog" aria-modal aria-label="Nouvelle chorégraphie">
        <header className="flow-head">
          <button className="icon-btn" onClick={prev} aria-label={index ? 'Retour' : 'Fermer'}>
            <Icon name={index ? 'back' : 'close'} size={22} />
          </button>
          <div className="flow-progress" aria-label={`Étape ${index + 1} sur ${STEPS.length}`}>
            {STEPS.map((s, i) => (
              <span key={s} className={i <= index ? 'on' : ''} />
            ))}
          </div>
          <span className="flow-count">
            {index + 1}/{STEPS.length}
          </span>
        </header>

        <div className="flow-body">
          {step === 'dancers' && (
            <>
              <h1 className="flow-title">Combien de danseurs ?</h1>
              <p className="flow-sub">Modifiable plus tard.</p>
              {team ? (
                <div className="flow-team">
                  <Icon name="users" size={22} />
                  <div className="grow">
                    <b>{team.name}</b>
                    <span>{team.members.length} membres</span>
                  </div>
                  <button className="btn small ghost" onClick={() => setTeamId(null)}>
                    Changer
                  </button>
                </div>
              ) : (
                <>
                  <Stepper size="big" label="Danseurs" value={count} min={1} max={30} onChange={setCount} />
                  <input className="flow-slider" type="range" min={1} max={30} value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="Nombre de danseurs" />
                </>
              )}
              {!team && teams.length > 0 && (
                <div className="flow-choices">
                  {teams.slice(0, 4).map((t) => (
                    <button key={t.id} className="chip" onClick={() => setTeamId(t.id)}>
                      <Icon name="users" size={13} /> {t.name}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {step === 'stage' && (
            <>
              <h1 className="flow-title">Taille de la scène</h1>
              <p className="flow-sub">En mètres.</p>
              <StagePreview width={width} depth={depth} dancers={members.length} colors={members.map((m) => m.color)} />
              <div className="flow-dims">
                <div>
                  <span>Largeur</span>
                  <Stepper label="Largeur" value={width} min={2} max={40} onChange={setWidth} />
                </div>
                <div>
                  <span>Profondeur</span>
                  <Stepper label="Profondeur" value={depth} min={2} max={30} onChange={setDepth} />
                </div>
              </div>
              <div className="flow-choices">
                {STAGE_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    className={`chip ${p.width === width && p.depth === depth ? 'on' : ''}`}
                    onClick={() => {
                      setWidth(p.width);
                      setDepth(p.depth);
                    }}
                  >
                    {p.label.replace(/ \(.*\)/, '')}
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 'music' && (
            <>
              <h1 className="flow-title">La musique</h1>
              <p className="flow-sub">Chanson ou vidéo. Facultatif.</p>
              {music ? (
                <button className="flow-music done" onClick={() => fileRef.current?.click()}>
                  <Icon name="music" size={28} />
                  <b className="ellipsis">{music.name}</b>
                  <span>
                    {formatTime(music.duration ?? 0, false)}
                    {music.bpm ? ` · ${music.bpm} BPM` : ''}
                  </span>
                  <small>Toucher pour changer</small>
                </button>
              ) : (
                <button
                  className="flow-music"
                  disabled={!!busy}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
                  }}
                >
                  {busy ? <div className="spinner" /> : <Icon name="plus" size={34} />}
                  <b>{busy === 'extract' ? 'Extraction du son…' : busy ? 'Analyse…' : 'Choisir un fichier'}</b>
                  <span>Galerie ou fichiers · chanson ou vidéo</span>
                </button>
              )}
              {music && videoFile && (
                <label className="flow-keep-video">
                  <Icon name="video" size={18} />
                  <span>Garder l’image comme vidéo de référence</span>
                  <input type="checkbox" className="switch" checked={keepVideo} onChange={(e) => setKeepVideo(e.target.checked)} />
                </label>
              )}
              {error && <p className="error-text">{error}</p>}
              <input
                ref={fileRef}
                type="file"
                accept={MEDIA_ACCEPT}
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) loadFile(f);
                }}
              />
            </>
          )}

          {step === 'name' && (
            <>
              <h1 className="flow-title">Un nom ?</h1>
              <p className="flow-sub">Pour la retrouver dans la bibliothèque.</p>
              <input
                className="flow-input"
                autoFocus
                value={name}
                placeholder={music?.name || 'Ma chorégraphie'}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && create()}
              />
              {folders.length > 0 && (
                <div className="flow-choices">
                  <button className={`chip ${!folderId ? 'on' : ''}`} onClick={() => setFolderId(null)}>
                    Sans dossier
                  </button>
                  {folders.map((f) => (
                    <button key={f.id} className={`chip ${folderId === f.id ? 'on' : ''}`} onClick={() => setFolderId(f.id)}>
                      <Icon name="folder" size={13} /> {f.name}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <footer className="flow-foot">
          {step === 'music' && !music && (
            <button className="btn big ghost" disabled={!!busy} onClick={next}>
              Plus tard
            </button>
          )}
          <button className="btn big primary" disabled={!!busy || (step === 'music' && !music)} onClick={next}>
            {step === 'name' ? 'Créer' : 'Suivant'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function StagePreview({ width, depth, dancers, colors }: { width: number; depth: number; dancers: number; colors: string[] }) {
  const pad = 0.8;
  const spacing = Math.min(1.2, (width * 0.9) / Math.max(1, dancers));
  const lines = [];
  for (let x = -Math.floor(width / 2); x <= Math.floor(width / 2); x++) lines.push(<line key={`x${x}`} x1={x} x2={x} y1={-depth / 2} y2={depth / 2} className={x === 0 ? 'fp-center' : 'fp-grid'} />);
  for (let y = -Math.floor(depth / 2); y <= Math.floor(depth / 2); y++) lines.push(<line key={`y${y}`} y1={y} y2={y} x1={-width / 2} x2={width / 2} className="fp-grid" />);
  return (
    <svg className="flow-stage" viewBox={`${-width / 2 - pad} ${-depth / 2 - pad} ${width + pad * 2} ${depth + pad * 2 + 0.6}`}>
      <rect x={-width / 2} y={-depth / 2} width={width} height={depth} rx={0.25} className="fp-floor" />
      {lines}
      <line x1={-width / 2} x2={width / 2} y1={depth / 2} y2={depth / 2} className="fp-front" />
      {Array.from({ length: dancers }, (_, i) => (
        <circle key={i} cx={(i - (dancers - 1) / 2) * spacing} cy={0} r={0.28} fill={colors[i] ?? '#fff'} />
      ))}
      <text x={0} y={depth / 2 + 0.95} className="fp-label" fontSize={0.42}>
        PUBLIC
      </text>
    </svg>
  );
}
