import { produce } from 'immer';
import { useEffect, useRef, useState } from 'react';
import { r2 } from '../../lib/geometry';
import { isMediaFile, MEDIA_ACCEPT } from '../../lib/media';
import { createChoreo, defaultMembers, formatTime, sortedFormations, STAGE_PRESETS } from '../../lib/model';
import type { Choreo, Folder, MusicInfo, Team } from '../../lib/types';
import { importMusicFile } from '../../store/music';
import { Icon } from '../common/Icon';
import { ColorDot, Modal, NumberField, Segmented } from '../common/ui';

const STAGE_LABEL = { extract: 'Extraction du son de la vidéo…', analyze: 'Analyse de la musique…' };

export function NewChoreoDialog({
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
  const [step, setStep] = useState<'music' | 'group'>('music');
  const [music, setMusic] = useState<MusicInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<keyof typeof STAGE_LABEL>('analyze');
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [source, setSource] = useState<'count' | 'team'>(initialTeamId ? 'team' : 'count');
  const [count, setCount] = useState(5);
  const [teamId, setTeamId] = useState(initialTeamId ?? teams[0]?.id ?? '');
  const [custom, setCustom] = useState<{ name: string; color: string }[]>([]);
  const [showNames, setShowNames] = useState(false);
  const [showStage, setShowStage] = useState(false);
  const [width, setWidth] = useState(10);
  const [depth, setDepth] = useState(8);
  const [folderId, setFolderId] = useState<string | null>(initialFolderId);

  const loadFile = async (file: File) => {
    if (!isMediaFile(file)) return setError('Ce fichier n’est ni une musique (MP3, M4A, WAV…) ni une vidéo (MP4, MOV…).');
    setError(null);
    setBusy(true);
    setStage('analyze');
    try {
      const { fromVideo: _fromVideo, ...info } = await importMusicFile(file, setStage);
      setMusic(info);
      setName((n) => n || info.name || '');
    } catch (e) {
      setError((e as Error)?.message?.startsWith('Cette') || (e as Error)?.message?.startsWith('Impossible') ? (e as Error).message : 'Impossible de lire ce fichier.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (initialFile) loadFile(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  const team = teams.find((t) => t.id === teamId);
  const base = source === 'team' && team ? team.members : defaultMembers(count);
  const members = base.map((m, i) => ({ ...m, name: custom[i]?.name?.trim() || m.name, color: custom[i]?.color || m.color }));
  const stageLabel = STAGE_PRESETS.find((p) => p.width === width && p.depth === depth)?.label ?? `Personnalisée (${width} × ${depth} m)`;

  const create = () => {
    let doc = createChoreo({
      name: name.trim() || music?.name || (team && source === 'team' ? `${team.name} — nouvelle choré` : 'Nouvelle chorégraphie'),
      members,
      stage: { width, depth },
      folderId,
    });
    if (music) {
      doc = produce(doc, (d) => {
        d.music = music;
        const bl = music.bpm ? 60 / music.bpm : null;
        if (bl) {
          // first formation lasts one 8-count phrase, then a 4-count move
          const f = sortedFormations(d)[0];
          f.duration = r2((music.beatOffset ?? 0) + 8 * bl);
          f.transition = r2(4 * bl);
        }
      });
    }
    onCreate(doc);
  };

  const patchCustom = (i: number, p: Partial<{ name: string; color: string }>) =>
    setCustom((c) => {
      const next = [...c];
      next[i] = { name: next[i]?.name ?? '', color: next[i]?.color ?? '', ...p };
      return next;
    });

  return (
    <Modal
      title="Nouvelle chorégraphie"
      onClose={onClose}
      width={540}
      footer={
        step === 'music' ? (
          <>
            <button className="btn ghost" onClick={onClose}>
              Annuler
            </button>
            <span className="grow" />
            {!music && (
              <button className="btn ghost" disabled={busy} onClick={() => setStep('group')}>
                Sans musique
              </button>
            )}
            <button className="btn primary" disabled={!music || busy} onClick={() => setStep('group')}>
              Continuer <Icon name="chevronRight" size={14} />
            </button>
          </>
        ) : (
          <>
            <button className="btn ghost" onClick={() => setStep('music')}>
              <Icon name="back" size={14} /> Retour
            </button>
            <span className="grow" />
            <button className="btn primary" onClick={create} disabled={!members.length}>
              <Icon name="sparkles" /> Créer la chorégraphie
            </button>
          </>
        )
      }
    >
      <div className="wizard-steps" aria-label="Étapes">
        <button className={step === 'music' ? 'on' : 'done'} onClick={() => setStep('music')}>
          <span>1</span> Musique
        </button>
        <i />
        <button className={step === 'group' ? 'on' : ''} onClick={() => setStep('group')}>
          <span>2</span> Groupe
        </button>
      </div>

      {step === 'music' && (
        <>
          {music ? (
            <div className="music-card big">
              <Icon name="music" size={24} />
              <div className="grow">
                <b className="ellipsis">{music.name}</b>
                <span>
                  {formatTime(music.duration ?? 0, false)}
                  {music.bpm ? ` · ${music.bpm} BPM détectés` : ' · tempo non détecté, vous pourrez le saisir'}
                </span>
              </div>
              <button className="btn small ghost" onClick={() => fileRef.current?.click()}>
                Changer
              </button>
            </div>
          ) : (
            <button
              className={`dropzone big ${dragOver ? 'drag' : ''}`}
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
              }}
            >
              {busy ? <div className="spinner" /> : <Icon name="music" size={30} />}
              <b>{busy ? STAGE_LABEL[stage] : 'Importer la musique'}</b>
              <span>Touchez pour choisir la chanson ou une vidéo (seul le son est gardé), ou glissez le fichier ici.</span>
            </button>
          )}
          {error && <p className="error-text">{error}</p>}
          <p className="hint">
            Commencer par la musique permet de voir les comptes « 5, 6, 7, 8 » et de caler chaque formation sur les temps. Le fichier reste sur cet appareil.
          </p>
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

      {step === 'group' && (
        <>
          <label className="field">
            <span className="field-label">Titre</span>
            <input autoFocus placeholder="ex : Cover « Supernova » — refrain" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
          </label>

          {teams.length > 0 && (
            <div className="field">
              <span className="field-label">Membres</span>
              <Segmented
                value={source}
                onChange={setSource}
                options={[
                  { value: 'count', label: 'Choisir un nombre' },
                  { value: 'team', label: 'Équipe enregistrée' },
                ]}
              />
            </div>
          )}

          {source === 'count' || !teams.length ? (
            <div className="field">
              {!teams.length && <span className="field-label">Combien de membres ?</span>}
              <div className="count-picker">
                {[2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13].map((n) => (
                  <button key={n} className={count === n ? 'on' : ''} onClick={() => setCount(n)}>
                    {n}
                  </button>
                ))}
                <NumberField value={count} onChange={(v) => setCount(Math.round(v))} min={1} max={40} step={1} precision={0} />
              </div>
            </div>
          ) : (
            <div className="field">
              <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.members.length})
                  </option>
                ))}
              </select>
            </div>
          )}

          <button className="disclosure" onClick={() => setShowNames(!showNames)} aria-expanded={showNames}>
            <Icon name={showNames ? 'down' : 'chevronRight'} size={14} /> Noms et couleurs des membres <span className="hint">(facultatif, modifiable plus tard)</span>
          </button>
          {showNames && (
            <div className="member-editor">
              {members.map((m, i) => (
                <div key={i} className="member-row">
                  <ColorDot color={m.color} onChange={(color) => patchCustom(i, { color })} />
                  <input value={custom[i]?.name ?? ''} placeholder={base[i]?.name} onChange={(e) => patchCustom(i, { name: e.target.value })} />
                </div>
              ))}
            </div>
          )}

          <button className="disclosure" onClick={() => setShowStage(!showStage)} aria-expanded={showStage}>
            <Icon name={showStage ? 'down' : 'chevronRight'} size={14} /> Scène : <b>{stageLabel}</b>
          </button>
          {showStage && (
            <div className="field">
              <div className="count-picker small">
                {STAGE_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    className={p.width === width && p.depth === depth ? 'on' : ''}
                    onClick={() => {
                      setWidth(p.width);
                      setDepth(p.depth);
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="row gap">
                <NumberField label="Largeur" value={width} onChange={setWidth} min={2} max={40} step={0.5} suffix="m" precision={1} />
                <NumberField label="Profondeur" value={depth} onChange={setDepth} min={2} max={30} step={0.5} suffix="m" precision={1} />
              </div>
            </div>
          )}

          {folders.length > 0 && (
            <label className="field">
              <span className="field-label">Dossier</span>
              <select value={folderId ?? ''} onChange={(e) => setFolderId(e.target.value || null)}>
                <option value="">Sans dossier</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}
    </Modal>
  );
}
