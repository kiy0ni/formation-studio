import { useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

const KEY = 'fs-open-sections';

function readState(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

/** Panel section that can be folded; remembers its state per device. */
export function Collapsible({
  id,
  title,
  hint,
  icon,
  defaultOpen = false,
  forceOpen = false,
  children,
}: {
  id: string;
  title: ReactNode;
  hint?: ReactNode;
  icon?: IconName;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readState()[id] ?? defaultOpen);
  const isOpen = forceOpen || open;
  const toggle = () => {
    const next = !isOpen;
    setOpen(next);
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...readState(), [id]: next }));
    } catch {
      /* private mode */
    }
  };
  return (
    <section className={`collapsible ${isOpen ? 'open' : ''}`}>
      <button type="button" className="collapsible-head" onClick={toggle} aria-expanded={isOpen}>
        {icon && (
          <span className="collapsible-icon">
            <Icon name={icon} size={15} />
          </span>
        )}
        <span className="collapsible-text">
          <b>{title}</b>
          {hint && <small>{hint}</small>}
        </span>
        <Icon name="chevronDown" size={15} className="collapsible-chevron" />
      </button>
      {isOpen && <div className="collapsible-body">{children}</div>}
    </section>
  );
}

export function Tip({ children, icon = 'sparkles', warn }: { children: ReactNode; icon?: IconName; warn?: boolean }) {
  return (
    <p className={`tip ${warn ? 'warn' : ''}`}>
      <Icon name={icon} size={14} />
      <span>{children}</span>
    </p>
  );
}
