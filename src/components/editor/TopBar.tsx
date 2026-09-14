import { useEffect, useState } from 'react';
import { useCollab } from '../../collab/client';
import { db } from '../../lib/db';
import { exportJson } from '../../lib/exporters';
import { initials } from '../../lib/geometry';
import { formatTime, timeline } from '../../lib/model';
import { CAN_OPEN_WINDOWS, openRoute } from '../../lib/platform';
import { navigate } from '../../lib/router';
import type { Choreo } from '../../lib/types';
import { useCollisions } from '../../store/derived';
import { useEditor } from '../../store/editor';
import { playback } from '../../store/playback';
import { useSaveStatus } from '../../store/save';
import { GuideContent } from '../GuideContent';
import { Icon } from '../common/Icon';
import { notify } from '../common/Toast';
import { IconButton, Menu, MenuCheck, MenuItem, Modal, Segmented } from '../common/ui';
import { startTour } from './EditorPage';
import { exportPng } from './editorActions';
import { ShareDialog } from './ShareDialog';
import { VIDEO_REFERENCE_ENABLED } from '../../lib/config';
import { RefVideoToggle } from '../../video/RefVideoPlayer';
import { VideoExportDialog } from './VideoExportDialog';

export function TopBar() {
  const name = useEditor((s) => s.doc!.name);
  const docId = useEditor((s) => s.doc!.id);
  const readOnly = useEditor((s) => s.readOnly);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const lastLabel = useEditor((s) => s.past[s.past.length - 1]?.label);
  const view = useEditor((s) => s.view);
  const dialog = useEditor((s) => s.dialog);
  const set = useEditor((s) => s.set);
  const collisions = useCollisions();
  const [draftName, setDraftName] = useState<string | null>(null);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <IconButton icon="back" title="Bibliothèque" size={20} onClick={() => navigate('/')} />
        <div className="title-wrap">
          <input
            className="title-input"
            value={draftName ?? name}
            disabled={readOnly}
            aria-label="Nom de la chorégraphie"
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={() => {
              if (draftName !== null && draftName.trim() && draftName !== name) {
                const v = draftName.trim();
                useEditor.getState().update('Renommer', (d) => {
                  d.name = v;
                });
              }
              setDraftName(null);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />
          <Menu align="left" trigger={<IconButton icon="chevronDown" title="Changer de chorégraphie" size={15} className="switch-btn" />}>
            {(close) => <ProjectList close={close} />}
          </Menu>
        </div>
        {readOnly ? (
          <span className="pill">
            <Icon name="lock" size={12} /> Lecture
          </span>
        ) : (
          <SaveIndicator />
        )}
      </div>

      <div className="topbar-center desktop-only">
        <Segmented
          value={view}
          onChange={(v) => set({ view: v })}
          options={[
            { value: '2d', label: '2D', title: 'Vue de dessus (V)' },
            { value: '3d', label: '3D', title: 'Vue 3D (V)' },
          ]}
        />
        <Menu align="left" trigger={<button className="btn small ghost"><Icon name="eye" size={15} /> Affichage</button>}>
          {() => <DisplayChecks />}
        </Menu>
        {VIDEO_REFERENCE_ENABLED && <RefVideoToggle />}
      </div>

      <div className="topbar-right">
        {collisions.length > 0 && (
          <Menu
            trigger={
              <button className="pill warn" title="Danseurs trop proches">
                <Icon name="warning" size={13} /> {collisions.length}
              </button>
            }
          >
            {(close) => <CollisionList close={close} />}
          </Menu>
        )}
        <IconButton icon="undo" size={19} title={canUndo ? `Annuler : ${lastLabel} (⌘Z)` : 'Annuler'} disabled={!canUndo || readOnly} onClick={() => useEditor.getState().undo()} />
        <IconButton icon="redo" size={19} title="Rétablir (⇧⌘Z)" disabled={!canRedo || readOnly} onClick={() => useEditor.getState().redo()} />
        <CollabIndicator onClick={() => set({ dialog: 'share' })} />
        <span className="desktop-only topbar-group">
          <button className="btn small ghost" onClick={() => set({ dialog: 'share' })}>
            <Icon name="share" size={14} /> Partager
          </button>
          <Menu trigger={<button className="btn small primary"><Icon name="download" size={14} /> Exporter</button>}>
            {(close) => (
              <>
                <MenuItem icon="video" onClick={() => (close(), set({ dialog: 'video' }))}>Vidéo</MenuItem>
                <MenuItem icon="print" onClick={() => (close(), openRoute(`/print/${docId}`, true))}>PDF</MenuItem>
                <MenuItem icon="image" onClick={() => (close(), exportPng())}>Image</MenuItem>
                <MenuItem icon="note" onClick={() => (close(), exportJson(useEditor.getState().doc!), notify('Fichier exporté'))}>Fichier (.json)</MenuItem>
              </>
            )}
          </Menu>
          <Menu trigger={<IconButton icon="help" title="Aide" size={18} />}>
            {(close) => (
              <>
                <MenuItem icon="sparkles" onClick={() => (close(), startTour())}>Visite guidée</MenuItem>
                <MenuItem icon="help" onClick={() => (close(), set({ dialog: 'guide' }))}>Guide</MenuItem>
                <MenuItem icon="settings" onClick={() => (close(), set({ dialog: 'shortcuts' }))}>Raccourcis clavier</MenuItem>
              </>
            )}
          </Menu>
        </span>
      </div>

      {dialog === 'share' && <ShareDialog onClose={() => set({ dialog: null })} />}
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => set({ dialog: null })} />}
      {dialog === 'video' && <VideoExportDialog onClose={() => set({ dialog: null })} />}
      {dialog === 'guide' && (
        <Modal title="Guide" onClose={() => set({ dialog: null })} width={860}>
          <GuideContent />
        </Modal>
      )}
    </header>
  );
}

