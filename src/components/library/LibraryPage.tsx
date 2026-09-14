import { useEffect, useMemo, useRef, useState } from 'react';
import { produce } from 'immer';
import { exportBackup, importBackup, isBackup } from '../../lib/backup';
import { FOLDER_COLORS } from '../../lib/colors';
import { COLLAB_ENABLED } from '../../lib/config';
import { db } from '../../lib/db';
import { exportJson, importJson } from '../../lib/exporters';
import { uid } from '../../lib/id';
import { formatTime, sortedFormations, totalDuration } from '../../lib/model';
import { navigate } from '../../lib/router';
import type { Choreo, Folder } from '../../lib/types';
import { useLibrary } from '../../store/library';
import { FormationThumb } from '../common/FormationThumb';
import { Icon } from '../common/Icon';
import { notify } from '../common/Toast';
import { Menu, MenuItem, Modal, TextField } from '../common/ui';
import { DiscoverView } from './DiscoverView';
import { InstallButton } from './InstallButton';
import { NewChoreoDialog } from './NewChoreoDialog';
import { ProfileButton } from './ProfileButton';
import { TeamsView } from './TeamsView';

type Tab = 'choreos' | 'teams' | 'discover';

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export function LibraryPage({ tab }: { tab: Tab }) {
  const { choreos, teams, folders, loaded, refresh } = useLibrary();
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState<string | 'all' | 'none' | 'shared'>('all');
  const [creating, setCreating] = useState<{ teamId?: string } | null>(null);
  const [renaming, setRenaming] = useState<Choreo | null>(null);
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
      alert((e as Error).message);
    }
  };

  const folderCount = (id: string) => choreos.filter((c) => c.folderId === id).length;

  return (
    <div className="library">
      <header className="lib-header">
        <div className="brand" onClick={() => navigate('/')}>
          <img src="icon.svg" alt="" width={30} height={30} />
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
                <MenuItem icon="upload" onClick={() => (close(), fileRef.current?.click())}>
                  Importer une chorégraphie ou une sauvegarde
                </MenuItem>
                <MenuItem
                  icon="download"
                  onClick={async () => {
                    close();
                    const r = await exportBackup();
                    notify(`Sauvegarde créée : ${r.choreos} chorégraphie(s), musiques comprises`);
                  }}
                >
                  Sauvegarder toute la bibliothèque
                  <small>Pour garder une copie ou transférer vers un autre appareil</small>
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
          <Icon name="sparkles" /> Découvrir
        </button>
      </nav>

      {tab === 'teams' && <TeamsView query={q} onCreateChoreo={(teamId) => setCreating({ teamId })} />}
      {tab === 'discover' && <DiscoverView query={q} />}

      {tab === 'choreos' && (
        <div className="lib-body">
          <aside className="folders">
            <FolderRow icon="grid" label="Toutes" count={choreos.length} on={folder === 'all'} onClick={() => setFolder('all')} />
            <FolderRow icon="note" label="Sans dossier" count={choreos.filter((c) => !c.folderId).length} on={folder === 'none'} onClick={() => setFolder('none')} />
            <FolderRow icon="cloud" label="Partagées" count={choreos.filter((c) => c.collab).length} on={folder === 'shared'} onClick={() => setFolder('shared')} />
            <div className="folders-head">
              <span>Dossiers</span>
              <button className="icon-btn" title="Nouveau dossier" onClick={() => setEditingFolder({ id: '', name: '', color: FOLDER_COLORS[folders.length % FOLDER_COLORS.length] })}>
                <Icon name="plus" size={14} />
              </button>
            </div>
            {folders.map((f) => (
              <FolderRow
                key={f.id}
                icon="folder"
                color={f.color}
                label={f.name}
                count={folderCount(f.id)}
                on={folder === f.id}
                onClick={() => setFolder(f.id)}
                onEdit={() => setEditingFolder(f)}
              />
            ))}
            {!folders.length && <p className="hint">Rangez vos chorégraphies par comeback, cover ou compétition.</p>}
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

            {loaded && !choreos.length && (
              <div className="empty">
                <div className="empty-art">
                  <span style={{ background: '#ff4d8d' }} />
                  <span style={{ background: '#7c5cff' }} />
                  <span style={{ background: '#2ec5ff' }} />
                  <span style={{ background: '#34d399' }} />
                  <span style={{ background: '#ffb020' }} />
                </div>
                <h2>Votre première chorégraphie</h2>
                <p>Ajoutez vos membres, importez la musique, puis enchaînez les formations en un clic.</p>
                <div className="row gap">
                  <button className="btn primary" onClick={() => setCreating({})}>
                    <Icon name="plus" /> Créer une chorégraphie
                  </button>
                  <button className="btn" onClick={() => navigate('/discover')}>
                    <Icon name="sparkles" /> Partir d’un modèle
                  </button>
                </div>
              </div>
            )}

            {loaded && choreos.length > 0 && !filtered.length && <p className="hint center">Aucun résultat.</p>}

            <div className="cards">
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
                                <MenuItem icon="copy" onClick={() => (close(), duplicate(c))}>Dupliquer</MenuItem>
                                <MenuItem icon="download" onClick={() => (close(), exportJson(c))}>Exporter (.json)</MenuItem>
                                <MenuItem icon="print" onClick={() => (close(), window.open(`#/print/${c.id}`, '_blank'))}>Imprimer / PDF</MenuItem>
                                <div className="menu-sep">Déplacer vers</div>
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
                        {Object.keys(c.dancers).length} membres · {Object.keys(c.formations).length} formations · {formatTime(totalDuration(c), false)}
                      </p>
                      <p className="card-meta dim">
                        {f && (
                          <span className="folder-tag" style={{ color: f.color }}>
                            <Icon name="folder" size={11} /> {f.name}
                          </span>
                        )}
                        {c.music.name ? (
                          <span>
                            <Icon name="music" size={11} /> {c.music.name}
                          </span>
                        ) : (
                          <span>Modifiée {new Date(c.updatedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>
                        )}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          </main>
        </div>
      )}

      {creating && (
        <NewChoreoDialog
          teams={teams}
          folders={folders}
          initialTeamId={creating.teamId}
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

export function RenameDialog({ title, value, onClose, onSave }: { title: string; value: string; onClose: () => void; onSave: (v: string) => void }) {
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
      <TextField label="Nom" value={f.name} onChange={(name) => setF({ ...f, name })} placeholder="ex : Comeback été, Cover contest…" />
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
