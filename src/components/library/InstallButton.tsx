import { useEffect, useReducer, useState } from 'react';
import { canPromptInstall, detectPlatform, isStandalone, onInstallChange, promptInstall, type Platform } from '../../lib/install';
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

export function InstallButton() {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [help, setHelp] = useState(false);
  useEffect(() => onInstallChange(rerender), []);

  if (isStandalone()) return null;
  const platform = detectPlatform();
  const info = STEPS[platform];

  return (
    <>
      <button
        className="btn install-btn"
        onClick={async () => {
          if (canPromptInstall()) await promptInstall();
          else setHelp(true);
        }}
        title="Installer Formation Studio sur cet appareil"
      >
        <Icon name="download" /> <span className="hide-sm">Installer l’app</span>
      </button>
      {help && (
        <Modal title="Installer Formation Studio" onClose={() => setHelp(false)}>
          <p className="hint">Une fois installée, l’app s’ouvre dans sa propre fenêtre et fonctionne sans connexion internet.</p>
          <div className="install-steps">
            <b>{info.title}</b>
            <ol>
              {info.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>
          <p className="hint">
            Vos chorégraphies sont enregistrées sur cet appareil. Pensez à utiliser « Données → Sauvegarder la bibliothèque » de temps en temps, et pour les transférer vers un autre appareil.
          </p>
        </Modal>
      )}
    </>
  );
}
