import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../../lib/db';
import { download, safe } from '../../lib/exporters';
import { createReferenceRenderer } from '../../video/referenceRender';
import { IS_PHONE_APP } from '../../lib/platform';
import { formatTime, sortedDancers, totalDuration } from '../../lib/model';
import type { VideoProgress, VideoResult } from '../../lib/videoExport';
import { createRenderer, videoSize, type Aspect, type VideoOptions } from '../../lib/videoRender';
import { currentItem, useEditor } from '../../store/editor';
import { playback } from '../../store/playback';
import { Icon } from '../common/Icon';
import { notify } from '../common/Toast';
import { Modal, Segmented, Toggle } from '../common/ui';

type Settings = Omit<VideoOptions, 'range'> & { rangeKind: 'all' | 'current'; withReference: boolean; refMirror: boolean };

type Phase =
  | { kind: 'setup' }
  | { kind: 'running'; progress: VideoProgress }
  | { kind: 'done'; result: VideoResult; url: string }
  | { kind: 'error'; message: string };

export function VideoExportDialog({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc!);
  const [cfg, setCfg] = useState<Settings>(() => {
    const s = useEditor.getState();
    return {
      aspect: 'landscape',
      resolution: 1080,
      rangeKind: 'all',
      audienceTop: s.audienceTop,
      showNames: s.showNames,
      showPaths: true,
      showCounts: !!s.doc?.music.bpm,
      showNotes: true,
      focusDancer: s.focusDancer,
      includeAudio: !!s.doc?.music.hash,
      withReference: !!s.doc?.video,
      // starts like the video's own setting, can be changed for this export
      refMirror: !!s.doc?.video?.mirror,
    };
  });
  const [phase, setPhase] = useState<Phase>({ kind: 'setup' });
  const abortRef = useRef<AbortController | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const urlRef = useRef<string | null>(null);
  // reference video: its file on this device, and a hidden player for the preview frame
  const [refBlob, setRefBlob] = useState<Blob | null>(null);
  const previewVideo = useRef<HTMLVideoElement | null>(null);
  const [frameTick, setFrameTick] = useState(0);
  const refInfo = doc.video ?? null;
  useEffect(() => {
    if (!refInfo) return void setRefBlob(null);
    let alive = true;
    db.getVideo(refInfo.hash).then((b) => alive && setRefBlob(b ?? null));
    return () => {
      alive = false;
    };
  }, [refInfo?.hash]);
  useEffect(() => {
    if (!refBlob) return;
    const url = URL.createObjectURL(refBlob);
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.onloadeddata = () => setFrameTick((n) => n + 1);
    v.onseeked = () => setFrameTick((n) => n + 1);
    v.src = url;
    previewVideo.current = v;
    return () => {
      previewVideo.current = null;
      v.removeAttribute('src');
      v.load();
      URL.revokeObjectURL(url);
    };
  }, [refBlob]);

  const range = useMemo(() => {
    if (cfg.rangeKind === 'all') return { start: 0, end: Math.max(1, totalDuration(doc)) };
    const { items, index, item } = currentItem(doc, useEditor.getState().time);
    const next = items[index + 1];
    return { start: item.start, end: next ? next.holdEnd : Math.max(item.holdEnd, item.start + 1) };
  }, [doc, cfg.rangeKind]);

  const [previewT, setPreviewT] = useState(range.start);
  useEffect(() => setPreviewT(range.start), [range.start]);
  const useReference = cfg.withReference && !!refBlob && !!refInfo;
  const refForExport = refInfo ? { ...refInfo, mirror: cfg.refMirror } : null;
  useEffect(() => {
    const v = previewVideo.current;
    if (!v || !refInfo || !useReference) return;
    const target = Math.max(0, Math.min(Math.max(0, refInfo.duration - 0.05), previewT + refInfo.offset));
    if (Math.abs(v.currentTime - target) > 0.02) v.currentTime = target;
  }, [previewT, useReference, refInfo, refBlob]);

  const { width, height } = videoSize(cfg.aspect, cfg.resolution);
  const options: VideoOptions = { ...cfg, range };

  // live preview of the chosen settings
  useEffect(() => {
    if (phase.kind !== 'setup' || !canvasRef.current) return;
    const c = canvasRef.current;
    c.width = width;
    c.height = height;
    if (useReference) {
      const r = createReferenceRenderer(doc, width, height, options, { blob: refBlob!, info: refForExport! });
      const v = previewVideo.current;
      if (v && v.readyState >= 2) r.setFrame(v, v.videoWidth, v.videoHeight);
      r.draw(c.getContext('2d')!, previewT);
    } else createRenderer(doc, width, height, options).draw(c.getContext('2d')!, previewT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, width, height, previewT, phase.kind, JSON.stringify(options), useReference, frameTick]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const close = () => {
    abortRef.current?.abort();
    onClose();
  };

  const start = async () => {
    playback.pause();
    const ac = new AbortController();
    abortRef.current = ac;
    setPhase({ kind: 'running', progress: { ratio: 0, mode: 'fast' } });
    try {
      const { exportVideo } = await import('../../lib/videoExport');
      let last = 0;
      const result = await exportVideo(
        doc,
        { ...options, reference: useReference ? { blob: refBlob!, info: refForExport! } : undefined },
        (progress) => {
          const now = performance.now();
          if (now - last > 80 || progress.ratio >= 0.98) {
            last = now;
            setPhase({ kind: 'running', progress });
          }
        },
        ac.signal,
      );
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(result.blob);
      urlRef.current = url;
      setPhase({ kind: 'done', result, url });
    } catch (e) {
      const { isAbort } = await import('../../lib/videoExport');
      if (isAbort(e)) setPhase({ kind: 'setup' });
      else setPhase({ kind: 'error', message: (e as Error).message || 'Erreur inconnue' });
    } finally {
      abortRef.current = null;
    }
  };

  const fileName = (ext: string) => {
    const who = cfg.focusDancer && doc.dancers[cfg.focusDancer] ? ` - ${doc.dancers[cfg.focusDancer].name}` : '';
    return `${safe(doc.name + who)}.${ext}`;
  };

  const set = (patch: Partial<Settings>) => setCfg((c) => ({ ...c, ...patch }));
  const duration = range.end - range.start;

  return (
    <Modal title="Exporter en vidéo" onClose={close} width={860}>
      {phase.kind === 'setup' && (
        <div className="video-export">
          <div className="video-preview">
            <div className="video-canvas-wrap">
              <canvas ref={canvasRef} />
            </div>
            <input
              type="range"
              min={range.start}
              max={range.end}
              step={0.05}
              value={previewT}
              onChange={(e) => setPreviewT(Number(e.target.value))}
              aria-label="Aperçu dans le temps"
            />
            <p className="hint">
              Aperçu à {formatTime(previewT, false)} · {width}×{height} · {formatTime(duration, false)}
            </p>
          </div>

          <div className="video-options">
            <div className="field">
              <span className="field-label">Format</span>
              <Segmented<Aspect>
                value={cfg.aspect}
                onChange={(aspect) => set({ aspect })}
                options={[
                  { value: 'landscape', label: '16:9', title: 'Écran, YouTube' },
                  { value: 'square', label: '1:1', title: 'Publication Instagram' },
                  { value: 'portrait', label: '9:16', title: 'Reels, TikTok, Stories' },
                ]}
              />
              <span className="hint">{cfg.aspect === 'landscape' ? 'Écran, YouTube, ordinateur' : cfg.aspect === 'square' ? 'Publication Instagram' : 'Reels, TikTok, Stories, WhatsApp'}</span>
            </div>
            <div className="row gap">
              <div className="field">
                <span className="field-label">Qualité</span>
                <Segmented
                  value={String(cfg.resolution)}
                  onChange={(v) => set({ resolution: Number(v) as 720 | 1080 })}
                  options={[
                    { value: '720', label: '720p' },
                    { value: '1080', label: '1080p' },
                  ]}
                />
              </div>
              <div className="field">
                <span className="field-label">Vue</span>
                <Segmented
                  value={cfg.audienceTop ? 'dancers' : 'public'}
                  onChange={(v) => set({ audienceTop: v === 'dancers' })}
                  options={[
                    { value: 'public', label: 'Public' },
                    { value: 'dancers', label: 'Miroir' },
                  ]}
                />
              </div>
            </div>
            <div className="field">
              <span className="field-label">Portion</span>
              <Segmented
                value={cfg.rangeKind}
                onChange={(rangeKind) => set({ rangeKind })}
                options={[
                  { value: 'all', label: 'Toute la choré' },
                  { value: 'current', label: 'Formation courante' },
                ]}
              />
            </div>
            <label className="field">
              <span className="field-label">Vidéo d’entraînement pour</span>
              <select value={cfg.focusDancer ?? ''} onChange={(e) => set({ focusDancer: e.target.value || null })}>
                <option value="">Tout le groupe</option>
                {sortedDancers(doc).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} (parcours mis en avant)
                  </option>
                ))}
              </select>
            </label>
            <div className="video-toggles">
              <Toggle checked={cfg.includeAudio && !!doc.music.hash} onChange={(includeAudio) => set({ includeAudio })} label={doc.music.hash ? 'Musique' : 'Musique (aucune importée)'} />
              <Toggle checked={cfg.showNames} onChange={(showNames) => set({ showNames })} label="Noms" />
              <Toggle checked={cfg.showPaths} onChange={(showPaths) => set({ showPaths })} label="Trajets" />
              <Toggle checked={cfg.showCounts} onChange={(showCounts) => set({ showCounts })} label={doc.music.bpm ? 'Comptes (8 temps)' : 'Comptes (BPM requis)'} />
              <Toggle checked={cfg.showNotes} onChange={(showNotes) => set({ showNotes })} label="Notes" />
              {refInfo && <Toggle checked={useReference} onChange={(withReference) => set({ withReference })} label={refBlob ? 'Vidéo de référence' : 'Vidéo absente ici'} />}
              {useReference && <Toggle checked={cfg.refMirror} onChange={(refMirror) => set({ refMirror })} label="Vidéo en miroir" />}
            </div>
            {useReference && <span className="hint">{cfg.aspect === 'landscape' ? 'La vidéo sera à côté des formations.' : 'La vidéo sera au-dessus des formations.'}</span>}
            <button className="btn primary block" onClick={start}>
              <Icon name="video" /> Créer la vidéo
            </button>
          </div>
        </div>
      )}

      {phase.kind === 'running' && (
        <div className="video-progress">
          <div className="spinner" />
          <b>{Math.round(phase.progress.ratio * 100)} %</b>
          <div className="progress-bar">
            <span style={{ width: `${Math.round(phase.progress.ratio * 100)}%` }} />
          </div>
          <p className="hint">
            {phase.progress.mode === 'fast'
              ? 'Encodage de la vidéo… (plus rapide que la lecture)'
              : 'Enregistrement en temps réel : gardez cet onglet ouvert et visible jusqu’à la fin.'}
          </p>
          <button className="btn ghost" onClick={() => abortRef.current?.abort()}>
            Annuler
          </button>
        </div>
      )}

      {phase.kind === 'done' && (
        <div className="video-done" data-mode={phase.result.mode}>
          <video src={phase.url} controls playsInline className={`video-result ${cfg.aspect}`} />
          <p className="hint">
            {phase.result.ext.toUpperCase()} · {phase.result.width}×{phase.result.height} · {formatTime(duration, false)} ·{' '}
            {phase.result.hasAudio ? 'avec musique' : 'sans musique'} · {(phase.result.blob.size / 1024 / 1024).toFixed(1)} Mo
            {phase.result.ext === 'webm' && ' — lisible dans Chrome, VLC, YouTube ; pas dans QuickTime'}
          </p>
          <div className="row gap wrap center-row">
            <button
              className="btn primary"
              onClick={() => {
                download(fileName(phase.result.ext), phase.result.blob);
                notify('Vidéo téléchargée');
              }}
            >
              <Icon name="download" /> {IS_PHONE_APP ? 'Enregistrer / partager' : 'Télécharger'}
            </button>
            <ShareButton blob={phase.result.blob} name={fileName(phase.result.ext)} title={doc.name} />
            <button className="btn ghost" onClick={() => setPhase({ kind: 'setup' })}>
              <Icon name="settings" /> Autres réglages
            </button>
          </div>
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="video-progress">
          <Icon name="warning" size={32} />
          <b>La vidéo n’a pas pu être créée</b>
          <p className="hint">{phase.message}</p>
          <button className="btn" onClick={() => setPhase({ kind: 'setup' })}>
            Réessayer
          </button>
        </div>
      )}
    </Modal>
  );
}

function ShareButton({ blob, name, title }: { blob: Blob; name: string; title: string }) {
  const file = useMemo(() => new File([blob], name, { type: blob.type }), [blob, name]);
  if (!navigator.canShare?.({ files: [file] })) return null;
  return (
    <button
      className="btn"
      onClick={() => navigator.share({ files: [file], title }).catch(() => {})}
    >
      <Icon name="share" /> Partager
    </button>
  );
}
