import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'library'; tab: 'choreos' | 'teams' | 'discover' | 'guide'; create?: boolean }
  | { name: 'editor'; id: string }
  | { name: 'join'; room: string; key: string }
  | { name: 'print'; id: string };

export function parseRoute(hash: string): Route {
  const parts = hash
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
  switch (parts[0]) {
    case 'c':
      if (parts[1]) return { name: 'editor', id: parts[1] };
      break;
    case 'join':
      if (parts[1] && parts[2]) return { name: 'join', room: parts[1], key: parts[2] };
      break;
    case 'print':
      if (parts[1]) return { name: 'print', id: parts[1] };
      break;
    case 'teams':
      return { name: 'library', tab: 'teams' };
    case 'discover':
      return { name: 'library', tab: 'discover' };
    case 'guide':
      return { name: 'library', tab: 'guide' };
    case 'new':
      return { name: 'library', tab: 'choreos', create: true };
  }
  return { name: 'library', tab: 'choreos' };
}

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export function useHash() {
  return useSyncExternalStore(subscribe, () => location.hash);
}

export const navigate = (path: string) => {
  location.hash = path;
};
