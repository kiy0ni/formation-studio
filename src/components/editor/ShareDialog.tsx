import { produce } from 'immer';
import { useEffect, useState } from 'react';
import { createRoom, displayName, ensureAudioUploaded, listMembers, openRoom, removeMember, rotateCodes, useCollab, type RoomMember } from '../../collab/client';
import { useCloud } from '../../lib/cloud';
import { COLLAB_ENABLED } from '../../lib/config';
import { db } from '../../lib/db';
import { exportJson } from '../../lib/exporters';
import type { CollabLink } from '../../lib/types';
import { useEditor } from '../../store/editor';
import { Icon } from '../common/Icon';
import { notify } from '../common/Toast';
import { Modal } from '../common/ui';
import { LoginDialog } from '../library/AccountButton';
import { QrCode, SITE_URL } from '../library/ShareAppDialog';

function setCollab(link: CollabLink | null) {
  const s = useEditor.getState();
  if (!s.doc) return;
  const next = produce(s.doc, (d) => {
    d.collab = link;
    d.updatedAt = Date.now();
  });
  useEditor.setState({ doc: next, readOnly: link?.role === 'view' });
  db.saveChoreo(next);
}

const joinUrl = (roomId: string, code: string) => `${SITE_URL}#/join/${roomId}/${code}`;
const ROLE: Record<RoomMember['role'], string> = { owner: 'Créateur', edit: 'Éditeur', view: 'Lecture' };

export function ShareDialog({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc!);
  const email = useCloud((s) => s.email);
  const [login, setLogin] = useState(false);

  if (!COLLAB_ENABLED) return <FileShare onClose={onClose} />;
  if (login) return <LoginDialog onClose={() => setLogin(false)} />;
  if (!email) {
    return (
      <Modal title="Partager" onClose={onClose} width={420}>
        <div className="share-app">
          <Intro />
          <p className="hint">Un compte gratuit est nécessaire, pour vous et pour les personnes invitées.</p>
          <button className="btn primary big" onClick={() => setLogin(true)}>
            Se connecter
          </button>
          <FileShareLink />
        </div>
      </Modal>
    );
  }
  return doc.collab ? <SharedView link={doc.collab} onClose={onClose} /> : <Enable onClose={onClose} />;
}

function Intro() {
  return (
    <ul className="share-points">
      <li>
        <Icon name="link" size={14} /> Lien <b>éditeur</b> : on modifie ensemble, en direct
      </li>
      <li>
        <Icon name="lock" size={14} /> Lien <b>lecture seule</b> : pour les danseurs
      </li>
      <li>
        <Icon name="music" size={14} /> La musique suit automatiquement
      </li>
    </ul>
  );
}

function NameField() {
  const [name, setName] = useState(displayName());
  return (
    <label className="field">
      <span className="field-label">Votre nom visible</span>
      <input
        value={name}
        maxLength={40}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const v = name.trim();
          if (v) localStorage.setItem('fs-name', v);
          else localStorage.removeItem('fs-name');
        }}
      />
    </label>
  );
}

function Enable({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal title="Partager" onClose={onClose} width={420}>
      <div className="share-app">
        <Intro />
        <NameField />
        {error && <p className="error-text">{error}</p>}
        <button
          className="btn primary big"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              const doc = useEditor.getState().doc!;
              const link = await createRoom(doc);
              setCollab(link);
              if (doc.music.hash) void ensureAudioUploaded(link, doc.music.hash);
              notify('Partage activé');
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Icon name="users" /> {busy ? 'Activation…' : 'Activer le partage'}
        </button>
        <FileShareLink />
      </div>
    </Modal>
  );
}

