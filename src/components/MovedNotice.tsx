import { useEffect, useState } from 'react';
import { exportBackup } from '../lib/backup';
import { db } from '../lib/db';
import { AT_OLD_ADDRESS, NEW_ADDRESS } from '../lib/moved';
import { Icon } from './common/Icon';
import { Modal } from './common/ui';

/**
 * Web app installed from the old address (a browser tab never gets here, see lib/moved): its projects may be kept
 * apart from the new address, so it explains how to bring them over. Nothing is deleted: it keeps working meanwhile.
 */
export function MovedNotice() {
  const [hasProjects, setHasProjects] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!AT_OLD_ADDRESS) return;
    Promise.all([db.listChoreos(), db.listTeams()]).then(([choreos, teams]) => {
      // nothing to bring over: just go
      if (!choreos.length && !teams.length) return location.replace(NEW_ADDRESS + location.hash);
      setHasProjects(true);
      setOpen(true);
    });
  }, []);

  if (!hasProjects) return null;
  if (!open)
    return (
      <button className="update-notice moved-pill" onClick={() => setOpen(true)}>
        <Icon name="warning" size={16} />
        <span>Lineup a changé d’adresse</span>
      </button>
    );
  return (
    <Modal
      title="Lineup a changé d’adresse"
      onClose={() => setOpen(false)}
      width={440}
      footer={
        <button className="btn ghost" onClick={() => setOpen(false)}>
          Plus tard
        </button>
      }
    >
      <p>Cette app a été installée depuis l’ancienne adresse et garde tes projets à part. Pour les retrouver dans la nouvelle :</p>
      <ol className="moved-steps">
        <li>
          <b>Enregistre tes projets</b> dans un fichier
          <button
            className={`btn ${saved ? '' : 'primary'}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await exportBackup();
                setSaved(true);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Icon name={saved ? 'check' : 'upload'} size={16} />
            {busy ? 'Préparation…' : saved ? 'Enregistré' : 'Enregistrer mes projets'}
          </button>
        </li>
        <li>
          <b>Ouvre la nouvelle adresse</b> (et installe-la à la place de celle-ci)
          <a className="btn" href={NEW_ADDRESS} target="_blank" rel="noopener noreferrer">
            <Icon name="link" size={16} />
            kiy0ni.github.io/lineup
          </a>
        </li>
        <li>
          Là-bas : <b>⋯ › Transférer › Recevoir</b>, puis choisis le fichier.
        </li>
      </ol>
      <p className="hint">Rien n’est effacé ici. Si tu modifies encore dans cette app, refais l’étape 1.</p>
    </Modal>
  );
}
