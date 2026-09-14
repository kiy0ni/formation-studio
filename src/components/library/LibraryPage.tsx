import { produce } from 'immer';
import { useEffect, useMemo, useRef, useState } from 'react';
import { exportBackup, importBackup, isBackup } from '../../lib/backup';
import { isMediaFile, MEDIA_ACCEPT } from '../../lib/media';
import { FOLDER_COLORS } from '../../lib/colors';
import { COLLAB_ENABLED } from '../../lib/config';
import { db } from '../../lib/db';
import { exportJson, importJson } from '../../lib/exporters';
import { uid } from '../../lib/id';
import { formatTime, sortedFormations, totalDuration } from '../../lib/model';
import { navigate } from '../../lib/router';
import type { Choreo, Folder } from '../../lib/types';
import { useLibrary } from '../../store/library';
import { GuideContent } from '../GuideContent';
import { FormationThumb } from '../common/FormationThumb';
import { Icon } from '../common/Icon';
import { notify } from '../common/Toast';
import { Menu, MenuItem, Modal } from '../common/ui';
import { DiscoverView } from './DiscoverView';
import { InstallButton } from './InstallButton';
import { NewChoreoDialog } from './NewChoreoDialog';
import { ProfileButton } from './ProfileButton';
import { TeamsView } from './TeamsView';

type Tab = 'choreos' | 'teams' | 'discover' | 'guide';

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const isAudio = isMediaFile;

