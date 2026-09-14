// Runs the collaboration server and the Vite dev server together.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const procs = [
  spawn(process.execPath, ['--watch', join(root, 'server', 'index.js')], { stdio: 'inherit', cwd: root }),
  spawn(join(root, 'node_modules', '.bin', 'vite'), [], { stdio: 'inherit', cwd: root }),
];

const stop = () => {
  for (const p of procs) p.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => code && stop());
