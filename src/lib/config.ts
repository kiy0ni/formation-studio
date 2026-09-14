/** Real-time collaboration needs the Node server; static builds (GitHub Pages) set VITE_COLLAB=off. */
export const COLLAB_ENABLED = import.meta.env.VITE_COLLAB !== 'off';