export function DisplayChecks() {
  const audienceTop = useEditor((s) => s.audienceTop);
  const showPaths = useEditor((s) => s.showPaths);
  const showGhost = useEditor((s) => s.showGhost);
  const showNames = useEditor((s) => s.showNames);
  const set = useEditor((s) => s.set);
  return (
    <>
      <MenuCheck icon="mirror" label="Vue miroir" hint="Public en haut (M)" checked={audienceTop} onChange={(v) => set({ audienceTop: v })} />
      <MenuCheck icon="route" label="Trajets" hint="P" checked={showPaths} onChange={(v) => set({ showPaths: v })} />
      <MenuCheck icon="ghost" label="Formation précédente" hint="G" checked={showGhost} onChange={(v) => set({ showGhost: v })} />
      <MenuCheck icon="tag" label="Noms" hint="N" checked={showNames} onChange={(v) => set({ showNames: v })} />
    </>
  );
}

function SaveIndicator() {
  const state = useSaveStatus((s) => s.state);
  const label = state === 'saving' ? 'Enregistrement…' : state === 'error' ? 'Non enregistré' : 'Enregistré';
  return (
    <span className={`save-ind ${state}`} title={label} role="status">
      <Icon name={state === 'error' ? 'warning' : state === 'saving' ? 'clock' : 'check'} size={14} />
    </span>
  );
}

function ProjectList({ close }: { close: () => void }) {
  const currentId = useEditor((s) => s.doc!.id);
  const [list, setList] = useState<Choreo[] | null>(null);
  useEffect(() => {
    db.listChoreos().then((l) => setList(l.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12)));
  }, []);
  return (
    <div className="menu-panel">
      {list?.map((c) => (
        <div key={c.id} className={`project-row ${c.id === currentId ? 'on' : ''}`}>
          <button className="menu-item" onClick={() => (close(), c.id !== currentId && navigate(`/c/${c.id}`))}>
            <Icon name={c.id === currentId ? 'check' : 'stage'} size={15} />
            <span>
              <b className="ellipsis">{c.name}</b>
            </span>
          </button>
          {c.id !== currentId && CAN_OPEN_WINDOWS && <IconButton icon="window" title="Nouvelle fenêtre" onClick={() => (close(), openRoute(`/c/${c.id}`, true))} />}
        </div>
      ))}
      <div className="menu-sep" />
      <MenuItem icon="plus" onClick={() => (close(), navigate('/new'))}>
        Nouvelle chorégraphie
      </MenuItem>
    </div>
  );
}

function CollisionList({ close }: { close: () => void }) {
  const doc = useEditor((s) => s.doc!);
  const collisions = useCollisions();
  const items = timeline(doc);
  return (
    <div className="collision-list">
      <div className="menu-sep">Trop proches</div>
      {collisions.slice(0, 40).map((c, i) => (
        <MenuItem
          key={i}
          icon="warning"
          onClick={() => {
            close();
            playback.pause();
            playback.seek(c.time);
            useEditor.getState().select([c.a, c.b]);
          }}
        >
          <b>
            {doc.dancers[c.a]?.name} × {doc.dancers[c.b]?.name}
          </b>
          <small>
            {formatTime(c.time)} · {items[c.index]?.f.name}
          </small>
        </MenuItem>
      ))}
    </div>
  );
}

function CollabIndicator({ onClick }: { onClick: () => void }) {
  const status = useCollab((s) => s.status);
  const peers = useCollab((s) => s.peers);
  if (status === 'off') return null;
  return (
    <button className={`collab-ind ${status}`} onClick={onClick} title={status === 'online' ? 'En ligne' : 'Hors ligne'}>
      <div className="avatars">
        {Object.values(peers)
          .slice(0, 3)
          .map((p) => (
            <span key={p.clientId} className="avatar" style={{ background: p.color }} title={p.name}>
              {initials(p.name)}
            </span>
          ))}
      </div>
      <Icon name={status === 'online' ? 'cloud' : 'cloudOff'} size={14} />
    </button>
  );
}

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['Espace', 'Lecture / pause'],
    ['⌘Z  ⇧⌘Z', 'Annuler / rétablir'],
    ['F', 'Nouvelle formation'],
    ['[  ]', 'Formation précédente / suivante'],
    ['Flèches', 'Décaler la sélection'],
    ['⌘A', 'Tout sélectionner'],
    ['Maj + clic', 'Sélection multiple'],
    ['Alt + glisser', 'Sans magnétisme'],
    ['V · M', '3D · miroir'],
    ['P · G · N', 'Trajets · précédente · noms'],
    ['L · K', 'Boucle · métronome'],
  ];
  return (
    <Modal title="Raccourcis" onClose={onClose} width={420}>
      <table className="shortcuts">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td>
                <kbd>{k}</kbd>
              </td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
