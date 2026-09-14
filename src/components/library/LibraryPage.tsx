import { produce } from 'immer';
import { useEffect, useMemo, useRef, useState } from 'react';
import { importBackup, isBackup } from '../../lib/backup';
import { FOLDER_COLORS } from '../../lib/colors';
import { COLLAB_ENABLED } from '../../lib/config';
import { db } from '../../lib/db';
import { exportJson, importJson } from '../../lib/exporters';
import { uid } from '../../lib/id';
import { isMediaFile } from '../../lib/media';
import { formatTime, sortedFormations, totalDuration } from '../../lib/model';
import { CAN_OPEN_WINDOWS, openRoute } from '../../lib/platform';
import { navigate } from '../../lib/router';
import type { Choreo, Folder } from '../../lib/types';
import { useLibrary } from '../../store/library';
import { GuideContent } from '../GuideContent';
import { FormationThumb } from '../common/FormationThumb';
import { Icon, type IconName } from '../common/Icon';
import { notify } from '../common/Toast';
import { Menu, MenuItem, Modal } from '../common/ui';
import { DiscoverView } from './DiscoverView';
import { InstallButton } from './InstallButton';
import { NewChoreoFlow } from './NewChoreoFlow';
import { AccountButton } from './AccountButton';
import { ProfileButton } from './ProfileButton';
import { TeamsView } from './TeamsView';
import { TransferDialog } from './TransferDialog';

type Tab = 'choreos' | 'teams' | 'discover' | 'guide';

