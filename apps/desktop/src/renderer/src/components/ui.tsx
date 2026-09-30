import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { PRIORITIES, Priority, Stage } from '@ff/shared';
import { PRIORITY_LABEL, STAGE_LABEL } from '../lib/format';

// ---------- icons (inline stroke SVG) ----------
const I = (p: { d: ReactNode; size?: number }) => (
  <svg width={p.size ?? 18} height={p.size ?? 18} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {p.d}
  </svg>
);
export const Icon = {
  grid: () => <I d={<><rect x="3" y="3" width="6" height="6" rx="1.5" /><rect x="11" y="3" width="6" height="6" rx="1.5" /><rect x="3" y="11" width="6" height="6" rx="1.5" /><rect x="11" y="11" width="6" height="6" rx="1.5" /></>} />,
  target: () => <I d={<><circle cx="10" cy="10" r="7" /><circle cx="10" cy="10" r="3" /></>} />,
  briefcase: () => <I d={<><rect x="2.5" y="6" width="15" height="11" rx="2" /><path d="M7 6V4.5A1.5 1.5 0 0 1 8.5 3h3A1.5 1.5 0 0 1 13 4.5V6" /></>} />,
  pulse: () => <I d={<path d="M2 10h3l2-5 3 10 2-5h6" />} />,
  sliders: () => <I d={<><path d="M3 5h14M3 10h14M3 15h14" /><circle cx="8" cy="5" r="2" fill="var(--side)" /><circle cx="13" cy="10" r="2" fill="var(--side)" /><circle cx="7" cy="15" r="2" fill="var(--side)" /></>} />,
  refresh: () => <I size={16} d={<path d="M16 10a6 6 0 1 1-2-4.5M16 3v4h-4" />} />,
  plus: () => <I size={16} d={<path d="M10 4v12M4 10h12" />} />,
  x: () => <I size={16} d={<path d="M5 5l10 10M15 5L5 15" />} />,
  external: () => <I size={14} d={<path d="M8 4H4v12h12v-4M11 3h6v6M17 3l-8 8" />} />,
  logo: () => (
    <svg width="30" height="30" viewBox="0 0 28 28" aria-hidden="true">
      <rect x="1" y="1" width="26" height="26" rx="7" fill="none" stroke="var(--accent)" strokeWidth="2" />
      <path d="M7 19l5-6 4 3 5-8" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

// ---------- chips ----------
export const StageChip = ({ stage }: { stage: Stage }) => (
  <span className={`chip ${stage}`}>
    <span className="pip" />
    {STAGE_LABEL[stage]}
  </span>
);

export function PrioritySelect(props: { value: Priority; onChange: (p: Priority) => void; label?: string }) {
  return (
    <select
      className={`prio select ${props.value}`}
      aria-label={props.label ?? 'Priority'}
      value={props.value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => props.onChange(e.target.value as Priority)}
    >
      {PRIORITIES.map((p) => (
        <option key={p} value={p}>
          {PRIORITY_LABEL[p]}
        </option>
      ))}
    </select>
  );
}

export const ScoreBar = ({ score }: { score: number | null }) => (
  <span className="row-flex" style={{ gap: 8 }}>
    <span className="mono" style={{ fontWeight: 600, width: 24 }}>
      {score ?? '—'}
    </span>
    <span className="bar" style={{ width: 60 }}>
      <span style={{ width: `${score ?? 0}%` }} />
    </span>
  </span>
);

export function Sparkline({ values, width = 72, height = 24, color = 'var(--blue)' }: { values: number[]; width?: number; height?: number; color?: string }) {
  if (!values.length) return null;
  const mn = Math.min(...values);
  const mx = Math.max(...values);
  const r = mx - mn || 1;
  const d = values
    .map((v, i) => `${i ? 'L' : 'M'}${((i * width) / Math.max(values.length - 1, 1)).toFixed(1)} ${(height - 2 - ((v - mn) / r) * (height - 4)).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
    </svg>
  );
}

export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
    />
  );
}

export function Seg<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button key={o.value} type="button" aria-pressed={props.value === o.value} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal(props: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, select, button')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={props.title} ref={ref}>
        <div className="row-flex">
          <h2 className="grow">{props.title}</h2>
          <button className="btn ghost sm" type="button" aria-label="Close" onClick={props.onClose}>
            <Icon.x />
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

export const ExtLink = ({ href, children }: { href: string | null; children: ReactNode }) =>
  href ? (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (window.ff) window.ff.openExternal(href);
        else window.open(href, '_blank', 'noopener');
      }}
    >
      {children}
    </a>
  ) : (
    <>{children}</>
  );

// ---------- toasts ----------
type Toast = { id: number; text: string; err?: boolean };
const ToastCtx = createContext<(text: string, err?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, err = false) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, err }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.err ? 'err' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function QueryState({ q, children, empty }: { q: { isLoading: boolean; error: unknown; data?: unknown }; children: ReactNode; empty?: string }) {
  if (q.isLoading) return <div className="empty">Loading…</div>;
  if (q.error) return <div className="empty error">{(q.error as Error).message}</div>;
  if (empty && Array.isArray(q.data) && q.data.length === 0) return <div className="empty">{empty}</div>;
  return <>{children}</>;
}
