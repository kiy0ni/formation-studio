import { lazy, Suspense, useEffect, useState } from 'react';
import { CollabSession, downloadAudio } from '../../collab/client';
import { db } from '../../lib/db';
import { insertFormationAfter, itemIndexAt, timeline } from '../../lib/model';
import { navigate } from '../../lib/router';
import type { Choreo, CollabLink } from '../../lib/types';
import { currentItem, useEditor } from '../../store/editor';
import { loadMusic } from '../../store/music';
import { playback } from '../../store/playback';
import { Icon } from '../common/Icon';
import { FormationList } from './FormationList';
import { Inspector } from './Inspector';
import { Stage2D } from './Stage2D';
import { Timeline } from './Timeline';
import { TopBar } from './TopBar';

const Stage3D = lazy(() => import('./Stage3D'));

export function EditorPage({ id }: { id: string }) {
  const [status, setStatus] = useState<'loading' | 'missing' | 'ready'>('loading');
  const view = useEditor((s) => s.view);
  const collabKey = useEditor((s) => (s.doc?.collab ? `${s.doc.collab.roomId}|${s.doc.collab.key}` : ''));
  const musicHash = useEditor((s) => s.doc?.music.hash);
  const [mobilePanel, setMobilePanel] = useState<'stage' | 'formations' | 'inspector'>('stage');

  // load
  useEffect(() => {
    let alive = true;
    db.getChoreo(id).then((doc) => {
      if (!alive) return;
      if (!doc) return setStatus('missing');
      useEditor.getState().load(doc, doc.collab?.role === 'view');
      setStatus('ready');
    });
    return () => {
      alive = false;
      playback.pause();
      const doc = useEditor.getState().doc;
      if (doc) db.saveChoreo(doc);
      useEditor.getState().unload();
    };
  }, [id]);

  // autosave (debounced)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      const doc = useEditor.getState().doc;
      if (doc && doc.id === id) db.saveChoreo(doc as Choreo);
    };
    const unsub = useEditor.subscribe((s, prev) => {
      if (s.doc && s.doc !== prev.doc && prev.doc) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, 400);
      }
    });
    const onUnload = () => timer && flush();
    window.addEventListener('beforeunload', onUnload);
    return () => {
      unsub();
      window.removeEventListener('beforeunload', onUnload);
      if (timer) {
        clearTimeout(timer);
        flush();
      }
    };
  }, [id]);

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

  return (
    <div className={`editor mobile-${mobilePanel}`}>
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
        </div>
        <Inspector />
      </div>
      <nav className="mobile-tabs">
        <button className={mobilePanel === 'formations' ? 'on' : ''} onClick={() => setMobilePanel('formations')}>
          <Icon name="grid" /> Formations
        </button>
        <button className={mobilePanel === 'stage' ? 'on' : ''} onClick={() => setMobilePanel('stage')}>
          <Icon name="stage" /> Scène
        </button>
        <button className={mobilePanel === 'inspector' ? 'on' : ''} onClick={() => setMobilePanel('inspector')}>
          <Icon name="settings" /> Réglages
        </button>
      </nav>
      <Timeline />
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
          s.set({ selected: [], selectedProp: null, focusDancer: null });
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
            for (const id of s.selected) {
              const p = f.positions[id];
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
