import React from 'react';

export const Row: React.FC<{ label?: string; children: React.ReactNode; hint?: string }> = ({ label, children, hint }) => (
  <div className="jz-row">
    {label ? <div className="jz-row__label">{label}</div> : null}
    <div className="jz-row__value">
      {children}
      {hint ? <span style={{ fontSize: 11, color: 'var(--jz-text-faint)' }}>{hint}</span> : null}
    </div>
  </div>
);

export const Toggle: React.FC<{ on: boolean; onChange: (on: boolean) => void; title?: string }> = ({ on, onChange, title }) => (
  <button
    type="button"
    title={title}
    aria-pressed={on}
    className={`jz-toggle${on ? ' jz-toggle--on' : ''}`}
    onClick={() => onChange(!on)}
  />
);

export const Segmented = <T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (v: T) => void;
}) => (
  <div style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        title={o.title}
        className={`jz-chip${value === o.value ? ' jz-chip--active' : ''}`}
        onClick={() => onChange(o.value)}
      >
        {o.label}
      </button>
    ))}
  </div>
);

export const Tip: React.FC<{ label: string; shortcut?: string; children: React.ReactNode; side?: 'left' | 'right' | 'top' }> = ({
  label,
  shortcut,
  children,
}) => (
  <span className="jz-tip" style={{ display: 'inline-flex' }}>
    {children}
    <span className="jz-tip__body" role="tooltip">
      {label}
      {shortcut ? <span className="jz-tip__key">{shortcut}</span> : null}
    </span>
  </span>
);

export const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="jz-section">
    <div className="jz-section__title">{title}</div>
    {children}
  </div>
);

export const Field: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  grow?: boolean;
}> = ({ value, onChange, placeholder, grow }) => (
  <input
    className={`jz-input${grow ? ' jz-input--grow' : ''}`}
    value={value}
    placeholder={placeholder}
    onChange={(e) => onChange(e.target.value)}
  />
);

export const Slider: React.FC<{
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}> = ({ value, min, max, step = 1, onChange, format }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
    <input className="jz-range" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    <span style={{ fontSize: 11.5, color: 'var(--jz-text-dim)', minWidth: 44 }}>{format ? format(value) : value}</span>
  </span>
);

export function formatTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
