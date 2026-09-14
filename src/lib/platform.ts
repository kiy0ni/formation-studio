import { Capacitor } from '@capacitor/core';

/** Desktop app (Mac / Windows) built with Electron. */
export const IS_ELECTRON = /Electron\//.test(navigator.userAgent);
/** Android app built with Capacitor. */
export const IS_ANDROID_APP = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
/** iPhone app built with Capacitor. */
export const IS_IOS_APP = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
/** Phone apps (Android, iPhone): files go through the share sheet, printing through the system service. */
export const IS_PHONE_APP = Capacitor.isNativePlatform();
export const IS_NATIVE_APP = IS_ELECTRON || Capacitor.isNativePlatform();
/** Phones apps have a single screen: no extra windows. */
export const CAN_OPEN_WINDOWS = !Capacitor.isNativePlatform();

export const APP_VERSION: string = __APP_VERSION__;

const REPO = 'kiy0ni/formation-studio';
export const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const asset = (name: string) => `https://github.com/${REPO}/releases/latest/download/${name}`;
export const DOWNLOADS = {
  macArm: asset('Lineup-mac-apple-silicon.dmg'),
  macIntel: asset('Lineup-mac-intel.dmg'),
  windows: asset('Lineup-windows.exe'),
  android: asset('Lineup-android.apk'),
};

/** Opens an app screen, in a separate window where the platform has windows. */
export function openRoute(path: string, newWindow: boolean) {
  if (newWindow && CAN_OPEN_WINDOWS) window.open(`#${path}`, '_blank');
  else location.hash = path;
}

/** Opens a web page in the system browser. */
export function openExternal(url: string) {
  if (Capacitor.isNativePlatform()) location.href = url;
  else window.open(url, '_blank', 'noopener');
}

/** Best download for the device this app runs on. */
export async function downloadForThisDevice(): Promise<string> {
  if (IS_ANDROID_APP || /Android/.test(navigator.userAgent)) return DOWNLOADS.android;
  if (/Windows/.test(navigator.userAgent)) return DOWNLOADS.windows;
  if (/Macintosh/.test(navigator.userAgent)) {
    const data = (navigator as unknown as { userAgentData?: { getHighEntropyValues: (h: string[]) => Promise<{ architecture?: string }> } }).userAgentData;
    const arch = await data?.getHighEntropyValues(['architecture']).then((v) => v.architecture).catch(() => undefined);
    if (arch === 'x86') return DOWNLOADS.macIntel;
    if (arch === 'arm') return DOWNLOADS.macArm;
  }
  return RELEASES_PAGE;
}

/** "1.2.0" > "1.1.9" */
export function isNewer(candidate: string, current: string) {
  const a = candidate.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}