const TABS: { id: Tab; path: string; icon: IconName; label: string }[] = [
  { id: 'choreos', path: '/', icon: 'grid', label: 'Bibliothèque' },
  { id: 'teams', path: '/teams', icon: 'users', label: 'Équipes' },
  { id: 'discover', path: '/discover', icon: 'sparkles', label: 'Modèles' },
  { id: 'guide', path: '/guide', icon: 'help', label: 'Guide' },
];

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export function LibraryPage({ tab, create }: { tab: Tab; create?: boolean }) {
  const { choreos, teams, folders, loaded, refresh } = useLibrary();
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [folder, setFolder] = useState<string | 'all'>('all');
  const [creating, setCreating] = useState<{ teamId?: string; file?: File } | null>(null);
  const [renaming, setRenaming] = useState<Choreo | null>(null);
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null);
  const [transfer, setTransfer] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  useEffect(() => {
    refresh();
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
  const filtered = useMemo(
    () =>
      choreos.filter((c) => {
        if (folder !== 'all' && c.folderId !== folder) return false;
        if (!q) return true;
        const hay = [c.name, ...Object.values(c.dancers).map((d) => `${d.name} ${d.group ?? ''}`), ...Object.values(c.formations).map((f) => `${f.name} ${f.note}`), c.music.name ?? ''];
        return hay.some((h) => norm(h).includes(q));
      }),
    [choreos, folder, q],
  );

  const save = async (doc: Choreo) => {
    await db.saveChoreo({ ...doc, updatedAt: Date.now() });
    await refresh();
  };

  const duplicate = async (c: Choreo) => {
    await save(
      produce(c, (d) => {
        d.id = uid();
        d.name = `${c.name} (copie)`;
        d.createdAt = d.updatedAt = Date.now();
        d.collab = null;
      }),
    );
    notify('Dupliquée');
  };

  const remove = async (c: Choreo) => {
    if (!confirm(`Supprimer « ${c.name} » ?`)) return;
    await db.deleteChoreo(c.id);
    await refresh();
    notify('Supprimée');
  };

  const onImport = async (file: File) => {
    try {
      const text = await file.text();
      if (isBackup(text)) {
        const r = await importBackup(text);
        await refresh();
        notify(`${r.choreos} chorégraphie${r.choreos > 1 ? 's' : ''} reçue${r.choreos > 1 ? 's' : ''}`);
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
    if (isMediaFile(f)) setCreating({ file: f });
    else if (f.name.endsWith('.json') || f.type === 'application/json') onImport(f);
  };

  const title = TABS.find((t) => t.id === tab)?.label ?? 'Bibliothèque';

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
      <header className="lib-top">
        <button className="lib-brand" onClick={() => navigate('/')} aria-label="Lineup">
          <img src="icon.svg" alt="" width={30} height={30} />
          <span>Lineup</span>
        </button>
        <h1 className="lib-title">{title}</h1>
        <label className={`lib-search ${searchOpen ? 'open' : ''}`}>
          <Icon name="search" size={16} />
          <input placeholder="Rechercher" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && (
            <button className="icon-btn tiny" onClick={() => setQuery('')} aria-label="Effacer">
              <Icon name="close" size={12} />
            </button>
          )}
        </label>
        <div className="lib-actions">
          <button className="icon-btn search-toggle" onClick={() => setSearchOpen(!searchOpen)} aria-label="Rechercher">
            <Icon name="search" size={20} />
          </button>
          <InstallButton />
          <AccountButton />
          {COLLAB_ENABLED && <ProfileButton />}
          <Menu trigger={<button className="icon-btn" aria-label="Plus"><Icon name="dots" size={20} /></button>}>
            {(close) => (
              <>
                <MenuItem icon="swap" onClick={() => (close(), setTransfer(true))}>
                  Transférer vers un autre appareil
                </MenuItem>
                <MenuItem icon="upload" onClick={() => (close(), fileRef.current?.click())}>
                  Importer un fichier
                </MenuItem>
                <MenuItem icon="help" onClick={() => (close(), navigate('/guide'))}>
                  Guide
                </MenuItem>
              </>
            )}
          </Menu>
          <button className="btn primary new-btn" onClick={() => setCreating({})}>
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
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => navigate(t.path)}>
            {t.label}
          </button>
        ))}
      </nav>

      <main className="lib-content">
        {tab === 'teams' && <TeamsView query={q} onCreateChoreo={(teamId) => setCreating({ teamId })} />}
        {tab === 'discover' && <DiscoverView query={q} />}
        {tab === 'guide' && (
          <div className="lib-main padded narrow">
            <GuideContent />
          </div>
        )}

        {tab === 'choreos' && (
          <div className="lib-main padded">
            {(folders.length > 0 || choreos.length > 0) && (
              <div className="folder-chips">
                <button className={`chip ${folder === 'all' ? 'on' : ''}`} onClick={() => setFolder('all')}>
                  Tout <em>{choreos.length}</em>
                </button>
                {folders.map((f) => (
                  <button
                    key={f.id}
                    className={`chip ${folder === f.id ? 'on' : ''}`}
                    onClick={() => (folder === f.id ? setEditingFolder(f) : setFolder(f.id))}
                    title={folder === f.id ? 'Toucher pour modifier' : f.name}
                  >
                    <i style={{ background: f.color }} /> {f.name} <em>{choreos.filter((c) => c.folderId === f.id).length}</em>
                  </button>
                ))}
                <button className="chip ghost" onClick={() => setEditingFolder({ id: '', name: '', color: FOLDER_COLORS[folders.length % FOLDER_COLORS.length] })}>
                  <Icon name="plus" size={12} /> Dossier
                </button>
              </div>
            )}

            {loaded && q && !filtered.length && <p className="hint center">Aucun résultat.</p>}

            <div className="cards">
              {!q && (
                <button className="card new-card" onClick={() => setCreating({})}>
                  <Icon name="plus" size={30} />
                  <span>Nouvelle chorégraphie</span>
                </button>
              )}
              {filtered.map((c) => (
                <article key={c.id} className="card" onClick={() => navigate(`/c/${c.id}`)}>
                  <div className="card-thumb">
                    <FormationThumb doc={c} formation={sortedFormations(c)[0]} />
                  </div>
                  <div className="card-body">
                    <div className="card-title">
                      <h3>{c.name}</h3>
                      <div onClick={(e) => e.stopPropagation()}>
                        <Menu trigger={<button className="icon-btn tiny" aria-label="Actions"><Icon name="dots" size={16} /></button>}>
                          {(close) => (
                            <>
                              <MenuItem icon="text" onClick={() => (close(), setRenaming(c))}>Renommer</MenuItem>
                              <MenuItem icon="copy" onClick={() => (close(), duplicate(c))}>Dupliquer</MenuItem>
                              {CAN_OPEN_WINDOWS && (
                                <MenuItem icon="window" onClick={() => (close(), openRoute(`/c/${c.id}`, true))}>
                                  Nouvelle fenêtre
                                </MenuItem>
                              )}
                              <MenuItem icon="share" onClick={() => (close(), exportJson(c))}>Envoyer</MenuItem>
                              <MenuItem icon="print" onClick={() => (close(), openRoute(`/print/${c.id}`, true))}>PDF</MenuItem>
                              {folders.length > 0 && <div className="menu-sep">Dossier</div>}
                              {folders.length > 0 && (
                                <MenuItem icon="note" onClick={() => (close(), save({ ...c, folderId: null }))}>
                                  Aucun
                                </MenuItem>
                              )}
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
                      {Object.keys(c.dancers).length} danseurs · {formatTime(totalDuration(c), false)}
                    </p>
                  </div>
                </article>
              ))}
            </div>

            {loaded && !choreos.length && (
              <p className="hint lib-empty-hint">
                ou <button className="link-btn" onClick={() => navigate('/discover')}>partir d’un modèle</button>
              </p>
            )}
          </div>
        )}
      </main>

      <nav className="tabbar" aria-label="Sections">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => navigate(t.path)}>
            <Icon name={t.icon} size={21} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      {tab === 'choreos' && (
        <button className="fab" onClick={() => setCreating({})} aria-label="Nouvelle chorégraphie">
          <Icon name="plus" size={26} strokeWidth={2.2} />
        </button>
      )}

      {dragging && (
        <div className="drop-overlay">
          <div>
            <Icon name="music" size={40} />
            <b>Déposez une musique ou une vidéo</b>
          </div>
        </div>
      )}

      {creating && (
        <NewChoreoFlow
          teams={teams}
          folders={folders}
          initialTeamId={creating.teamId}
          initialFile={creating.file}
          initialFolderId={folder !== 'all' ? folder : null}
          onClose={() => setCreating(null)}
          onCreate={async (doc) => {
            await db.saveChoreo(doc);
            navigate(`/c/${doc.id}`);
          }}
        />
      )}

      {transfer && <TransferDialog onClose={() => setTransfer(false)} onReceive={() => fileRef.current?.click()} />}

      {renaming && (
        <RenameDialog
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
                  if (!confirm(`Supprimer le dossier « ${editingFolder.name} » ? Les chorégraphies restent.`)) return;
                  await Promise.all(choreos.filter((c) => c.folderId === editingFolder.id).map((c) => db.saveChoreo({ ...c, folderId: null, updatedAt: Date.now() })));
                  await db.deleteFolder(editingFolder.id);
                  setFolder('all');
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

export function RenameDialog({ value, onClose, onSave, title = 'Renommer' }: { value: string; onClose: () => void; onSave: (v: string) => void; title?: string }) {
  const [name, setName] = useState(value);
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={400}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Annuler</button>
          <button className="btn primary" disabled={!name.trim()} onClick={() => onSave(name.trim())}>OK</button>
        </>
      }
    >
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSave(name.trim())} />
    </Modal>
  );
}

function FolderDialog({ folder, onClose, onSave, onDelete }: { folder: Folder; onClose: () => void; onSave: (f: Folder) => void; onDelete?: () => void }) {
  const [f, setF] = useState(folder);
  return (
    <Modal
      title={folder.id ? 'Dossier' : 'Nouveau dossier'}
      onClose={onClose}
      width={400}
      footer={
        <>
          {onDelete && (
            <button className="btn danger ghost" onClick={onDelete}>
              <Icon name="trash" /> Supprimer
            </button>
          )}
          <span className="grow" />
          <button className="btn primary" disabled={!f.name.trim()} onClick={() => onSave({ ...f, name: f.name.trim() })}>OK</button>
        </>
      }
    >
      <input
        autoFocus
        value={f.name}
        placeholder="Nom du dossier"
        onChange={(e) => setF({ ...f, name: e.target.value })}
        onKeyDown={(e) => e.key === 'Enter' && f.name.trim() && onSave({ ...f, name: f.name.trim() })}
      />
      <div className="swatches">
        {FOLDER_COLORS.map((c) => (
          <button key={c} className={`swatch ${f.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setF({ ...f, color: c })} aria-label={c} />
        ))}
      </div>
    </Modal>
  );
}
