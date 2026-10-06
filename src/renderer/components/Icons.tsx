import React from 'react';

/** Inline icon set (no icon font, no external assets). */
const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const Icon: Record<string, React.FC<{ size?: number }>> = {
  cursor: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <path d="M5 3.5l13.5 6.8-6 2-2.2 6z" />
    </svg>
  ),
  pen: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <path d="M4 20l2.5-.6 10.6-10.6-2-2L4.6 17.4z" />
      <path d="M15.2 4.3l1.6-1.6a1.8 1.8 0 012.5 2.5l-1.6 1.6" />
    </svg>
  ),
  marker: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <path d="M9.5 11.5L4 17v3h3l5.5-5.5" />
      <path d="M13.5 7.5l4 4 3-3-4-4z" />
    </svg>
  ),
  highlighter: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <path d="M3.5 20.5l3.2-.8L19 7.4l-2.6-2.6L4.3 17.3z" />
      <path d="M14 6l3.4 3.4" />
    </svg>
  ),
  eraser: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <path d="M20 20H8.6L3.5 14.9 13 5.4l6.1 6.1-6.4 6.4" />
      <path d="M9.6 14.1l4.6-4.6" />
    </svg>
  ),
  line: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <path d="M4 20L20 4" />
    </svg>
  ),
  arrow: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <path d="M5 19L19 5" />
      <path d="M9.5 5H19v9.5" />
    </svg>
  ),
  rect: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <rect x="4" y="5.5" width="16" height="13" rx="1.5" />
    </svg>
  ),
  ellipse: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <ellipse cx="12" cy="12" rx="8.5" ry="6.4" />
    </svg>
  ),
  text: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <path d="M5 5.5h14" />
      <path d="M12 5.5v13" />
      <path d="M9.5 18.5h5" />
    </svg>
  ),
  number: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M10.2 10.2l1.5-1.2v6.4" />
    </svg>
  ),
  laser: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
      <path d="M12 2.5v3.6M12 17.9v3.6M2.5 12h3.6M17.9 12h3.6" />
    </svg>
  ),
  spotlight: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <path d="M8.5 10a3.5 3.5 0 117 0l-1.8 7.4h-3.4z" />
      <path d="M6 20.8h12" />
    </svg>
  ),
  select: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <path d="M5.5 3.5l12 7.2-5.4 1.7-1.9 5.4z" />
    </svg>
  ),
  hand: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <path d="M8 12V5.6a1.6 1.6 0 113.2 0V11" />
      <path d="M11.2 11V4.6a1.6 1.6 0 113.2 0V11" />
      <path d="M14.4 11.4V6.6a1.6 1.6 0 113.2 0V15a5 5 0 01-5 5h-1.2a5 5 0 01-4.3-2.5L5 14.2a1.7 1.7 0 012.6-2.1z" />
    </svg>
  ),
  image: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M4 17l4.8-4.5L13 16l3-2.6 4.5 4" />
    </svg>
  ),
  undo: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <path d="M9 7H4.5V2.5" />
      <path d="M4.5 7.5A8 8 0 1112 20" />
    </svg>
  ),
  redo: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <path d="M15 7h4.5V2.5" />
      <path d="M19.5 7.5A8 8 0 1012 20" />
    </svg>
  ),
  trash: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <path d="M4 7h16" />
      <path d="M9.5 7V4.8h5V7" />
      <path d="M6 7l1 12.2h10L18 7" />
    </svg>
  ),
  globe: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.4 2.4 3.6 5.3 3.6 8.5S14.4 18.1 12 20.5c-2.4-2.4-3.6-5.3-3.6-8.5S9.6 5.9 12 3.5z" />
    </svg>
  ),
  search: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15.2 15.2L20.5 20.5" />
    </svg>
  ),
  plus: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  menu: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <circle cx="12" cy="5.5" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="18.5" r="1.6" fill="currentColor" />
    </svg>
  ),
  chevronDown: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <path d="M6 9.5l6 6 6-6" />
    </svg>
  ),
  eyeOff: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <path d="M3 3l18 18" />
      <path d="M10.6 6.3A9.6 9.6 0 0112 6.2c5 0 8.5 5.8 8.5 5.8a17 17 0 01-3.3 3.7" />
      <path d="M6.4 8.1A17.6 17.6 0 003.5 12s3.5 5.8 8.5 5.8a9.4 9.4 0 003.4-.6" />
      <path d="M9.9 9.9a2.9 2.9 0 004.2 4.2" />
    </svg>
  ),
  snowflake: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <path d="M12 3v18M4.5 7.5l15 9M19.5 7.5l-15 9" />
    </svg>
  ),
  broadcast: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <circle cx="12" cy="12" r="2.4" fill="currentColor" />
      <path d="M7.6 7.6a6.2 6.2 0 000 8.8M16.4 16.4a6.2 6.2 0 000-8.8" />
      <path d="M4.6 4.6a10.4 10.4 0 000 14.8M19.4 19.4a10.4 10.4 0 000-14.8" />
    </svg>
  ),
  layers: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <path d="M12 3.5L20 8l-8 4.5L4 8z" />
      <path d="M4 12.5l8 4.5 8-4.5" />
    </svg>
  ),
  camera: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <rect x="3" y="6.5" width="12.5" height="11" rx="2.5" />
      <path d="M15.5 11l5-2.6v7.2l-5-2.6z" />
    </svg>
  ),
  notes: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <path d="M6 3.5h9.5L19 7v13.5H6z" />
      <path d="M9 10h7M9 13.5h7M9 17h4" />
    </svg>
  ),
  timer: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <circle cx="12" cy="13" r="7.5" />
      <path d="M12 9.5V13l2.4 1.6M9.5 2.5h5" />
    </svg>
  ),
  grid: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <rect x="4" y="4" width="16" height="16" rx="2.5" />
      <path d="M4 10h16M4 15h16M10 4v16M15 4v16" />
    </svg>
  ),
  mask: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <rect x="3.5" y="6" width="17" height="12" rx="2" />
      <rect x="9" y="9" width="8" height="6" rx="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  sliders: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <path d="M5 8h14M5 16h14" />
      <circle cx="9" cy="8" r="2.2" fill="var(--jz-panel-solid)" />
      <circle cx="15" cy="16" r="2.2" fill="var(--jz-panel-solid)" />
    </svg>
  ),
  monitor: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M9 20h6M12 16.5V20" />
    </svg>
  ),
  star: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <path d="M12 4l2.5 5.1 5.6.8-4 4 .9 5.6L12 16.9 7 19.5l.9-5.6-4-4 5.6-.8z" />
    </svg>
  ),
  clock: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  ),
  sound: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <path d="M4 9.5h3l4-3.5v12l-4-3.5H4z" />
      <path d="M14.5 9a4.5 4.5 0 010 6" />
    </svg>
  ),
  muted: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <path d="M4 9.5h3l4-3.5v12l-4-3.5H4z" />
      <path d="M14.5 10l4 4M18.5 10l-4 4" />
    </svg>
  ),
  pin: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <path d="M9 3.5h6l-.8 4.4 2.8 2.8H7l2.8-2.8z" />
      <path d="M12 10.7V20.5" />
    </svg>
  ),
  copy: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7.5a2 2 0 002 2h2.5" />
    </svg>
  ),
  refresh: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <path d="M20 11a8 8 0 10-2.4 5.7" />
      <path d="M20 4.5V11h-6.5" />
    </svg>
  ),
  check: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <path d="M4.5 12.5l5 5 10-11" />
    </svg>
  ),
  settings: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v3M12 17.5v3M4.5 12h3M16.5 12h3M6.4 6.4l2.1 2.1M15.5 15.5l2.1 2.1M17.6 6.4l-2.1 2.1M8.5 15.5l-2.1 2.1" />
    </svg>
  ),
  expand: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <path d="M4 9V4.5h5M20 15v4.5h-5M15 4.5h5V9M9 19.5H4V15" />
    </svg>
  ),
  board: ({ size = 20 }) => (
    <svg {...base} width={size} height={size}>
      <rect x="3.5" y="4.5" width="17" height="12" rx="2" />
      <path d="M7.5 20.5l2-4M16.5 20.5l-2-4" />
    </svg>
  ),
};
