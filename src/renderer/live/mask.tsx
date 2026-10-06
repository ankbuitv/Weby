import React from 'react';
import type { Rect } from '../../shared/types';

/**
 * Rounded-card clipping without `setBorderRadius`.
 *
 * Electron 31 has no way to round the corners of a native `WebContentsView`, so
 * the *background layer* is clipped: everything outside the rounded card. The
 * clip is a single SVG `clipPath` (even-odd) which Chromium composites on the
 * GPU — far cheaper than re-rasterising gradients, and it works identically in
 * the audience surface and in the PREP overlay.
 */

export function roundedRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  if (radius <= 0.01) return `M${x} ${y} H${x + w} V${y + h} H${x} Z`;
  return [
    `M${x + radius} ${y}`,
    `H${x + w - radius}`,
    `A${radius} ${radius} 0 0 1 ${x + w} ${y + radius}`,
    `V${y + h - radius}`,
    `A${radius} ${radius} 0 0 1 ${x + w - radius} ${y + h}`,
    `H${x + radius}`,
    `A${radius} ${radius} 0 0 1 ${x} ${y + h - radius}`,
    `V${y + radius}`,
    `A${radius} ${radius} 0 0 1 ${x + radius} ${y}`,
    'Z',
  ].join(' ');
}

/** A clip that keeps everything *outside* the rounded card (local coordinates). */
export const OutsideCardClip: React.FC<{ id: string; local: { w: number; h: number }; card: Rect; radius: number }> = ({ id, local, card, radius }) => (
  <svg width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }} aria-hidden="true">
    <defs>
      <clipPath id={id} clipPathUnits="userSpaceOnUse">
        <path
          clipRule="evenodd"
          d={`M0 0 H${local.w} V${local.h} H0 Z ${roundedRectPath(card.x, card.y, card.width, card.height, radius)}`}
        />
      </clipPath>
    </defs>
  </svg>
);

/** Clip that keeps only the region *inside* the rounded card. */
export const InsideCardClip: React.FC<{ id: string; card: Rect; radius: number }> = ({ id, card, radius }) => (
  <svg width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }} aria-hidden="true">
    <defs>
      <clipPath id={id} clipPathUnits="userSpaceOnUse">
        <path d={roundedRectPath(card.x, card.y, card.width, card.height, radius)} />
      </clipPath>
    </defs>
  </svg>
);

export function clipStyle(id: string): React.CSSProperties {
  return { clipPath: `url(#${id})` };
}

export function radiusOf(card: { radius: number }): number {
  return Math.max(0, card.radius);
}
