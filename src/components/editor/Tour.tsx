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
  text: string;
}

const STEPS: Step[] = [
  { selector: '.stage-wrap', text: 'Glissez un danseur pour le déplacer.' },
  { selector: '.inspector-tabs button:first-child', mobileSelector: '.toolbar button:first-child', text: 'Choisissez une forme toute prête.' },
  { selector: '.add-formation', text: 'Touchez + pour ajouter une formation.' },
  { selector: '.play-btn', text: 'Lecture : les déplacements s’animent.' },
  { selector: '.topbar-right', mobileSelector: '.toolbar button:last-child', text: 'Exports et aide sont ici.' },
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
      const r = document.querySelector((mobile && step.mobileSelector) || step.selector)?.getBoundingClientRect();
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
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [next, finish]);

  const cardW = Math.min(320, viewport.w - 32);
  const cardH = 132;
  let style: CSSProperties = { width: cardW, left: (viewport.w - cardW) / 2, top: (viewport.h - cardH) / 2 };
  if (rect) {
    const left = Math.min(viewport.w - cardW - 16, Math.max(16, rect.left + rect.width / 2 - cardW / 2));
    let top: number;
    if (rect.height > viewport.h * 0.45) top = rect.top + rect.height / 2 - cardH / 2;
    else if (rect.top - 16 - cardH > 0) top = rect.top - 16 - cardH;
    else top = rect.bottom + 16;
    style = { width: cardW, left, top: Math.max(16, Math.min(viewport.h - cardH - 16, top)) };
  }

  const pad = 6;
  return (
    <div className="tour" role="dialog" aria-modal aria-label="Visite guidée" onClick={next}>
      <div
        className="tour-spot"
        style={rect ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 } : { top: viewport.h / 2, left: viewport.w / 2, width: 0, height: 0 }}
      />
      <div className="tour-card" style={style} onClick={(e) => e.stopPropagation()}>
        <p>{step.text}</p>
        <div className="tour-actions">
          <button className="link-btn muted" onClick={finish}>
            Passer
          </button>
          <span className="tour-dots">
            {STEPS.map((_, k) => (
              <i key={k} className={k === i ? 'on' : ''} />
            ))}
          </span>
          <button className="btn primary" onClick={next}>
            {i === STEPS.length - 1 ? 'Terminé' : 'Suivant'}
          </button>
        </div>
      </div>
    </div>
  );
}
