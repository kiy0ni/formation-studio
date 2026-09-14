import { useEffect, useReducer, useState } from 'react';
import { canPromptInstall, detectPlatform, isStandalone, onInstallChange, promptInstall, type Platform } from '../../lib/install';
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
  other: {
    title: 'Chrome ou Edge',
    steps: ['Cliquez l’icône « Installer » à droite de la barre d’adresse.', 'Ou menu ⋮ → « Installer Lineup ».'],
  },
};

const APPS: { id: string; icon: 'stage' | 'window' | 'hand'; title: string; url: string; first: string }[] = [
  { id: 'mac-arm', icon: 'stage', title: 'Mac (puce Apple)', url: DOWNLOADS.macArm, first: 'Réglages Système → Confidentialité et sécurité → « Ouvrir quand même ».' },
  { id: 'mac-intel', icon: 'stage', title: 'Mac (Intel)', url: DOWNLOADS.macIntel, first: 'Réglages Système → Confidentialité et sécurité → « Ouvrir quand même ».' },
  { id: 'windows', icon: 'window', title: 'Windows', url: DOWNLOADS.windows, first: '« Informations complémentaires » → « Exécuter quand même ».' },
  { id: 'android', icon: 'hand', title: 'Android (.apk)', url: DOWNLOADS.android, first: 'Autorisez l’installation depuis cette source.' },
];

export function InstallButton() {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [help, setHelp] = useState(false);
  useEffect(() => onInstallChange(rerender), []);

  if (IS_NATIVE_APP || isStandalone()) return null;
  const info = STEPS[detectPlatform()];

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
              </div>
            )}
            <p className="hint">Même compte sur chaque appareil = mêmes chorégraphies partout.</p>
            <details className="install-details">
              <summary>Autres options : apps à télécharger</summary>
              <div className="download-grid">
                {APPS.map((a) => (
                  <button key={a.id} className="download-card" onClick={() => openExternal(a.url)} title={a.first}>
                    <Icon name={a.icon} size={20} />
                    <span>
                      <b>{a.title}</b>
                      <small>Premier lancement : {a.first}</small>
                    </span>
                    <Icon name="download" size={16} />
                  </button>
                ))}
              </div>
            </details>
          </div>
        </Modal>
      )}
    </>
  );
}
