import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.API_URL || 'http://localhost:8787';
const VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string;

/** Stamps the service worker with a build id and the list of files to precache for offline use. */
function serviceWorker(): Plugin {
  return {
    name: 'formation-studio-sw',
    apply: 'build',
    closeBundle() {
      const dist = fileURLToPath(new URL('./dist/', import.meta.url));
      const assets = readdirSync(`${dist}assets`).map((f) => `assets/${f}`);
      const sw = readFileSync(`${dist}sw.js`, 'utf8')
        .replace('__BUILD__', Date.now().toString(36))
        .replace('"__PRECACHE__"', JSON.stringify(assets));
      writeFileSync(`${dist}sw.js`, sw);
    },
  };
}

export default defineConfig({
  // relative base so the build works at any path (GitHub Pages serves under /<repo>/)
  base: './',
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  plugins: [react(), serviceWorker()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': API,
      '/ws': { target: API.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 1200,
  },
});
