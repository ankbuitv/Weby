/**
 * Website annotation ink: model, ops and rasteriser.
 *
 * The ink layer lives *above* the website's native view, so it is drawn by a
 * transparent WebContentsView (the overlay) in PREP and by the audience surface
 * in the LIVE window. Both use this module, so both produce identical pixels.
 *
 * Ops (never full snapshots) travel over IPC:
 *   add | remove | clear | live | replay
 *
 * Points are stored in *normalised* card coordinates (0..1), so the same ink is
 * correct on the teacher's 1440p card and the projector's 4K output.
 */

import type { ToolId } from '../../shared/types';

export interface InkStroke {
  kind: 'stroke';
  id: string;
  tool: 'pen' | 'marker' | 'highlighter' | 'eraser';
  points: number[];
  color: string;
  size: number;
  opacity: number;
}

export interface InkText {
  kind: 'text';
  id: string;
  text: string;
  x: number;
  y: number;
  color: string;
  fontSize: number;
}

export interface InkNumber {
  kind: 'number';
  id: string;
  n: number;
  x: number;
  y: number;
  color: string;
  radius: number;
}

export interface InkSpotlight extends Omit<InkStroke, 'kind' | 'tool'> {
  kind: 'spotlight';
  tool: 'spotlight';
}

export type InkItem = InkStroke | InkText | InkNumber | InkSpotlight;

export type InkOp =
  | { kind: 'add'; item: InkItem }
  | { kind: 'remove'; ids: string[] }
  | { kind: 'clear' }
  | { kind: 'live'; item: InkItem | null }
  | { kind: 'replay'; items: InkItem[] };

const MAX_ITEMS = 2000;
const MAX_HISTORY = 120;

let inkSeq = 0;

/**
 * Unique id for an ink item.
 *
 * A monotonic counter is what makes this safe: two strokes committed in the same
 * millisecond (which happens on a fast double-tap) must never share an id, or a
 * later `remove` would delete both of them.
 */
