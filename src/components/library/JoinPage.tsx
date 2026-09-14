import { useEffect, useState } from 'react';
import { fetchRoom, seedFromRoom } from '../../collab/client';
import { cloudSession, useCloud } from '../../lib/cloud';
import { db } from '../../lib/db';
import { unflatten } from '../../lib/flatten';
import { uid } from '../../lib/id';
import { defaultStage } from '../../lib/model';
import { navigate } from '../../lib/router';
import type { CollabLink } from '../../lib/types';
import { Icon } from '../common/Icon';
import { LoginDialog } from './AccountButton';

export function JoinPage({ room, accessKey }: { room: string; accessKey: string }) {
  const email = useCloud((s) => s.email);
  const [ready, setReady] = useState(false);
  const [login, setLogin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // wait until a saved sign-in has been restored
  useEffect(() => {
    void cloudSession().finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready || !email) return;
    let cancelled = false;
    (async () => {
      const local = (await db.listChoreos()).find((c) => c.collab?.roomId === room);
      try {
        const snap = await fetchRoom(room, accessKey);
        const collab: CollabLink = { roomId: room, key: accessKey, role: snap.role, owner: snap.owner, editKey: snap.editCode ?? undefined, viewKey: snap.viewCode ?? undefined };
        if (local) {
          await db.saveChoreo({ ...local, collab, updatedAt: Date.now() });
          if (!cancelled) navigate(`/c/${local.id}`);
          return;
        }
        const now = Date.now();
        const flat: Record<string, unknown> = {};
        for (const k in snap.entries) if (snap.entries[k].v != null) flat[k] = snap.entries[k].v;
        const doc = unflatten({ id: uid(), createdAt: now, updatedAt: now }, flat);
        if (!doc.stage) doc.stage = defaultStage();
        doc.collab = collab;
        await db.saveChoreo(doc);
        await seedFromRoom(doc.id, snap.entries);
        if (!cancelled) navigate(`/c/${doc.id}`);
      } catch (e) {
        // already on this device: open the local copy, it catches up when back online
        if (local && /connexion/i.test((e as Error).message)) return void (cancelled || navigate(`/c/${local.id}`));
        if (!cancelled) setError((e as Error).message || 'Impossible d’ouvrir la chorégraphie');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, email, room, accessKey]);

  if (login) return <LoginDialog onClose={() => setLogin(false)} />;

  return (
    <div className="center-screen">
      {error ? (
        <div className="empty">
          <Icon name="cloudOff" size={36} />
          <h2>Impossible d’ouvrir le lien</h2>
          <p>{error}. Demandez un nouveau lien si besoin.</p>
          <button className="btn primary" onClick={() => navigate('/')}>
            Bibliothèque
          </button>
        </div>
      ) : ready && !email ? (
        <div className="empty">
          <img src="icon.svg" alt="" width={56} height={56} />
          <h2>Chorégraphie partagée</h2>
          <p>Connectez-vous ou créez un compte gratuit pour l’ouvrir.</p>
          <button className="btn primary big" onClick={() => setLogin(true)}>
            Se connecter
          </button>
        </div>
      ) : (
        <div className="empty">
          <div className="spinner" />
          <p>Ouverture de la chorégraphie partagée…</p>
        </div>
      )}
    </div>
  );
}
