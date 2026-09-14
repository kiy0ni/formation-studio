import { lazy, Suspense, useEffect, useState } from 'react';
import { CollabSession, downloadAudio } from '../../collab/client';
import { db } from '../../lib/db';
import { insertFormationAfter, itemIndexAt, timeline } from '../../lib/model';
import { navigate } from '../../lib/router';
import type { CollabLink } from '../../lib/types';
import { currentItem, onLocalChange, useEditor, type InspectorTab } from '../../store/editor';
import { loadMusic } from '../../store/music';
import { playback } from '../../store/playback';
import { useSaveStatus } from '../../store/save';
import { Icon } from '../common/Icon';
import { FormationList } from './FormationList';
import { Inspector, TABS } from './Inspector';
import { Stage2D } from './Stage2D';
import { Timeline } from './Timeline';
import { TopBar } from './TopBar';
import { shouldShowTour, Tour } from './Tour';

const Stage3D = lazy(() => import('./Stage3D'));

export const startTour = () => window.dispatchEvent(new Event('fs-tour'));

export function EditorPage({ id }: { id: string }) {
  const [status, setStatus] = useState<'loading' | 'missing' | 'ready'>('loading');
  const view = useEditor((s) => s.view);
  const sheetOpen = useEditor((s) => s.sheetOpen);
  const tab = useEditor((s) => s.tab);
  const collabKey = useEditor((s) => (s.doc?.collab ? `${s.doc.collab.roomId}|${s.doc.collab.key}` : ''));
  const musicHash = useEditor((s) => s.doc?.music.hash);
  const [tour, setTour] = useState(false);

  // load
  useEffect(() => {
    let alive = true;
    db.getChoreo(id).then((doc) => {
      if (!alive) return;
      if (!doc) return setStatus('missing');
      useEditor.getState().load(doc, doc.collab?.role === 'view');
      useEditor.setState({ sheetOpen: false });
      setStatus('ready');
    });
    return () => {
      alive = false;
      playback.pause();
      const doc = useEditor.getState().doc;
      if (doc && doc.id === id) db.saveChoreo(doc);
      useEditor.getState().unload();
    };
  }, [id]);

  // autosave: debounced, and flushed as soon as the app goes to the background (phones kill apps silently)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = async () => {
      timer = null;
      const doc = useEditor.getState().doc;
      if (!doc || doc.id !== id) return;
      try {
        await db.saveChoreo(doc);
        useSaveStatus.setState({ state: 'saved', at: Date.now() });
      } catch {
        useSaveStatus.setState({ state: 'error', at: Date.now() });
      }
    };
    const flushNow = () => {
      if (timer) {
        clearTimeout(timer);
        flush();
      }
    };
    useSaveStatus.setState({ state: 'saved', at: Date.now() });
    const unsub = useEditor.subscribe((s, prev) => {
      if (s.doc && prev.doc && s.doc !== prev.doc) {
        useSaveStatus.setState({ state: 'saving', at: Date.now() });
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, 400);
      }
    });
    const onVisibility = () => document.visibilityState === 'hidden' && flushNow();
    window.addEventListener('beforeunload', flushNow);
    window.addEventListener('pagehide', flushNow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      unsub();
      window.removeEventListener('beforeunload', flushNow);
      window.removeEventListener('pagehide', flushNow);
      document.removeEventListener('visibilitychange', onVisibility);
      flushNow();
    };
  }, [id]);

  // same choreography open in several windows: keep them in sync
  useEffect(() => {
    if (status !== 'ready' || typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(`fs-choreo-${id}`);
    const unsub = onLocalChange((after) => channel.postMessage(after));
    channel.onmessage = (e) => useEditor.getState().applyRemote(e.data);
    return () => {
      unsub();
      channel.close();
    };
  }, [status, id]);

  // music
  useEffect(() => {
    if (status !== 'ready') return;
    const link = useEditor.getState().doc?.collab;
    loadMusic(musicHash, link ? (h) => downloadAudio(link, h) : undefined);
  }, [musicHash, status, collabKey]);

  // collaboration
  useEffect(() => {
    if (status !== 'ready' || !collabKey) return;
    const link = useEditor.getState().doc!.collab as CollabLink;
    const session = new CollabSession(id, link, (hash) => loadMusic(hash, (h) => downloadAudio(link, h)));
    session.start();
    return () => session.stop();
  }, [status, collabKey, id]);

  // guided tour: first visit, or on demand from the Help menu
  useEffect(() => {
    if (status !== 'ready') return;
    const show = () => setTour(true);
    window.addEventListener('fs-tour', show);
    const t = shouldShowTour() ? setTimeout(show, 500) : null;
    return () => {
      window.removeEventListener('fs-tour', show);
      if (t) clearTimeout(t);
    };
  }, [status]);

  useShortcuts();

  if (status === 'missing')
    return (
      <div className="center-screen">
        <div className="empty">
          <h2>Chorégraphie introuvable</h2>
          <p>Elle a peut-être été supprimée de cet appareil.</p>
          <button className="btn primary" onClick={() => navigate('/')}>
            Retour à la bibliothèque
          </button>
        </div>
      </div>
    );
  if (status === 'loading')
    return (
      <div className="center-screen">
        <div className="spinner" />
      </div>
    );

  const openTab = (t: InspectorTab) => useEditor.setState(sheetOpen && tab === t ? { sheetOpen: false } : { tab: t, sheetOpen: true });

  return (
    <div className={`editor ${sheetOpen ? 'sheet-open' : ''}`}>
      <TopBar />
      <div className="editor-main">
        <FormationList />
        <div className="stage-wrap">
          {view === '2d' ? (
            <Stage2D />
          ) : (
            <Suspense fallback={<div className="center-screen"><div className="spinner" /></div>}>
              <Stage3D />
            </Suspense>
          )}
          <CoachTip />
        </div>
        <Inspector />
      </div>
      <Timeline />
      <nav className="mobile-nav" aria-label="Réglages">
        {TABS.map((t) => (
          <button key={t.id} className={sheetOpen && tab === t.id ? 'on' : ''} onClick={() => openTab(t.id)}>
            <Icon name={t.icon} size={19} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      {sheetOpen && <div className="sheet-backdrop" onClick={() => useEditor.setState({ sheetOpen: false })} />}
      {tour && <Tour onClose={() => setTour(false)} />}
    </div>
  );
}

/** Contextual "what to do next" card for the first steps. */
function CoachTip() {
  const count = useEditor((s) => Object.keys(s.doc!.formations).length);
  const hasMusic = useEditor((s) => !!s.doc!.music.hash);
  const readOnly = useEditor((s) => s.readOnly);
  const playing = useEditor((s) => s.playing);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('fs-coach-off') === '1';
    } catch {
      return false;
    }
  });
  if (hidden || readOnly || playing || count > 2) return null;
  const tip = !hasMusic
    ? { title: 'Ajoutez la musique', body: 'Importez la chanson pour caler les formations sur les temps et voir les comptes « 5, 6, 7, 8 ».', label: 'Importer la musique', tab: 'music' as InspectorTab }
    : count === 1
      ? { title: 'Placez la première formation', body: 'Choisissez une forme toute prête, ou glissez les membres sur la scène.', label: 'Choisir une forme', tab: 'presets' as InspectorTab }
      : { title: 'Enchaînez les formations', body: 'Lancez la musique, mettez pause au bon moment puis « + Formation ». Le déplacement est animé tout seul.', label: null, tab: null };
  return (
    <div className="coach-tip">
      <Icon name="sparkles" size={18} />
      <div>
        <b>{tip.title}</b>
        <p>{tip.body}</p>
        {tip.label && tip.tab && (
          <button className="btn small primary" onClick={() => useEditor.setState({ tab: tip.tab!, sheetOpen: true })}>
            {tip.label}
          </button>
        )}
      </div>
      <button
        className="icon-btn tiny"
        aria-label="Masquer les astuces"
        title="Ne plus afficher les astuces"
        onClick={() => {
          try {
            localStorage.setItem('fs-coach-off', '1');
          } catch {
            /* ignore */
          }
          setHidden(true);
        }}
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

export function goToFormation(delta: number) {
  const s = useEditor.getState();
  if (!s.doc) return;
  const items = timeline(s.doc);
  const i = itemIndexAt(items, s.time);
  const cur = items[i];
  let target = i + delta;
  // "previous" while inside a formation goes back to its start first
  if (delta < 0 && cur && s.time > cur.start + 0.05) target = i;
  const it = items[Math.max(0, Math.min(items.length - 1, target))];
  if (it) playback.seek(it.start);
}

export function addFormationAtPlayhead() {
  const s = useEditor.getState();
  if (!s.doc || s.readOnly) return;
  playback.pause();
  const time = s.time;
  let newId = '';
  s.update('Nouvelle formation', (d) => {
    const { item } = currentItem(d, time);
    if (!item) return;
    const f = d.formations[item.f.id];
    const elapsed = time - item.start;
    const inHold = time <= item.holdEnd;
    newId = insertFormationAfter(d, f.id);
    const nf = d.formations[newId];
    if (inHold && elapsed > 0.1 && elapsed < f.duration - 0.1) {
      const remaining = f.duration - elapsed;
      f.duration = Math.round(elapsed * 100) / 100;
      nf.duration = Math.max(1, Math.round((remaining - f.transition) * 100) / 100);
    }
  });
  if (!newId) return;
  const it = timeline(useEditor.getState().doc!).find((x) => x.f.id === newId);
  if (it) playback.seek(it.start);
  s.notify('Formation ajoutée : placez les membres');
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const s = useEditor.getState();
      if (!s.doc) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        s.redo();
        return;
      }
      if (mod && key === 'a') {
        e.preventDefault();
        s.select(Object.keys(s.doc.dancers));
        return;
      }
      if (mod && key === 'd') {
        e.preventDefault();
        addFormationAtPlayhead();
        return;
      }
      if (mod) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          playback.toggle();
          return;
        case 'Escape':
          s.set({ selected: [], selectedProp: null, focusDancer: null, sheetOpen: false });
          return;
        case '[':
          goToFormation(-1);
          return;
        case ']':
          goToFormation(1);
          return;
        case 'Delete':
        case 'Backspace':
          if (s.selectedProp) {
            const pid = s.selectedProp;
            s.update('Supprimer l’accessoire', (d) => {
              delete d.props[pid];
              for (const f of Object.values(d.formations)) delete f.props[pid];
            });
          }
          return;
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          e.preventDefault();
          if (!s.selected.length) {
            if (e.key === 'ArrowLeft') goToFormation(-1);
            if (e.key === 'ArrowRight') goToFormation(1);
            return;
          }
          if (s.readOnly || s.playing) return;
          const { item } = currentItem(s.doc, s.time);
          if (!item || s.time > item.holdEnd) return;
          const step = e.shiftKey ? 0.5 : 0.1;
          const flip = s.audienceTop ? -1 : 1;
          const dx = (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0) * flip;
          const dy = (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0) * flip;
          s.update('Décaler', (d) => {
            const f = d.formations[item.f.id];
            for (const sid of s.selected) {
              const p = f.positions[sid];
              if (!p) continue;
              p.x = Math.round((p.x + dx) * 100) / 100;
              p.y = Math.round((p.y + dy) * 100) / 100;
            }
          });
          return;
        }
      }
      switch (key) {
        case 'v':
          s.set({ view: s.view === '2d' ? '3d' : '2d' });
          break;
        case 'm':
          s.set({ audienceTop: !s.audienceTop });
          break;
        case 'p':
          s.set({ showPaths: !s.showPaths });
          break;
        case 'g':
          s.set({ showGhost: !s.showGhost });
          break;
        case 'n':
          s.set({ showNames: !s.showNames });
          break;
        case 'f':
          addFormationAtPlayhead();
          break;
        case 'k':
          s.set({ metronome: !s.metronome });
          break;
        case 'l': {
          if (s.loop) s.set({ loop: null });
          else {
            const { item } = currentItem(s.doc, s.time);
            if (item) s.set({ loop: { a: item.start, b: Math.max(item.end, item.start + 0.5) } });
          }
          break;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
