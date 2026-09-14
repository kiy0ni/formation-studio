// Publishes the files of native/release/ as the GitHub release v<version>.
// The download links of the app always point to the latest release, with these stable names.
//   npm run release
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const tag = `v${pkg.version}`;
const files = [
  'Lineup-mac-apple-silicon.dmg',
  'Lineup-mac-intel.dmg',
  'Lineup-windows.exe',
  'Lineup-android.apk',
]
  .map((f) => join(root, 'native/release', f))
  .filter((f) => existsSync(f));

if (!files.length) {
  console.error('✗ Rien à publier : lancez d’abord npm run build:desktop et npm run build:android');
  process.exit(1);
}

const notes = `## Installer Lineup ${pkg.version}

| Appareil | Fichier |
| --- | --- |
| Mac avec puce Apple (M1, M2, M3, M4…) | **Lineup-mac-apple-silicon.dmg** |
| Mac avec processeur Intel | **Lineup-mac-intel.dmg** |
| Windows 10 / 11 | **Lineup-windows.exe** |
| Android | **Lineup-android.apk** |
| iPhone / iPad | Ouvrez https://kiy0ni.github.io/lineup/ dans Safari → Partager → « Sur l’écran d’accueil » |

### Premier lancement
- **Mac** : ouvrez le .dmg et glissez Lineup dans Applications. Au premier lancement, si macOS bloque l’app : Réglages Système → Confidentialité et sécurité → « Ouvrir quand même ».
- **Windows** : si « Windows a protégé votre ordinateur » s’affiche : « Informations complémentaires » → « Exécuter quand même ».
- **Android** : ouvrez le fichier téléchargé et autorisez l’installation depuis cette source si Android le demande.

Ces avertissements viennent du fait que l’app est distribuée hors des stores ; ils n’apparaissent qu’une fois.

**Compte** : icône profil dans la bibliothèque → Créer un compte. Connectez-vous avec le même compte sur chaque appareil (Mac, Windows, Android, iPhone) : tout se synchronise, musiques comprises.`;

const gh = (args) => execFileSync('gh', args, { cwd: root, stdio: 'inherit' });

// apps installed before the rename (≤ 1.3) download the old file names: publish copies under those names too
const legacyDir = mkdtempSync(join(tmpdir(), 'lineup-legacy-'));
const legacy = files.map((f) => {
  const copy = join(legacyDir, basename(f).replace(/^Lineup-/, 'Formation-Studio-'));
  copyFileSync(f, copy);
  return copy;
});
files.push(...legacy);
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
  gh(['release', 'create', tag, ...files, '--title', `Lineup ${pkg.version}`, '--notes', notes, '--latest']);
}
console.log(`✓ https://github.com/kiy0ni/lineup/releases/tag/${tag}`);
