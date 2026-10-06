import React from 'react';

/**
 * Juzt mark — original geometry.
 *
 * A rounded "stage" frame holding a geometric J whose tail becomes a pen stroke,
 * plus a stage-light dot. Identical geometry is used by `scripts/gen-icon.mjs`
 * for the Windows .ico so the on-screen mark and the executable icon match.
 */

export interface LogoProps {
  size?: number;
  /** 'brand' = frame gradient, 'mono' = single colour (for small sizes / dark UI). */
  variant?: 'brand' | 'mono';
  className?: string;
  title?: string;
}

export const Logo: React.FC<LogoProps> = ({ size = 48, variant = 'brand', className, title = 'Juzt' }) => {
  const gradId = React.useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label={title}
      focusable="false"
    >
      {variant === 'brand' && (
        <defs>
          <linearGradient id={`frame-${gradId}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#5B8CFF" />
            <stop offset="100%" stopColor="#8B5CF6" />
          </linearGradient>
          <linearGradient id={`accent-${gradId}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FFB25E" />
            <stop offset="100%" stopColor="#FF6B6B" />
          </linearGradient>
        </defs>
      )}
      {/* stage frame */}
      <rect
        x="5.5"
        y="5.5"
        width="53"
        height="53"
        rx="15"
        fill="none"
        stroke={variant === 'brand' ? `url(#frame-${gradId})` : 'currentColor'}
        strokeWidth="4"
        opacity={variant === 'brand' ? 1 : 0.85}
      />
      {/* geometric J: stem down into a 180° tail */}
      <path
        d="M38.5 18.5 V35.5 A8.75 8.75 0 0 1 21 35.5"
        fill="none"
        stroke={variant === 'brand' ? '#ffffff' : 'currentColor'}
        strokeWidth="6.5"
        strokeLinecap="round"
      />
      {/* stage-light dot */}
      <circle cx="46.5" cy="20" r="3.6" fill={variant === 'brand' ? `url(#accent-${gradId})` : 'currentColor'} />
    </svg>
  );
};

export const Wordmark: React.FC<{ size?: number; color?: string }> = ({ size = 22, color = 'inherit' }) => (
  <span
    style={{
      fontWeight: 700,
      fontSize: size,
      letterSpacing: '-0.02em',
      color,
      fontFamily: '"Segoe UI", -apple-system, system-ui, sans-serif',
    }}
  >
    Juzt
  </span>
);

/** App-window draggable title bar with brand + private window controls. */
export const BrandLockup: React.FC<{ version?: string }> = ({ version }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
    <Logo size={18} />
    <Wordmark size={14} />
    {version ? <span style={{ opacity: 0.4, fontSize: 11 }}>v{version}</span> : null}
  </span>
);
