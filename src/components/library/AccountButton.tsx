import { useState, type FormEvent, type ReactNode } from 'react';
import { changePassword, CLOUD_ENABLED, deleteAccount, resetWithCode, sendResetCode, signIn, signOut, syncNow, useCloud, type CloudStatus } from '../../lib/cloud';
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

const validEmail = (v: string) => /^\S+@\S+\.\S+$/.test(v.trim());

/** Shared submit handling: validation message, busy state, error text. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

function PasswordInput({ value, onChange, placeholder, isNew }: { value: string; onChange: (v: string) => void; placeholder: string; isNew?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div className="password-field">
      <input type={show ? 'text' : 'password'} autoComplete={isNew ? 'new-password' : 'current-password'} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="icon-btn" onClick={() => setShow(!show)} aria-label={show ? 'Masquer' : 'Afficher'}>
        <Icon name="eye" size={18} />
      </button>
    </div>
  );
}

/* ------------------------------ signed out ------------------------------ */

type LoginView = 'in' | 'up' | 'forgot' | 'code';

export function LoginDialog({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<LoginView>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const { busy, error, setError, run } = useAction();
  const go = (v: LoginView) => (setView(v), setError(''));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!validEmail(email)) return setError('E-mail invalide.');
    if (view === 'forgot') {
      return run(async () => {
        await sendResetCode(email.trim());
        go('code');
      });
    }
    if (view === 'code' && !/^\d{8}$/.test(code.trim())) return setError('Entrez le code reçu par e-mail.');
    if (password.length < 8) return setError('Mot de passe : 8 caractères minimum.');
    return run(async () => {
      if (view === 'code') {
        await resetWithCode(email.trim(), code.trim(), password);
        notify('Mot de passe changé');
      } else {
        await signIn(email.trim(), password, view === 'up');
        notify(view === 'up' ? 'Compte créé' : 'Connecté');
      }
      onClose();
    });
  };

  const emailInput = <input type="email" inputMode="email" autoComplete="email" autoCapitalize="none" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} />;

  return (
    <Modal title={view === 'forgot' || view === 'code' ? 'Mot de passe oublié' : 'Compte'} onClose={onClose} width={400}>
      <form className="account-form" onSubmit={submit}>
        {(view === 'in' || view === 'up') && (
          <>
            <p className="hint">Vos chorégraphies sur tous vos appareils.</p>
            <Segmented
              value={view}
              onChange={go}
              options={[
                { value: 'in', label: 'Connexion' },
                { value: 'up', label: 'Créer un compte' },
              ]}
            />
            {emailInput}
            <PasswordInput value={password} onChange={setPassword} placeholder={view === 'up' ? 'Mot de passe (8 caractères min.)' : 'Mot de passe'} isNew={view === 'up'} />
            {error && <p className="error-text">{error}</p>}
            <button className="btn primary big" disabled={busy}>
              {busy ? 'Un instant…' : view === 'up' ? 'Créer le compte' : 'Se connecter'}
            </button>
            {view === 'in' && (
              <button type="button" className="link-btn muted center-text" onClick={() => go('forgot')}>
                Mot de passe oublié ?
              </button>
            )}
          </>
        )}

        {view === 'forgot' && (
          <>
            <p className="hint">Recevez un code par e-mail pour choisir un nouveau mot de passe.</p>
            {emailInput}
            {error && (
              <>
                <p className="error-text">{error}</p>
                <p className="hint">Connecté sur un autre appareil ? Changez-le là-bas : Compte → Changer le mot de passe.</p>
              </>
            )}
            <button className="btn primary big" disabled={busy}>
              {busy ? 'Envoi…' : 'Recevoir un code'}
            </button>
            <BackLink onClick={() => go('in')} />
          </>
        )}

        {view === 'code' && (
          <>
            <p className="hint">Code envoyé à {email.trim()}. Pensez aux spams.</p>
            <input className="code-input" inputMode="numeric" autoComplete="one-time-code" placeholder="Code" maxLength={10} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            <PasswordInput value={password} onChange={setPassword} placeholder="Nouveau mot de passe" isNew />
            {error && <p className="error-text">{error}</p>}
            <button className="btn primary big" disabled={busy}>
              {busy ? 'Un instant…' : 'Changer le mot de passe'}
            </button>
            <button type="button" className="link-btn muted center-text" disabled={busy} onClick={() => run(() => sendResetCode(email.trim()).then(() => notify('Nouveau code envoyé')))}>
              Renvoyer le code
            </button>
          </>
        )}
      </form>
    </Modal>
  );
}

