import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './lib/install';
import { IS_ANDROID_APP, IS_NATIVE_APP } from './lib/platform';
import { useEditor } from './store/editor';
import './styles.css';

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
if (import.meta.env.PROD && !IS_NATIVE_APP && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
