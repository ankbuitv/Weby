import React from 'react';
import {
  HANDLES,
  MAX_ZOOM,
  MIN_ZOOM,
  clampView,
  contentBounds,
  eraseAt,
  handleScale,
  hitTest,
  newId,
  nextZ,
  objectAt,
  objectBounds,
  scaleObject,
  strokeStyle,
  translateObject,
  type HandleId,
} from '../../shared/whiteboard';
import type { Rect, WbObject, WbOp, WbStyle, WbView, WhiteboardDoc } from '../../shared/types';
import { actions } from '../state/actions';
import { store, useSel } from '../state/store';
import { drawWhiteboard, fitView } from './render';

/**
 * Whiteboard editor.
 *
 * Everything is object-based: strokes are vectors committed as a single op on
 * pointer-up, drags/resizes are previewed by transforming at paint time and
 * committed once, and nothing is written to disk per pointer event (main
 * debounces autosave). The canvas only rasterises the visible region, so panning
 * feels infinite without ever allocating one huge bitmap.
 */

interface TextDraft {
  x: number;
  y: number;
  value: string;
  editingId?: string;
}

const HANDLE_R = 7;

export const WhiteboardEditor: React.FC<{ doc: WhiteboardDoc }> = ({ doc }) => {
  const boardId = doc.id;
  const tool = useSel((s) => s.wbTool);
  const style = useSel((s) => s.wbStyle);
  const selection = useSel((s) => s.wbSelection);
  const nextNumber = useSel((s) => s.wbNumber);

  const wrapRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [size, setSize] = React.useState({ w: 800, h: 600 });
  const [view, setView] = React.useState<WbView>(() => store.getState().wbView[boardId] ?? doc.view);
  const [textDraft, setTextDraft] = React.useState<TextDraft | null>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);

  const gesture = React.useRef<{
    kind: 'none' | 'draw' | 'erase' | 'pan' | 'move' | 'resize' | 'laser' | 'marquee';
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    view: WbView;
    points: number[];
    ids: string[];
    handle?: HandleId;
    startRect?: Rect;
    moved: boolean;
  }>({ kind: 'none', startX: 0, startY: 0, lastX: 0, lastY: 0, view, points: [], ids: [], moved: false });

  const previewRef = React.useRef<WbObject | null>(null);
  const marqueeRef = React.useRef<Rect | null>(null);
  const laserRef = React.useRef<{ points: number[]; color: string } | null>(null);
  const rafRef = React.useRef(0);
  const lastLaserSent = React.useRef(0);

  /* ---------------------------------------------------------------- *
   * Paint (never runs in a permanent loop)
   * ---------------------------------------------------------------- */

  const paint = React.useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(size.w));
    const h = Math.max(1, Math.round(size.h));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const g = gesture.current;
    const selected = new Set(selection);
    let objects = doc.objects;
    if (g.kind === 'erase' && g.ids.length) {
      const gone = new Set(g.ids);
      objects = objects.filter((o) => !gone.has(o.id));
    } else if (g.kind === 'move' && g.moved && selected.size) {
      const dx = g.lastX - g.startX;
      const dy = g.lastY - g.startY;
      objects = objects.map((o) => (selected.has(o.id) ? translateObject(o, dx, dy) : o));
    } else if (g.kind === 'resize' && g.startRect && selection.length === 1 && previewRef.current) {
      objects = doc.objects.map((o) => (o.id === selection[0] ? previewRef.current as WbObject : o));
    }
    drawWhiteboard({
      ctx,
      width: w,
      height: h,
      dpr,
      view,
      objects,
      themeId: doc.theme,
      selection: g.kind === 'move' || g.kind === 'resize' || tool === 'select' ? selection : [],
      preview: previewRef.current,
    });
    drawOverlay(ctx, { w, h }, view, laserRef.current, marqueeRef.current);
  }, [doc.objects, doc.theme, selection, size.h, size.w, tool, view]);

  React.useEffect(() => {
    paint();
  }, [paint, doc.rev]);

  const schedulePaint = React.useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      paint();
    });
  }, [paint]);

  React.useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  /* ---------------------------------------------------------------- *
   * Size + view bookkeeping
   * ---------------------------------------------------------------- */

  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let pending = 0;
    const apply = () => {
      pending = 0;
      const box = el.getBoundingClientRect();
      setSize((prev) => (Math.abs(prev.w - box.width) < 1 && Math.abs(prev.h - box.height) < 1 ? prev : { w: box.width, h: box.height }));
    };
    const ro = new ResizeObserver(() => {
      if (pending) return;
      pending = requestAnimationFrame(apply);
    });
    ro.observe(el);
    apply();
    return () => {
      if (pending) cancelAnimationFrame(pending);
      ro.disconnect();
    };
  }, []);

  // Reset the local view when the document changes; publish it for persistence.
  React.useEffect(() => {
    const stored = store.getState().wbView[boardId];
    setView(stored ?? doc.view);
    gesture.current.kind = 'none';
    previewRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  const commitView = React.useCallback(
    (next: WbView) => {
      const clamped = clampView(next);
      setView(clamped);
      store.set((s) => ({ wbView: { ...s.wbView, [boardId]: clamped } }));
      void actions.wbOps(boardId, [{ type: 'view', view: clamped }]);
    },
    [boardId],
  );

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (textDraft) return;
      if (e.key === ' ' && !spaceHeld.current) spaceHeld.current = true;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length) {
        e.preventDefault();
        void actions.wbOps(boardId, [{ type: 'delete', ids: selection }]);
        actions.setWbSelection([]);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') spaceHeld.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [boardId, selection, textDraft]);

  const spaceHeld = React.useRef(false);

  /* ---------------------------------------------------------------- *
   * Pointer maths
   * ---------------------------------------------------------------- */

  const toBoard = (clientX: number, clientY: number): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const box = canvas.getBoundingClientRect();
    return { x: (clientX - box.left) / view.zoom + view.x, y: (clientY - box.top) / view.zoom + view.y };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (textDraft) return;
    const canvas = e.currentTarget;
    canvas.setPointerCapture(e.pointerId);
    const p = toBoard(e.clientX, e.clientY);
    const g = gesture.current;
    g.startX = p.x;
    g.startY = p.y;
    g.lastX = p.x;
    g.lastY = p.y;
    g.view = view;
    g.points = [];
    g.ids = [];
    g.moved = false;

    const panning = tool === 'hand' || spaceHeld.current || e.button === 1;
    if (panning) {
      g.kind = 'pan';
      return;
    }

    if (tool === 'select') {
      const handle = selection.length === 1 ? handleAt(doc.objects, selection[0], p, view.zoom) : null;
      if (handle) {
        g.kind = 'resize';
        g.handle = handle;
        g.startRect = objectBounds(doc.objects.find((o) => o.id === selection[0]) as WbObject);
        return;
      }
      const hit = objectAt(doc.objects, p.x, p.y, 8 / view.zoom);
      if (hit) {
        const ids = e.shiftKey ? [...new Set([...selection, hit.id])] : selection.includes(hit.id) ? selection : [hit.id];
        actions.setWbSelection(ids);
        g.kind = 'move';
        g.ids = ids;
        return;
      }
      if (!e.shiftKey) actions.setWbSelection([]);
      g.kind = 'marquee';
      return;
    }

    if (tool === 'laser') {
      g.kind = 'laser';
      laserRef.current = { points: [p.x, p.y], color: style.color };
      schedulePaint();
      return;
    }

    if (tool === 'eraser') {
      g.kind = 'erase';
      g.ids = eraseAt(doc.objects, p.x, p.y, style.size * 1.6 + 6);
      schedulePaint();
      return;
    }

    if (tool === 'number') {
      const object: WbObject = {
        id: newId('num'),
        z: nextZ(doc.objects),
        kind: 'number',
        x: p.x,
        y: p.y,
        n: nextNumber,
        radius: Math.max(14, style.size * 5),
        style: { color: style.color, width: 2, opacity: 1 },
      };
      void actions.wbOps(boardId, [{ type: 'add', objects: [object] }]);
      store.set({ wbNumber: nextNumber + 1 });
      return;
    }

    if (tool === 'text') {
      setTextDraft({ x: p.x, y: p.y, value: '' });
      return;
    }

    if (tool === 'image') {
      void actions.wbInsertImage(boardId, p);
      return;
    }

    // pen / marker / highlighter / line / arrow / rect / ellipse
    g.kind = 'draw';
    g.points = [p.x, p.y];
    previewRef.current = makePreview(tool, p, p, style);
    schedulePaint();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    if (g.kind === 'none') return;
    const p = toBoard(e.clientX, e.clientY);
    const dx = p.x - g.startX;
    const dy = p.y - g.startY;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) g.moved = true;

    switch (g.kind) {
      case 'pan': {
        const zoom = g.view.zoom;
        setView(clampView({ x: g.view.x - (p.x - g.startX), y: g.view.y - (p.y - g.startY), zoom }));
        g.lastX = p.x;
        g.lastY = p.y;
        break;
      }
      case 'draw': {
        if (isStrokeTool(tool)) {
          // Coalesced events: a full-rate pointer stream without a re-render each time.
          const events = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : [];
          const list = events.length ? events : [e.nativeEvent];
          const box = e.currentTarget.getBoundingClientRect();
          for (const ev of list) {
            const bx = (ev.clientX - box.left) / view.zoom + view.x;
            const by = (ev.clientY - box.top) / view.zoom + view.y;
            const lastX = g.points[g.points.length - 2];
            const lastY = g.points[g.points.length - 1];
            if (lastX !== undefined && Math.hypot(bx - lastX, by - lastY) < 0.6 / view.zoom) continue;
            g.points.push(bx, by);
          }
          previewRef.current = makeStroke(tool === 'marker' || tool === 'highlighter' ? tool : 'pen', g.points, style);
        } else {
          g.lastX = p.x;
          g.lastY = p.y;
          previewRef.current = makePreview(tool, { x: g.startX, y: g.startY }, p, style);
        }
        schedulePaint();
        break;
      }
      case 'erase': {
        const hits = eraseAt(doc.objects, p.x, p.y, style.size * 1.6 + 6).filter((id) => !g.ids.includes(id));
        if (hits.length) {
          g.ids.push(...hits);
          schedulePaint();
        }
        break;
      }
      case 'move':
      case 'resize':
      case 'marquee': {
        g.lastX = p.x;
        g.lastY = p.y;
        if (g.kind === 'resize' && g.startRect && g.handle) {
          const original = doc.objects.find((o) => o.id === selection[0]);
          if (original) {
            const { sx, sy, px, py } = handleScale(g.startRect, g.handle, p.x, p.y);
            previewRef.current = scaleObject(original, sx, sy, px, py);
          }
        }
        if (g.kind === 'marquee') {
          marqueeRef.current = rectOf(g.startX, g.startY, p.x, p.y);
        }
        schedulePaint();
        break;
      }
      case 'laser': {
        const points = laserRef.current?.points ?? [];
        points.push(p.x, p.y);
        if (points.length > 900) points.splice(0, points.length - 900);
        schedulePaint();
        const now = performance.now();
        if (now - lastLaserSent.current > 33) {
          lastLaserSent.current = now;
          void window.juzt.effects.laser(points, style.color).catch(() => undefined);
        }
        break;
      }
      default:
        break;
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    const p = toBoard(e.clientX, e.clientY);
    gesture.current.kind = 'none';
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    switch (g.kind) {
      case 'draw': {
        const preview = previewRef.current;
        if (preview) {
          if (isStrokeTool(tool) && g.points.length >= 2) {
            const object = { ...(preview as Extract<WbObject, { kind: 'stroke' }>), points: g.points.slice() };
            void actions.wbOps(boardId, [{ type: 'add', objects: [object] }]);
          } else if (!isStrokeTool(tool)) {
            void actions.wbOps(boardId, [{ type: 'add', objects: [preview] }]);
          }
        }
        break;
      }
      case 'erase':
        if (g.ids.length) void actions.wbOps(boardId, [{ type: 'delete', ids: g.ids }]);
        break;
      case 'move':
        if (g.moved && g.ids.length) {
          void actions.wbOps(boardId, [{ type: 'move', ids: g.ids, dx: p.x - g.startX, dy: p.y - g.startY }]);
        }
        break;
      case 'resize': {
        const next = previewRef.current;
        if (next && g.moved) void actions.wbOps(boardId, [{ type: 'replace', id: next.id, object: next }]);
        break;
      }
      case 'marquee': {
        const rect = marqueeRef.current;
        if (rect && (rect.width > 4 || rect.height > 4)) {
          const inside = doc.objects.filter((o) => intersects(objectBounds(o), rect)).map((o) => o.id);
          actions.setWbSelection(e.shiftKey ? [...new Set([...selection, ...inside])] : inside);
        }
        break;
      }
      case 'pan': {
        commitView(view);
        break;
      }
      case 'laser':
        laserRef.current = null;
        void window.juzt.effects.laser([], style.color).catch(() => undefined);
        break;
      default:
        break;
    }
    previewRef.current = null;
    marqueeRef.current = null;
    schedulePaint();
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (e.shiftKey && !e.ctrlKey) {
      commitView({ ...view, x: view.x + e.deltaY / view.zoom });
      return;
    }
    if (e.ctrlKey || e.metaKey || !e.shiftKey) {
      if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 4) {
        commitView({ ...view, y: view.y + e.deltaY / view.zoom });
        return;
      }
      const box = e.currentTarget.getBoundingClientRect();
      const mx = e.clientX - box.left;
      const my = e.clientY - box.top;
      const factor = Math.exp(-e.deltaY / 600);
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
      const bx = mx / view.zoom + view.x;
      const by = my / view.zoom + view.y;
      commitView({ zoom, x: bx - mx / zoom, y: by - my / zoom });
    }
  };

  /* ---------------------------------------------------------------- *
   * Text + menu + toolbar actions
   * ---------------------------------------------------------------- */

  const commitText = () => {
    const draft = textDraft;
    setTextDraft(null);
    if (!draft || !draft.value.trim()) return;
    const object: WbObject = {
      id: newId('txt'),
      z: nextZ(doc.objects),
      kind: 'text',
      x: draft.x,
      y: draft.y,
      text: draft.value,
      style: { color: style.color, width: 2, opacity: 1, fontSize: style.fontSize },
    };
    void actions.wbOps(boardId, [{ type: 'add', objects: [object] }]);
  };

  const fitAll = () => commitView(fitView(doc.objects, size));
  const zoomBy = (factor: number) => {
    const cx = size.w / 2;
    const cy = size.h / 2;
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
    const bx = cx / view.zoom + view.x;
    const by = cy / view.zoom + view.y;
    commitView({ zoom, x: bx - cx / zoom, y: by - cy / zoom });
  };

  return (
    <div className="jz-board" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="jz-board__canvas"
        style={{ width: size.w, height: size.h, cursor: cursorFor(tool, spaceHeld.current) }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuOpen(true);
        }}
      />

      {textDraft ? (
        <textarea
          className="jz-board__text"
          autoFocus
          style={{ left: (textDraft.x - view.x) * view.zoom, top: (textDraft.y - view.y) * view.zoom, fontSize: style.fontSize * view.zoom }}
          value={textDraft.value}
          onChange={(e) => setTextDraft({ ...textDraft, value: e.target.value })}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setTextDraft(null);
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commitText();
            }
          }}
        />
      ) : null}

      <div className="jz-board__hud">
        <button className="jz-btn" title="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
          −
        </button>
        <button className="jz-btn" title="Reset zoom" onClick={() => commitView({ ...view, zoom: 1 })}>
          {Math.round(view.zoom * 100)}%
        </button>
        <button className="jz-btn" title="Zoom in" onClick={() => zoomBy(1.2)}>
          +
        </button>
        <button className="jz-btn" title="Fit everything (F)" onClick={fitAll}>
          Fit
        </button>
        <span className="jz-board__hud-sep" />
        <button className="jz-btn" title="Undo (Ctrl+Z)" onClick={() => void actions.wbUndo(boardId)}>
          Undo
        </button>
        <button className="jz-btn" title="Redo (Ctrl+Shift+Z)" onClick={() => void actions.wbRedo(boardId)}>
          Redo
        </button>
        <button className="jz-btn" title="Export PNG" onClick={() => void actions.wbExport(boardId, 'all')}>
          PNG
        </button>
        <button className="jz-btn" title="Clear board" onClick={() => void actions.wbClear(boardId)}>
          Clear
        </button>
      </div>

      {doc.objects.length === 0 ? (
        <div className="jz-board__empty">
          <strong>{doc.name}</strong>
          <span>Draw, type or drop an image. Everything stays a vector until you export.</span>
        </div>
      ) : null}

      {menuOpen ? (
        <div
          className="jz-menu-backdrop"
          onClick={() => {
            setMenuOpen(false);
          }}
        >
          <div className="jz-menu" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => { void actions.wbExport(boardId, 'view'); setMenuOpen(false); }}>Export current view</button>
            <button onClick={() => { setMenuOpen(false); fitAll(); }}>Fit everything</button>
            <button onClick={() => { void actions.wbInsertImage(boardId); setMenuOpen(false); }}>Insert image…</button>
            <button
              className="is-danger"
              onClick={() => {
                void actions.wbClear(boardId);
                setMenuOpen(false);
              }}
            >
              Clear board
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * Pure helpers
 * ------------------------------------------------------------------ */

function isStrokeTool(tool: string): boolean {
  return tool === 'pen' || tool === 'marker' || tool === 'highlighter';
}

function makeStroke(tool: 'pen' | 'marker' | 'highlighter', points: number[], style: { color: string; size: number; opacity: number }): WbObject {
  return {
    // The shared generator carries a counter: two strokes finishing in the same
    // millisecond must not end up with the same id.
    id: newId('st'),
    z: 0,
    kind: 'stroke',
    tool,
    points,
    style: strokeStyle(tool, style.color, style.size, style.opacity),
  };
}

function makePreview(
  tool: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  style: { color: string; size: number; opacity: number; fontSize: number },
): WbObject {
  const base: WbStyle = { color: style.color, width: style.size, opacity: style.opacity };
  const id = 'preview';
  switch (tool) {
    case 'line':
    case 'arrow':
    case 'rect':
    case 'ellipse':
      return { id, z: 0, kind: tool, x1: from.x, y1: from.y, x2: to.x, y2: to.y, style: base };
    default:
      return { id, z: 0, kind: 'line', x1: from.x, y1: from.y, x2: to.x, y2: to.y, style: base };
  }
}

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  size: { w: number; h: number },
  view: WbView,
  laser: { points: number[]; color: string } | null,
  marquee: Rect | null,
): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (marquee) {
    ctx.strokeStyle = 'rgba(110,168,255,0.9)';
    ctx.fillStyle = 'rgba(110,168,255,0.12)';
    ctx.lineWidth = 1;
    const x = (marquee.x - view.x) * view.zoom;
    const y = (marquee.y - view.y) * view.zoom;
    ctx.fillRect(x, y, marquee.width * view.zoom, marquee.height * view.zoom);
    ctx.strokeRect(x + 0.5, y + 0.5, marquee.width * view.zoom, marquee.height * view.zoom);
  }
  if (laser && laser.points.length >= 4) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = laser.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, 5 * view.zoom);
    ctx.shadowColor = laser.color;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo((laser.points[0] - view.x) * view.zoom, (laser.points[1] - view.y) * view.zoom);
    for (let i = 2; i + 1 < laser.points.length; i += 2) {
      ctx.lineTo((laser.points[i] - view.x) * view.zoom, (laser.points[i + 1] - view.y) * view.zoom);
    }
    ctx.stroke();
  }
  ctx.restore();
  void size;
}

