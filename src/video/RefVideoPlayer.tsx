import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from '../components/common/Icon';
import { useEditor } from '../store/editor';
import { loadRefVideo, setRefCorner, setRefVisible, useRefVideo } from './refVideo';

const WIDE_QUERY = '(min-width: 861px), (orientation: landscape) and (max-height: 600px)';

/** Computer, tablet and phone held sideways: the video sits beside the stage. */
export function useWideLayout() {
  const [wide, setWide] = useState(() => typeof matchMedia === 'function' && matchMedia(WIDE_QUERY).matches);
  useEffect(() => {
    const m = matchMedia(WIDE_QUERY);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

/** Progress of a video being prepared in the background for the open choreography. */
export function RefVideoJob() {
  const job = useRefVideo((s) => s.job);
  const docId = useEditor((s) => s.doc?.id);
  if (!job || job.choreoId !== docId) return null;
  return (
    <div className="ref-job" role="status">
      <Icon name="video" size={14} /> {job.label}
      {job.ratio !== undefined ? ` ${Math.round(job.ratio * 100)} %` : ''}
    </div>
  );
}

/** Top bar button (computer): shows / hides the video, or opens its settings when there is none. */
export function RefVideoToggle() {
  const has = useEditor((s) => !!s.doc?.video);
  const visible = useRefVideo((s) => s.visible);
  return (
    <button
      className={`btn small ${has && visible ? '' : 'ghost'}`}
      title={has ? (visible ? 'Masquer la vidéo de référence' : 'Afficher la vidéo de référence') : 'Ajouter une vidéo de référence'}
      onClick={() => (has ? setRefVisible(!visible) : useEditor.setState({ tab: 'video', sheetOpen: true }))}
    >
      <Icon name="video" size={15} /> Vidéo
    </button>
  );
}

export function RefVideoPlayer({ wide }: { wide: boolean }) {
  const info = useEditor((s) => s.doc?.video ?? null);
  const { visible, expanded, corner, url, missing } = useRefVideo();
  const videoRef = useRef<HTMLVideoElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    void loadRefVideo(info?.hash);
  }, [info?.hash]);

  // follows the editor clock: play, pause, seek and slow motion
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !info) return;
    let lastSeek = 0;
    let lastCheck = 0;
    const sync = (force: boolean) => {
      const { time, playing, rate } = useEditor.getState();
      const now = performance.now();
      // while playing, a few checks per second are enough (seeking a video on every frame makes it stutter)
      if (playing && !force && now - lastCheck < 200) return;
      lastCheck = now;
      const duration = Number.isFinite(v.duration) ? v.duration : info.duration;
      const target = time + info.offset;
      const clamped = Math.max(0, Math.min(Math.max(0, duration - 0.05), target));
      if (playing && target >= 0 && target < duration - 0.05) {
        const drift = v.currentTime - clamped;
        if (v.paused) {
          if (!v.seeking && Math.abs(drift) > 0.1) v.currentTime = clamped;
          v.playbackRate = rate;
          v.play().catch(() => {});
          return;
        }
        if (Math.abs(drift) > 0.75 && !v.seeking && now - lastSeek > 1500) {
          lastSeek = now;
          v.currentTime = clamped;
        }
        // small drift: speed up or slow down a touch instead of jumping
        const wanted = Math.abs(drift) > 0.12 ? rate * (drift > 0 ? 0.92 : 1.08) : rate;
        if (Math.abs(v.playbackRate - wanted) > 0.001) v.playbackRate = wanted;
      } else {
        if (!v.paused) v.pause();
        if (v.playbackRate !== rate) v.playbackRate = rate;
        if (!v.seeking && Math.abs(v.currentTime - clamped) > 0.04) v.currentTime = clamped;
      }
    };
    sync(true);
    const unsub = useEditor.subscribe((s, p) => {
      if (s.playing !== p.playing || s.rate !== p.rate) sync(true);
      else if (s.time !== p.time) sync(!s.playing);
    });
    const onMeta = () => sync(true);
    v.addEventListener('loadedmetadata', onMeta);
    return () => {
      unsub();
      v.removeEventListener('loadedmetadata', onMeta);
    };
  }, [info, url, visible, expanded, wide]);

  if (!info) return null;

  if (!visible) {
    return (
      <button className="ref-show" onClick={() => setRefVisible(true)} aria-label="Afficher la vidéo de référence">
        <Icon name="video" size={15} /> Vidéo
      </button>
    );
  }

  const openSettings = () => useEditor.setState({ tab: 'video', sheetOpen: true });
  const media = missing ? (
    <button className="ref-missing" onClick={openSettings}>
      <Icon name="video" size={20} />
      <span>Vidéo absente sur cet appareil</span>
      <small>Toucher pour l’importer</small>
    </button>
  ) : url ? (
    <video ref={videoRef} src={url} muted playsInline preload="auto" className={info.mirror ? 'mirror' : ''} />
  ) : (
    <div className="ref-loading">
      <div className="spinner" />
    </div>
  );
  const close = (
    <button className="ref-close" onClick={() => setRefVisible(false)} aria-label="Masquer la vidéo">
      <Icon name="close" size={14} />
    </button>
  );

  if (wide) {
    return (
      <div className="ref-video docked">
        {media}
        <div className="ref-bar">
          <span className="grow ellipsis">{info.name}</span>
          <button className="icon-btn" onClick={openSettings} aria-label="Réglages de la vidéo" title="Réglages">
            <Icon name="settings" size={15} />
          </button>
          <button className="icon-btn" onClick={() => setRefVisible(false)} aria-label="Masquer la vidéo" title="Masquer">
            <Icon name="close" size={15} />
          </button>
        </div>
      </div>
    );
  }

  // phone: small floating video, dragged to a corner, tapped to enlarge
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button') || expanded) return;
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    d.moved = true;
    setOffset({ x: dx, y: dy });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if ((e.target as HTMLElement).closest('button')) return;
    if (expanded) return void useRefVideo.setState({ expanded: false });
    if (!d?.moved) return void useRefVideo.setState({ expanded: true });
    const box = e.currentTarget.getBoundingClientRect();
    const area = e.currentTarget.parentElement!.getBoundingClientRect();
    const cx = box.left + box.width / 2 - area.left;
    const cy = box.top + box.height / 2 - area.top;
    setRefCorner(`${cy < area.height / 2 ? 't' : 'b'}${cx < area.width / 2 ? 'l' : 'r'}`);
    setOffset(null);
  };

  return (
    <div
      className={`ref-video floating ${expanded ? 'expanded' : corner} ${offset ? 'dragging' : ''}`}
      style={{ ['--ref-ar' as string]: `${info.width || 16} / ${info.height || 9}`, transform: offset ? `translate(${offset.x}px, ${offset.y}px)` : undefined }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drag.current = null;
        setOffset(null);
      }}
    >
      {media}
      {close}
    </div>
  );
}
