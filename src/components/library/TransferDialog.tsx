import { useState } from 'react';
import { exportBackup } from '../../lib/backup';
import { IS_ANDROID_APP } from '../../lib/platform';
import { Icon } from '../common/Icon';
import { notify } from '../common/Toast';
import { Modal } from '../common/ui';

/** Continue on another device: send the whole library as one file, open it on the other side. */
export function TransferDialog({ onClose, onReceive }: { onClose: () => void; onReceive: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Transférer" onClose={onClose} width={440}>
      <div className="transfer">
        <button
          className="transfer-tile"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await exportBackup();
              notify(`${r.choreos} chorégraphie${r.choreos > 1 ? 's' : ''} prête${r.choreos > 1 ? 's' : ''} à envoyer`);
            } finally {
              setBusy(false);
            }
          }}
        >
          <span className="transfer-icon send">
            <Icon name="upload" size={22} />
          </span>
          <b>{busy ? 'Préparation…' : 'Envoyer'}</b>
          <span>{IS_ANDROID_APP ? 'Partager le fichier (Drive, WhatsApp…)' : 'Télécharger un fichier avec tout'}</span>
        </button>
        <button
          className="transfer-tile"
          onClick={() => {
            onClose();
            onReceive();
          }}
        >
          <span className="transfer-icon receive">
            <Icon name="download" size={22} />
          </span>
          <b>Recevoir</b>
          <span>Ouvrir le fichier reçu</span>
        </button>
      </div>
      <p className="hint center-text">Chorégraphies, équipes et musiques comprises.</p>
    </Modal>
  );
}
