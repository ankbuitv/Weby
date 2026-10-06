/**
 * Pure layout maths.
 *
 * Every rectangle the app hands to the OS (native views, the LIVE stage, the
 * card, the camera overlay) is computed here so it can be unit-tested without a
 * window and so PREP and LIVE can never disagree about geometry.
 */

import { CARD_RADII } from './types';
import type { CameraConfig, CardAppearance, CardMargin, CardRadius, LayoutId, Rect, Size, SizePreset } from './types';

export interface CardRectOpts {
  size: SizePreset;
  /** Inset from the window edge, in CSS pixels. */
  safeInset: number;
  /** Overall scale for the `custom` preset (0.4..1). */
  customScale: number;
  margin: CardMargin;
  layout: LayoutId;
  /** Region reserved for the camera in classroom/tutor layouts. */
  cameraReserve: number;
}

export const SIZE_PRESETS: { id: SizePreset; label: string; ratio?: number; fill: number }[] = [
  { id: 'comfortable', label: 'Comfortable', ratio: 16 / 9, fill: 0.82 },
  { id: 'large', label: 'Large', ratio: 16 / 9, fill: 0.94 },
  { id: 'full', label: 'Full', fill: 1 },
  { id: '16:9', label: '16:9', ratio: 16 / 9, fill: 0.96 },
  { id: '4:3', label: '4:3', ratio: 4 / 3, fill: 0.96 },
  { id: 'portrait', label: 'Portrait', ratio: 9 / 16, fill: 0.94 },
  { id: 'custom', label: 'Custom', fill: 1 },
];

export const MARGINS: Record<CardMargin, number> = { compact: 14, comfortable: 44, spacious: 84 };

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function roundRect(r: Rect): Rect {
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.max(1, Math.round(r.width)),
    height: Math.max(1, Math.round(r.height)),
  };
}

/**
 * Rect equality used to skip a `setBounds` call.
 *
 * Sub-pixel differences are treated as equal on purpose: integer-rounded bounds
 * are what actually reaches the native view, so comparing the rounded values
 * removes the "same rect, new object, needless layout" churn.
 */
export function sameRect(a: Rect | null | undefined, b: Rect | null | undefined): boolean {
  // Neither side has a rect: that is still "no change", whatever the flavour of
  // empty value (null vs undefined) happens to be.
  if (!a || !b) return !a && !b;
  return Math.round(a.x) === Math.round(b.x) && Math.round(a.y) === Math.round(b.y) && Math.round(a.width) === Math.round(b.width) && Math.round(a.height) === Math.round(b.height);
}

/**
 * The content region inside the LIVE surface, after margins and any camera
 * strip reserved by the layout.
 */
export function contentRegion(surface: Size, opts: CardRectOpts): Rect {
  const inset = Math.max(MARGINS[opts.margin], opts.safeInset);
  let x = inset;
  let y = inset;
  let width = surface.width - inset * 2;
  let height = surface.height - inset * 2;

  if (opts.layout === 'classroom') {
    const strip = Math.max(opts.cameraReserve, Math.min(180, surface.height * 0.2));
    y += strip;
    height -= strip;
  } else if (opts.layout === 'tutor') {
    const col = Math.max(opts.cameraReserve, Math.min(400, surface.width * 0.24));
    width -= col;
  }

  return { x, y, width, height };
}

/** Fit a rectangle of `ratio` inside the region, scaled by `fill`. */
export function fitRatio(region: Rect, ratio: number, fill: number): Rect {
  const availW = region.width * fill;
  const availH = region.height * fill;
  let width = availW;
  let height = width / ratio;
  if (height > availH) {
    height = availH;
    width = height * ratio;
  }
  return {
    x: region.x + (region.width - width) / 2,
    y: region.y + (region.height - height) / 2,
    width,
    height,
  };
}

/**
 * Main entry point — the card rectangle for a given surface.
 */