function BackLink({ onClick, children = 'Retour' }: { onClick: () => void; children?: ReactNode }) {
  return (
    <button type="button" className="link-btn muted center-text" onClick={onClick}>
      {children}
    </button>
  );
}

/* ------------------------------- signed in ------------------------------ */

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

type AccountView = 'main' | 'password' | 'delete' | 'delete-confirm';

function AccountDialog({ onClose }: { onClose: () => void }) {
  const { email, status, lastSync, error: syncError } = useCloud();
  const [view, setView] = useState<AccountView>('main');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const { busy, error, setError, run } = useAction();
  const go = (v: AccountView) => (setView(v), setError(''), setPassword(''), setPassword2(''));

  if (view === 'password') {
    return (
      <Modal title="Changer le mot de passe" onClose={onClose} width={400}>
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (password.length < 8) return setError('Mot de passe : 8 caractères minimum.');
            if (password !== password2) return setError('Les deux mots de passe sont différents.');
            run(async () => {
              await changePassword(password);
              notify('Mot de passe changé');
              go('main');
            });
          }}
        >
          <PasswordInput value={password} onChange={setPassword} placeholder="Nouveau mot de passe" isNew />
          <PasswordInput value={password2} onChange={setPassword2} placeholder="Encore une fois" isNew />
          {error && <p className="error-text">{error}</p>}
          <button className="btn primary big" disabled={busy}>
            {busy ? 'Un instant…' : 'Enregistrer'}
          </button>
          <BackLink onClick={() => go('main')} />
        </form>
      </Modal>
    );
  }

  if (view === 'delete') {
    return (
      <Modal title="Supprimer le compte ?" onClose={onClose} width={400}>
        <div className="account-form">
          <div className="account-warning">
            <Icon name="warning" size={20} />
            <p>
              Le compte <b>{email}</b> et tout ce qu’il contient en ligne (chorégraphies, équipes, musiques) seront effacés. C’est définitif.
            </p>
          </div>
          <p className="hint">Les chorégraphies déjà présentes sur cet appareil y restent.</p>
          <button className="btn danger-solid big" onClick={() => go('delete-confirm')}>
            Continuer
          </button>
          <BackLink onClick={() => go('main')}>Annuler</BackLink>
        </div>
      </Modal>
    );
  }

  if (view === 'delete-confirm') {
    return (
      <Modal title="Dernière confirmation" onClose={onClose} width={400}>
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!password) return setError('Entrez votre mot de passe.');
            run(async () => {
              await deleteAccount(password);
              notify('Compte supprimé');
              onClose();
            });
          }}
        >
          <p className="hint">Entrez votre mot de passe pour supprimer définitivement le compte.</p>
          <PasswordInput value={password} onChange={setPassword} placeholder="Mot de passe" />
          {error && <p className="error-text">{error}</p>}
          <button className="btn danger-solid big" disabled={busy || !password}>
            {busy ? 'Suppression…' : 'Supprimer définitivement'}
          </button>
          <BackLink onClick={() => go('main')}>Annuler</BackLink>
        </form>
      </Modal>
    );
  }

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
      {syncError && <p className="error-text">{syncError}</p>}
      <div className="account-actions">
        <button className="btn" disabled={status === 'syncing'} onClick={() => void syncNow()}>
          <Icon name="cloud" size={16} /> Synchroniser
        </button>
        <button
          className="btn"
          onClick={async () => {
            await signOut();
            notify('Déconnecté');
            onClose();
          }}
        >
          Se déconnecter
        </button>
      </div>
      <div className="more-group account-more">
        <button className="more-row" onClick={() => go('password')}>
          <Icon name="lock" size={18} />
          <span className="grow">Changer le mot de passe</span>
          <Icon name="chevronRight" size={16} className="muted-icon" />
        </button>
        <button className="more-row danger-row" onClick={() => go('delete')}>
          <Icon name="trash" size={18} />
          <span className="grow">Supprimer le compte</span>
          <Icon name="chevronRight" size={16} className="muted-icon" />
        </button>
      </div>
      <p className="hint">Tout reste aussi enregistré sur cet appareil.</p>
    </Modal>
  );
}
