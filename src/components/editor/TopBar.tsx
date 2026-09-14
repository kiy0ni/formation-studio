import { useEffect, useState } from 'react';
import { useCollab } from '../../collab/client';
import { db } from '../../lib/db';
import { exportJson, exportSvgAsPng } from '../../lib/exporters';
import { initials } from '../../lib/geometry';
import { formatTime, itemIndexAt, timeline } from '../../lib/model';
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
import { ShareDialog } from './ShareDialog';
import { stageSvg } from './Stage2D';
import { VideoExportDialog } from './VideoExportDialog';

function exportPng() {
  const s = useEditor.getState();
  if (s.view !== '2d') s.set({ view: '2d' });
  setTimeout(() => {
    const doc = useEditor.getState().doc!;
    const items = timeline(doc);
    const it = items[itemIndexAt(items, useEditor.getState().time)];
    if (stageSvg.current) exportSvgAsPng(stageSvg.current, `${doc.name} - ${it?.f.name ?? ''}`);
  }, 80);
}

export function TopBar() {
  const name = useEditor((s) => s.doc!.name);
  const readOnly = useEditor((s) => s.readOnly);
  const past = useEditor((s) => s.past);
  const future = useEditor((s) => s.future);
  const view = useEditor((s) => s.view);
  const set = useEditor((s) => s.set);
  const collisions = useCollisions();
  const [share, setShare] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [video, setVideo] = useState(false);
  const [guide, setGuide] = useState(false);
  const [draftName, setDraftName] = useState<string | null>(null);

  const undoBtns = (
    <>
      <IconButton icon="undo" title={past.length ? `Annuler : ${past[past.length - 1].label} (⌘Z)` : 'Rien à annuler'} disabled={!past.length || readOnly} onClick={() => useEditor.getState().undo()} />
      <IconButton icon="redo" title={future.length ? `Rétablir : ${future[future.length - 1].label} (⇧⌘Z)` : 'Rien à rétablir'} disabled={!future.length || readOnly} onClick={() => useEditor.getState().redo()} />
    </>
  );

  const exportItems = (close: () => void) => (
    <>
      <div className="menu-sep">Exporter</div>
      <MenuItem icon="video" onClick={() => (close(), setVideo(true))}>
        Vidéo avec la musique
        <small>MP4 pour écran, Instagram, Reels, TikTok</small>
      </MenuItem>
      <MenuItem icon="print" onClick={() => (close(), window.open(`#/print/${useEditor.getState().doc!.id}`, '_blank'))}>
        PDF / impression
        <small>Toutes les formations + une fiche par danseuse</small>
      </MenuItem>
      <MenuItem icon="image" onClick={() => (close(), exportPng())}>
        Image de la formation
        <small>PNG de la scène affichée</small>
      </MenuItem>
      <MenuItem icon="note" onClick={() => (close(), exportJson(useEditor.getState().doc!), notify('Fichier exporté'))}>
        Fichier chorégraphie (.json)
        <small>À ouvrir sur un autre appareil</small>
      </MenuItem>
    </>
  );

  const helpItems = (close: () => void) => (
    <>
      <div className="menu-sep">Aide</div>
      <MenuItem icon="sparkles" onClick={() => (close(), startTour())}>
        Visite guidée
        <small>Les bases en 6 étapes</small>
      </MenuItem>
      <MenuItem icon="help" onClick={() => (close(), setGuide(true))}>
        Guide complet
        <small>Toutes les fonctionnalités expliquées</small>
      </MenuItem>
      <MenuItem icon="settings" onClick={() => (close(), setShortcuts(true))}>
        Raccourcis clavier
      </MenuItem>
    </>
  );

  return (
    <header className="topbar">
      <div className="topbar-left">
        <IconButton icon="back" title="Retour à la bibliothèque" onClick={() => navigate('/')} />
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
          <ProjectSwitcher />
        </div>
        {readOnly ? (
          <span className="pill">
            <Icon name="lock" size={12} /> Lecture seule
          </span>
        ) : (
          <SaveIndicator />
        )}
      </div>

      <div className="topbar-center hide-sm">
        {undoBtns}
        <span className="divider" />
        <Segmented
          value={view}
          onChange={(v) => set({ view: v })}
          options={[
            { value: '2d', label: '2D', title: 'Vue de dessus (V)' },
            { value: '3d', label: '3D', title: 'Vue 3D (V)' },
          ]}
        />
        <Menu align="left" trigger={<button className="btn small ghost"><Icon name="eye" size={15} /> Affichage <Icon name="chevronDown" size={13} /></button>}>
          {() => <DisplayChecks />}
        </Menu>
        {collisions.length > 0 && (
          <Menu
            align="left"
            trigger={
              <button className="pill warn" title="Des danseurs sont trop proches">
                <Icon name="warning" size={13} /> {collisions.length} croisement{collisions.length > 1 ? 's' : ''}
              </button>
            }
          >
            {(close) => <CollisionList close={close} />}
          </Menu>
        )}
      </div>

      <div className="topbar-right">
        <span className="only-sm">{undoBtns}</span>
        <CollabIndicator onClick={() => setShare(true)} />
        <button className="btn small ghost hide-sm" onClick={() => setShare(true)}>
          <Icon name="share" size={14} /> Partager
        </button>
        <span className="hide-sm">
          <Menu trigger={<button className="btn small primary"><Icon name="download" size={14} /> Exporter</button>}>{exportItems}</Menu>
        </span>
        <span className="hide-sm">
          <Menu trigger={<IconButton icon="help" title="Aide : visite guidée, guide, raccourcis" size={18} />}>{helpItems}</Menu>
        </span>
        <span className="only-sm">
          <Menu trigger={<IconButton icon="dots" title="Plus d’options" size={18} />}>
            {(close) => (
              <div className="menu-panel">
                <div className="menu-sep">Vue</div>
                <div className="menu-row">
                  <Segmented
                    value={view}
                    onChange={(v) => set({ view: v })}
                    options={[
                      { value: '2d', label: 'Dessus (2D)' },
                      { value: '3d', label: '3D' },
                    ]}
                  />
                </div>
                <DisplayChecks />
                {collisions.length > 0 && <CollisionList close={close} />}
                <div className="menu-sep">Partager</div>
                <MenuItem icon="share" onClick={() => (close(), setShare(true))}>
                  Partager la chorégraphie
                </MenuItem>
                {exportItems(close)}
                {helpItems(close)}
              </div>
            )}
          </Menu>
        </span>
      </div>

      {share && <ShareDialog onClose={() => setShare(false)} />}
      {shortcuts && <ShortcutsDialog onClose={() => setShortcuts(false)} />}
      {video && <VideoExportDialog onClose={() => setVideo(false)} />}
      {guide && (
        <Modal title="Guide complet" onClose={() => setGuide(false)} width={860}>
          <GuideContent />
        </Modal>
      )}
    </header>
  );
}

