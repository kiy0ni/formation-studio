import { useEffect, useState } from 'react';
import { Icon } from '../common/Icon';
import { notify } from '../common/Toast';
import { Modal } from '../common/ui';

export const SITE_URL = 'https://kiy0ni.github.io/lineup/';
const MESSAGE = 'Lineup : créez vos formations de danse, synchronisées avec la musique. Gratuit.';

/** QR code as SVG squares (black on white, readable by every phone camera). */
export function QrCode({ text }: { text: string }) {
  const [cells, setCells] = useState<boolean[][] | null>(null);
  useEffect(() => {
    let alive = true;
    import('qrcode-generator').then((mod) => {
      const qrcode = (mod as unknown as { default?: typeof mod }).default ?? mod;
      const qr = (qrcode as unknown as (t: number, l: string) => { addData: (s: string) => void; make: () => void; getModuleCount: () => number; isDark: (r: number, c: number) => boolean })(0, 'M');
      qr.addData(text);
      qr.make();
      const n = qr.getModuleCount();
      if (alive) setCells(Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c))));
    });
    return () => {
      alive = false;
    };
  }, [text]);
  if (!cells) return <div className="share-qr placeholder" />;
  const n = cells.length;
  const path = cells.flatMap((row, r) => row.map((dark, c) => (dark ? `M${c} ${r}h1v1h-1z` : ''))).join('');
  return (
    <svg className="share-qr" viewBox={`-3 -3 ${n + 6} ${n + 6}`} role="img" aria-label="QR code vers Lineup" shapeRendering="crispEdges">
      <rect x={-3} y={-3} width={n + 6} height={n + 6} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

export function ShareAppDialog({ onClose }: { onClose: () => void }) {
  const canShare = typeof navigator.share === 'function';
  return (
    <Modal title="Partager Lineup" onClose={onClose} width={420}>
      <div className="share-app">
        <p className="hint center-text">Scannez avec l’appareil photo du téléphone.</p>
        <QrCode text={SITE_URL} />
        <div className="share-link">
          <span className="ellipsis">{SITE_URL.replace('https://', '')}</span>
          <button
            className="btn small"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(SITE_URL);
                notify('Lien copié');
              } catch {
                notify(`Copie impossible · ${SITE_URL}`);
              }
            }}
          >
            <Icon name="copy" size={14} /> Copier
          </button>
        </div>
        {canShare && (
          <button className="btn primary big" onClick={() => navigator.share({ title: 'Lineup', text: MESSAGE, url: SITE_URL }).catch(() => {})}>
            <Icon name="share" size={16} /> Envoyer le lien
          </button>
        )}
        <div className="share-steps">
          <b>Installer en 10 secondes</b>
          <ul>
            <li>
              <b>iPhone</b> · Safari → Partager → « Sur l’écran d’accueil »
            </li>
            <li>
              <b>Android</b> · Chrome → ⋮ → « Installer l’application »
            </li>
            <li>
              <b>Ordinateur</b> · Chrome ou Edge → icône « Installer » dans la barre d’adresse
            </li>
          </ul>
          <p className="hint">Gratuit, sans store. Un compte permet de retrouver ses chorégraphies sur tous ses appareils.</p>
        </div>
      </div>
    </Modal>
  );
}
