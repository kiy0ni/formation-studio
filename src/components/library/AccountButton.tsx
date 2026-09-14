import { useState, type FormEvent } from 'react';
import { CLOUD_ENABLED, signIn, signOut, syncNow, useCloud, type CloudStatus } from '../../lib/cloud';
import { Icon } from '../common/Icon';
import { notify } from '../common/Toast';
import { Modal, Segmented } from '../common/ui';

export function AccountButton() {
  const email = useCloud((s) => s.email);
  const status = useCloud((s) => s.status);
  const [open, setOpen] = useState(false);
  if (!CLOUD_ENABLED) return null;
  return (
    <>
      {email ? (
        <button className={`account-btn ${status}`} onClick={() => setOpen(true)} aria-label="Compte" title={email}>
          {email[0].toUpperCase()}
          <i className="account-dot" />
        </button>
      ) : (
        <button className="icon-btn account-login" onClick={() => setOpen(true)} aria-label="Se connecter" title="Se connecter">
          <Icon name="user" size={20} />
        </button>
      )}
      {open && (email ? <AccountDialog onClose={() => setOpen(false)} /> : <LoginDialog onClose={() => setOpen(false)} />)}
    </>
  );
}

function LoginDialog({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('E-mail invalide.');
    if (password.length < 6) return setError('Mot de passe : 6 caractères minimum.');
    setBusy(true);
    try {
      await signIn(email.trim(), password, mode === 'up');
      notify(mode === 'up' ? 'Compte créé' : 'Connecté');
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Compte" onClose={onClose} width={400}>
      <form className="account-form" onSubmit={submit}>
        <p className="hint">Vos chorégraphies sur tous vos appareils.</p>
        <Segmented
          value={mode}
          onChange={(m) => (setMode(m), setError(''))}
          options={[
            { value: 'in', label: 'Connexion' },
            { value: 'up', label: 'Créer un compte' },
          ]}
        />
        <input type="email" inputMode="email" autoComplete="email" autoCapitalize="none" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input
          type="password"
          autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
          placeholder={mode === 'up' ? 'Mot de passe (6 caractères min.)' : 'Mot de passe'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="error-text">{error}</p>}
        <button className="btn primary big" disabled={busy}>
          {busy ? 'Un instant…' : mode === 'up' ? 'Créer le compte' : 'Se connecter'}
        </button>
      </form>
    </Modal>
  );
}

const STATUS: Record<CloudStatus, string> = {
  off: 'Déconnecté',
  idle: 'Synchronisé',
  syncing: 'Synchronisation…',
  offline: 'Hors ligne · reprise automatique',
  error: 'Synchronisation impossible',
};

function ago(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  return `il y a ${Math.round(s / 3600)} h`;
}

function AccountDialog({ onClose }: { onClose: () => void }) {
  const { email, status, lastSync, error } = useCloud();
  return (
    <Modal title="Compte" onClose={onClose} width={400}>
      <div className="account-card">
        <span className={`account-btn big ${status}`}>
          {email?.[0].toUpperCase()}
          <i className="account-dot" />
        </span>
        <div className="grow account-meta">
          <b className="ellipsis">{email}</b>
          <span>
            {STATUS[status]}
            {status === 'idle' && lastSync ? ` ${ago(lastSync)}` : ''}
          </span>
        </div>
      </div>
      {error && <p className="error-text">{error}</p>}
      <div className="account-actions">
        <button className="btn" disabled={status === 'syncing'} onClick={() => void syncNow()}>
          <Icon name="cloud" size={16} /> Synchroniser
        </button>
        <button
          className="btn ghost"
          onClick={async () => {
            await signOut();
            notify('Déconnecté');
            onClose();
          }}
        >
          Se déconnecter
        </button>
      </div>
      <p className="hint">Tout reste aussi enregistré sur cet appareil.</p>
    </Modal>
  );
}