function DisplayChecks() {
  const audienceTop = useEditor((s) => s.audienceTop);
  const showPaths = useEditor((s) => s.showPaths);
  const showGhost = useEditor((s) => s.showGhost);
  const showNames = useEditor((s) => s.showNames);
  const set = useEditor((s) => s.set);
  return (
    <>
      <div className="menu-sep">Affichage</div>
      <MenuCheck icon="mirror" label="Vue danseuses (miroir)" hint="Public en haut, comme face au miroir (M)" checked={audienceTop} onChange={(v) => set({ audienceTop: v })} />
      <MenuCheck icon="route" label="Trajets" hint="Flèches du déplacement de chaque membre (P)" checked={showPaths} onChange={(v) => set({ showPaths: v })} />
      <MenuCheck icon="ghost" label="Formation précédente" hint="Anciennes positions en pointillés (G)" checked={showGhost} onChange={(v) => set({ showGhost: v })} />
      <MenuCheck icon="tag" label="Noms des membres" hint="Afficher les noms sous les ronds (N)" checked={showNames} onChange={(v) => set({ showNames: v })} />
    </>
  );
}

function SaveIndicator() {
  const state = useSaveStatus((s) => s.state);
  const label = state === 'saving' ? 'Enregistrement…' : state === 'error' ? 'Non enregistré' : 'Enregistré';
  return (
    <span className={`save-ind ${state}`} title="Chaque modification est enregistrée automatiquement sur cet appareil" role="status">
      <Icon name={state === 'error' ? 'warning' : state === 'saving' ? 'clock' : 'check'} size={13} />
      <span className="hide-sm">{label}</span>
    </span>
  );
}

function ProjectSwitcher() {
  return (
    <Menu align="left" trigger={<IconButton icon="chevronDown" title="Changer de chorégraphie" size={15} className="switch-btn" />}>
      {(close) => <ProjectList close={close} />}
    </Menu>
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
      <div className="menu-sep">Mes chorégraphies</div>
      {!list && <p className="hint menu-row">Chargement…</p>}
      {list?.map((c) => (
        <div key={c.id} className={`project-row ${c.id === currentId ? 'on' : ''}`}>
          <button className="menu-item" onClick={() => (close(), c.id !== currentId && navigate(`/c/${c.id}`))}>
            <Icon name={c.id === currentId ? 'check' : 'stage'} size={15} />
            <span>
              <b className="ellipsis">{c.name}</b>
              <small>
                {Object.keys(c.dancers).length} membres · modifiée le {new Date(c.updatedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
              </small>
            </span>
          </button>
          {c.id !== currentId && (
            <IconButton icon="window" title="Ouvrir dans une nouvelle fenêtre" onClick={() => (close(), window.open(`#/c/${c.id}`, '_blank'))} />
          )}
        </div>
      ))}
      <div className="menu-sep" />
      <MenuItem icon="plus" onClick={() => (close(), navigate('/new'))}>
        Nouvelle chorégraphie
      </MenuItem>
      <MenuItem icon="grid" onClick={() => (close(), navigate('/'))}>
        Toute la bibliothèque
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
      <div className="menu-sep">Danseurs trop proches</div>
      <p className="hint menu-row">Touchez une ligne pour aller au moment du croisement.</p>
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
            {formatTime(c.time)} · {c.kind === 'transition' ? `en allant vers la formation après « ${items[c.index]?.f.name} »` : `dans « ${items[c.index]?.f.name} »`}
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
    ['Double-clic trajet', 'Ajouter un point de passage'],
    ['Alt + clic sur un point', 'Supprimer le point'],
    ['Molette / pincer', 'Zoom sur la scène · ⌘ + molette : zoom timeline'],
    ['V', 'Basculer 2D / 3D'],
    ['M', 'Vue public / vue danseuses'],
    ['P · G · N', 'Trajets · formation précédente · noms'],
    ['L', 'Boucler la formation courante'],
    ['K', 'Métronome'],
    ['Échap', 'Tout désélectionner / fermer le panneau'],
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
