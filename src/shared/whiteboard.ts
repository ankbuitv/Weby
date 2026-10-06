/**
 * Whiteboard document model, ops and geometry.
 *
 * The document is a vector/object list — never one giant bitmap and never a
 * screenshot. All coordinate maths lives here so the PREP editor, the LIVE
 * renderer and the tests agree.
 *
 * Coordinate spaces:
 *  - board space: unbounded, origin 0,0, `zoom` scales it;
 *  - screen space: pixels inside the visible editor/card.
 */

import {
  SCHEMA_VERSION,
  WHITEBOARD_THEMES,
  type Rect,
  type WbObject,
  type WbOp,
  type WbStyle,
  type WbView,
  type WhiteboardDoc,
  type WhiteboardMeta,
  type WhiteboardTheme,
  type WhiteboardThemeId,
} from './types';

export const BOARD_SCHEMA_VERSION = SCHEMA_VERSION;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

let idCounter = 0;
export function newId(prefix = 'ob'): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function theme(id: WhiteboardThemeId): WhiteboardTheme {
  return WHITEBOARD_THEMES.find((t) => t.id === id) ?? WHITEBOARD_THEMES[0];
}

export function createDoc(name = 'Whiteboard', themeId: WhiteboardThemeId = 'dark'): WhiteboardDoc {
  return {
    schemaVersion: BOARD_SCHEMA_VERSION,
    id: newId('wb'),
    name,
    theme: themeId,
    objects: [],
    view: { x: 0, y: 0, zoom: 1 },
    updatedAt: Date.now(),
    rev: 0,
  };
}

/* ------------------------------------------------------------------ *
 * Ops
 * ------------------------------------------------------------------ */

/** Apply an op, returning a new document (structural sharing where possible). */
export function applyOp(doc: WhiteboardDoc, op: WbOp): WhiteboardDoc {
  const base = { ...doc, rev: doc.rev + 1, updatedAt: Date.now() };
  switch (op.type) {
    case 'add': {
      if (!op.objects.length) return base;
      return { ...base, objects: [...doc.objects, ...op.objects] };
    }
    case 'delete': {
      const ids = new Set(op.ids);
      const objects = doc.objects.filter((o) => !ids.has(o.id));
      return objects.length === doc.objects.length ? base : { ...base, objects };
    }
    case 'move': {
      if (!op.dx && !op.dy) return base;
      const ids = new Set(op.ids);
      const objects = doc.objects.map((o) => (ids.has(o.id) ? translateObject(o, op.dx, op.dy) : o));
      return { ...base, objects };
    }
    case 'replace': {
      let hit = false;
      const objects = doc.objects.map((o) => {
        if (o.id !== op.id) return o;
        hit = true;
        return op.object;
      });
      return hit ? { ...base, objects } : base;
    }
    case 'clear':
      return doc.objects.length === 0 ? base : { ...base, objects: [] };
    case 'theme':
      return { ...base, theme: op.theme };
    case 'name':
      return { ...base, name: op.name.slice(0, 80) };
    case 'view':
      return { ...base, view: clampView(op.view) };
    default:
      return base;
  }
}

export function applyOps(doc: WhiteboardDoc, ops: WbOp[]): WhiteboardDoc {
  return ops.reduce(applyOp, doc);
}

export function clampView(view: WbView): WbView {
  return { x: view.x, y: view.y, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom)) };
}

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

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

export function strokeBounds(points: number[], width: number): Rect {
  if (points.length < 2) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i];
    const y = points[i + 1];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const pad = width / 2 + 1;
  return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}

export function objectBounds(o: WbObject): Rect {
  switch (o.kind) {
    case 'stroke':
      return strokeBounds(o.points, o.style.width);
    case 'line':
    case 'arrow': {
      const pad = o.style.width / 2 + 2;
      const x = Math.min(o.x1, o.x2) - pad;
      const y = Math.min(o.y1, o.y2) - pad;
      return { x, y, width: Math.abs(o.x2 - o.x1) + pad * 2, height: Math.abs(o.y2 - o.y1) + pad * 2 };
    }
    case 'rect':
    case 'ellipse':
      return {
        x: Math.min(o.x1, o.x2) - 1,
        y: Math.min(o.y1, o.y2) - 1,
        width: Math.abs(o.x2 - o.x1) + 2,
        height: Math.abs(o.y2 - o.y1) + 2,
      };
    case 'text': {
      const size = o.style.fontSize ?? 32;
      const width = Math.max(size * 0.6, o.text.length * size * 0.56);
      return { x: o.x, y: o.y, width, height: size * 1.35 };
    }
    case 'image':
      return { x: o.x, y: o.y, width: o.w, height: o.h };
    case 'number': {
      const r = o.radius;
      return { x: o.x - r, y: o.y - r, width: r * 2, height: r * 2 };
    }
    default:
      return { x: 0, y: 0, width: 0, height: 0 };
  }
}

