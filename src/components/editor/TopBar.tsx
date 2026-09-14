import { useState } from 'react';
import { useCollab } from '../../collab/client';
import { exportJson, exportSvgAsPng } from '../../lib/exporters';
import { initials } from '../../lib/geometry';
import { formatTime, itemIndexAt, timeline } from '../../lib/model';
import { navigate } from '../../lib/router';
import { useCollisions } from '../../store/derived';
import { useEditor } from '../../store/editor';
import { playback } from '../../store/playback';
import { Icon } from '../common/Icon';
import { notify } from '../common/Toast';
import { IconButton, Menu, MenuItem, Modal, Segmented } from '../common/ui';
import { ShareDialog } from './ShareDialog';
import { stageSvg } from './Stage2D';
import { VideoExportDialog } from './VideoExportDialog';

export function TopBar() {
  const name = useEditor((s) => s.doc!.name);
  const readOnly = useEditor((s) => s.readOnly);
  const past = useEditor((s) => s.past);
  const future = useEditor((s) => s.future);
  const view = useEditor((s) => s.view);
  const audienceTop = useEditor((s) => s.audienceTop);
  const showPaths = useEditor((s) => s.showPaths);
  const showGhost = useEditor((s) => s.showGhost);
  const showNames = useEditor((s) => s.showNames);
  const set = useEditor((s) => s.set);
  const collisions = useCollisions();
  const [share, setShare] = useState(false);
  const [help, setHelp] = useState(false);
  const [video, setVideo] = useState(false);
  const [draftName, setDraftName] = useState<string | null>(null);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <IconButton icon="back" title="Bibliothèque" onClick={() => navigate('/')} />
        <input
          className="title-input"
          value={draftName ?? name}
          disabled={readOnly}
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
        {readOnly && (
          <span className="pill">
            <Icon name="lock" size={12} /> Lecture seule
          </span>
        )}
      </div>

      <div className="topbar-center">
        <IconButton icon="undo" title={past.length ? `Annuler : ${past[past.length - 1].label} (⌘Z)` : 'Annuler'} disabled={!past.length || readOnly} onClick={() => useEditor.getState().undo()} />
        <IconButton icon="redo" title={future.length ? `Rétablir : ${future[future.length - 1].label} (⇧⌘Z)` : 'Rétablir'} disabled={!future.length || readOnly} onClick={() => useEditor.getState().redo()} />
        <span className="divider" />
        <Segmented
          value={view}
          onChange={(v) => set({ view: v })}
          options={[
            { value: '2d', label: '2D', title: 'Vue de dessus (V)' },
            { value: '3d', label: '3D', title: 'Vue 3D (V)' },
          ]}
        />
        <IconButton icon="mirror" title={audienceTop ? 'Vue danseurs (public en haut) — M' : 'Vue public (public en bas) — M'} active={audienceTop} onClick={() => set({ audienceTop: !audienceTop })} />
        <IconButton icon="route" title="Trajectoires (P)" active={showPaths} onClick={() => set({ showPaths: !showPaths })} />
        <IconButton icon="ghost" title="Formation précédente en transparence (G)" active={showGhost} onClick={() => set({ showGhost: !showGhost })} />
        <IconButton icon="tag" title="Noms (N)" active={showNames} onClick={() => set({ showNames: !showNames })} />
        {collisions.length > 0 && (
          <Menu
            align="left"
            trigger={
              <button className="pill warn" title="Croisements détectés">
                <Icon name="warning" size={13} /> {collisions.length}
              </button>
            }
          >
            {(close) => <CollisionList close={close} />}
          </Menu>
        )}
      </div>

      <div className="topbar-right">
        <CollabIndicator onClick={() => setShare(true)} />
        <button className="btn small primary" onClick={() => setShare(true)}>
          <Icon name="share" size={14} /> <span className="hide-sm">Partager</span>
        </button>
        <Menu trigger={<IconButton icon="download" title="Exporter" />}>
          {(close) => (
            <>
              <MenuItem icon="video" onClick={() => (close(), setVideo(true))}>
                Vidéo (MP4) avec la musique
              </MenuItem>
              <MenuItem
                icon="image"
                onClick={() => {
                  close();
                  const s = useEditor.getState();
                  if (s.view !== '2d') set({ view: '2d' });
                  setTimeout(() => {
                    const doc = useEditor.getState().doc!;
                    const items = timeline(doc);
                    const it = items[itemIndexAt(items, useEditor.getState().time)];
                    if (stageSvg.current) exportSvgAsPng(stageSvg.current, `${doc.name} - ${it?.f.name ?? ''}`);
                  }, 60);
                }}
              >
                Image PNG de la formation
              </MenuItem>
              <MenuItem icon="print" onClick={() => (close(), window.open(`#/print/${useEditor.getState().doc!.id}`, '_blank'))}>
                Imprimer / PDF (fiches danseurs)
              </MenuItem>
              <MenuItem icon="note" onClick={() => (close(), exportJson(useEditor.getState().doc!), notify('Fichier exporté'))}>
                Fichier chorégraphie (.json)
              </MenuItem>
            </>
          )}
        </Menu>
        <IconButton icon="settings" title="Raccourcis clavier" onClick={() => setHelp(true)} />
      </div>

      {share && <ShareDialog onClose={() => setShare(false)} />}
      {help && <ShortcutsDialog onClose={() => setHelp(false)} />}
      {video && <VideoExportDialog onClose={() => setVideo(false)} />}
    </header>
  );
}

