import { IS_NATIVE_APP } from './platform';

// Lineup moved from /formation-studio/ to /lineup/ when the repository was renamed. The old address still serves
// the same build, so nothing kept there is out of reach.
export const AT_OLD_ADDRESS = !IS_NATIVE_APP && location.pathname.startsWith('/formation-studio/');
export const NEW_ADDRESS = `${location.origin}/lineup/`;

/** Home-screen / Dock web app: its data may be kept apart from the browser's (iPhone, Safari on Mac). */
export const IS_INSTALLED_WEB_APP =
  (navigator as unknown as { standalone?: boolean }).standalone === true ||
  (typeof matchMedia === 'function' && ['standalone', 'fullscreen', 'minimal-ui'].some((m) => matchMedia(`(display-mode: ${m})`).matches));

/** A browser tab shares its data with the new address: it simply goes there. */
export const LEAVING = AT_OLD_ADDRESS && !IS_INSTALLED_WEB_APP;
if (LEAVING) location.replace(NEW_ADDRESS + location.search + location.hash);