export function unionBounds(objects: WbObject[]): Rect {
  if (objects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const o of objects) {
    const b = objectBounds(o);
    if (b.width === 0 && b.height === 0) continue;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function contentBounds(objects: WbObject[], pad = 40): Rect {
  const b = unionBounds(objects);
  if (b.width === 0 && b.height === 0) return { x: -400, y: -300, width: 800, height: 600 };
  return { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
}

export function translateObject(o: WbObject, dx: number, dy: number): WbObject {
  switch (o.kind) {
    case 'stroke': {
      const points = o.points.slice();
      for (let i = 0; i < points.length; i += 2) {
        points[i] += dx;
        points[i + 1] += dy;
      }
      return { ...o, points };
    }
    case 'line':
    case 'arrow':
    case 'rect':
    case 'ellipse':
      return { ...o, x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy };
    case 'text':
    case 'image':
    case 'number':
      return { ...o, x: o.x + dx, y: o.y + dy };
    default:
      return o;
  }
}

/** Scale an object about a pivot (resize handles / multi-select transforms). */
export function scaleObject(o: WbObject, sx: number, sy: number, px: number, py: number, minSize = 6): WbObject {
  const fx = (x: number) => px + (x - px) * sx;
  const fy = (y: number) => py + (y - py) * sy;
  switch (o.kind) {
    case 'stroke': {
      const points = o.points.slice();
      for (let i = 0; i < points.length; i += 2) {
        points[i] = fx(points[i]);
        points[i + 1] = fy(points[i + 1]);
      }
      return { ...o, points, style: { ...o.style, width: Math.max(0.5, o.style.width * (Math.abs(sx) + Math.abs(sy)) / 2) } };
    }
    case 'line':
    case 'arrow':
    case 'rect':
    case 'ellipse':
      return { ...o, x1: fx(o.x1), y1: fy(o.y1), x2: fx(o.x2), y2: fy(o.y2) };
    case 'text':
      return { ...o, x: fx(o.x), y: fy(o.y), style: { ...o.style, fontSize: Math.max(8, (o.style.fontSize ?? 32) * ((Math.abs(sx) + Math.abs(sy)) / 2)) } };
    case 'image':
      return { ...o, x: fx(o.x), y: fy(o.y), w: Math.max(minSize, o.w * Math.abs(sx)), h: Math.max(minSize, o.h * Math.abs(sy)) };
    case 'number':
      return { ...o, x: fx(o.x), y: fy(o.y), radius: Math.max(6, o.radius * ((Math.abs(sx) + Math.abs(sy)) / 2)) };
    default:
      return o;
  }
}

/** Distance from a point to a segment (squared, cheaper). */
function distToSegmentSq(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const wx = px - x1;
  const wy = py - y1;
  const len = vx * vx + vy * vy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len));
  const dx = px - (x1 + t * vx);
  const dy = py - (y1 + t * vy);
  return dx * dx + dy * dy;
}

/** Points for hit-testing a stroke, respecting the 2-point grouping. */
function strokeHit(o: Extract<WbObject, { kind: 'stroke' }>, x: number, y: number, tolerance: number): boolean {
  const tol = tolerance + o.style.width / 2;
  const tolSq = tol * tol;
  const pts = o.points;
  if (pts.length === 2) {
    const dx = x - pts[0];
    const dy = y - pts[1];
    return dx * dx + dy * dy <= tolSq;
  }
  for (let i = 0; i + 3 < pts.length; i += 2) {
    if (distToSegmentSq(x, y, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]) <= tolSq) return true;
  }
  return false;
}

export function hitTest(o: WbObject, x: number, y: number, tolerance = 6): boolean {
  switch (o.kind) {
    case 'stroke':
      return strokeHit(o, x, y, tolerance);
    case 'line':
    case 'arrow':
      return distToSegmentSq(x, y, o.x1, o.y1, o.x2, o.y2) <= (tolerance + o.style.width / 2) ** 2;
    case 'rect': {
      const b = objectBounds(o);
      const grown = { x: b.x - tolerance, y: b.y - tolerance, w: b.width + tolerance * 2, h: b.height + tolerance * 2 };
      const inside = x >= grown.x && x <= grown.x + grown.w && y >= grown.y && y <= grown.y + grown.h;
      if (!inside) return false;
      if (o.style.fill) return true;
      // Hollow: near an edge only.
      const near = Math.min(Math.abs(x - b.x), Math.abs(x - (b.x + b.width)), Math.abs(y - b.y), Math.abs(y - (b.y + b.height)));
      return near <= tolerance + o.style.width;
    }
    case 'ellipse': {
      const b = objectBounds(o);
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      const rx = b.width / 2 + tolerance;
      const ry = b.height / 2 + tolerance;
      const v = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (o.style.fill) return v <= 1;
      return v <= 1 && v >= 0.55;
    }
    case 'text':
    case 'image':
    case 'number': {
      const b = objectBounds(o);
      return x >= b.x - tolerance && x <= b.x + b.width + tolerance && y >= b.y - tolerance && y <= b.y + b.height + tolerance;
    }
    default:
      return false;
  }
}