export function computeCardRect(surface: Size, opts: CardRectOpts): Rect {
  if (surface.width < 2 || surface.height < 2) return { x: 0, y: 0, width: 1, height: 1 };
  const region = contentRegion(surface, opts);
  if (region.width < 8 || region.height < 8) return roundRect({ x: 0, y: 0, width: surface.width, height: surface.height });

  const preset = SIZE_PRESETS.find((p) => p.id === opts.size) ?? SIZE_PRESETS[0];

  if (opts.size === 'custom') {
    const fill = clamp(opts.customScale, 0.4, 1);
    const target = { width: region.width * fill, height: region.height * fill };
    return roundRect({
      x: region.x + (region.width - target.width) / 2,
      y: region.y + (region.height - target.height) / 2,
      width: target.width,
      height: target.height,
    });
  }

  if (!preset.ratio) {
    // `full` — fill the whole content region (no aspect constraint).
    return roundRect(region);
  }

  return roundRect(fitRatio(region, preset.ratio, preset.fill));
}

/**
 * Card style → renderer CSS values. The radius itself cannot be applied by the
 * OS to the native view (Electron 31 has no `setBorderRadius`), so the card
 * corners are punched out of the background layer; LIVE uses this helper only
 * for the frame/border/shadow.
 */
export function cardShadowCss(shadow: CardAppearance['shadow']): string {
  switch (shadow) {
    case 'off':
      return 'none';
    case 'medium':
      return '0 32px 90px rgba(0,0,0,0.62)';
    default:
      return '0 18px 46px rgba(0,0,0,0.38)';
  }
}

export function cardBorderCss(border: CardAppearance['border']): { width: number; color: string } {
  return border === 'off' ? { width: 0, color: 'transparent' } : { width: 1, color: 'rgba(255,255,255,0.10)' };
}

/** Camera rect (normalised, inside the card) → device-independent pixels. */
export function cameraRectPx(cam: CameraConfig, card: Rect): Rect {
  return roundRect({
    x: card.x + cam.rect.x * card.width,
    y: card.y + cam.rect.y * card.height,
    width: cam.rect.w * card.width,
    height: cam.rect.h * card.height,
  });
}

export const CAMERA_MIN = 0.08;
export const CAMERA_MAX = 0.72;

/** Snap the camera to corners when dragged near them (PREP interaction). */
export function snapCameraRect(rect: CameraConfig['rect'], snap = 0.06): CameraConfig['rect'] {
  const clampVal = (v: number, lo: number, hi: number) => clamp(v, lo, hi);
  const w = clampVal(rect.w, CAMERA_MIN, CAMERA_MAX);
  const h = clampVal(rect.h, CAMERA_MIN, CAMERA_MAX);
  let x = clampVal(rect.x, 0, 1 - w);
  let y = clampVal(rect.y, 0, 1 - h);
  for (const ax of [0, 1 - w]) if (Math.abs(x - ax) < snap) x = ax;
  for (const ay of [0, 1 - h]) if (Math.abs(y - ay) < snap) y = ay;
  return { x, y, w, h };
}

/** Resolution of a `contain`/`cover` fit inside a target box. */
export function fitSize(natural: Size, box: Size, mode: 'cover' | 'contain' | 'stretch'): Size {
  if (mode === 'stretch' || natural.width <= 0 || natural.height <= 0) return { ...box };
  const scale = mode === 'cover' ? Math.max(box.width / natural.width, box.height / natural.height) : Math.min(box.width / natural.width, box.height / natural.height);
  return { width: natural.width * scale, height: natural.height * scale };
}

/** Split a window between the private prep pane and the audience card. */
export function splitPanes(surface: Size, paneWidth: number): { live: Rect; pane: Rect | null } {
  if (paneWidth <= 0) return { live: { x: 0, y: 0, ...surface }, pane: null };
  const pane: Rect = { x: Math.max(0, surface.width - paneWidth), y: 0, width: paneWidth, height: surface.height };
  return { live: { x: 0, y: 0, width: Math.max(120, surface.width - paneWidth), height: surface.height }, pane };
}

