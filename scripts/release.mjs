// Publishes the files of native/release/ as the GitHub release v<version>.
// The download links of the app always point to the latest release, with these stable names.
//   npm run release
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const tag = `v${pkg.version}`;
const files = [
  'Formation-Studio-mac-apple-silicon.dmg',
  'Formation-Studio-mac-intel.dmg',
  'Formation-Studio-windows.exe',
  'Formation-Studio-android.apk',
]
  .map((f) => join(root, 'native/release', f))
  .filter((f) => existsSync(f));

if (!files.length) {
  console.error('✗ Rien à publier : lancez d’abord npm run build:desktop et npm run build:android');
  process.exit(1);
}

const notes = `## Installer Formation Studio ${pkg.version}

| Appareil | Fichier |
| --- | --- |
| Mac avec puce Apple (M1, M2, M3, M4…) | **Formation-Studio-mac-apple-silicon.dmg** |
| Mac avec processeur Intel | **Formation-Studio-mac-intel.dmg** |
| Windows 10 / 11 | **Formation-Studio-windows.exe** |
| Android | **Formation-Studio-android.apk** |
| iPhone / iPad | Ouvrez https://kiy0ni.github.io/formation-studio/ dans Safari → Partager → « Sur l’écran d’accueil » |

### Premier lancement
- **Mac** : ouvrez le .dmg et glissez Formation Studio dans Applications. Au premier lancement, si macOS bloque l’app : Réglages Système → Confidentialité et sécurité → « Ouvrir quand même ».
- **Windows** : si « Windows a protégé votre ordinateur » s’affiche : « Informations complémentaires » → « Exécuter quand même ».
- **Android** : ouvrez le fichier téléchargé et autorisez l’installation depuis cette source si Android le demande.

Ces avertissements viennent du fait que l’app est distribuée hors des stores ; ils n’apparaissent qu’une fois.

**Compte** : icône profil dans la bibliothèque → Créer un compte. Connectez-vous avec le même compte sur chaque appareil (Mac, Windows, Android, iPhone) : tout se synchronise, musiques comprises.`;

const gh = (args) => execFileSync('gh', args, { cwd: root, stdio: 'inherit' });
let exists = true;
try {
  execFileSync('gh', ['release', 'view', tag], { cwd: root, stdio: 'ignore' });
} catch {
  exists = false;
}
if (exists) {
  gh(['release', 'upload', tag, ...files, '--clobber']);
  gh(['release', 'edit', tag, '--notes', notes, '--latest']);
} else {
  gh(['release', 'create', tag, ...files, '--title', `Formation Studio ${pkg.version}`, '--notes', notes, '--latest']);
}
console.log(`✓ https://github.com/kiy0ni/formation-studio/releases/tag/${tag}`);
