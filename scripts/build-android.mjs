// Builds the Android app into native/release/Formation-Studio-android.apk
//   npm run build:android
// Needs the Android SDK (ANDROID_HOME) and the signing key described in README (never committed).
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const env = {
  ...process.env,
  ANDROID_HOME: process.env.ANDROID_HOME || '/opt/homebrew/share/android-commandlinetools',
  VITE_COLLAB: 'off',
};
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: 'inherit', env });

const signing = process.env.FS_ANDROID_SIGNING || join(homedir(), '.formation-studio', 'android-signing.properties');
if (!existsSync(signing)) {
  console.error(`\n✗ Clé de signature Android introuvable : ${signing}\n  Voir README → « Applications à télécharger ».`);
  process.exit(1);
}

console.log(`\n▶ Formation Studio ${pkg.version} — application web`);
run('npx tsc --noEmit');
run('npx vite build');

console.log('\n▶ Projet Android');
const cap = 'node node_modules/@capacitor/cli/bin/capacitor';
if (!existsSync(join(root, 'android'))) run(`${cap} add android`);
run(`${cap} sync android`);

console.log('\n▶ Création de l’APK');
const [major, minor, patch] = pkg.version.split('.').map(Number);
const versionCode = major * 10000 + minor * 100 + patch;
run(`./gradlew assembleRelease --console=plain -PfsVersionName=${pkg.version} -PfsVersionCode=${versionCode} "-PfsSigning=${signing}"`, join(root, 'android'));

const apk = join(root, 'android/app/build/outputs/apk/release/app-release.apk');
mkdirSync(join(root, 'native/release'), { recursive: true });
copyFileSync(apk, join(root, 'native/release/Formation-Studio-android.apk'));
console.log('  ✓ native/release/Formation-Studio-android.apk');
