import { useCallback, useEffect, useLayoutEffect, useState, type CSSProperties } from 'react';

const KEY = 'fs-tour-done';

export const shouldShowTour = () => {
  try {
    return localStorage.getItem(KEY) !== '1';
  } catch {
    return false;
  }
};

interface Step {
  selector: string;
  mobileSelector?: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    selector: '.stage-wrap',
    title: 'La scène',
    body: 'Vue du dessus, le public est en bas. Glissez un membre pour le déplacer. Pour en sélectionner plusieurs, tracez un cadre autour (ou Maj + clic). Sur téléphone, pincez pour zoomer.',
  },
  {
    selector: '.inspector-tabs button:first-child',
    mobileSelector: '.mobile-nav button:first-child',
    title: 'Placer en un clic',
    body: 'Choisissez une forme toute prête : ligne, V, cercle, pyramide… Elle s’applique à tout le groupe, ou seulement aux membres sélectionnés. Les autres onglets règlent la formation, les membres, la musique et la scène.',
  },
  {
    selector: '.formation-list',
    title: 'Vos formations',
    body: 'Chaque carte est une formation. Touchez-en une pour y aller ; le bouton ⋯ permet de la dupliquer, la déplacer ou la supprimer.',
  },
  {
    selector: '.tl-scroll',
    title: 'La timeline',
    body: 'La musique et vos formations dans le temps. Bloc plein = formation tenue, zone rayée = déplacement vers la suivante. Glissez les poignées ‖ entre les blocs pour changer les durées (ou − / + dans l’onglet Formation).',
  },
  {
    selector: '.player-add',
    title: 'Ajouter au bon moment',
    body: 'Lancez la lecture, mettez pause là où la formation doit changer, puis « + Formation ». Placez les membres : le déplacement entre les deux est animé tout seul.',
  },
  {
    selector: '.topbar-right',
    title: 'Enregistré, exporté, expliqué',
    body: 'Tout est enregistré automatiquement sur cet appareil. Exportez en vidéo avec la musique ou en PDF pour les danseuses. Le guide complet et cette visite sont dans le menu Aide.',
  },
];

export function Tour({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });
  const mobile = viewport.w <= 860;
  const step = STEPS[i];

  const finish = useCallback(() => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* ignore */
    }
    onClose();
  }, [onClose]);

  const next = useCallback(() => (i < STEPS.length - 1 ? setI(i + 1) : finish()), [i, finish]);

  useLayoutEffect(() => {
    const measure = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight });
      const el = document.querySelector((mobile && step.mobileSelector) || step.selector);
      const r = el?.getBoundingClientRect();
      setRect(r && r.width > 0 && r.height > 0 ? r : null);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [step, mobile]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') finish();
      if (e.key === 'ArrowRight' || e.key === 'Enter') next();
      if (e.key === 'ArrowLeft' && i > 0) setI(i - 1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [i, next, finish]);

  const cardW = Math.min(340, viewport.w - 24);
  const cardH = 200;
  let style: CSSProperties = { width: cardW, left: (viewport.w - cardW) / 2, top: (viewport.h - cardH) / 2 };
  if (rect) {
    const left = Math.min(viewport.w - cardW - 12, Math.max(12, rect.left + rect.width / 2 - cardW / 2));
    let top: number;
    if (rect.height > viewport.h * 0.45) top = rect.top + rect.height / 2 - cardH / 2;
    else if (rect.bottom + 14 + cardH < viewport.h) top = rect.bottom + 14;
    else top = Math.max(12, rect.top - 14 - cardH);
    style = { width: cardW, left, top: Math.max(12, Math.min(viewport.h - cardH - 12, top)) };
  }

  const pad = 6;
  return (
    <div className="tour" role="dialog" aria-modal aria-label="Visite guidée">
      <div
        className="tour-spot"
        style={
          rect
            ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }
            : { top: viewport.h / 2, left: viewport.w / 2, width: 0, height: 0 }
        }
      />
      <div className="tour-card" style={style}>
        <div className="tour-step">
          {i + 1} / {STEPS.length}
        </div>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div className="row gap">
          <button className="btn ghost small" onClick={finish}>
            Passer
          </button>
          <span className="grow" />
          {i > 0 && (
            <button className="btn small" onClick={() => setI(i - 1)}>
              Précédent
            </button>
          )}
          <button className="btn primary small" onClick={next}>
            {i === STEPS.length - 1 ? 'C’est parti !' : 'Suivant'}
          </button>
        </div>
      </div>
    </div>
  );
}
