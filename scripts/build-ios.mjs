// Prepares the iPhone app and opens it in Xcode.
//   npm run build:ios            → build + open Xcode (plug the iPhone in, choose your team, press ▶)
//   npm run build:ios -- --check → build + compile without signing (no iPhone needed)
// Without a paid Apple Developer account, an app installed from Xcode works for 7 days, then must be reinstalled.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const env = { ...process.env, VITE_COLLAB: 'off' };
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: 'inherit', env });
const check = process.argv.includes('--check');

console.log(`\n▶ Formation Studio ${pkg.version} — application web`);
run('npx tsc --noEmit');
run('npx vite build');

console.log('\n▶ Projet iPhone');
run('node node_modules/@capacitor/cli/bin/capacitor sync ios');

const [major, minor, patch] = pkg.version.split('.').map(Number);
const build = major * 10000 + minor * 100 + patch;
run(`xcrun agvtool new-marketing-version ${pkg.version} >/dev/null && xcrun agvtool new-version -all ${build} >/dev/null`, join(root, 'ios/App'));

if (check) {
  console.log('\n▶ Compilation (sans signature)');
  run('xcodebuild -project App.xcodeproj -scheme App -configuration Release -sdk iphoneos -destination "generic/platform=iOS" CODE_SIGNING_ALLOWED=NO -quiet build', join(root, 'ios/App'));
  console.log('  ✓ L’app iPhone compile');
} else {
  run('open ios/App/App.xcodeproj');
  console.log('\n  Xcode : branchez l’iPhone, onglet « Signing & Capabilities » → Team = votre identifiant Apple, puis ▶');
}
