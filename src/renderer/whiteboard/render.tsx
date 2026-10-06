import React, { useEffect, useMemo, useRef, useState } from 'react';
import { WHITEBOARD_THEMES, type WbObject, type WbStyle, type WbView, type WhiteboardDoc, type WhiteboardTheme, type WhiteboardThemeId } from '../../shared/types';
import { mediaUrl } from '../live/effects';

/**
 * Whiteboard rasteriser.
 *
 * The document is a vector/object list; the canvas only ever rasterises the
 * visible part at the current zoom, so a board with thousands of strokes stays
 * fast and the "infinite" feel never costs a giant bitmap.
 *
 * `WhiteboardCanvas` is shared by the audience surface (read-only) and the
 * editor (interactive), so what the teacher draws is exactly what is projected.
 */

export function theme(themeId: WhiteboardThemeId | undefined): WhiteboardTheme {
  return WHITEBOARD_THEMES.find((t) => t.id === themeId) ?? WHITEBOARD_THEMES[0];
}

export interface ScreenTransform {
  x: number;
  y: number;
  zoom: number;
}

export function boardToScreen(t: ScreenTransform, bx: number, by: number): { x: number; y: number } {
  return { x: (bx - t.x) * t.zoom, y: (by - t.y) * t.zoom };
}

export function screenToBoard(t: ScreenTransform, sx: number, sy: number): { x: number; y: number } {
  return { x: sx / t.zoom + t.x, y: sy / t.zoom + t.y };
}

/** Fit the board content into a viewport (used for "fit all" and the audience). */
export function fitView(objects: WbObject[], size: { w: number; h: number }, pad = 60): ScreenTransform {
  const bounds = contentBounds(objects, pad);
  if (bounds.width <= 0 || bounds.height <= 0) return { x: -size.w / 2, y: -size.h / 2, zoom: 1 };
  const zoom = Math.min(size.w / bounds.width, size.h / bounds.height);
  const z = Math.max(0.05, Math.min(8, zoom));
  return { x: bounds.x + bounds.width / 2 - size.w / (2 * z), y: bounds.y + bounds.height / 2 - size.h / (2 * z), zoom: z };
}

export function contentBounds(objects: WbObject[], pad = 40): { x: number; y: number; width: number; height: number } {
  if (objects.length === 0) return { x: -600, y: -400, width: 1200, height: 800 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const o of objects) {
    const b = objectBounds(o);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  if (!Number.isFinite(minX)) return { x: -600, y: -400, width: 1200, height: 800 };
  return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}

export function objectBounds(o: WbObject): { x: number; y: number; width: number; height: number } {
  const pad = o.kind === 'stroke' ? styleOf(o).width / 2 + 1 : 2;
  switch (o.kind) {
    case 'stroke': {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i + 1 < o.points.length; i += 2) {
        minX = Math.min(minX, o.points[i]);
        minY = Math.min(minY, o.points[i + 1]);
        maxX = Math.max(maxX, o.points[i]);
        maxY = Math.max(maxY, o.points[i + 1]);
      }
      if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
      return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
    }
    case 'line':
    case 'arrow':
    case 'rect':
    case 'ellipse':
      return {
        x: Math.min(o.x1, o.x2) - pad,
        y: Math.min(o.y1, o.y2) - pad,
        width: Math.abs(o.x2 - o.x1) + pad * 2,
        height: Math.abs(o.y2 - o.y1) + pad * 2,
      };
    case 'text': {
      const size = styleOf(o).fontSize ?? 32;
      const lines = o.text.split('\n');
      const width = Math.max(...lines.map((l) => l.length)) * size * 0.56 + 8;
      return { x: o.x - 4, y: o.y - 4, width: Math.max(60, width), height: lines.length * size * 1.3 + 8 };
    }
    case 'image':
      return { x: o.x, y: o.y, width: o.w, height: o.h };
    case 'number':
      return { x: o.x - o.radius, y: o.y - o.radius, width: o.radius * 2, height: o.radius * 2 };
    default:
      return { x: 0, y: 0, width: 0, height: 0 };
  }
}

/* ------------------------------------------------------------------ *
 * Image cache
 * ------------------------------------------------------------------ */

interface CacheEntry {
  img: HTMLImageElement;
  ready: boolean;
}