/** Topmost object under the cursor (highest z wins). */
export function objectAt(objects: WbObject[], x: number, y: number, tolerance = 6): WbObject | null {
  let best: WbObject | null = null;
  for (const o of objects) {
    if (!hitTest(o, x, y, tolerance)) continue;
    if (!best || o.z >= best.z) best = o;
  }
  return best;
}

export function nextZ(objects: WbObject[]): number {
  let z = 0;
  for (const o of objects) if (o.z > z) z = o.z;
  return z + 1;
}

/* ------------------------------------------------------------------ *
 * Eraser
 * ------------------------------------------------------------------ */

/** Objects whose *interior* (not just outline) is erased by a circular eraser. */
export function eraseAt(objects: WbObject[], x: number, y: number, radius: number): string[] {
  const ids: string[] = [];
  for (const o of objects) {
    if (hitTest(o, x, y, radius)) ids.push(o.id);
  }
  return ids;
}

/* ------------------------------------------------------------------ *
 * Selection handles
 * ------------------------------------------------------------------ */

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const HANDLES: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function handlePoint(b: Rect, h: HandleId): { x: number; y: number } {
  const x = h.includes('w') ? b.x : h.includes('e') ? b.x + b.width : b.x + b.width / 2;
  const y = h.startsWith('n') ? b.y : h.startsWith('s') ? b.y + b.height : b.y + b.height / 2;
  return { x, y };
}

/** Scale factors for dragging a handle, relative to the opposite corner. */
export function handleScale(start: Rect, h: HandleId, px: number, py: number): { sx: number; sy: number; px: number; py: number } {
  const anchor = handlePoint(start, flipHandle(h));
  const sx = h.includes('w') || h.includes('e') ? (start.width === 0 ? 1 : (px - anchor.x) / (handlePoint(start, h).x - anchor.x || 1)) : 1;
  const sy = h.startsWith('n') || h.startsWith('s') ? (start.height === 0 ? 1 : (py - anchor.y) / (handlePoint(start, h).y - anchor.y || 1)) : 1;
  return { sx, sy, px: anchor.x, py: anchor.y };
}

export function flipHandle(h: HandleId): HandleId {
  switch (h) {
    case 'nw':
      return 'se';
    case 'n':
      return 's';
    case 'ne':
      return 'sw';
    case 'e':
      return 'w';
    case 'se':
      return 'nw';
    case 's':
      return 'n';
    case 'sw':
      return 'ne';
    default:
      return 'e';
  }
}

/* ------------------------------------------------------------------ *
 * Factories
 * ------------------------------------------------------------------ */

export function strokeStyle(tool: 'pen' | 'marker' | 'highlighter', color: string, width: number, opacity: number): WbStyle {
  if (tool === 'highlighter') return { color, width: Math.max(8, width * 3), opacity: 0.35 };
  if (tool === 'marker') return { color, width: Math.max(6, width * 2), opacity: Math.min(1, opacity) };
  return { color, width, opacity: 1 };
}

export function serialize(doc: WhiteboardDoc): string {
  return JSON.stringify(doc);
}

/** Migrate an on-disk document of any older schema into the current model. */
export function migrateDoc(input: unknown): WhiteboardDoc | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<WhiteboardDoc> & { version?: number; strokes?: unknown };
  // A document written by a *newer* Juzt is refused rather than misread: loading
  // it would silently drop fields we do not know about and the next autosave
  // would then overwrite the teacher's work with the lossy copy.
  if (typeof raw.schemaVersion === 'number' && raw.schemaVersion > BOARD_SCHEMA_VERSION) return null;
  // Refuse anything that does not look like a board at all. Silently turning a
  // corrupt file into an empty document would autosave over the original.
  const recognisable = typeof raw.id === 'string' || Array.isArray(raw.objects) || Array.isArray(raw.strokes) || typeof raw.name === 'string';
  if (!recognisable) return null;
  const base = createDoc(typeof raw.name === 'string' ? raw.name : 'Whiteboard', (raw.theme as WhiteboardThemeId) ?? 'dark');
  const doc: WhiteboardDoc = {
    ...base,
    id: typeof raw.id === 'string' ? raw.id : base.id,
    name: typeof raw.name === 'string' ? raw.name : base.name,
    theme: (raw.theme as WhiteboardThemeId) ?? base.theme,
    objects: Array.isArray(raw.objects) ? (raw.objects as WbObject[]) : [],
    view: raw.view && typeof raw.view === 'object' ? clampView({ x: 0, y: 0, zoom: 1, ...(raw.view as Partial<WbView>) }) : base.view,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    rev: typeof raw.rev === 'number' ? raw.rev : 0,
    schemaVersion: BOARD_SCHEMA_VERSION,
  };
  // Drop objects we cannot render rather than crashing the board.
  doc.objects = doc.objects.filter((o) => !!o && typeof o === 'object' && typeof (o as WbObject).kind === 'string');
  return doc;
}

export function metaOf(doc: WhiteboardDoc): WhiteboardMeta {
  return { id: doc.id, name: doc.name, theme: doc.theme, updatedAt: doc.updatedAt, objectCount: doc.objects.length };
}
