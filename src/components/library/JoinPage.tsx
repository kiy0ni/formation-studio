import { useEffect, useState } from 'react';
import { fetchRoom, seedFromRoom } from '../../collab/client';
import { db } from '../../lib/db';
import { unflatten } from '../../lib/flatten';
import { uid } from '../../lib/id';
import { defaultStage } from '../../lib/model';
import { navigate } from '../../lib/router';
import { Icon } from '../common/Icon';

export function JoinPage({ room, accessKey }: { room: string; accessKey: string }) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const local = (await db.listChoreos()).find((c) => c.collab?.roomId === room);
        if (local) {
          if (local.collab && local.collab.key !== accessKey) {
            // upgrade / downgrade access with the new link
            const { role } = await fetchRoom(room, accessKey);
            await db.saveChoreo({ ...local, collab: { ...local.collab, key: accessKey, role } });
          }
          if (!cancelled) navigate(`/c/${local.id}`);
          return;
        }
        const { role, entries } = await fetchRoom(room, accessKey);
        const now = Date.now();
        const flat: Record<string, unknown> = {};
        for (const k in entries) if (entries[k].v != null) flat[k] = entries[k].v;
        const doc = unflatten({ id: uid(), createdAt: now, updatedAt: now }, flat);
        if (!doc.stage) doc.stage = defaultStage();
        doc.collab = { roomId: room, key: accessKey, role };
        await db.saveChoreo(doc);
        await seedFromRoom(doc.id, entries);
        if (!cancelled) navigate(`/c/${doc.id}`);
      } catch (e) {
        if (!cancelled) setError((e as Error).message || 'Impossible de rejoindre la chorégraphie');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [room, accessKey]);

  return (
    <div className="center-screen">
      {error ? (
        <div className="empty">
          <Icon name="cloudOff" size={36} />
          <h2>Impossible d’ouvrir le lien</h2>
          <p>{error}. Vérifiez votre connexion ou demandez un nouveau lien.</p>
          <button className="btn primary" onClick={() => navigate('/')}>
            Retour à la bibliothèque
          </button>
        </div>
      ) : (
        <div className="empty">
          <div className="spinner" />
          <p>Connexion à la chorégraphie partagée…</p>
        </div>
      )}
    </div>
  );
}
