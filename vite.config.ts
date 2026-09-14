import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string;

/**
 * Content Security Policy of the published app (not in dev: Vite needs inline scripts and its own websocket).
 * Scripts and wasm only from the app itself; network only to the account service and GitHub (versions, downloads).
 */
function csp(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.github.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return {
    name: 'formation-studio-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
}

/** Stamps the service worker with a build id and the list of files to precache for offline use. */
function serviceWorker(): Plugin {
  return {
    name: 'formation-studio-sw',
    apply: 'build',
    closeBundle() {
      const dist = fileURLToPath(new URL('./dist/', import.meta.url));
      // the detection engine (tens of MB) is downloaded only by those who use it
      // only what the first screen needs; everything else is cached the first time it is used
      const assets = readdirSync(`${dist}assets`)
        .filter((f) => /^(index-|rolldown-runtime-)/.test(f) || f.endsWith('.css'))
        .map((f) => `assets/${f}`);
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
  plugins: [react(), csp(), serviceWorker()],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    chunkSizeWarningLimit: 1200,
  },
});