export function LibraryPage({ tab, create }: { tab: Tab; create?: boolean }) {
  const { choreos, teams, folders, loaded, refresh } = useLibrary();
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState<string | 'all' | 'none' | 'shared'>('all');
  const [creating, setCreating] = useState<{ teamId?: string; file?: File } | null>(null);
  const [renaming, setRenaming] = useState<Choreo | null>(null);
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  useEffect(() => {
    refresh();
    // choreographies edited in another window show up when coming back
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [refresh]);

  useEffect(() => {
    if (!create) return;
    setCreating({});
    history.replaceState(null, '', '#/');
  }, [create]);

  const q = norm(query.trim());
  const filtered = useMemo(() => {
    return choreos.filter((c) => {
      if (folder === 'none' && c.folderId) return false;
      if (folder === 'shared' && !c.collab) return false;
      if (folder !== 'all' && folder !== 'none' && folder !== 'shared' && c.folderId !== folder) return false;
      if (!q) return true;
      const hay = [c.name, ...Object.values(c.dancers).map((d) => `${d.name} ${d.group ?? ''}`), ...Object.values(c.formations).map((f) => `${f.name} ${f.note}`), c.music.name ?? ''];
      return hay.some((h) => norm(h).includes(q));
    });
  }, [choreos, folder, q]);

  const matchingTeams = q ? teams.filter((t) => norm(t.name).includes(q) || t.members.some((m) => norm(m.name).includes(q))) : [];
  const matchingFolders = q ? folders.filter((f) => norm(f.name).includes(q)) : [];

  const save = async (doc: Choreo) => {
    await db.saveChoreo(doc);
    await refresh();
  };

  const duplicate = async (c: Choreo) => {
    const copy = produce(c, (d) => {
      d.id = uid();
      d.name = `${c.name} (copie)`;
      d.createdAt = d.updatedAt = Date.now();
      d.collab = null;
    });
    await save(copy);
    notify('Chorégraphie dupliquée');
  };

  const remove = async (c: Choreo) => {
    if (!confirm(`Supprimer « ${c.name} » ? Cette action est définitive sur cet appareil.`)) return;
    await db.deleteChoreo(c.id);
    await refresh();
    notify('Chorégraphie supprimée');
  };

  const onImport = async (file: File) => {
    try {
      const text = await file.text();
      if (isBackup(text)) {
        const r = await importBackup(text);
        await refresh();
        notify(`Sauvegarde restaurée : ${r.choreos} chorégraphie(s), ${r.teams} équipe(s) ajoutées ou mises à jour`);
        return;
      }
      const doc = await importJson(file);
      await save(doc);
      notify(`« ${doc.name} » importée`);
    } catch (e) {
      alert((e as Error).message || 'Fichier non reconnu');
    }
  };

  const onFiles = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (isAudio(f)) setCreating({ file: f });
    else if (f.name.endsWith('.json') || f.type === 'application/json') onImport(f);
    else alert('Glissez une musique ou une vidéo pour créer une chorégraphie, ou un fichier .json pour l’importer.');
  };

  const folderCount = (id: string) => choreos.filter((c) => c.folderId === id).length;

  return (
    <div
      className="library"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        onFiles(e.dataTransfer.files);
      }}
    >
      <header className="lib-header">
        <div className="brand" onClick={() => navigate('/')}>
          <img src="icon.svg" alt="" width={32} height={32} />
          <div>
            <strong>Formation Studio</strong>
            <span>Chorégraphies K-pop</span>
          </div>
        </div>
        <div className="search">
          <Icon name="search" />
          <input placeholder="Rechercher une chorégraphie, un membre, une équipe…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && (
            <button className="icon-btn" onClick={() => setQuery('')} aria-label="Effacer">
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
        <div className="lib-actions">
          <InstallButton />
          {COLLAB_ENABLED && <ProfileButton />}
          <Menu
            trigger={
              <button className="btn ghost" title="Importer, sauvegarder, transférer">
                <Icon name="folder" /> <span className="hide-sm">Données</span>
              </button>
            }
          >
            {(close) => (
              <>
                <div className="menu-sep">Vos données restent sur cet appareil</div>
                <MenuItem icon="download" onClick={async () => (close(), notify(`Sauvegarde créée : ${(await exportBackup()).choreos} chorégraphie(s), musiques comprises`))}>
                  Sauvegarder toute la bibliothèque
                  <small>Une copie de sécurité, ou pour changer d’appareil</small>
                </MenuItem>
                <MenuItem icon="upload" onClick={() => (close(), fileRef.current?.click())}>
                  Importer
                  <small>Une sauvegarde ou une chorégraphie (.json)</small>
                </MenuItem>
              </>
            )}
          </Menu>
          <button className="btn primary" onClick={() => setCreating({})}>
            <Icon name="plus" /> Nouvelle
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) onImport(f);
            }}
          />
        </div>
      </header>

      <nav className="lib-tabs">
        <button className={tab === 'choreos' ? 'on' : ''} onClick={() => navigate('/')}>
          <Icon name="stage" /> Chorégraphies <em>{choreos.length}</em>
        </button>
        <button className={tab === 'teams' ? 'on' : ''} onClick={() => navigate('/teams')}>
          <Icon name="users" /> Équipes <em>{teams.length}</em>
        </button>
        <button className={tab === 'discover' ? 'on' : ''} onClick={() => navigate('/discover')}>
          <Icon name="sparkles" /> Modèles
        </button>
        <button className={tab === 'guide' ? 'on' : ''} onClick={() => navigate('/guide')}>
          <Icon name="help" /> Guide
        </button>
      </nav>

      {tab === 'teams' && <TeamsView query={q} onCreateChoreo={(teamId) => setCreating({ teamId })} />}
      {tab === 'discover' && <DiscoverView query={q} />}
      {tab === 'guide' && (
        <div className="lib-main padded narrow">
          <GuideContent />
        </div>
      )}

      {tab === 'choreos' && loaded && !choreos.length && (
        <div className="lib-main padded">
          <Welcome onCreate={() => setCreating({})} onImportMusic={(f) => setCreating({ file: f })} />
        </div>
      )}

      {tab === 'choreos' && choreos.length > 0 && (
        <div className="lib-body">
          <aside className="folders">
            <FolderRow icon="grid" label="Toutes" count={choreos.length} on={folder === 'all'} onClick={() => setFolder('all')} />
            <FolderRow icon="note" label="Sans dossier" count={choreos.filter((c) => !c.folderId).length} on={folder === 'none'} onClick={() => setFolder('none')} />
            {choreos.some((c) => c.collab) && <FolderRow icon="cloud" label="Partagées" count={choreos.filter((c) => c.collab).length} on={folder === 'shared'} onClick={() => setFolder('shared')} />}
            <div className="folders-head">
              <span>Dossiers</span>
              <button className="icon-btn" title="Nouveau dossier" onClick={() => setEditingFolder({ id: '', name: '', color: FOLDER_COLORS[folders.length % FOLDER_COLORS.length] })}>
                <Icon name="plus" size={14} />
              </button>
            </div>
            {folders.map((f) => (
              <FolderRow key={f.id} icon="folder" color={f.color} label={f.name} count={folderCount(f.id)} on={folder === f.id} onClick={() => setFolder(f.id)} onEdit={() => setEditingFolder(f)} />
            ))}
            {!folders.length && <p className="hint">Rangez vos chorégraphies par comeback, cover ou compétition avec le bouton +.</p>}
          </aside>

          <main className="lib-main">
            {q && (matchingTeams.length > 0 || matchingFolders.length > 0) && (
              <div className="search-extra">
                {matchingFolders.map((f) => (
                  <button key={f.id} className="chip" onClick={() => setFolder(f.id)}>
                    <Icon name="folder" size={13} /> {f.name}
                  </button>
                ))}
                {matchingTeams.map((t) => (
                  <button key={t.id} className="chip" onClick={() => navigate('/teams')}>
                    <Icon name="users" size={13} /> {t.name}
                  </button>
                ))}
              </div>
            )}

            {!filtered.length && <p className="hint center">Aucun résultat.</p>}

            <div className="cards">
              {!q && (
                <button className="card new-card" onClick={() => setCreating({})}>
                  <span className="new-card-icon">
                    <Icon name="plus" size={22} />
                  </span>
                  <b>Nouvelle chorégraphie</b>
                  <span className="hint">Importez la musique pour commencer, ou glissez un MP3 n’importe où sur la page.</span>
                </button>
              )}
              {filtered.map((c) => {
                const first = sortedFormations(c)[0];
                const f = folders.find((x) => x.id === c.folderId);
                return (
                  <article key={c.id} className="card" onClick={() => navigate(`/c/${c.id}`)}>
                    <div className="card-thumb">
                      <FormationThumb doc={c} formation={first} />
                      {c.collab && (
                        <span className="badge" title={c.collab.role === 'view' ? 'Partagée (lecture seule)' : 'Collaboration en temps réel'}>
                          <Icon name={c.collab.role === 'view' ? 'lock' : 'cloud'} size={12} />
                        </span>
                      )}
                    </div>
                    <div className="card-body">
                      <div className="card-title">
                        <h3>{c.name}</h3>
                        <div onClick={(e) => e.stopPropagation()}>
                          <Menu trigger={<button className="icon-btn" aria-label="Actions"><Icon name="dots" /></button>}>
                            {(close) => (
                              <>
                                <MenuItem icon="text" onClick={() => (close(), setRenaming(c))}>Renommer</MenuItem>
                                <MenuItem icon="copy" onClick={() => (close(), duplicate(c))}>
                                  Dupliquer
                                  <small>Pour tester une variante</small>
                                </MenuItem>
                                <MenuItem icon="window" onClick={() => (close(), window.open(`#/c/${c.id}`, '_blank'))}>Ouvrir dans une nouvelle fenêtre</MenuItem>
                                <MenuItem icon="download" onClick={() => (close(), exportJson(c))}>Exporter (.json)</MenuItem>
                                <MenuItem icon="print" onClick={() => (close(), window.open(`#/print/${c.id}`, '_blank'))}>Imprimer / PDF</MenuItem>
                                <div className="menu-sep">Ranger dans</div>
                                <MenuItem icon="note" onClick={() => (close(), save({ ...c, folderId: null }))}>Sans dossier</MenuItem>
                                {folders.map((fo) => (
                                  <MenuItem key={fo.id} icon="folder" onClick={() => (close(), save({ ...c, folderId: fo.id }))}>
                                    {fo.name}
                                  </MenuItem>
                                ))}
                                <div className="menu-sep" />
                                <MenuItem icon="trash" danger onClick={() => (close(), remove(c))}>Supprimer</MenuItem>
                              </>
                            )}
                          </Menu>
                        </div>
                      </div>
                      <p className="card-meta">
                        {Object.keys(c.dancers).length} membres · {Object.keys(c.formations).length} formation{Object.keys(c.formations).length > 1 ? 's' : ''} · {formatTime(totalDuration(c), false)}
                      </p>
                      <p className="card-meta dim">
                        {f && (
                          <span className="folder-tag" style={{ color: f.color }}>
                            <Icon name="folder" size={11} /> {f.name}
                          </span>
                        )}
                        {c.music.name && (
                          <span>
                            <Icon name="music" size={11} /> {c.music.name}
                          </span>
                        )}
                        <span>Modifiée le {new Date(c.updatedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          </main>
        </div>
      )}

      {dragging && (
        <div className="drop-overlay">
          <div>
            <Icon name="music" size={40} />
            <b>Déposez la musique (ou une vidéo) pour créer une chorégraphie</b>
            <span>ou un fichier .json pour l’importer</span>
          </div>
        </div>
      )}

      {creating && (
        <NewChoreoDialog
          teams={teams}
          folders={folders}
          initialTeamId={creating.teamId}
          initialFile={creating.file}
          initialFolderId={folder !== 'all' && folder !== 'none' && folder !== 'shared' ? folder : null}
          onClose={() => setCreating(null)}
          onCreate={async (doc) => {
            await db.saveChoreo(doc);
            navigate(`/c/${doc.id}`);
          }}
        />
      )}

      {renaming && (
        <RenameDialog
          title="Renommer la chorégraphie"
          value={renaming.name}
          onClose={() => setRenaming(null)}
          onSave={async (name) => {
            await save({ ...renaming, name, updatedAt: Date.now() });
            setRenaming(null);
          }}
        />
      )}

      {editingFolder && (
        <FolderDialog
          folder={editingFolder}
          onClose={() => setEditingFolder(null)}
          onSave={async (f) => {
            await db.saveFolder(f.id ? f : { ...f, id: uid() });
            await refresh();
            setEditingFolder(null);
          }}
          onDelete={
            editingFolder.id
              ? async () => {
                  if (!confirm(`Supprimer le dossier « ${editingFolder.name} » ? Les chorégraphies seront conservées.`)) return;
                  await Promise.all(choreos.filter((c) => c.folderId === editingFolder.id).map((c) => db.saveChoreo({ ...c, folderId: null })));
                  await db.deleteFolder(editingFolder.id);
                  if (folder === editingFolder.id) setFolder('all');
                  await refresh();
                  setEditingFolder(null);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

function Welcome({ onCreate, onImportMusic }: { onCreate: () => void; onImportMusic: (f: File) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const steps: { icon: 'music' | 'wand' | 'video'; title: string; body: string }[] = [
    { icon: 'music', title: '1. La musique', body: 'Importez la chanson : le tempo est détecté pour compter les « 5, 6, 7, 8 ».' },
    { icon: 'wand', title: '2. Les formations', body: 'Choisissez une forme en un clic, ajustez en glissant les membres, ajoutez la suivante au bon moment.' },
    { icon: 'video', title: '3. Partagez', body: 'Relisez l’animation, puis exportez une vidéo avec la musique ou un PDF pour chaque danseuse.' },
  ];
  return (
    <div className="welcome">
      <div className="empty-art">
        <span style={{ background: '#ff4d8d' }} />
        <span style={{ background: '#7c5cff' }} />
        <span style={{ background: '#2ec5ff' }} />
        <span style={{ background: '#34d399' }} />
        <span style={{ background: '#ffb020' }} />
      </div>
      <h1>Créez vos formations K-pop</h1>
      <p className="welcome-lead">Placez le groupe sur scène, synchronisez avec la musique et partagez le résultat. Tout est enregistré automatiquement sur cet appareil.</p>
      <div className="step-cards">
        {steps.map((s) => (
          <div key={s.title} className="step-card">
            <span className="collapsible-icon">
              <Icon name={s.icon} size={18} />
            </span>
            <b>{s.title}</b>
            <p>{s.body}</p>
          </div>
        ))}
      </div>
      <div className="row gap wrap center-row">
        <button className="btn primary big" onClick={() => fileRef.current?.click()}>
          <Icon name="music" /> Commencer avec une musique
        </button>
        <button className="btn big" onClick={onCreate}>
          <Icon name="plus" /> Sans musique
        </button>
        <button className="btn ghost big" onClick={() => navigate('/discover')}>
          <Icon name="sparkles" /> Partir d’un modèle
        </button>
      </div>
      <p className="hint">
        Astuce : glissez un MP3 sur cette page · <button className="link-btn" onClick={() => navigate('/guide')}>Lire le guide</button>
      </p>
      <input
        ref={fileRef}
        type="file"
        accept={MEDIA_ACCEPT}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onImportMusic(f);
        }}
      />
    </div>
  );
}

function FolderRow({
  icon,
  label,
  count,
  on,
  onClick,
  onEdit,
  color,
}: {
  icon: 'grid' | 'note' | 'cloud' | 'folder';
  label: string;
  count: number;
  on: boolean;
  onClick: () => void;
  onEdit?: () => void;
  color?: string;
}) {
  return (
    <div className={`folder-row ${on ? 'on' : ''}`} onClick={onClick}>
      <span style={{ color }}>
        <Icon name={icon} size={15} />
      </span>
      <span className="grow ellipsis">{label}</span>
      {onEdit && (
        <button
          className="icon-btn tiny"
          title="Modifier le dossier"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
          <Icon name="settings" size={12} />
        </button>
      )}
      <em>{count}</em>
    </div>
  );
}

function RenameDialog({ title, value, onClose, onSave }: { title: string; value: string; onClose: () => void; onSave: (v: string) => void }) {
  const [name, setName] = useState(value);
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Annuler</button>
          <button className="btn primary" disabled={!name.trim()} onClick={() => onSave(name.trim())}>Enregistrer</button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">Nom</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSave(name.trim())} />
      </label>
    </Modal>
  );
}

function FolderDialog({ folder, onClose, onSave, onDelete }: { folder: Folder; onClose: () => void; onSave: (f: Folder) => void; onDelete?: () => void }) {
  const [f, setF] = useState(folder);
  return (
    <Modal
      title={folder.id ? 'Modifier le dossier' : 'Nouveau dossier'}
      onClose={onClose}
      footer={
        <>
          {onDelete && (
            <button className="btn danger ghost" onClick={onDelete}>
              <Icon name="trash" /> Supprimer
            </button>
          )}
          <span className="grow" />
          <button className="btn ghost" onClick={onClose}>Annuler</button>
          <button className="btn primary" disabled={!f.name.trim()} onClick={() => onSave({ ...f, name: f.name.trim() })}>Enregistrer</button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">Nom</span>
        <input
          autoFocus
          value={f.name}
          placeholder="ex : Comeback été, Cover contest…"
          onChange={(e) => setF({ ...f, name: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && f.name.trim() && onSave({ ...f, name: f.name.trim() })}
        />
      </label>
      <div className="field">
        <span className="field-label">Couleur</span>
        <div className="swatches">
          {FOLDER_COLORS.map((c) => (
            <button key={c} className={`swatch ${f.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setF({ ...f, color: c })} />
          ))}
        </div>
      </div>
    </Modal>
  );
}
