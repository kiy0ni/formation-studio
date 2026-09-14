import { useEffect, useReducer, useState } from 'react';
import { canPromptInstall, detectPlatform, isStandalone, macInstallCommand, onInstallChange, promptInstall, type Platform } from '../../lib/install';
import { SITE_URL } from './ShareAppDialog';
import { notify } from '../common/Toast';
import { DOWNLOADS, IS_NATIVE_APP, openExternal } from '../../lib/platform';
import { Icon } from '../common/Icon';
import { Modal } from '../common/ui';

const STEPS: Record<Platform, { title: string; steps: string[] }> = {
  ios: {
    title: 'iPhone / iPad (Safari)',
    steps: ['Touchez Partager (carré avec une flèche).', 'Touchez « Sur l’écran d’accueil ».', 'Touchez « Ajouter ».'],
  },
  android: {
    title: 'Android (Chrome)',
    steps: ['Touchez ⋮ en haut à droite.', 'Touchez « Installer l’application ».'],
  },
  'mac-safari': {
    title: 'Mac (Safari)',
    steps: ['Menu « Fichier » → « Ajouter au Dock… ».', 'Cliquez « Ajouter ».'],
  },
  'mac-chrome': {
    title: 'Mac (Chrome ou Edge)',
    steps: ['Cliquez l’icône « Installer » à droite de la barre d’adresse.', 'Ou menu ⋮ → « Installer Lineup ».'],
  },
  firefox: {
    title: 'Firefox ne sait pas installer les apps',
    steps: ['Ouvrez ce lien dans Safari, Chrome ou Edge.'],
  },
  'in-app': {
    title: 'Vous êtes dans le navigateur d’une autre app',
    steps: ['Ce navigateur (WhatsApp, Instagram, Messenger…) ne sait pas installer.', 'Touchez ⋯ ou Partager → « Ouvrir dans Safari » (ou Chrome), ou copiez le lien ci-dessous et collez-le dans votre navigateur.'],
  },
  arc: {
    title: 'Arc ne sait pas installer les apps',
    steps: ['Ouvrez ce lien dans Safari (Fichier → « Ajouter au Dock ») ou dans Chrome.', 'Ou téléchargez l’app Mac ci-dessous.'],
  },
  other: {
    title: 'Chrome ou Edge',
    steps: ['Cliquez l’icône « Installer » à droite de la barre d’adresse.', 'Ou menu ⋮ → « Installer Lineup ».'],
  },
};

const MAC_FIRST = 'macOS bloque l’app la première fois : ouvrez-la, cliquez « Terminé », puis Réglages Système → Confidentialité et sécurité → « Ouvrir quand même ».';
const APPS: { id: string; icon: 'stage' | 'window' | 'hand'; title: string; url: string; first: string; mac?: 'arm' | 'intel' }[] = [
  { id: 'mac-arm', icon: 'stage', title: 'Mac (puce Apple)', url: DOWNLOADS.macArm, first: MAC_FIRST, mac: 'arm' },
  { id: 'mac-intel', icon: 'stage', title: 'Mac (Intel)', url: DOWNLOADS.macIntel, first: MAC_FIRST, mac: 'intel' },
  { id: 'windows', icon: 'window', title: 'Windows', url: DOWNLOADS.windows, first: 'Windows affiche « Windows a protégé votre ordinateur » : « Informations complémentaires » → « Exécuter quand même ».' },
  { id: 'android', icon: 'hand', title: 'Android (.apk)', url: DOWNLOADS.android, first: 'Ouvrez le fichier téléchargé et autorisez l’installation depuis cette source.' },
];

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    notify(done);
  } catch {
    notify('Copie impossible');
  }
}

export function InstallButton() {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [help, setHelp] = useState(false);
  useEffect(() => onInstallChange(rerender), []);

  if (IS_NATIVE_APP || isStandalone()) return null;
  const platform = detectPlatform();
  const info = STEPS[platform];

  return (
    <>
      <button className="btn install-btn" onClick={() => setHelp(true)} title="Installer Lineup sur cet appareil">
        <Icon name="download" /> <span className="hide-sm">Installer l’app</span>
      </button>
      {help && (
        <Modal title="Installer Lineup" onClose={() => setHelp(false)} width={440}>
          <div className="install-simple">
            <p className="hint">Gratuit, sans store. Marche hors ligne et se met à jour toute seule.</p>
            {canPromptInstall() ? (
              <button className="btn primary big" onClick={() => promptInstall().then((ok) => ok && setHelp(false))}>
                <Icon name="download" /> Installer
              </button>
            ) : (
              <div className="install-steps">
                <b>{info.title}</b>
                <ol>
                  {info.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
                {platform === 'in-app' && (
                  <button className="btn small" onClick={() => copy(SITE_URL, 'Lien copié · collez-le dans Safari ou Chrome')}>
                    <Icon name="copy" size={14} /> Copier le lien
                  </button>
                )}
              </div>
            )}
            <p className="hint">Même compte sur chaque appareil = mêmes chorégraphies partout.</p>
            <details className="install-details">
              <summary>Autres options : apps à télécharger</summary>
              <div className="download-grid">
                {APPS.map((a) => (
                  <div key={a.id} className="download-item">
                    <button className="download-card" onClick={() => openExternal(a.url)}>
                      <Icon name={a.icon} size={20} />
                      <span>
                        <b>{a.title}</b>
                        <small>{a.first}</small>
                      </span>
                      <Icon name="download" size={16} />
                    </button>
                    {a.mac && (
                      <button className="btn small ghost" onClick={() => copy(macInstallCommand(a.mac === 'intel'), 'Commande copiée · collez-la dans le Terminal')}>
                        <Icon name="copy" size={14} /> Sans alerte : copier la commande Terminal
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <p className="hint">Les apps ne sont pas signées par Apple ni Microsoft (payant) : l’alerte au premier lancement est normale, l’app est la même que le site.</p>
            </details>
          </div>
        </Modal>
      )}
    </>
  );
}