/* ------------------------------------------------------------------ *
 * Whole-window geometry (identical in main and both renderers)
 * ------------------------------------------------------------------ */

/** Chrome reserved by the PREP UI around the private card. */
export const PREP_CHROME = { top: 96, left: 78, right: 20, bottom: 24 } as const;
export const PANE_MIN_WIDTH = 360;
export const PANE_MAX_FRACTION = 0.45;

export interface SurfaceGeometry {
  /** The audience card rect. */
  live: Rect;
  /** The teacher's private card (dual) or the private pane (single). */
  prepCard: Rect;
  /** Single mode: rect of the private pane, otherwise null. */
  pane: Rect | null;
  /** Rect of the transparent overlay above the private site view (dual mode). */
  overlay: Rect | null;
  /** True when the audience surface is the PREP window itself. */
  single: boolean;
}

function inset(size: Size, insets: { top: number; left: number; right: number; bottom: number }): Size {
  return { width: Math.max(160, size.width - insets.left - insets.right), height: Math.max(120, size.height - insets.top - insets.bottom) };
}

/**
 * Every rect the app needs, derived only from (window size, settings).
 *
 * Both processes call this with the same inputs, which is what removes the
 * resize IPC round-trip (and the re-layout storms that came with it in V2).
 */
export function computeGeometry(opts: {
  single: boolean;
  prepSize: Size;
  liveSize: Size;
  sizePreset: SizePreset;
  customScale: number;
  margin: CardMargin;
  layout: LayoutId;
  card: CardAppearance;
  paneOpen: boolean;
}): SurfaceGeometry {
  const cardOpts = (size: Size, extra = 0): CardRectOpts => ({
    size: opts.sizePreset,
    safeInset: extra,
    customScale: opts.customScale,
    margin: opts.margin,
    layout: opts.layout,
    cameraReserve: opts.layout === 'classroom' ? 140 : 320,
  });

  if (opts.single) {
    const paneWidth = opts.paneOpen ? clamp(Math.round(opts.prepSize.width * 0.36), PANE_MIN_WIDTH, Math.round(opts.prepSize.width * PANE_MAX_FRACTION)) : 0;
    const panes = splitPanes(opts.prepSize, paneWidth);
    const live = computeCardRect(panes.live, { ...cardOpts(panes.live), safeInset: 12 });
    const pane = panes.pane
      ? { x: panes.pane.x - 8, y: PREP_CHROME.top, width: panes.pane.width - 8, height: Math.max(200, panes.pane.height - PREP_CHROME.top - 12) }
      : null;
    return { live, prepCard: live, pane, overlay: live, single: true };
  }

  const prepSize = inset(opts.prepSize, { top: PREP_CHROME.top, left: PREP_CHROME.left, right: PREP_CHROME.right, bottom: PREP_CHROME.bottom });
  const prepCard = computeCardRect(prepSize, cardOpts(prepSize));
  const live = computeCardRect(opts.liveSize, { ...cardOpts(opts.liveSize), safeInset: 18 });
  return { live, prepCard, pane: null, overlay: prepCard, single: false };
}

/** The private pane rect only (single mode helper for the renderer's DOM). */
export function computePaneRect(prepSize: Size, open: boolean): Rect | null {
  if (!open) return null;
  const width = clamp(Math.round(prepSize.width * 0.36), PANE_MIN_WIDTH, Math.round(prepSize.width * PANE_MAX_FRACTION));
  return { x: prepSize.width - width, y: 0, width, height: prepSize.height };
}

export function isCardRadius(value: unknown): value is CardRadius {
  return typeof value === 'number' && (CARD_RADII as readonly number[]).includes(value);
}