export function newInkId(prefix = 'ink'): string {
  inkSeq = (inkSeq + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${inkSeq.toString(36)}`;
}

/** Ink model with op-based undo (a stroke's remove is undone by re-adding it). */
export class InkModel {
  items: InkItem[] = [];
  private undoStack: InkOp[] = [];
  private redoStack: InkOp[] = [];

  apply(op: InkOp): void {
    switch (op.kind) {
      case 'add':
        this.items = [...this.items, op.item].slice(-MAX_ITEMS);
        break;
      case 'remove': {
        const ids = new Set(op.ids);
        this.items = this.items.filter((i) => !ids.has(i.id));
        break;
      }
      case 'clear':
        this.items = [];
        break;
      case 'replay':
        this.items = op.items.slice(-MAX_ITEMS);
        break;
      case 'live':
        break; // live strokes are never committed here
    }
  }

  /** Commit a new item, remembering how to undo it. */
  add(item: InkItem): InkOp {
    const op: InkOp = { kind: 'add', item };
    this.apply(op);
    this.pushUndo(op, { kind: 'remove', ids: [item.id] });
    return op;
  }

  remove(ids: string[]): InkOp {
    const previous = this.items;
    const removed = previous.filter((i) => ids.includes(i.id));
    const op: InkOp = { kind: 'remove', ids };
    this.apply(op);
    // Undoing an erase restores the exact previous list, so the strokes come
    // back in their original z-order instead of being appended on top.
    if (removed.length) this.pushUndo(op, { kind: 'replay', items: previous });
    return op;
  }

  eraseAt(x: number, y: number, radius: number): InkItem[] {
    const hit = this.items.filter((item) => item.kind !== 'spotlight' && itemHit(item, x, y, radius));
    return hit;
  }

  clear(): InkOp {
    const op: InkOp = { kind: 'clear' };
    const previous = this.items;
    this.apply(op);
    if (previous.length) this.pushUndo(op, { kind: 'replay', items: previous });
    return op;
  }

  undo(): InkOp | null {
    const op = this.undoStack.pop();
    if (!op) return null;
    const inverse = invert(this.items, op);
    this.apply(op);
    if (inverse) this.redoStack.push(inverse);
    return op;
  }

  redo(): InkOp | null {
    const op = this.redoStack.pop();
    if (!op) return null;
    const inverse = invert(this.items, op);
    this.apply(op);
    if (inverse) this.undoStack.push(inverse);
    return op;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  private pushUndo(forward: InkOp, inverse: InkOp): void {
    this.undoStack.push(inverse);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    void forward;
  }
}

function invert(current: InkItem[], op: InkOp): InkOp | null {
  switch (op.kind) {
    case 'add':
      return { kind: 'remove', ids: [op.item.id] };
    case 'remove':
      // `current` is the state *before* the op ran, so replaying it is a lossless
      // undo. Appending the removed items to the live list instead would
      // duplicate them on the next redo.
      return current.length ? { kind: 'replay', items: current.slice(-MAX_ITEMS) } : null;
    case 'clear':
      return current.length ? { kind: 'replay', items: current } : null;
    case 'replay':
      return current.length ? { kind: 'replay', items: current } : { kind: 'clear' };
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 * Hit testing (normalised coordinates)
 * ------------------------------------------------------------------ */

function itemHit(item: InkItem, x: number, y: number, radius: number): boolean {
  switch (item.kind) {
    case 'stroke':
    case 'spotlight': {
      const tol = radius + item.size / 2000;
      for (let i = 0; i + 3 < item.points.length; i += 2) {
        const d = distToSegment(x, y, item.points[i], item.points[i + 1], item.points[i + 2], item.points[i + 3]);
        if (d <= tol) return true;
      }
      if (item.points.length === 2) {
        return Math.hypot(x - item.points[0], y - item.points[1]) <= tol;
      }
      return false;
    }
    case 'text': {
      const width = Math.max(item.fontSize / 1000, item.text.length * (item.fontSize / 1600));
      const height = item.fontSize / 900;
      return x >= item.x - 0.01 && x <= item.x + width && y >= item.y - height && y <= item.y + height;
    }
    case 'number':
      return Math.hypot(x - item.x, y - item.y) <= item.radius / 1000 + radius;
    default:
      return false;
  }
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const wx = px - x1;
  const wy = py - y1;
  const len = vx * vx + vy * vy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len));
  return Math.hypot(px - (x1 + t * vx), py - (y1 + t * vy));
}

/* ------------------------------------------------------------------ *
 * Rasteriser
 * ------------------------------------------------------------------ */

export interface InkCanvasOpts {
  /** Card size in CSS px. */
  width: number;
  height: number;
  dpr: number;
  items: InkItem[];
  live?: InkItem | null;
  laser?: { points: number[]; color: string; alpha: number } | null;
}

/**
 * Draw the committed ink into `ctx`. Assumes the canvas has already been sized
 * (`width * dpr`, `height * dpr`) and cleared.
 */
export function drawInk(ctx: CanvasRenderingContext2D, opts: InkCanvasOpts): void {
  const { width, height, dpr, items, live, laser } = opts;
  ctx.save();
  ctx.scale(width * dpr, height * dpr);
  for (const item of items) drawItem(ctx, item);
  if (live) drawItem(ctx, live);
  if (laser && laser.points.length >= 2) drawLaser(ctx, laser.points, laser.color, laser.alpha);
  ctx.restore();
}

function drawItem(ctx: CanvasRenderingContext2D, item: InkItem): void {
  switch (item.kind) {
    case 'stroke': {
      if (item.points.length < 2) return;
      ctx.save();
      ctx.globalAlpha = item.opacity;
      ctx.strokeStyle = item.color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(0.0008, item.size / 1000);
      ctx.beginPath();
      ctx.moveTo(item.points[0], item.points[1]);
      for (let i = 2; i + 1 < item.points.length; i += 2) ctx.lineTo(item.points[i], item.points[i + 1]);
      if (item.points.length === 2) ctx.lineTo(item.points[0] + 0.0001, item.points[1]);
      ctx.stroke();
      ctx.restore();
      return;
    }
    case 'spotlight':
      return;
    case 'text': {
      ctx.save();
      ctx.fillStyle = item.color;
      const size = item.fontSize / 1000;
      ctx.font = `600 ${size}px "Segoe UI", system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      const lines = item.text.split('\n').slice(0, 12);
      lines.forEach((line, i) => ctx.fillText(line.slice(0, 200), item.x, item.y + i * size * 1.25));
      ctx.restore();
      return;
    }
    case 'number': {
      ctx.save();
      const r = item.radius / 1000;
      ctx.beginPath();
      ctx.arc(item.x, item.y, r, 0, Math.PI * 2);
      ctx.fillStyle = item.color;
      ctx.fill();
      ctx.fillStyle = contrastOn(item.color);
      ctx.font = `600 ${r * 1.1}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(item.n), item.x, item.y + r * 0.06);
      ctx.restore();
      return;
    }
    default:
      return;
  }
}

function drawLaser(ctx: CanvasRenderingContext2D, points: number[], color: string, alpha: number): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i + 3 < points.length; i += 2) {
    const t = i / Math.max(2, points.length - 2);
    ctx.globalAlpha = alpha * (0.25 + 0.75 * t);
    ctx.lineWidth = 0.002 + 0.004 * t;
    ctx.beginPath();
    ctx.moveTo(points[i], points[i + 1]);
    ctx.lineTo(points[i + 2], points[i + 3]);
    ctx.stroke();
  }
  const n = points.length;
  if (n >= 2) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(points[n - 2], points[n - 1], 0.008, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function contrastOn(color: string): string {
  const hex = color.replace('#', '');
  if (hex.length < 6) return '#fff';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#111318' : '#ffffff';
}

/**
 * Convert a pixel thickness into the normalised unit used by the ink model
 * (1000 = one card width), so a stroke keeps its visual weight on any display.
 */
export function inkSize(px: number, cardWidth: number): number {
  return (Math.max(0.5, px) / Math.max(320, cardWidth)) * 1000;
}

/** Effective thickness + alpha for a tool. */
export function styleForTool(tool: ToolId, size: number, opacity: number): { size: number; opacity: number } {
  switch (tool) {
    case 'highlighter':
      return { size: size * 3.2, opacity: 0.35 };
    case 'marker':
      return { size: size * 1.9, opacity: Math.min(1, opacity) * 0.92 };
    default:
      return { size, opacity };
  }
}
