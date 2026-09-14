import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: width }} role="dialog" aria-modal>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
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

export function ColorDot({ color, onChange, size = 22 }: { color: string; onChange: (c: string) => void; size?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className="color-dot-wrap" ref={ref}>
      <button type="button" className="color-dot" style={{ background: color, width: size, height: size }} onClick={() => setOpen(!open)} aria-label="Couleur" />
      {open && (
        <div className="popover">
          <ColorSwatches
            value={color}
            onChange={(c) => {
              onChange(c);
              setOpen(false);
            }}
          />
        </div>
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
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      <span onClick={() => setOpen(!open)}>{trigger}</span>
      {open && <div className={`menu ${align} ${direction}`}>{children(() => setOpen(false))}</div>}
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
