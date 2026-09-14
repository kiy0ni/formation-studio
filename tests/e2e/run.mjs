// Builds the app, serves it on http://127.0.0.1:8811/lineup/ and runs the browser tests in tests/e2e/.
// Needs Chromium (playwright-core): CHROME=/path/to/chrome, or `npx playwright-core install chromium`.
//   npm run test:e2e              → all
//   npm run test:e2e -- panels    → only tests whose name contains "panels"
import { execSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const here = join(root, 'tests', 'e2e');
const filter = process.argv[2] ?? '';
const scratch = mkdtempSync(join(tmpdir(), 'lineup-e2e-'));

execSync('npx vite build', { cwd: root, stdio: 'inherit' });
cpSync(join(root, 'dist'), join(scratch, 'srv', 'lineup'), { recursive: true });
const server = spawn('python3', ['-m', 'http.server', '8811', '--bind', '127.0.0.1'], { cwd: join(scratch, 'srv'), stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

let failed = 0;
try {
  for (const file of readdirSync(here).filter((f) => f.endsWith('.test.mjs') && f.includes(filter))) {
    console.log(`\n=== ${file}`);
    try {
      execSync(`node ${join(here, file)}`, { cwd: root, stdio: 'inherit', env: { ...process.env, SP: scratch, OUT: scratch } });
    } catch {
      failed++;
    }
  }
} finally {
  server.kill();
  if (!process.env.KEEP) rmSync(scratch, { recursive: true, force: true });
  else console.log('screenshots in', scratch);
}
if (failed) {
  console.error(`\n✗ ${failed} test file(s) failed`);
  process.exit(1);
}
