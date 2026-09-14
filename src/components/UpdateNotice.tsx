import { useEffect, useState } from 'react';
import { APP_VERSION, downloadForThisDevice, IS_NATIVE_APP, isNewer, openExternal } from '../lib/platform';
import { Icon } from './common/Icon';

const CHECK_EVERY = 6 * 3600 * 1000;

/** Installed apps (Mac, Windows, Android) don't update themselves: tell when a new version is out. */
export function UpdateNotice() {
  const [latest, setLatest] = useState<string | null>(null);

  useEffect(() => {
    if (!IS_NATIVE_APP) return;
    const show = (v: string) => {
      if (isNewer(v, APP_VERSION) && localStorage.getItem('fs-update-dismissed') !== v) setLatest(v);
    };
    const cached = localStorage.getItem('fs-update-latest');
    if (cached) show(cached);
    if (Date.now() - Number(localStorage.getItem('fs-update-check') || 0) < CHECK_EVERY) return;
    fetch('https://api.github.com/repos/kiy0ni/formation-studio/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((release) => {
        const v = typeof release?.tag_name === 'string' ? release.tag_name.replace(/^v/, '') : null;
        if (!v) return;
        localStorage.setItem('fs-update-check', String(Date.now()));
        localStorage.setItem('fs-update-latest', v);
        show(v);
      })
      .catch(() => {
        /* offline */
      });
  }, []);

  if (!latest) return null;
  return (
    <div className="update-notice" role="status">
      <Icon name="download" size={16} />
      <span>
        Nouvelle version <b>{latest}</b> disponible
      </span>
      <button className="btn small primary" onClick={async () => openExternal(await downloadForThisDevice())}>
        Télécharger
      </button>
      <button
        className="icon-btn tiny"
        aria-label="Plus tard"
        title="Plus tard"
        onClick={() => {
          localStorage.setItem('fs-update-dismissed', latest);
          setLatest(null);
        }}
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}
