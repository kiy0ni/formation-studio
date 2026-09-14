import { produce } from 'immer';
import { useState } from 'react';
import { createRoom, displayName, ensureAudioUploaded, useCollab } from '../../collab/client';
import { COLLAB_ENABLED } from '../../lib/config';
import { db } from '../../lib/db';
import { exportJson } from '../../lib/exporters';
import { initials } from '../../lib/geometry';
import type { CollabLink } from '../../lib/types';
import { useEditor } from '../../store/editor';
import { Icon } from '../common/Icon';
import { notify } from '../common/Toast';
import { Modal } from '../common/ui';

function setCollab(link: CollabLink | null) {
  const s = useEditor.getState();
  if (!s.doc) return;
  const next = produce(s.doc, (d) => {
    d.collab = link;
  });
  useEditor.setState({ doc: next, readOnly: link?.role === 'view' });
  db.saveChoreo(next);
}

export function ShareDialog({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc!);
  const status = useCollab((s) => s.status);
  const peers = useCollab((s) => s.peers);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = doc.collab;
  const base = `${location.origin}${location.pathname}#/join/${link?.roomId}`;

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      const l = await createRoom(useEditor.getState().doc!);
      setCollab(l);
      if (doc.music.hash) ensureAudioUploaded(l, doc.music.hash);
      notify('Collaboration activée');
    } catch {
      setError('Le serveur de collaboration est injoignable. Lancez l’application avec « npm run dev » ou « npm start ».');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify('Lien copié');
    } catch {
      prompt('Copiez ce lien :', text);
    }
  };

  return (
    <Modal title="Partager & collaborer" onClose={onClose} width={540}>
      {!COLLAB_ENABLED && !link ? (
        <>
          <div className="share-hero">
            <Icon name="note" size={28} />
            <div>
              <b>Partager par fichier</b>
              <p>
                Cette version fonctionne entièrement sur l’appareil, sans serveur. Pour envoyer une chorégraphie, exportez-la puis ouvrez le fichier sur l’autre appareil
                (bibliothèque → « Données » → « Importer »).
              </p>
            </div>
          </div>
          <button
            className="btn primary block"
            onClick={() => {
              exportJson(useEditor.getState().doc!);
              notify('Fichier exporté');
            }}
          >
            <Icon name="download" /> Exporter cette chorégraphie
          </button>
          <p className="hint">Pour tout transférer d’un coup (Mac → Android), utilisez « Sauvegarder toute la bibliothèque » dans la bibliothèque.</p>
        </>
      ) : !link ? (
        <>
          <div className="share-hero">
            <Icon name="users" size={28} />
            <div>
              <b>Créez à plusieurs, en temps réel</b>
              <p>Chaque modification apparaît instantanément chez tous les membres. Hors connexion, vous continuez à éditer : tout se synchronise au retour du réseau.</p>
            </div>
          </div>
          <ul className="share-points">
            <li><Icon name="link" size={14} /> Un lien <b>éditeur</b> pour les chorégraphes</li>
            <li><Icon name="lock" size={14} /> Un lien <b>lecture seule</b> pour les danseurs</li>
            <li><Icon name="music" size={14} /> La musique est partagée automatiquement</li>
          </ul>
          <p className="hint">Vous apparaîtrez sous le nom « {displayName()} » (modifiable depuis la bibliothèque).</p>
          {error && <p className="error-text">{error}</p>}
          <button className="btn primary block" disabled={busy} onClick={enable}>
            <Icon name="cloud" /> {busy ? 'Activation…' : 'Activer la collaboration'}
          </button>
        </>
      ) : (
        <>
          <p className={`status-line ${status}`}>
            <Icon name={status === 'online' ? 'cloud' : 'cloudOff'} size={14} />
            {status === 'online' ? 'Connecté — les modifications sont synchronisées' : status === 'connecting' ? 'Connexion…' : 'Hors ligne — vos modifications seront envoyées au retour du réseau'}
          </p>
          {link.role === 'edit' && (
            <>
              <ShareRow label="Lien éditeur" hint="Peut modifier la chorégraphie" icon="link" url={`${base}/${link.editKey ?? link.key}`} onCopy={copy} />
              {link.viewKey && <ShareRow label="Lien lecture seule" hint="Idéal pour les danseurs : consulter, lire, zoomer" icon="lock" url={`${base}/${link.viewKey}`} onCopy={copy} />}
              {!link.viewKey && <p className="hint">Seul le créateur du partage peut générer le lien lecture seule.</p>}
            </>
          )}
          {link.role === 'view' && <p className="hint">Vous avez un accès en lecture seule à cette chorégraphie.</p>}

          <div className="field">
            <span className="field-label">Présents maintenant</span>
            <div className="peer-list">
              <span className="chip">
                <i style={{ background: localStorage.getItem('fs-color') || '#ff4d8d' }} /> {displayName()} (vous)
              </span>
              {Object.values(peers).map((p) => (
                <span key={p.clientId} className="chip">
                  <span className="avatar tiny" style={{ background: p.color }}>
                    {initials(p.name)}
                  </span>
                  {p.name}
                </span>
              ))}
            </div>
          </div>
          <button
            className="btn ghost danger small"
            onClick={() => {
              if (!confirm('Arrêter la synchronisation sur cet appareil ? Une copie locale est conservée.')) return;
              setCollab(null);
              onClose();
            }}
          >
            <Icon name="cloudOff" size={14} /> Arrêter la synchronisation ici
          </button>
        </>
      )}
    </Modal>
  );
}

function ShareRow({ label, hint, url, icon, onCopy }: { label: string; hint: string; url: string; icon: 'link' | 'lock'; onCopy: (u: string) => void }) {
  return (
    <div className="share-row">
      <div className="share-row-head">
        <Icon name={icon} size={14} />
        <b>{label}</b>
        <span className="hint">{hint}</span>
      </div>
      <div className="share-link">
        <input readOnly value={url} onFocus={(e) => e.target.select()} />
        <button className="btn small" onClick={() => onCopy(url)}>
          <Icon name="copy" size={14} /> Copier
        </button>
      </div>
    </div>
  );
}
