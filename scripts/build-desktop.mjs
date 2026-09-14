// Builds the desktop apps into native/release/.
//   npm run build:desktop            → Mac (Apple Silicon + Intel) and Windows
//   npm run build:desktop -- --mac   → Mac only
//   npm run build:desktop -- --win   → Windows only
import { execSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const run = (cmd, env = {}) => execSync(cmd, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
const targets = process.argv.slice(2).filter((a) => a === '--mac' || a === '--win');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

console.log(`\n▶ Lineup ${pkg.version} — application web`);
run('npx tsc --noEmit');
run('npx vite build', { VITE_COLLAB: 'off' });

console.log('\n▶ Préparation de l’app de bureau');
const app = join(root, 'native/electron/app');
rmSync(join(app, 'web'), { recursive: true, force: true });
cpSync(join(root, 'dist'), join(app, 'web'), { recursive: true });
rmSync(join(app, 'web/sw.js'), { force: true });
writeFileSync(
  join(app, 'package.json'),
  JSON.stringify(
    { name: 'formation-studio', productName: 'Lineup', version: pkg.version, description: 'Chorégraphies K-pop synchronisées avec la musique', author: 'Lineup', main: 'main.js' },
    null,
    2,
  ) + '\n',
);

// icon sizes for the Windows .exe (see native/electron/after-pack.cjs)
const sizes = join(root, 'native/electron/icon-sizes');
mkdirSync(sizes, { recursive: true });
if (process.platform === 'darwin') for (const s of [16, 24, 32, 48, 64, 128, 256]) execSync(`sips -z ${s} ${s} native/icons/app-icon.png --out "${join(sizes, `icon-${s}.png`)}"`, { cwd: root, stdio: 'ignore' });

console.log('\n▶ Création des installeurs');
rmSync(join(root, 'native/electron/out'), { recursive: true, force: true });
run(`npx electron-builder --config native/electron/builder.cjs ${(targets.length ? targets : ['--mac', '--win']).join(' ')} --publish never`);

// stable names: the download links always point to these
const out = join(root, 'native/electron/out');
const release = join(root, 'native/release');
mkdirSync(release, { recursive: true });
const names = {
  'Lineup-mac-arm64.dmg': 'Lineup-mac-apple-silicon.dmg',
  'Lineup-mac-x64.dmg': 'Lineup-mac-intel.dmg',
  'Lineup-windows.exe': 'Lineup-windows.exe',
};
for (const [from, to] of Object.entries(names)) {
  if (existsSync(join(out, from))) {
    copyFileSync(join(out, from), join(release, to));
    console.log('  ✓', `native/release/${to}`);
  }
}