function CollisionList({ close }: { close: () => void }) {
  const doc = useEditor((s) => s.doc!);
  const collisions = useCollisions();
  const items = timeline(doc);
  return (
    <div className="collision-list">
      <div className="menu-sep">Danseurs trop proches</div>
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
          <b>{doc.dancers[c.a]?.name}</b> × <b>{doc.dancers[c.b]?.name}</b>
          <small>
            {formatTime(c.time)} · {c.kind === 'transition' ? `transition après « ${items[c.index]?.f.name} »` : `« ${items[c.index]?.f.name} »`}
          </small>
        </MenuItem>
      ))}
    </div>
  );
}

function CollabIndicator({ onClick }: { onClick: () => void }) {
  const status = useCollab((s) => s.status);
  const pending = useCollab((s) => s.pending);
  const peers = useCollab((s) => s.peers);
  if (status === 'off') return null;
  const label =
    status === 'online'
      ? pending
        ? 'Synchronisation…'
        : 'En ligne'
      : status === 'connecting'
        ? 'Connexion…'
        : status === 'error'
          ? 'Erreur'
          : `Hors ligne${pending ? ` · ${pending} en attente` : ''}`;
  return (
    <button className={`collab-ind ${status}`} onClick={onClick} title={label}>
      <div className="avatars">
        {Object.values(peers)
          .slice(0, 4)
          .map((p) => (
            <span key={p.clientId} className="avatar" style={{ background: p.color }} title={p.name}>
              {initials(p.name)}
            </span>
          ))}
      </div>
      <Icon name={status === 'online' ? 'cloud' : 'cloudOff'} size={14} />
      <span className="hide-sm">{label}</span>
    </button>
  );
}

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['Espace', 'Lecture / pause'],
    ['⌘Z / ⇧⌘Z', 'Annuler / rétablir'],
    ['F ou ⌘D', 'Nouvelle formation au curseur'],
    ['[ ]  ou  ← →', 'Formation précédente / suivante'],
    ['Flèches (sélection)', 'Décaler de 10 cm (Maj : 50 cm)'],
    ['⌘A', 'Sélectionner tout le monde'],
    ['Maj + clic / cadre', 'Sélection multiple'],
    ['Alt + glisser', 'Déplacer sans magnétisme'],
    ['Double-clic trajectoire', 'Ajouter un point de passage'],
    ['Alt + clic sur un point', 'Supprimer le point'],
    ['Molette', 'Zoom scène · ⌘ + molette : zoom timeline'],
    ['V', 'Basculer 2D / 3D'],
    ['M', 'Vue public / vue danseurs'],
    ['P · G · N', 'Trajectoires · fantôme · noms'],
    ['L', 'Boucler la formation courante'],
    ['K', 'Métronome'],
    ['Échap', 'Tout désélectionner'],
  ];
  return (
    <Modal title="Raccourcis clavier" onClose={onClose}>
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
