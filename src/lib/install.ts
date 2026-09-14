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

export type Platform = 'mac-safari' | 'mac-chrome' | 'android' | 'ios' | 'firefox' | 'in-app' | 'arc' | 'other';

/** The small browser inside WhatsApp, Instagram, Messenger, TikTok…: it cannot install anything. */
export function isInAppBrowser() {
  const ua = navigator.userAgent;
  return /FBAN|FBAV|Instagram|Messenger|TikTok|Snapchat|Line\/|WhatsApp|; wv\)/.test(ua) || (/iPhone|iPad/.test(ua) && !/Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua));
}

/** Arc looks like Chrome but has no "install" button; it paints its theme colors into the page. */
export function isArc() {
  try {
    return !!getComputedStyle(document.documentElement).getPropertyValue('--arc-palette-title').trim();
  } catch {
    return false;
  }
}

export function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  const touchMac = ua.includes('Macintosh') && navigator.maxTouchPoints > 1;
  if (isInAppBrowser()) return 'in-app';
  if (/iPhone|iPad|iPod/.test(ua) || touchMac) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (isArc()) return 'arc';
  if (ua.includes('Macintosh')) return /Chrome|Chromium|Edg\//.test(ua) ? 'mac-chrome' : 'mac-safari';
  return 'other';
}

/** Terminal line that installs the latest Mac app without the "downloaded from the internet" block. */
export function macInstallCommand(intel: boolean) {
  const file = intel ? 'Lineup-mac-intel.dmg' : 'Lineup-mac-apple-silicon.dmg';
  return `curl -L -o /tmp/Lineup.dmg https://github.com/kiy0ni/formation-studio/releases/latest/download/${file} && hdiutil attach -nobrowse -mountpoint /tmp/lineup-dmg /tmp/Lineup.dmg && rm -rf /Applications/Lineup.app && ditto /tmp/lineup-dmg/Lineup.app /Applications/Lineup.app && hdiutil detach /tmp/lineup-dmg && open /Applications/Lineup.app`;
}
