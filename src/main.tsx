import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { startCloud } from './lib/cloud';
import './lib/install';
import { LEAVING } from './lib/moved';
import { IS_ANDROID_APP, IS_NATIVE_APP } from './lib/platform';
import { useEditor } from './store/editor';
import './styles.css';

// (an old-address tab is on its way to the new one)
if (!LEAVING)
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

// App-like behaviour on phones: the page itself never zooms (iOS ignores user-scalable=no).
// Pinch on the stage still works: the stage handles it itself.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener(
  'touchmove',
  (e) => {
    if (e.touches.length > 1) e.preventDefault();
  },
  { passive: false },
);

startCloud();

// iPhone home-screen app: the web view can stop above the home indicator. Then the bottom bars
// must not add the home-indicator margin on top of that (it lifted them), nor grow past the view (it cut them).
if ((navigator as unknown as { standalone?: boolean }).standalone === true) {
  const fit = () => {
    const portrait = matchMedia('(orientation: portrait)').matches;
    const screenHeight = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
    document.documentElement.classList.toggle('webview-short', screenHeight - window.innerHeight > 24);
  };
  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', () => setTimeout(fit, 300));
}

// ask the browser not to evict the offline library (IndexedDB) under storage pressure
navigator.storage?.persist?.().catch(() => {});

// Android app: the system back button closes what is open, then goes back, then leaves the app
if (IS_ANDROID_APP) {
  import('@capacitor/app').then(({ App: NativeApp }) =>
    NativeApp.addListener('backButton', () => {
      if (document.querySelector('.menu.floating, .popover.floating, .modal-backdrop, .tour')) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      } else if (useEditor.getState().doc && useEditor.getState().sheetOpen) {
        useEditor.setState({ sheetOpen: false });
      } else if (location.hash && !['#', '#/'].includes(location.hash)) {
        history.back();
      } else {
        NativeApp.exitApp();
      }
    }),
  );
}

// the installed apps ship their files: the offline service worker is only for the website
if (import.meta.env.PROD && !IS_NATIVE_APP && !LEAVING && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
  // a new version took over while this page was open: say so (its old files may be gone)
  const hadWorker = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadWorker) useEditor.getState().notify('Nouvelle version de Lineup : rechargez la page');
  });
}
// a lazy part of the app could not load (typically right after an update): a reload gets the new files
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault();
  location.reload();
});
