// Captures the browser's install prompt as early as possible (imported from main.tsx).

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as InstallPromptEvent;
  emit();
});

window.addEventListener('appinstalled', () => {
  deferred = null;
  emit();
});

export const onInstallChange = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export const canPromptInstall = () => !!deferred;

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  emit();
  return outcome === 'accepted';
}

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

export type Platform = 'mac-safari' | 'mac-chrome' | 'android' | 'ios' | 'firefox' | 'other';

export function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  const touchMac = ua.includes('Macintosh') && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || touchMac) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (ua.includes('Macintosh')) return /Chrome|Chromium|Edg\//.test(ua) ? 'mac-chrome' : 'mac-safari';
  return 'other';
}
