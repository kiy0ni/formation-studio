import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { beatLength, countAt, formatTime, itemIndexAt, snapTime, timeline, totalDuration } from '../../lib/model';
import { currentItem, useEditor } from '../../store/editor';
import { useMusic } from '../../store/music';
import { playback } from '../../store/playback';
import { Icon } from '../common/Icon';
import { IconButton, Menu, MenuCheck, Segmented } from '../common/ui';
import { addFormationAtPlayhead, goToFormation } from './EditorPage';

const PAD = 12;
const CANVAS_H = 62;

type Field = 'duration' | 'transition';

export function Timeline() {
  const doc = useEditor((s) => s.doc!);
  const time = useEditor((s) => s.time);
  const playing = useEditor((s) => s.playing);
  const pps = useEditor((s) => s.pxPerSec);
  const readOnly = useEditor((s) => s.readOnly);
  const loop = useEditor((s) => s.loop);
  const timelineOpen = useEditor((s) => s.timelineOpen);
  const peaks = useMusic((s) => s.peaks);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState({ left: 0, width: 800 });
  const [bubble, setBubble] = useState<{ x: number; text: string } | null>(null);

  const items = timeline(doc);
  const total = totalDuration(doc);
  const contentW = (total + 6) * pps + PAD * 2;
  const index = itemIndexAt(items, time);

  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const update = () => setView({ left: el.scrollLeft, width: el.clientWidth });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener('scroll', update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', update);
    };
  }, []);

  // zoom with ctrl/cmd + wheel, keeping the time under the cursor
  useEffect(() => {
    const el = scrollRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const s = useEditor.getState();
      const t = (e.clientX - rect.left + el.scrollLeft - PAD) / s.pxPerSec;
      const next = Math.max(8, Math.min(500, s.pxPerSec * Math.exp(-e.deltaY * 0.01)));
      s.set({ pxPerSec: next });
      requestAnimationFrame(() => (el.scrollLeft = t * next + PAD - (e.clientX - rect.left)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // follow the playhead
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    const x = time * pps + PAD;
    if (x > el.scrollLeft + el.clientWidth * 0.85 || x < el.scrollLeft) el.scrollLeft = x - el.clientWidth * 0.2;
  }, [time, playing, pps]);

  // draw ruler + waveform + beat grid for the visible window
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(view.width * dpr);
    canvas.height = CANVAS_H * dpr;
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, view.width, CANVAS_H);
    const css = getComputedStyle(document.documentElement);
    const muted = css.getPropertyValue('--muted').trim() || '#9a93ad';
    const line = css.getPropertyValue('--border').trim() || '#2f2940';
    const accent = css.getPropertyValue('--accent').trim() || '#ff4d8d';
    const tAt = (x: number) => (x + view.left - PAD) / pps;
    const xAt = (t: number) => t * pps + PAD - view.left;
    const t0 = Math.max(0, tAt(0));
    const t1 = tAt(view.width);

    // waveform
    if (peaks) {
      const mid = 18 + (CANVAS_H - 18) / 2;
      const amp = (CANVAS_H - 22) / 2;
      g.fillStyle = 'rgba(124, 92, 255, 0.55)';
      for (let x = 0; x < view.width; x++) {
        const a = tAt(x);
        const b = tAt(x + 1);
        if (b < 0) continue;
        const i0 = Math.max(0, Math.floor(a * 100));
        const i1 = Math.min(peaks.length, Math.max(i0 + 1, Math.ceil(b * 100)));
        let m = 0;
        for (let i = i0; i < i1; i++) if (peaks[i] > m) m = peaks[i];
        if (m > 0) g.fillRect(x, mid - m * amp, 1, Math.max(1, m * amp * 2));
      }
    }

    // beat grid
    const bl = beatLength(doc.music);
    if (bl) {
      const per = doc.music.countsPerPhrase || 8;
      const off = doc.music.beatOffset ?? 0;
      const first = Math.max(0, Math.floor((t0 - off) / bl));
      const last = Math.ceil((t1 - off) / bl);
      const beatPx = bl * pps;
      for (let k = first; k <= last; k++) {
        const x = xAt(off + k * bl);
        const phrase = k % per === 0;
        if (!phrase && beatPx < 5) continue;
        g.fillStyle = phrase ? 'rgba(255,77,141,0.55)' : 'rgba(255,255,255,0.09)';
        g.fillRect(Math.round(x), phrase ? 0 : 18, 1, CANVAS_H);
        if (phrase && per * beatPx > 26) {
          g.fillStyle = accent;
          g.font = '600 10px system-ui, sans-serif';
          g.fillText(`${per}×${k / per + 1}`, x + 3, 29);
        }
      }
    }

    // ruler
    g.fillStyle = line;
    g.fillRect(0, 17, view.width, 1);
    const steps = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
    const step = steps.find((s) => s * pps >= 64) ?? 60;
    g.fillStyle = muted;
    g.font = '10px system-ui, sans-serif';
    for (let t = Math.floor(t0 / step) * step; t <= t1; t += step) {
      const x = xAt(t);
      g.fillRect(Math.round(x), 10, 1, 7);
      g.fillText(formatTime(t, step < 1), x + 3, 10);
    }
  }, [peaks, pps, view, doc.music, total]);

  /** Drag on the ruler / waveform moves the playhead. */
  const scrub = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const target = e.currentTarget;
    const el = scrollRef.current!;
    const at = (clientX: number) => {
      const rect = el.getBoundingClientRect();
      return Math.max(0, (clientX - rect.left + el.scrollLeft - PAD) / useEditor.getState().pxPerSec);
    };
    target.setPointerCapture(e.pointerId);
    playback.seek(at(e.clientX));
    const move = (ev: PointerEvent) => playback.seek(at(ev.clientX));
    const end = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  };

  /** Drag a grip to change a hold or move duration; the timeline scrolls by itself near its edges. */
  const startResize = (e: React.PointerEvent<HTMLElement>, fid: string, field: Field) => {
    if (readOnly || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    playback.pause();
    const grip = e.currentTarget;
    const el = scrollRef.current!;
    grip.setPointerCapture(e.pointerId);
    const s = useEditor.getState();
    const label = field === 'duration' ? 'Durée de tenue' : 'Durée du déplacement';
    const item = timeline(s.doc!).find((x) => x.f.id === fid);
    if (!item) return;
    s.beginGesture(label);
    const anchor = field === 'duration' ? item.start : item.holdEnd;
    const startVal = item.f[field];
    const startX = e.clientX;
    const startScroll = el.scrollLeft;
    let lastX = e.clientX;
    let free = e.altKey;
    let raf = 0;
    let done = false;

    const apply = () => {
      const st = useEditor.getState();
      const doc = st.doc!;
      let endT = anchor + startVal + (lastX - startX + el.scrollLeft - startScroll) / st.pxPerSec;
      if (!free) endT = doc.music.bpm ? snapTime(doc.music, endT, 2) : Math.round(endT * 10) / 10;
      const v = Math.max(0, Math.round((endT - anchor) * 100) / 100);
      if (doc.formations[fid] && doc.formations[fid][field] !== v)
        st.update(label, (d) => {
          if (d.formations[fid]) d.formations[fid][field] = v;
        });
      const bl = beatLength(doc.music);
      const num = (n: number, digits: number) => n.toFixed(digits).replace('.', ',');
      setBubble({
        x: (anchor + v) * st.pxPerSec + PAD,
        text: `${field === 'duration' ? 'Tenue' : 'Déplacement'} ${num(v, 2)} s${bl ? ` · ${num(v / bl, 1)} temps` : ''}`,
      });
    };

    // gentle: only right at the edge, speed grows the closer the finger gets
    const autoScroll = () => {
      const rect = el.getBoundingClientRect();
      const edge = 28;
      let dx = 0;
      if (lastX > rect.right - edge) dx = Math.min(10, 1 + ((lastX - rect.right + edge) / edge) * 9);
      else if (lastX < rect.left + edge && el.scrollLeft > 0) dx = -Math.min(10, 1 + ((rect.left + edge - lastX) / edge) * 9);
      if (dx) {
        el.scrollLeft += dx;
        apply();
      }
      raf = requestAnimationFrame(autoScroll);
    };

    const move = (ev: PointerEvent) => {
      lastX = ev.clientX;
      free = ev.altKey;
      apply();
    };
    const end = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', end);
      grip.removeEventListener('pointercancel', end);
      grip.removeEventListener('lostpointercapture', end);
      useEditor.getState().endGesture();
      setBubble(null);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
    grip.addEventListener('lostpointercapture', end);
    raf = requestAnimationFrame(autoScroll);
    apply();
  };

  return (
    <div className={`timeline ${timelineOpen ? '' : 'collapsed'}`}>
      <PlayerBar />
      <div className="tl-scroll" ref={scrollRef}>
        <div className="tl-content" style={{ width: contentW }}>
          <canvas ref={canvasRef} className="tl-canvas" style={{ left: view.left, width: view.width, height: CANVAS_H }} onPointerDown={scrub} />
          <div className="tl-canvas-spacer" style={{ height: CANVAS_H }} onPointerDown={scrub} />
          <div className="tl-row">
            {items.map((it) => (
              <Fragment key={it.f.id}>
                <div
                  className={`tl-hold ${it.index === index ? 'on' : ''}`}
                  style={{ left: it.start * pps + PAD, width: Math.max(2, it.f.duration * pps) }}
                  onClick={() => playback.seek(it.start)}
                  title={`${it.f.name} — ${formatTime(it.start)} → ${formatTime(it.holdEnd)}`}
                >
                  <span className="tl-label">
                    <b>{it.index + 1}</b> {it.f.name}
                  </span>
                </div>
                {it.index < items.length - 1 && (
                  <div
                    className="tl-trans"
                    style={{ left: it.holdEnd * pps + PAD, width: Math.max(2, it.f.transition * pps) }}
                    title={`Déplacement ${it.f.transition.toFixed(2)} s`}
                    onClick={() => playback.seek(it.holdEnd + it.f.transition / 2)}
                  />
                )}
              </Fragment>
            ))}
            {!readOnly &&
              items.map((it) => {
                const last = it.index === items.length - 1;
                // keep both grips reachable when the move is very short
                const tight = !last && it.f.transition * pps < 24;
                const on = it.index === index;
                return (
                  <Fragment key={`grip-${it.f.id}`}>
                    <span
                      className={`tl-grip ${on ? 'on' : ''}`}
                      style={{ left: it.holdEnd * pps + PAD - (tight ? 12 : 0) }}
                      title="Glisser pour changer la durée de tenue"
                      onPointerDown={(e) => startResize(e, it.f.id, 'duration')}
                    >
                      <i />
                    </span>
                    {!last && (
                      <span
                        className={`tl-grip trans ${on ? 'on' : ''}`}
                        style={{ left: it.end * pps + PAD + (tight ? 12 : 0) }}
                        title="Glisser pour changer la durée du déplacement"
                        onPointerDown={(e) => startResize(e, it.f.id, 'transition')}
                      >
                        <i />
                      </span>
                    )}
                  </Fragment>
                );
              })}
            {doc.music.duration ? <div className="tl-music-end" style={{ left: doc.music.duration * pps + PAD }} title="Fin de la musique" /> : null}
          </div>
          {loop && <div className="tl-loop" style={{ left: loop.a * pps + PAD, width: (loop.b - loop.a) * pps }} />}
          <div className="tl-playhead" style={{ transform: `translateX(${time * pps + PAD}px)` }}>
            <span />
          </div>
          {bubble && (
            <div className="tl-bubble" style={{ left: bubble.x }}>
              {bubble.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PlayerBar() {
  const time = useEditor((s) => s.time);
  const playing = useEditor((s) => s.playing);
  const rate = useEditor((s) => s.rate);
  const metronome = useEditor((s) => s.metronome);
  const loop = useEditor((s) => s.loop);
  const readOnly = useEditor((s) => s.readOnly);
  const music = useEditor((s) => s.doc!.music);
  const total = useEditor((s) => totalDuration(s.doc!));
  const pps = useEditor((s) => s.pxPerSec);
  const loading = useMusic((s) => s.loading);
  const missing = useMusic((s) => s.missing);
  const set = useEditor((s) => s.set);
  const timelineOpen = useEditor((s) => s.timelineOpen);
  const count = countAt(music, time);

  return (
    <div className="player">
      <div className="player-left">
        <IconButton icon="prev" title="Formation précédente ([)" onClick={() => goToFormation(-1)} />
        <button className="play-btn" onClick={() => playback.toggle()} title="Lecture / pause (Espace)" aria-label={playing ? 'Pause' : 'Lecture'}>
          <Icon name={playing ? 'pause' : 'play'} size={18} />
        </button>
        <IconButton icon="next" title="Formation suivante (])" onClick={() => goToFormation(1)} />
        <div className="time-readout">
          <b>{formatTime(time)}</b>
          <span>/ {formatTime(total)}</span>
        </div>
        {count && (
          <div className="beat-readout" title="Phrase de comptes · temps">
            <span>{count.phrase}</span>
            <i>·</i>
            <b>{count.count}</b>
          </div>
        )}
      </div>

      <div className="player-right">
        <button className={`btn small ghost music-btn ${missing ? 'warn' : ''}`} onClick={() => set({ tab: 'music', sheetOpen: true })} title="Musique et tempo">
          <Icon name="music" size={14} />
          <span className="ellipsis hide-sm">{loading ? 'Chargement…' : missing ? 'Audio manquant' : (music.name ?? 'Ajouter une musique')}</span>
          {music.bpm ? <em>{music.bpm} BPM</em> : null}
        </button>
        {!readOnly && (
          <button className="btn small primary player-add" onClick={addFormationAtPlayhead} title="Nouvelle formation à partir du curseur (F)">
            <Icon name="plus" size={14} /> <span>Formation</span>
          </button>
        )}
        <Menu direction="up" trigger={<IconButton icon="settings" title="Options de lecture : vitesse, boucle, métronome" active={!!loop || metronome || rate !== 1} />}>
          {() => (
            <div className="menu-panel">
              <div className="menu-sep">Vitesse de lecture</div>
              <div className="menu-row">
                <Segmented
                  value={String(rate)}
                  onChange={(v) => playback.setRate(Number(v))}
                  options={['0.25', '0.5', '0.75', '1', '1.25'].map((v) => ({ value: v, label: `${v.replace('.', ',')}×` }))}
                />
              </div>
              <MenuCheck
                icon="loop"
                label="Boucler la formation"
                hint="Répète la formation en cours et sa transition (L)"
                checked={!!loop}
                onChange={() => {
                  const s = useEditor.getState();
                  if (s.loop) return set({ loop: null });
                  const { item } = currentItem(s.doc!, s.time);
                  if (item) set({ loop: { a: item.start, b: Math.max(item.end, item.start + 0.5) } });
                }}
              />
              {music.bpm ? (
                <MenuCheck icon="metronome" label="Métronome" hint="Un clic sur chaque temps (K)" checked={metronome} onChange={(v) => set({ metronome: v })} />
              ) : null}
              <div className="menu-sep">Zoom de la timeline</div>
              <div className="menu-row">
                <button className="btn small" onClick={() => set({ pxPerSec: Math.max(8, pps / 1.4) })}>
                  <Icon name="minus" size={14} /> Dézoomer
                </button>
                <button className="btn small" onClick={() => set({ pxPerSec: Math.min(500, pps * 1.4) })}>
                  <Icon name="plus" size={14} /> Zoomer
                </button>
              </div>
            </div>
          )}
        </Menu>
        <IconButton
          icon={timelineOpen ? 'down' : 'up'}
          className="tl-toggle"
          title={timelineOpen ? 'Masquer la timeline' : 'Afficher la timeline'}
          onClick={() => {
            const open = !useEditor.getState().timelineOpen;
            set({ timelineOpen: open });
            try {
              localStorage.setItem('fs-timeline-open', open ? '1' : '0');
            } catch {
              /* private mode */
            }
          }}
        />
      </div>
    </div>
  );
}