function handleAt(objects: WbObject[], id: string, p: { x: number; y: number }, zoom: number): HandleId | null {
  const object = objects.find((o) => o.id === id);
  if (!object) return null;
  const b = objectBounds(object);
  const r = HANDLE_R / zoom;
  for (const h of HANDLES) {
    const pt = handlePointLocal(b, h);
    if (Math.abs(pt.x - p.x) <= r && Math.abs(pt.y - p.y) <= r) return h;
  }
  return null;
}

function handlePointLocal(b: Rect, h: HandleId): { x: number; y: number } {
  const x = h.includes('w') ? b.x : h.includes('e') ? b.x + b.width : b.x + b.width / 2;
  const y = h.includes('n') ? b.y : h.includes('s') ? b.y + b.height : b.y + b.height / 2;
  return { x, y };
}

function rectOf(x1: number, y1: number, x2: number, y2: number): Rect {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

function intersects(a: Rect, b: Rect): boolean {
  return !(a.x > b.x + b.width || a.x + a.width < b.x || a.y > b.y + b.height || a.y + a.height < b.y);
}

function cursorFor(tool: string, space: boolean): string {
  if (space || tool === 'hand') return 'grab';
  if (tool === 'select') return 'default';
  if (tool === 'text') return 'text';
  if (tool === 'eraser') return 'cell';
  return 'crosshair';
}

export { contentBounds, hitTest };

/** Re-exported for tests and the LIVE surface (single import point). */
export type { WbOp };
