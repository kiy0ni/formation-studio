import { useRef, useState } from 'react';
import { Icon } from '../components/common/Icon';
import { notify } from '../components/common/Toast';
import { NumberField, Toggle } from '../components/common/ui';
import { formatTime } from '../lib/model';
import { useEditor } from '../store/editor';
import { importMusicFile } from '../store/music';
import { prepareReferenceVideo, REF_VIDEO_ACCEPT, removeRefVideo, setRefVisible, updateRefVideo, useRefVideo, type RefImportStage } from './refVideo';

/** Settings of the reference video (phone: Plus → Vidéo de référence; computer: Vidéo button or Musique). */
export function RefVideoPanel() {
  const doc = useEditor((s) => s.doc!);
  const info = doc.video ?? null;
  const visible = useRefVideo((s) => s.visible);
  const missing = useRefVideo((s) => s.missing);
  const [busy, setBusy] = useState<RefImportStage | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File) => {
    setError('');
    setBusy({ label: 'Lecture de la vidéo…' });
    try {
      const prepared = await prepareReferenceVideo(file, setBusy);
      const same = info?.hash === prepared.hash;
      updateRefVideo(same ? { ...prepared, offset: info!.offset, mirror: info!.mirror } : prepared);
      setRefVisible(true);
      if (!doc.music.hash) {
        setBusy({ label: 'Son de la vidéo utilisé comme musique…' });
        const { fromVideo: _fromVideo, ...music } = await importMusicFile(file).catch(() => ({ fromVideo: false }) as never);
        if (music?.hash) {
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

  return (
    <>
      <div className="panel-intro">
        {info && !missing ? (
          <div className="music-card" onClick={() => !busy && fileRef.current?.click()}>
            <Icon name="video" size={20} />
            <div className="grow">
              <b className="ellipsis">{info.name}</b>
              <span>{formatTime(info.duration, false)} · reste sur cet appareil</span>
            </div>
            <span className="hint">Changer</span>
          </div>
        ) : (
          <button className="dropzone" disabled={!!busy} onClick={() => fileRef.current?.click()}>
            <Icon name="video" size={24} />
            <b>{info ? 'Importer la vidéo sur cet appareil' : 'Ajouter une vidéo de référence'}</b>
            <span>{info ? `« ${info.name} » n’est pas sur cet appareil` : 'Dance practice, clip… pour caler les formations'}</span>
          </button>
        )}
        {busy && (
          <div className="ref-busy">
            <span>{busy.label}</span>
            {busy.ratio !== undefined && (
              <div className="progress-bar">
                <span style={{ width: `${Math.round(busy.ratio * 100)}%` }} />
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
          <Toggle checked={info.mirror} onChange={(mirror) => updateRefVideo({ mirror })} label="Miroir" />
          <NumberField label="Décalage (s)" value={info.offset} step={0.01} stepper={0.1} onChange={(offset) => updateRefVideo({ offset: Math.round(offset * 100) / 100 })} />
          <span className="hint">À régler si la vidéo est en avance (valeur négative) ou en retard sur la musique.</span>
          <button
            className="btn small ghost danger"
            onClick={() => {
              if (confirm('Retirer la vidéo de référence de cette chorégraphie ?')) void removeRefVideo();
            }}
          >
            <Icon name="trash" size={14} /> Retirer la vidéo
          </button>
        </div>
      )}
    </>
  );
}
