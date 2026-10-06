import React from 'react';
import type { PrivacyMask, Rect, SpotlightState, ToolId } from '../../shared/types';
import { InkModel, drawInk, inkSize, newInkId, styleForTool, type InkItem, type InkOp } from '../live/ink';
import { CameraView } from '../live/effects';

/**
 * The interactive ink / effects layer.
 *
 * It is mounted inside the transparent overlay WebContentsView that sits *above*
 * the website's native view (a renderer can never paint over a native view, so
 * this is the only place where teacher drawing can see the page underneath).
 *
 * Performance contract:
 *   • committed items live in a mutable model — never React state;
 *   • a live stroke repaints on rAF only while the pointer is down;
 *   • pointer emits are coalesced and throttled to ~30/s before IPC;
 *   • nothing here polls, and the laser fade stops itself.
 */

export interface AnnotationLayerHandle {
  undo(): void;
  redo(): void;
  clear(): void;
  state(): { count: number; canUndo: boolean; canRedo: boolean };
}

export const AnnotationLayer: React.FC<{
  /** Card rect in overlay-local coordinates. */
  rect: Rect;
  /** Card size in CSS px (the coordinate space of normalised ink). */
  size: { w: number; h: number };
  tool: ToolId;
  style: { color: string; size: number; opacity: number; fontSize: number };
  numberStart: number;
  interactive: boolean;
  /** Keep the mouse for the camera preview even though no tool is drawing. */
  cameraInteractive?: boolean;
  masks: PrivacyMask[];
  spotlight: SpotlightState;
  camera: React.ReactNode;
  onRegister?: (handle: AnnotationLayerHandle) => void;
  onLiveStroke?: (item: InkItem | null) => void;
  onCommit?: (op: InkOp) => void;
  onLaser?: (points: number[], color: string) => void;
  onHistoryChange?: (state: { count: number; canUndo: boolean; canRedo: boolean }) => void;
}> = ({ rect, size, tool, style, numberStart, interactive, cameraInteractive = false, masks, spotlight, camera, onRegister, onLiveStroke, onCommit, onLaser, onHistoryChange }) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const model = React.useRef(new InkModel());
  const liveItem = React.useRef<InkItem | null>(null);
  const laser = React.useRef<{ points: number[]; color: string; at: number } | null>(null);
  const gesture = React.useRef<{ kind: 'none' | 'draw' | 'erase' | 'spotlight' | 'laser'; points: number[]; id: string }>({ kind: 'none', points: [], id: '' });
  const rafRef = React.useRef(0);
  const numberRef = React.useRef(numberStart);
  const lastSent = React.useRef({ ink: 0, laser: 0, spotlight: 0 });

  numberRef.current = numberStart;

  const repaint = React.useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(size.w));
    const h = Math.max(1, Math.round(size.h));
    const wantW = Math.round(w * dpr);
    const wantH = Math.round(h * dpr);
    if (canvas.width !== wantW || canvas.height !== wantH) {
      canvas.width = wantW;
      canvas.height = wantH;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, wantW, wantH);
    const now = laser.current;
    const alpha = now ? Math.max(0, 1 - (performance.now() - now.at) / 900) : 0;
    drawInk(ctx, {
      width: w,
      height: h,
      dpr,
      items: model.current.items,
      live: liveItem.current,
      laser: now && alpha > 0 ? { points: now.points, color: now.color, alpha } : null,
    });
  }, [size.w, size.h]);

  const schedule = React.useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      repaint();
    });
  }, [repaint]);

  React.useEffect(() => {
    repaint();
  }, [repaint, rect.width, rect.height]);

  React.useEffect(() => {
    onRegister?.({
      undo: () => {
        const op = model.current.undo();
        if (op) {
          onCommit?.(op);
          report();
        }
        repaint();
      },
      redo: () => {
        const op = model.current.redo();
        if (op) {
          onCommit?.(op);
          report();
        }
        repaint();
      },
      clear: () => {
        const op = model.current.clear();
        onCommit?.(op);
        report();
        repaint();
      },
      state: report,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onRegister]);

  function report(): { count: number; canUndo: boolean; canRedo: boolean } {
    const state = { count: model.current.items.length, canUndo: model.current.canUndo, canRedo: model.current.canRedo };
    onHistoryChange?.(state);
    return state;
  }

  /** Normalised 0..1 inside the card. */
  const toCard = (e: React.PointerEvent): { x: number; y: number } => {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: (e.clientX - box.left) / Math.max(1, box.width), y: (e.clientY - box.top) / Math.max(1, box.height) };
  };

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive || tool === 'cursor') return;
    const p = toCard(e);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    if (tool === 'spotlight') {
      gesture.current = { kind: 'spotlight', points: [], id: '' };
      sendSpotlight(p.x, p.y);
      return;
    }
    if (tool === 'eraser') {
      gesture.current = { kind: 'erase', points: [], id: '' };
      eraseAt(p);
      return;
    }
    if (tool === 'text') {
      const value = window.prompt('Text to show on the card');
      if (value) {
        const item: InkItem = { kind: 'text', id: newInkId('txt'), text: value, x: p.x, y: p.y, color: style.color, fontSize: inkSize(style.fontSize, size.w) };
        model.current.add(item);
        onCommit?.({ kind: 'add', item });
        report();
        repaint();
      }
      return;
    }
    if (tool === 'number') {
      const item: InkItem = { kind: 'number', id: newInkId('num'), n: numberRef.current, x: p.x, y: p.y, color: style.color, radius: inkSize(20, size.w) };
      model.current.add(item);
      onCommit?.({ kind: 'add', item });
      report();
      repaint();
      return;
    }
    if (tool === 'laser') {
      laser.current = { points: [p.x, p.y], color: style.color, at: performance.now() };
      gesture.current = { kind: 'laser', points: [p.x, p.y], id: '' };
      schedule();
      return;
    }

    // Pen / marker / highlighter (and the line/arrow/rect/ellipse tools act as a
    // straight two-point stroke with the pen family's geometry).
    const toolForInk: 'pen' | 'marker' | 'highlighter' = tool === 'marker' || tool === 'highlighter' ? tool : 'pen';
    const styled = styleForTool(toolForInk, style.size, style.opacity);
    const item: InkItem = {
      kind: 'stroke',
      id: newInkId('ink'),
      tool: toolForInk,
      points: [p.x, p.y],
      color: style.color,
      size: inkSize(styled.size, size.w),
      opacity: styled.opacity,
    };
    liveItem.current = item;
    gesture.current = { kind: 'draw', points: [p.x, p.y], id: item.id };
    schedule();
  };

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!interactive || g.kind === 'none') return;
    const p = toCard(e);

    if (g.kind === 'spotlight') {
      sendSpotlight(p.x, p.y);
      return;
    }
    if (g.kind === 'erase') {
      eraseAt(p);
      return;
    }

    if (g.kind === 'draw' && liveItem.current && liveItem.current.kind === 'stroke') {
      const item = liveItem.current;
      const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const native = e.nativeEvent as PointerEvent;
      const samples = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
      for (const ev of samples.length ? samples : [native]) {
        const nx = (ev.clientX - box.left) / Math.max(1, box.width);
        const ny = (ev.clientY - box.top) / Math.max(1, box.height);
        const lastX = item.points[item.points.length - 2];
        const lastY = item.points[item.points.length - 1];
        if (Math.hypot(nx - lastX, ny - lastY) < 0.0012) continue;
        item.points.push(nx, ny);
      }
      if (performance.now() - lastSent.current.ink > 33) {
        lastSent.current.ink = performance.now();
        onLiveStroke?.(item);
      }
      schedule();
      return;
    }

    if (g.kind === 'laser' && laser.current) {
      laser.current.points.push(p.x, p.y);
      laser.current.at = performance.now();
      if (laser.current.points.length > 800) laser.current.points.splice(0, laser.current.points.length - 800);
      if (performance.now() - lastSent.current.laser > 33) {
        lastSent.current.laser = performance.now();
        onLaser?.(laser.current.points, laser.current.color);
      }
      schedule();
    }
  };

  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    gesture.current = { kind: 'none', points: [], id: '' };
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }

    if (g.kind === 'spotlight' || g.kind === 'erase') return;

    const item = liveItem.current;
    if (g.kind === 'draw' && item) {
      if (item.kind === 'stroke' && item.points.length >= 4) {
        model.current.add(item);
        onCommit?.({ kind: 'add', item });
      }
      onLiveStroke?.(null);
    }
    liveItem.current = null;

    if (g.kind === 'laser' && laser.current) {
      window.setTimeout(() => {
        laser.current = null;
        schedule();
      }, 900);
    }
    report();
    schedule();
  };

  const eraseAt = (p: { x: number; y: number }) => {
    const radius = inkSize(Math.max(10, style.size * 2), size.w) / 2;
    const hits = model.current.eraseAt(p.x, p.y, radius);
    if (!hits.length) return;
    const op = model.current.remove(hits.map((i) => i.id));
    onCommit?.(op);
    report();
    schedule();
  };

  const sendSpotlight = (x: number, y: number) => {
    const now = performance.now();
    if (now - lastSent.current.spotlight < 33) return;
    lastSent.current.spotlight = now;
    window.juzt.effects.spotlight({ on: true, x, y });
  };

  const dpr = Math.min(2, window.devicePixelRatio || 1);

  return (
    <div
      className="jz-annot"
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        pointerEvents: interactive || cameraInteractive ? 'auto' : 'none',
        cursor: cameraInteractive && !interactive ? 'grab' : interactive ? 'crosshair' : 'default',
      }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <div className="jz-annot__clip" style={{ position: 'absolute', inset: 0, borderRadius: Math.max(0, spotlight.shape === 'rect' ? 12 : 0) }}>
        {masks.map((m) => (
          <div
            key={m.id}
            className={`jz-annot__mask ${m.mode === 'blur' ? 'is-blur' : ''}`}
            style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%`, height: `${m.h * 100}%` }}
          />
        ))}

        <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: size.w, height: size.h }} />

        {spotlight.on ? (
          <div
            className="jz-annot__spotlight"
            style={{
              left: `${spotlight.x * 100}%`,
              top: `${spotlight.y * 100}%`,
              width: Math.max(48, spotlight.r * size.w * 2),
              height: Math.max(48, spotlight.r * size.w * 2),
              borderRadius: spotlight.shape === 'circle' ? '50%' : 14,
              boxShadow: `0 0 0 100vmax rgba(5,7,12,${spotlight.dim})`,
            }}
          />
        ) : null}

        {camera}

        <div className="jz-annot__grid" data-dpr={dpr} />
      </div>
    </div>
  );
};