export class ImageCache {
  private cache = new Map<string, CacheEntry>();
  private listeners = new Set<() => void>();

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get(src: string): CacheEntry | null {
    if (!src) return null;
    const existing = this.cache.get(src);
    if (existing) return existing;
    const img = new Image();
    const entry: CacheEntry = { img, ready: false };
    this.cache.set(src, entry);
    img.onload = () => {
      entry.ready = true;
      this.listeners.forEach((l) => l());
    };
    img.onerror = () => {
      entry.ready = false;
    };
    img.src = src.startsWith('data:') || src.startsWith('juzt-media:') ? src : mediaUrl(src);
    return entry;
  }
}

export const imageCache = new ImageCache();

/* ------------------------------------------------------------------ *
 * Rasteriser
 * ------------------------------------------------------------------ */

export interface DrawOpts {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  dpr: number;
  view: ScreenTransform;
  objects: WbObject[];
  themeId?: WhiteboardThemeId;
  selection?: string[];
  /** Live preview objects (e.g. the shape being dragged) drawn on top. */
  preview?: WbObject | null;
}

export function drawWhiteboard(opts: DrawOpts): void {
  const { ctx, width, height, dpr, view, objects, preview } = opts;
  const t = theme(opts.themeId);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = t.background;
  ctx.fillRect(0, 0, width, height);
  drawPattern(ctx, t, view, width, height);

  ctx.save();
  ctx.translate(-view.x * view.zoom, -view.y * view.zoom);
  ctx.scale(view.zoom, view.zoom);

  // Cull to the visible board rect: big boards stay cheap.
  const visible = {
    x: view.x - 40,
    y: view.y - 40,
    w: width / view.zoom + 80,
    h: height / view.zoom + 80,
  };

  const sorted = [...objects].sort((a, b) => a.z - b.z);
  for (const o of sorted) {
    const b = objectBounds(o);
    if (b.x > visible.x + visible.w || b.x + b.width < visible.x || b.y > visible.y + visible.h || b.y + b.height < visible.y) continue;
    drawObject(ctx, o);
  }
  if (preview) drawObject(ctx, preview);

  if (opts.selection?.length) {
    ctx.save();
    ctx.strokeStyle = 'rgba(110,168,255,0.95)';
    ctx.setLineDash([6 / view.zoom, 5 / view.zoom]);
    ctx.lineWidth = 1.5 / view.zoom;
    for (const o of objects) {
      if (!opts.selection.includes(o.id)) continue;
      const b = objectBounds(o);
      ctx.strokeRect(b.x, b.y, b.width, b.height);
    }
    ctx.restore();
  }
  ctx.restore();
}

