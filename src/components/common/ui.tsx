import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { DANCER_COLORS } from '../../lib/colors';
import { Icon, type IconName } from './Icon';

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 480,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Escape closes the dialog, unless a menu is open on top of it (it closes itself first)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.floating.menu, .floating.popover')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    // keyboard focus stays inside, the page behind does not scroll, focus goes back where it was on close
    const before = document.activeElement as HTMLElement | null;
    const el = box.current;
    const focusable = () => Array.from(el?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? []).filter((n) => !n.hasAttribute('disabled') && n.offsetParent !== null);
    if (el && !el.contains(document.activeElement)) (focusable().find((n) => !n.classList.contains('icon-btn')) ?? focusable()[0] ?? el).focus({ preventScroll: true });
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !el) return;
      const list = focusable();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onTab);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onTab);
      document.body.style.overflow = previous;
      if (before && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, []);
  // rendered at the page root: no scrolling list or toolbar around it can clip it or restyle it
  return createPortal(
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className="modal" style={{ maxWidth: width }} role="dialog" aria-modal tabIndex={-1}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function IconButton({
  icon,
  title,
  onClick,
  active,
  disabled,
  size = 16,
  className = '',
}: {
  icon: IconName;
  title: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-btn ${active ? 'active' : ''} ${className}`}
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

/** Numeric input that commits on blur / Enter, supports arrow-key nudging. */
export function NumberField({
  value,
  onChange,
  step = 0.01,
  min,
  max,
  suffix,
  label,
  disabled,
  precision = 2,
  stepper,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  label?: string;
  disabled?: boolean;
  precision?: number;
  /** Shows − / + buttons that change the value by this amount. */
  stepper?: number;
}) {
  const [text, setText] = useState(value.toFixed(precision));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(Number.isFinite(value) ? value.toFixed(precision) : '');
  }, [value, precision]);
  const commit = (raw: string) => {
    const v = parseFloat(raw.replace(',', '.'));
    if (!Number.isFinite(v)) return setText(value.toFixed(precision));
    let c = v;
    if (min !== undefined) c = Math.max(min, c);
    if (max !== undefined) c = Math.min(max, c);
    c = Math.round(c * 10 ** precision) / 10 ** precision;
    setText(c.toFixed(precision));
    if (c !== value) onChange(c);
  };
  return (
    <div className="field num-field">
      {label && <span className="field-label">{label}</span>}
      <span className={`num-wrap ${stepper ? 'has-stepper' : ''}`}>
        {stepper ? (
          <button type="button" className="num-step" disabled={disabled} aria-label={`${label ?? 'Valeur'} : diminuer`} onClick={() => commit(String(value - stepper))}>
            −
          </button>
        ) : null}
        <input
          inputMode="decimal"
          aria-label={label}
          value={text}
          disabled={disabled}
          onFocus={(e) => {
            focused.current = true;
            e.target.select();
          }}
          onBlur={(e) => {
            focused.current = false;
            commit(e.target.value);
          }}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const k = (e.shiftKey ? 10 : 1) * step * (e.key === 'ArrowUp' ? 1 : -1);
              commit(String((parseFloat(text) || 0) + k));
            }
            e.stopPropagation();
          }}
        />
        {suffix && <span className="suffix">{suffix}</span>}
        {stepper ? (
          <button type="button" className="num-step" disabled={disabled} aria-label={`${label ?? 'Valeur'} : augmenter`} onClick={() => commit(String(value + stepper))}>
            +
          </button>
        ) : null}
      </span>
    </div>
  );
}

export function TextField({
  value,
  onChange,
  label,
  placeholder,
  disabled,
  multiline,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  multiline?: boolean;
}) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  const props = {
    value: text,
    placeholder,
    disabled,
    onFocus: () => (focused.current = true),
    onBlur: () => {
      focused.current = false;
      if (text !== value) onChange(text);
    },
    onChange: (e: { target: { value: string } }) => setText(e.target.value),
    onKeyDown: (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (!multiline && e.key === 'Enter') (e.target as HTMLInputElement).blur();
    },
  };
  return (
    <label className="field">
      {label && <span className="field-label">{label}</span>}
      {multiline ? <textarea rows={3} {...props} /> : <input {...props} />}
    </label>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track">
        <span className="toggle-thumb" />
      </span>
      <span>{label}</span>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          title={o.title}
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ColorSwatches({ value, onChange, colors = DANCER_COLORS }: { value: string; onChange: (c: string) => void; colors?: string[] }) {
  return (
    <div className="swatches">
      {colors.map((c) => (
        <button
          type="button"
          key={c}
          className={`swatch ${c.toLowerCase() === value.toLowerCase() ? 'on' : ''}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
          aria-label={c}
        />
      ))}
      <label className="swatch custom" title="Couleur personnalisée">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
        <Icon name="plus" size={12} />
      </label>
    </div>
  );
}