function SharedView({ link, onClose }: { link: CollabLink; onClose: () => void }) {
  const status = useCollab((s) => s.status);
  const error = useCollab((s) => s.error);
  const peers = useCollab((s) => s.peers);
  const [members, setMembers] = useState<RoomMember[] | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = link.role === 'edit';
  const peerCount = Object.keys(peers).length;

  // links may have been changed by the owner: refresh them, and the member list
  useEffect(() => {
    let alive = true;
    if (canEdit)
      openRoom(link.roomId)
        .then((room) => {
          if (!alive || !room.editCode || !room.viewCode) return;
          if (room.editCode !== link.editKey || room.viewCode !== link.viewKey || room.owner !== !!link.owner)
            setCollab({ ...link, editKey: room.editCode, viewKey: room.viewCode, owner: room.owner });
        })
        .catch(() => {});
    listMembers(link.roomId)
      .then((m) => alive && setMembers(m))
      .catch(() => alive && setMembers(null));
    return () => {
      alive = false;
    };
  }, [link, canEdit, peerCount]);

  const statusText =
    status === 'online'
      ? `En direct${peerCount ? ` · ${peerCount} autre${peerCount > 1 ? 's' : ''} ici` : ''}`
      : status === 'connecting'
        ? 'Connexion…'
        : status === 'error'
          ? error || 'Partage indisponible'
          : 'Hors ligne · vos modifications partiront au retour du réseau';

  return (
    <Modal title="Partager" onClose={onClose} width={440}>
      <div className="share-app">
        <p className={`status-line ${status}`}>
          <Icon name={status === 'online' ? 'cloud' : 'cloudOff'} size={14} /> {statusText}
        </p>

        {canEdit && link.editKey && link.viewKey ? (
          <>
            <LinkRow label="Lecture seule" hint="Pour les danseurs" icon="lock" url={joinUrl(link.roomId, link.viewKey)} />
            <LinkRow label="Éditeur" hint="Peut tout modifier" icon="link" url={joinUrl(link.roomId, link.editKey)} />
          </>
        ) : (
          <p className="hint">{canEdit ? 'Liens disponibles une fois en ligne.' : 'Vous consultez cette chorégraphie en lecture seule.'}</p>
        )}

        <NameField />

        {members && (
          <div className="field">
            <span className="field-label">Membres · {members.length}</span>
            <div className="member-list">
              {members.map((m) => (
                <div key={m.userId} className="member-row">
                  <span className="grow ellipsis">
                    {m.name}
                    {m.me ? ' (vous)' : ''}
                  </span>
                  <span className="hint">{ROLE[m.role]}</span>
                  {link.owner && !m.me && m.role !== 'owner' && (
                    <button
                      className="icon-btn"
                      aria-label={`Retirer ${m.name}`}
                      title="Retirer l’accès"
                      onClick={async () => {
                        if (!confirm(`Retirer l’accès de ${m.name} ?`)) return;
                        try {
                          await removeMember(link.roomId, m.userId);
                          setMembers((list) => list?.filter((x) => x.userId !== m.userId) ?? null);
                          notify('Accès retiré');
                        } catch (e) {
                          notify((e as Error).message);
                        }
                      }}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="account-actions">
          {link.owner && (
            <button
              className="btn small"
              disabled={busy}
              onClick={async () => {
                if (!confirm('Créer de nouveaux liens ? Les anciens ne marcheront plus (les membres actuels gardent leur accès).')) return;
                setBusy(true);
                try {
                  const codes = await rotateCodes(link.roomId);
                  setCollab({ ...link, key: codes.editKey, ...codes });
                  notify('Nouveaux liens créés');
                } catch (e) {
                  notify((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Icon name="swap" size={14} /> Nouveaux liens
            </button>
          )}
          <button
            className="btn small ghost danger"
            onClick={async () => {
              const leave = !link.owner;
              if (!confirm(leave ? 'Quitter ce partage ? Une copie reste sur cet appareil.' : 'Arrêter le partage sur cet appareil ? Une copie reste ici, les autres gardent l’accès.')) return;
              if (leave) {
                const me = members?.find((m) => m.me);
                if (me) await removeMember(link.roomId, me.userId).catch(() => {});
              }
              setCollab(null);
              onClose();
            }}
          >
            <Icon name="cloudOff" size={14} /> {link.owner ? 'Arrêter ici' : 'Quitter'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function LinkRow({ label, hint, url, icon }: { label: string; hint: string; url: string; icon: 'link' | 'lock' }) {
  const [qr, setQr] = useState(false);
  const canShare = typeof navigator.share === 'function';
  return (
    <div className="share-row">
      <div className="share-row-head">
        <Icon name={icon} size={14} />
        <b>{label}</b>
        <span className="hint">{hint}</span>
      </div>
      <div className="share-actions">
        <button
          className="btn small"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              notify('Lien copié');
            } catch {
              prompt('Copiez ce lien :', url);
            }
          }}
        >
          <Icon name="copy" size={14} /> Copier
        </button>
        {canShare && (
          <button className="btn small" onClick={() => navigator.share({ title: 'Chorégraphie Lineup', url }).catch(() => {})}>
            <Icon name="share" size={14} /> Envoyer
          </button>
        )}
        <button className={`btn small ${qr ? 'primary' : ''}`} onClick={() => setQr(!qr)}>
          QR code
        </button>
      </div>
      {qr && <QrCode text={url} />}
    </div>
  );
}

function FileShareLink() {
  return (
    <button
      className="link-btn muted center-text"
      onClick={() => {
        exportJson(useEditor.getState().doc!);
        notify('Fichier exporté');
      }}
    >
      Ou envoyer un fichier
    </button>
  );
}

function FileShare({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Partager" onClose={onClose} width={420}>
      <div className="share-app">
        <p className="hint">Envoyez la chorégraphie en fichier, puis ouvrez-le sur l’autre appareil (Bibliothèque → ⋯ → Importer un fichier).</p>
        <button
          className="btn primary big"
          onClick={() => {
            exportJson(useEditor.getState().doc!);
            notify('Fichier exporté');
          }}
        >
          <Icon name="download" /> Envoyer un fichier
        </button>
      </div>
    </Modal>
  );
}
