import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { AnnotationStroke, ToolId } from '../../shared/types';

interface Props {
  interactive: boolean;
  tool: ToolId;
  color: string;
  size: number;
  opacity: number;
  spotlightActive: boolean;
  onHistoryChange: (info: { canUndo: boolean; canRedo: boolean; count: number }) => void;
  registerUndoRedo: (api: { undo: () => void; redo: () => void; clear: () => void }) => void;
}

type Point = { x: number; y: number; p: number };

interface LiveInkState {
  points: Point[];
  tool: ToolId;
  color: string;
  size: number;
  opacity: number;
}

const HISTORY_CAP = 200;

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  size: number,
) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const headLen = Math.max(10, size * 2.5);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - headLen * Math.cos(angle - Math.PI / 6), to.y - headLen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(to.x - headLen * Math.cos(angle + Math.PI / 6), to.y - headLen * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

export const AnnotationCanvas: React.FC<Props> = ({
  interactive,
  tool,
  color,
  size,
  opacity,
  spotlightActive,
  onHistoryChange,
  registerUndoRedo,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const strokesRef = useRef<AnnotationStroke[]>([]);
  const historyRef = useRef<AnnotationStroke[][]>([]);
  const futureRef = useRef<AnnotationStroke[][]>([]);
  const liveRef = useRef<LiveInkState | null>(null);
  const laserTrailRef = useRef<{ x: number; y: number; t: number }[]>([]);
  const [textPlace, setTextPlace] = useState<{ x: number; y: number } | null>(null);
  const [textValue, setTextValue] = useState('');
  const textInputRef = useRef<HTMLTextAreaElement>(null);

  const toolRef = useRef(tool);
  toolRef.current = tool;
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;
  const colorRef = useRef(color);
  colorRef.current = color;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const opacityRef = useRef(opacity);
  opacityRef.current = opacity;

  // Resize canvas to container
  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth;
      const h = container.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener('resize', resize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, []);

  const notifyHistory = useCallback(() => {
    onHistoryChange({
      canUndo: historyRef.current.length > 0,
      canRedo: futureRef.current.length > 0,
      count: strokesRef.current.length,
    });
  }, [onHistoryChange]);

  const pushHistory = useCallback(() => {
    historyRef.current.push(strokesRef.current.map((s) => ({ ...s, points: [...s.points] })));
    if (historyRef.current.length > HISTORY_CAP) historyRef.current.shift();
    futureRef.current = [];
    notifyHistory();
  }, [notifyHistory]);

  const undo = useCallback(() => {
    if (historyRef.current.length === 0) return;
    const prev = historyRef.current.pop()!;
    futureRef.current.push(strokesRef.current);
    strokesRef.current = prev;
    notifyHistory();
    redraw();
  }, [notifyHistory]);

  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return;
    const next = futureRef.current.pop()!;
    historyRef.current.push(strokesRef.current);
    strokesRef.current = next;
    notifyHistory();
    redraw();
  }, [notifyHistory]);

  const clear = useCallback(() => {
    pushHistory();
    strokesRef.current = [];
    notifyHistory();
    redraw();
  }, [pushHistory, notifyHistory]);

  useEffect(() => {
    registerUndoRedo({ undo, redo, clear });
  }, [undo, redo, clear, registerUndoRedo]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    const drawStroke = (s: AnnotationStroke) => {
      ctx.save();
      ctx.globalAlpha = s.opacity;
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = s.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (s.tool === 'highlighter') {
        ctx.globalAlpha = s.opacity;
        ctx.lineWidth = Math.max(s.size, 18);
      }
      if (s.tool === 'marker') {
        ctx.lineWidth = Math.max(s.size, 8);
      }
      ctx.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over';
      const pts = s.points;
      if (s.tool === 'line' || s.tool === 'arrow') {
        if (pts.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
          ctx.stroke();
          if (s.tool === 'arrow') drawArrowHead(ctx, pts[0], pts[pts.length - 1], s.size);
        }
      } else if (s.tool === 'rect') {
        if (pts.length >= 2) {
          const a = pts[0];
          const b = pts[pts.length - 1];
          ctx.beginPath();
          ctx.strokeRect(
            Math.min(a.x, b.x),
            Math.min(a.y, b.y),
            Math.abs(b.x - a.x),
            Math.abs(b.y - a.y),
          );
        }
      } else if (s.tool === 'ellipse') {
        if (pts.length >= 2) {
          const a = pts[0];
          const b = pts[pts.length - 1];
          const cx = (a.x + b.x) / 2;
          const cy = (a.y + b.y) / 2;
          const rx = Math.abs(b.x - a.x) / 2;
          const ry = Math.abs(b.y - a.y) / 2;
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (s.tool === 'text') {
        if (s.text && pts[0]) {
          ctx.font = `${Math.max(16, s.size * 4)}px -apple-system, Segoe UI, sans-serif`;
          ctx.textBaseline = 'top';
          ctx.fillText(s.text, pts[0].x, pts[0].y);
        }
      } else {
        if (pts.length === 1) {
          ctx.beginPath();
          ctx.arc(pts[0].x, pts[0].y, Math.max(1, s.size / 2), 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length - 1; i++) {
            const mx = (pts[i].x + pts[i + 1].x) / 2;
            const my = (pts[i].y + pts[i + 1].y) / 2;
            ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
          }
          ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
          ctx.stroke();
        }
      }
      ctx.restore();
    };

    for (const s of strokesRef.current) drawStroke(s);

    const live = liveRef.current;
    if (live) {
      ctx.save();
      ctx.globalAlpha = live.opacity;
      ctx.strokeStyle = live.color;
      ctx.fillStyle = live.color;
      ctx.lineWidth = live.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = live.tool === 'eraser' ? 'destination-out' : 'source-over';
      const pts = live.points;
      if (live.tool === 'laser') {
        ctx.shadowColor = live.color;
        ctx.shadowBlur = 20;
        ctx.lineWidth = 4;
        if (pts.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.stroke();
        }
        if (pts.length > 0) {
          const last = pts[pts.length - 1];
          ctx.beginPath();
          ctx.shadowBlur = 24;
          ctx.arc(last.x, last.y, 8, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (live.tool === 'line' || live.tool === 'arrow') {
        if (pts.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
          ctx.stroke();
          if (live.tool === 'arrow') drawArrowHead(ctx, pts[0], pts[pts.length - 1], live.size);
        }
      } else if (live.tool === 'rect') {
        if (pts.length >= 2) {
          const a = pts[0];
          const b = pts[pts.length - 1];
          ctx.strokeRect(
            Math.min(a.x, b.x),
            Math.min(a.y, b.y),
            Math.abs(b.x - a.x),
            Math.abs(b.y - a.y),
          );
        }
      } else if (live.tool === 'ellipse') {
        if (pts.length >= 2) {
          const a = pts[0];
          const b = pts[pts.length - 1];
          ctx.beginPath();
          ctx.ellipse(
            (a.x + b.x) / 2,
            (a.y + b.y) / 2,
            Math.abs(b.x - a.x) / 2,
            Math.abs(b.y - a.y) / 2,
            0,
            0,
            Math.PI * 2,
          );
          ctx.stroke();
        }
      } else {
        if (pts.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length - 1; i++) {
            const mx = (pts[i].x + pts[i + 1].x) / 2;
            const my = (pts[i].y + pts[i + 1].y) / 2;
            ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
          }
          ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
          ctx.stroke();
        } else if (pts.length === 1) {
          ctx.beginPath();
          ctx.arc(pts[0].x, pts[0].y, Math.max(1, live.size / 2), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

  }, []);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      // laser trail decay
      if (toolRef.current === 'laser' && interactiveRef.current) {
        const now = performance.now();
        const before = laserTrailRef.current.length;
        laserTrailRef.current = laserTrailRef.current.filter((p) => now - p.t < 500);
        if (liveRef.current && liveRef.current.tool === 'laser') {
          liveRef.current.points = laserTrailRef.current
            .slice(-60)
            .map((p) => ({ x: p.x, y: p.y, p: 0.5 }));
        }
        if (before !== laserTrailRef.current.length || laserTrailRef.current.length > 0) {
          redraw();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [redraw]);

  const getLocalPoint = (e: React.PointerEvent): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      p: (e as unknown as { pressure?: number }).pressure ?? 0.5,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive) return;
    const t = toolRef.current;
    if (t === 'cursor') return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const pt = getLocalPoint(e);
    if (t === 'text') {
      setTextPlace({ x: pt.x, y: pt.y });
      setTextValue('');
      setTimeout(() => textInputRef.current?.focus(), 10);
      return;
    }
    let effColor = colorRef.current;
    let effSize = sizeRef.current;
    let effOpacity = opacityRef.current;
    if (t === 'highlighter') {
      effOpacity = Math.min(1, Math.max(0.15, opacityRef.current));
      effSize = Math.max(18, sizeRef.current * 3);
    }
    if (t === 'marker') {
      effSize = Math.max(10, sizeRef.current * 2.5);
      effOpacity = 0.95;
    }
    if (t === 'eraser') {
      effColor = '#000';
      effSize = Math.max(24, sizeRef.current * 4);
      effOpacity = 1;
      // Snapshot before modifying strokes so Undo restores erased ink.
      pushHistory();
      eraseAt(pt, effSize);
    }
    if (t === 'laser') {
      effColor = effColor === '#000000' ? '#ff2d55' : effColor;
      effSize = 4;
      effOpacity = 1;
      laserTrailRef.current = [{ x: pt.x, y: pt.y, t: performance.now() }];
    }
    liveRef.current = {
      points: [pt],
      tool: t,
      color: effColor,
      size: effSize,
      opacity: effOpacity,
    };
    redraw();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const pt = getLocalPoint(e);
    if (spotlightActive) {
      const r = 150;
      if (overlayRef.current) {
        overlayRef.current.style.background = `radial-gradient(circle ${r}px at ${pt.x}px ${pt.y}px, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.8) 100%)`;
      }
    }
    if (!interactive) return;
    const t = toolRef.current;
    if (t === 'cursor') return;
    if (t === 'laser') {
      laserTrailRef.current.push({ x: pt.x, y: pt.y, t: performance.now() });
      liveRef.current = {
        points: laserTrailRef.current.slice(-60).map((p) => ({ x: p.x, y: p.y, p: 0.5 })),
        tool: 'laser',
        color: colorRef.current === '#000000' ? '#ff2d55' : colorRef.current,
        size: 4,
        opacity: 1,
      };
      scheduleRedraw();
      return;
    }
    if (!liveRef.current) {
      return;
    }
    if (liveRef.current.tool === 'eraser') {
      eraseAt(pt, liveRef.current.size);
    }
    liveRef.current.points.push(pt);
    if (
      liveRef.current.tool === 'line' ||
      liveRef.current.tool === 'arrow' ||
      liveRef.current.tool === 'rect' ||
      liveRef.current.tool === 'ellipse'
    ) {
      liveRef.current.points = [liveRef.current.points[0], pt];
    }
    scheduleRedraw();
  };

  const onPointerUp = () => {
    commitLive();
  };

  const eraseAt = (pt: Point, radius: number) => {
    const hit = (s: AnnotationStroke): boolean => {
      if (s.tool === 'eraser') return false;
      for (const p of s.points) {
        const dx = p.x - pt.x;
        const dy = p.y - pt.y;
        if (dx * dx + dy * dy < radius * radius) return true;
      }
      return false;
    };
    const before = strokesRef.current.length;
    strokesRef.current = strokesRef.current.filter((s) => !hit(s));
    if (strokesRef.current.length !== before) {
      // push history once per gesture start; here we just mark dirty
      scheduleRedraw();
    }
  };

  const commitLive = () => {
    const live = liveRef.current;
    if (!live) return;
    liveRef.current = null;
    if (live.tool === 'laser') {
      laserTrailRef.current = [];
      redraw();
      return;
    }
    if (live.tool === 'eraser') {
      notifyHistory();
      redraw();
      return;
    }
    if (
      live.points.length < 2 &&
      live.tool !== 'rect' &&
      live.tool !== 'ellipse' &&
      live.tool !== 'line' &&
      live.tool !== 'arrow'
    ) {
      redraw();
      return;
    }
    pushHistory();
    strokesRef.current.push({
      id: Math.random().toString(36).slice(2),
      tool: live.tool,
      color: live.color,
      size: live.size,
      opacity: live.opacity,
      points: live.points.map((p) => ({ x: p.x, y: p.y, p: p.p })),
    });
    notifyHistory();
    redraw();
  };

  const rafPending = useRef(false);
  const scheduleRedraw = () => {
    if (rafPending.current) return;
    rafPending.current = true;
    requestAnimationFrame(() => {
      rafPending.current = false;
      redraw();
    });
  };

  const commitText = () => {
    if (!textPlace) return;
    const text = textValue;
    setTextPlace(null);
    setTextValue('');
    if (!text) return;
    pushHistory();
    strokesRef.current.push({
      id: Math.random().toString(36).slice(2),
      tool: 'text',
      color: colorRef.current,
      size: sizeRef.current,
      opacity: 1,
      points: [{ x: textPlace.x, y: textPlace.y, p: 1 }],
      text,
    });
    notifyHistory();
    redraw();
  };

  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', inset: 0, zIndex: 3, pointerEvents: 'none' }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          pointerEvents: interactive && (tool !== 'cursor' || spotlightActive) ? 'auto' : 'none',
          touchAction: 'none',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div
        ref={overlayRef}
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          display: spotlightActive ? 'block' : 'none',
          background: 'transparent',
        }}
      />
      {textPlace && (
        <textarea
          data-text-editor="true"
          ref={textInputRef}
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commitText();
            } else if (e.key === 'Escape') {
              setTextPlace(null);
              setTextValue('');
            }
          }}
          style={{
            position: 'absolute',
            left: textPlace.x,
            top: textPlace.y,
            zIndex: 5,
            background: 'rgba(0,0,0,0.65)',
            color: colorRef.current,
            border: '1px solid rgba(255,255,255,0.3)',
            borderRadius: 4,
            padding: 4,
            font: `${Math.max(16, sizeRef.current * 4)}px -apple-system, Segoe UI, sans-serif`,
            outline: 'none',
            minWidth: 120,
            minHeight: 28,
            resize: 'none',
          }}
        />
      )}
    </div>
  );
};
