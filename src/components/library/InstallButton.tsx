import { useEffect, useReducer, useState } from 'react';
import { canPromptInstall, detectPlatform, isStandalone, onInstallChange, promptInstall, type Platform } from '../../lib/install';
import { DOWNLOADS, IS_NATIVE_APP, openExternal } from '../../lib/platform';
import { Icon } from '../common/Icon';
import { Modal } from '../common/ui';

const STEPS: Record<Platform, { title: string; steps: string[] }> = {
  'mac-safari': {
    title: 'Sur Mac avec Safari',
    steps: ['Ouvrez le menu « Fichier » en haut de l’écran.', 'Choisissez « Ajouter au Dock… » puis « Ajouter ».', 'Formation Studio apparaît dans le Dock et le Launchpad, comme une app normale.'],
  },
  'mac-chrome': {
    title: 'Sur Mac avec Chrome ou Edge',
    steps: ['Cliquez sur l’icône d’installation à droite de la barre d’adresse (un écran avec une flèche).', 'Ou menu ⋮ → « Caster, enregistrer et partager » → « Installer la page en tant qu’application ».', 'L’app s’ouvre dans sa propre fenêtre et se retrouve dans le dossier Applications.'],
  },
  android: {
    title: 'Sur Android avec Chrome',
    steps: ['Touchez le menu ⋮ en haut à droite.', 'Choisissez « Installer l’application » (ou « Ajouter à l’écran d’accueil »).', 'L’icône Formation Studio apparaît avec vos autres apps.'],
  },
  ios: {
    title: 'Sur iPhone / iPad avec Safari',
    steps: ['Touchez le bouton Partager (carré avec une flèche).', 'Choisissez « Sur l’écran d’accueil ».', 'Touchez « Ajouter ».'],
  },
  firefox: {
    title: 'Firefox ne sait pas installer les apps web',
    steps: ['Ouvrez ce même lien dans Safari ou Chrome.', 'Puis suivez les instructions d’installation affichées ici.'],
  },
  other: {
    title: 'Installer l’application',
    steps: ['Dans Chrome ou Edge : icône d’installation dans la barre d’adresse, ou menu ⋮ → « Installer ».', 'Dans Safari (Mac) : menu Fichier → « Ajouter au Dock ».'],
  },
};

const APPS: { id: string; icon: 'stage' | 'window' | 'hand'; title: string; detail: string; url: string; first: string }[] = [
  { id: 'mac-arm', icon: 'stage', title: 'Mac (Apple M1, M2, M3, M4…)', detail: 'Fichier .dmg', url: DOWNLOADS.macArm, first: 'Glissez l’app dans Applications. Au premier lancement : Réglages Système → Confidentialité et sécurité → « Ouvrir quand même ».' },
  { id: 'mac-intel', icon: 'stage', title: 'Mac (processeur Intel)', detail: 'Fichier .dmg', url: DOWNLOADS.macIntel, first: 'Même installation que ci-dessus.' },
  { id: 'windows', icon: 'window', title: 'Windows 10 / 11', detail: 'Installeur .exe', url: DOWNLOADS.windows, first: 'Si Windows affiche « Windows a protégé votre ordinateur » : « Informations complémentaires » → « Exécuter quand même ».' },
  { id: 'android', icon: 'hand', title: 'Android', detail: 'Fichier .apk', url: DOWNLOADS.android, first: 'Ouvrez le fichier téléchargé et autorisez l’installation depuis cette source si Android le demande.' },
];

export function InstallButton() {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [help, setHelp] = useState(false);
  useEffect(() => onInstallChange(rerender), []);

  if (IS_NATIVE_APP || isStandalone()) return null;
  const platform = detectPlatform();
  const info = STEPS[platform];
  const suggested = platform === 'android' ? 'android' : /Windows/.test(navigator.userAgent) ? 'windows' : platform.startsWith('mac') ? 'mac-arm' : null;

  return (
    <>
      <button className="btn install-btn" onClick={() => setHelp(true)} title="Installer Formation Studio sur cet appareil">
        <Icon name="download" /> <span className="hide-sm">Installer l’app</span>
      </button>
      {help && (
        <Modal title="Installer Formation Studio" onClose={() => setHelp(false)} width={620}>
          <div className="install-section">
            <b>Application à télécharger</b>
            <p className="hint">Une vraie app qui s’ouvre dans sa propre fenêtre et fonctionne sans internet.</p>
            <div className="download-grid">
              {APPS.map((a) => (
                <button key={a.id} className={`download-card ${suggested === a.id ? 'suggested' : ''}`} onClick={() => openExternal(a.url)} title={a.first}>
                  <Icon name={a.icon} size={20} />
                  <span>
                    <b>{a.title}</b>
                    <small>
                      {a.detail}
                      {suggested === a.id ? ' · conseillé pour cet appareil' : ''}
                    </small>
                  </span>
                  <Icon name="download" size={16} />
                </button>
              ))}
            </div>
            <details className="install-details">
              <summary>Premier lancement : que faire si un avertissement s’affiche ?</summary>
              <ul>
                {APPS.filter((a) => a.id !== 'mac-intel').map((a) => (
                  <li key={a.id}>
                    <b>{a.title.split(' (')[0]} :</b> {a.first}
                  </li>
                ))}
              </ul>
              <p className="hint">Ces avertissements apparaissent pour les apps distribuées hors des stores. Ils ne concernent que la première ouverture.</p>
            </details>
          </div>

          <div className="install-section">
            <b>{platform === 'ios' ? 'iPhone / iPad' : 'Ou sans rien télécharger'}</b>
            <p className="hint">
              {platform === 'ios'
                ? 'Sur iPhone, l’app s’installe depuis Safari : elle reste fixe, plein écran et fonctionne hors ligne.'
                : 'Ajoutez simplement ce site comme une app depuis le navigateur.'}
            </p>
            {canPromptInstall() ? (
              <button className="btn primary" onClick={() => promptInstall()}>
                <Icon name="download" /> Installer depuis le navigateur
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
          </div>
          <p className="hint">
            Vos chorégraphies sont enregistrées sur chaque appareil. Pour passer de l’un à l’autre : « Données → Sauvegarder toute la bibliothèque », puis « Importer » sur le nouvel appareil.
          </p>
        </Modal>
      )}
    </>
  );
}