function drawPattern(ctx: CanvasRenderingContext2D, t: WhiteboardTheme, view: ScreenTransform, width: number, height: number): void {
  if (t.pattern === 'none') return;
  const size = t.patternSize * view.zoom;
  if (size < 6) return;
  ctx.save();
  ctx.strokeStyle = t.patternColor;
  ctx.fillStyle = t.patternColor;
  ctx.lineWidth = 1;
  const offsetX = -((view.x * view.zoom) % size);
  const offsetY = -((view.y * view.zoom) % size);
  if (t.pattern === 'grid' || t.pattern === 'lines') {
    ctx.beginPath();
    for (let x = offsetX; x < width; x += size) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, height);
    }
    if (t.pattern === 'grid') {
      for (let y = offsetY; y < height; y += size) {
        ctx.moveTo(0, Math.round(y) + 0.5);
        ctx.lineTo(width, Math.round(y) + 0.5);
      }
    }
    ctx.stroke();
  } else {
    for (let x = offsetX; x < width; x += size) {
      for (let y = offsetY; y < height; y += size) {
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.8, view.zoom), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

/** Images carry no style; everything else does. */
export function styleOf(o: WbObject, fallback = '#ffffff', width = 3): WbStyle {
  const style = (o as { style?: WbStyle }).style;
  return style ?? { color: fallback, width, opacity: 1 };
}

export function drawObject(ctx: CanvasRenderingContext2D, o: WbObject): void {
  const style = styleOf(o);
  ctx.save();
  ctx.globalAlpha = style.opacity ?? 1;
  ctx.strokeStyle = style.color;
  ctx.fillStyle = style.fill ?? 'transparent';
  ctx.lineWidth = style.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (o.kind) {
    case 'stroke': {
      const pts = o.points;
      if (pts.length < 2) break;
      ctx.beginPath();
      if (pts.length === 2) {
        ctx.arc(pts[0], pts[1], Math.max(0.5, style.width / 2), 0, Math.PI * 2);
        ctx.fillStyle = style.color;
        ctx.fill();
        break;
      }
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i + 3 < pts.length; i += 2) {
        const mx = (pts[i] + pts[i + 2]) / 2;
        const my = (pts[i + 1] + pts[i + 3]) / 2;
        ctx.quadraticCurveTo(pts[i], pts[i + 1], mx, my);
      }
      ctx.lineTo(pts[pts.length - 2], pts[pts.length - 1]);
      ctx.stroke();
      break;
    }
    case 'line':
      ctx.beginPath();
      ctx.moveTo(o.x1, o.y1);
      ctx.lineTo(o.x2, o.y2);
      ctx.stroke();
      break;
    case 'arrow': {
      ctx.beginPath();
      ctx.moveTo(o.x1, o.y1);
      ctx.lineTo(o.x2, o.y2);
      ctx.stroke();
      const angle = Math.atan2(o.y2 - o.y1, o.x2 - o.x1);
      const head = Math.max(12, style.width * 3.2);
      ctx.beginPath();
      ctx.moveTo(o.x2, o.y2);
      ctx.lineTo(o.x2 - head * Math.cos(angle - 0.42), o.y2 - head * Math.sin(angle - 0.42));
      ctx.lineTo(o.x2 - head * Math.cos(angle + 0.42), o.y2 - head * Math.sin(angle + 0.42));
      ctx.closePath();
      ctx.fillStyle = style.color;
      ctx.fill();
      break;
    }
    case 'rect': {
      const x = Math.min(o.x1, o.x2);
      const y = Math.min(o.y1, o.y2);
      const w = Math.abs(o.x2 - o.x1);
      const h = Math.abs(o.y2 - o.y1);
      if (style.fill) ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      break;
    }
    case 'ellipse': {
      ctx.beginPath();
      ctx.ellipse((o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2, Math.abs(o.x2 - o.x1) / 2, Math.abs(o.y2 - o.y1) / 2, 0, 0, Math.PI * 2);
      if (style.fill) ctx.fill();
      ctx.stroke();
      break;
    }
    case 'text': {
      const size = style.fontSize ?? 32;
      ctx.fillStyle = style.color;
      ctx.font = `600 ${size}px "Segoe UI", system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      o.text.split('\n').forEach((line, i) => ctx.fillText(line, o.x, o.y + i * size * 1.28));
      break;
    }
    case 'number': {
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.radius, 0, Math.PI * 2);
      ctx.fillStyle = style.color;
      ctx.fill();
      ctx.fillStyle = contrastOn(style.color);
      ctx.font = `700 ${o.radius * 1.05}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(o.n), o.x, o.y + o.radius * 0.05);
      break;
    }
    case 'image': {
      const entry = imageCache.get(o.src);
      if (entry?.ready) ctx.drawImage(entry.img, o.x, o.y, o.w, o.h);
      else {
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(o.x, o.y, o.w, o.h);
      }
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

function contrastOn(color: string): string {
  const hex = color.replace('#', '');
  if (hex.length < 6) return '#fff';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#111318' : '#ffffff';
}

/* ------------------------------------------------------------------ *
 * Read-only canvas (audience + previews)
 * ------------------------------------------------------------------ */

export const WhiteboardCanvas: React.FC<{
  doc: WhiteboardDoc;
  theme?: WhiteboardThemeId;
  size: { w: number; h: number };
  /** Use the document view (audience) instead of fitting the content. */
  useDocView?: boolean;
}> = ({ doc, theme: themeId, size, useDocView }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);

  useEffect(() => imageCache.onChange(() => force((n) => n + 1)), []);

  const view = useMemo<WbView>(() => {
    if (useDocView !== false) return doc.view;
    return fitView(doc.objects, { w: size.w, h: size.h });
  }, [doc.view, doc.objects, size.w, size.h, useDocView]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(size.w));
    const h = Math.max(1, Math.round(size.h));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawWhiteboard({ ctx, width: w, height: h, dpr, view, objects: doc.objects, themeId: themeId ?? doc.theme });
  }, [doc.objects, doc.rev, doc.theme, themeId, size.w, size.h, view]);

  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: size.w, height: size.h }} />;
};
