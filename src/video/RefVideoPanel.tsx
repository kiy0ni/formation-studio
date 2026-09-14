import { useRef, useState } from 'react';
import { Icon } from '../components/common/Icon';
import { notify } from '../components/common/Toast';
import { NumberField, Toggle } from '../components/common/ui';
import { formatTime } from '../lib/model';
import { useEditor } from '../store/editor';
import { DetectSection } from '../detect/DetectSection';
import { importMusicFile } from '../store/music';
import {
  loadRefVideo,
  prepareReferenceVideo,
  RefDurationMismatch,
  REF_VIDEO_ACCEPT,
  removeRefVideo,
  setRefVisible,
  updateRefVideo,
  useRefVideo,
  type RefImportStage,
} from './refVideo';

/** Settings of the reference video (phone: Plus → Vidéo de référence; computer: Vidéo button or Musique). */
export function RefVideoPanel() {
  const doc = useEditor((s) => s.doc!);
  const readOnly = useEditor((s) => s.readOnly);
  const info = doc.video ?? null;
  const visible = useRefVideo((s) => s.visible);
  const missing = useRefVideo((s) => s.missing);
  const job = useRefVideo((s) => (s.job?.choreoId === doc.id ? s.job : null));
  const [busy, setBusy] = useState<RefImportStage | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const progress = busy ?? job;

  /** The choreography names a video this device does not have: store the picked file under that name, settings kept. */
  const importHere = async (file: File, force = false) => {
    try {
      await prepareReferenceVideo(file, setBusy, { keepHash: info!.hash, expectDuration: info!.duration, force });
      await loadRefVideo(info!.hash, true);
      setRefVisible(true);
      notify('Vidéo importée sur cet appareil');
    } catch (e) {
      if (e instanceof RefDurationMismatch) {
        const ok = confirm(`Cette vidéo dure ${formatTime(e.found, false)} au lieu de ${formatTime(e.expected, false)}. Ce n’est peut-être pas la même. L’utiliser quand même ?`);
        if (ok) return importHere(file, true);
        return;
      }
      throw e;
    }
  };

  const onFile = async (file: File) => {
    setError('');
    setBusy({ label: 'Lecture de la vidéo…' });
    try {
      if (info && missing) {
        await importHere(file);
        return;
      }
      if (readOnly) return;
      const prepared = await prepareReferenceVideo(file, setBusy);
      updateRefVideo(prepared);
      setRefVisible(true);
      if (!doc.music.hash) {
        setBusy({ label: 'Son de la vidéo utilisé comme musique…' });
        const imported = await importMusicFile(file).catch(() => null);
        if (imported) {
          const { fromVideo: _fromVideo, ...music } = imported;
          useEditor.getState().update('Musique', (d) => void (d.music = { ...music, countsPerPhrase: d.music.countsPerPhrase ?? 8 }));
          notify('Vidéo ajoutée · son utilisé comme musique');
        } else notify('Vidéo ajoutée');
      } else notify('Vidéo ajoutée');
    } catch (e) {
      setError((e as Error).message || 'Vidéo illisible.');
    } finally {
      setBusy(null);
    }
  };

  const canPick = !progress && (!readOnly || (info && missing));

  return (
    <>
      <div className="panel-intro">
        {info && !missing ? (
          <div className="music-card" onClick={() => canPick && fileRef.current?.click()}>
            <Icon name="video" size={20} />
            <div className="grow">
              <b className="ellipsis">{info.name}</b>
              <span>{formatTime(info.duration, false)} · reste sur cet appareil</span>
            </div>
            {!readOnly && <span className="hint">Changer</span>}
          </div>
        ) : readOnly && !info ? (
          <p className="hint">Pas de vidéo de référence pour cette chorégraphie.</p>
        ) : (
          <button className="dropzone" disabled={!canPick} onClick={() => fileRef.current?.click()}>
            <Icon name="video" size={24} />
            <b>{info ? 'Importer la vidéo sur cet appareil' : 'Ajouter une vidéo de référence'}</b>
            <span>{info ? `« ${info.name} » (${formatTime(info.duration, false)}) · galerie ou fichiers` : 'Dance practice, clip… · galerie ou fichiers'}</span>
          </button>
        )}
        {progress && (
          <div className="ref-busy">
            <span>{progress.label}</span>
            {progress.ratio !== undefined && (
              <div className="progress-bar">
                <span style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
              </div>
            )}
          </div>
        )}
        {error && <p className="error-text">{error}</p>}
        <input
          ref={fileRef}
          type="file"
          accept={REF_VIDEO_ACCEPT}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void onFile(f);
          }}
        />
      </div>

      {info && (
        <div className="panel-block ref-settings">
          <Toggle checked={visible} onChange={setRefVisible} label="Afficher la vidéo" />
          <Toggle checked={info.mirror} onChange={(mirror) => !readOnly && updateRefVideo({ mirror })} label="Miroir" />
          <NumberField label="Décalage (s)" value={info.offset} step={0.01} stepper={0.1} disabled={readOnly} onChange={(offset) => updateRefVideo({ offset: Math.round(offset * 100) / 100 })} />
          <span className="hint">
            {readOnly
              ? 'Miroir et décalage sont réglés par le créateur du partage.'
              : 'À régler si la vidéo est en avance (valeur négative) ou en retard sur la musique. Ces réglages suivent sur vos appareils et dans les partages ; chacun importe la vidéo de son côté.'}
          </span>
          {!readOnly && (
            <button
              className="btn small ghost danger"
              onClick={() => {
                if (confirm('Retirer la vidéo de référence de cette chorégraphie ?')) void removeRefVideo();
              }}
            >
              <Icon name="trash" size={14} /> Retirer la vidéo
            </button>
          )}
        </div>
      )}
      <DetectSection />
    </>
  );
}