/**
 * Menu / popover layer rendered on top of the whole page (never clipped by cards, panels or the
 * phone bottom sheet). Opens below or above its anchor depending on the room, and stays on screen.
 */
/** Big − value + control, like native phone apps. */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 99,
  step = 1,
  label,
  size = 'normal',
  format = (v: number) => String(v),
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  size?: 'normal' | 'big';
  format?: (v: number) => string;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  return (
    <div className={`stepper ${size}`} role="group" aria-label={label}>
      <button type="button" aria-label={`${label ?? ''} moins`} disabled={value <= min} onClick={() => onChange(clamp(value - step))}>
        <Icon name="minus" size={size === 'big' ? 26 : 18} />
      </button>
      <output>{format(value)}</output>
      <button type="button" aria-label={`${label ?? ''} plus`} disabled={value >= max} onClick={() => onChange(clamp(value + step))}>
        <Icon name="plus" size={size === 'big' ? 26 : 18} />
      </button>
    </div>
  );
}

export function Floating({
  anchor,
  onClose,
  align,
  direction,
  className,
  children,
}: {
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  align: 'left' | 'right';
  direction: 'down' | 'up';
  className: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ top: 0, left: 0, visibility: 'hidden' });

  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const el = ref.current;
      if (!a || !el) return;
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const margin = 8;
      const gap = 6;
      const width = Math.min(el.offsetWidth, vw - margin * 2);
      const natural = el.scrollHeight;
      const below = vh - a.bottom - gap - margin;
      const above = a.top - gap - margin;
      const up = direction === 'up' ? above >= Math.min(natural, 220) || above > below : natural > below && above > below;
      const maxHeight = Math.max(140, up ? above : below);
      const left = Math.max(margin, Math.min(vw - margin - width, align === 'right' ? a.right - width : a.left));
      setStyle(up ? { left, top: 'auto', bottom: vh - a.top + gap, maxHeight } : { left, top: a.bottom + gap, bottom: 'auto', maxHeight });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, align, direction]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.current?.contains(t)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', key);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div ref={ref} className={`${className} floating`} style={style}>
      {children}
    </div>,
    document.body,
  );
}

export function ColorDot({ color, onChange, size = 22 }: { color: string; onChange: (c: string) => void; size?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  return (
    <div className="color-dot-wrap" ref={ref}>
      <button type="button" className="color-dot" style={{ background: color, width: size, height: size }} onClick={() => setOpen(!open)} aria-label="Couleur" />
      {open && (
        <Floating anchor={ref} onClose={close} align="left" direction="down" className="popover">
          <ColorSwatches
            value={color}
            onChange={(c) => {
              onChange(c);
              setOpen(false);
            }}
          />
        </Floating>
      )}
    </div>
  );
}

export function MenuCheck({
  icon,
  label,
  hint,
  checked,
  onChange,
}: {
  icon?: IconName;
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button type="button" className={`menu-item check ${checked ? 'on' : ''}`} role="menuitemcheckbox" aria-checked={checked} onClick={() => onChange(!checked)}>
      {icon && <Icon name={icon} size={15} />}
      <span>
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </span>
      <i className={`check-box ${checked ? 'on' : ''}`}>{checked && <Icon name="check" size={12} />}</i>
    </button>
  );
}

export function Menu({
  trigger,
  children,
  align = 'right',
  direction = 'down',
}: {
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  direction?: 'down' | 'up';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  return (
    <div className="menu-wrap" ref={ref}>
      <span onClick={() => setOpen(!open)}>{trigger}</span>
      {open && (
        <Floating anchor={ref} onClose={close} align={align} direction={direction} className="menu">
          {children(close)}
        </Floating>
      )}
    </div>
  );
}

export function MenuItem({ icon, children, onClick, danger }: { icon?: IconName; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" className={`menu-item ${danger ? 'danger' : ''}`} onClick={onClick}>
      {icon && <Icon name={icon} size={15} />}
      <span>{children}</span>
    </button>
  );
}

export function Section({ title, children, actions }: { title: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="panel-section">
      <div className="panel-section-head">
        <h3>{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}
