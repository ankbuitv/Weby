import React from 'react';
import { createRoot } from 'react-dom/client';
import { computeGeometry } from '../../shared/layout';
import type { LivePayload, WhiteboardDoc } from '../../shared/types';
import { LiveSurface } from './LiveSurface';
import { InkModel, type InkItem, type InkOp } from './ink';
import { mountOverlay } from './overlay';
import '../styles/global.css';

/**
 * `Juzt Live` renderer.
 *
 * Renders the audience surface (background, card frame, whiteboard, ink,
 * spotlight, masks, camera, holding/privacy/freeze screens) from the payload
 * main sends. It never sees a URL, a tab title or a history entry.
 *
 * Everything expensive is event-driven: the canvas repaints when ops arrive,
 * the laser fades with a short self-terminating interval, no permanent rAF.
 */

const LiveApp: React.FC = () => {
  const [live, setLive] = React.useState<LivePayload | null>(null);
  const [doc, setDoc] = React.useState<WhiteboardDoc | null>(null);
  const [frozenFrame, setFrozenFrame] = React.useState<string | null>(null);
  const [protectionFrame, setProtectionFrame] = React.useState<string | null>(null);
  const [ink, setInk] = React.useState<InkItem[]>([]);
  const [liveStroke, setLiveStroke] = React.useState<InkItem | null>(null);
  const [laser, setLaser] = React.useState<{ points: number[]; color: string; alpha: number } | null>(null);
  const [size, setSize] = React.useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const model = React.useRef(new InkModel());

  React.useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  React.useEffect(() => {
    const api = window.juzt;
    void api.liveState().then((payload) => setLive(payload));
    const offLive = api.on.live((payload) => setLive(payload));
    const offDoc = api.on.boardDoc((incoming) => setDoc(incoming));
    const offFrame = api.on.frame(({ kind, dataUrl }) => {
      if (kind === 'freeze') setFrozenFrame(dataUrl);
      else setProtectionFrame(dataUrl);
    });
    const offOp = api.on.inkOp((raw) => {
      const op = raw as InkOp;
      if (!op || typeof op !== 'object') return;
      if (op.kind === 'live') {
        setLiveStroke(op.item ?? null);
        return;
      }
      model.current.apply(op);
      setInk([...model.current.items]);
    });
    const offLaser = api.on.laser((payload) => {
      if (!payload || !payload.points || payload.points.length < 2) {
        setLaser(null);
        return;
      }
      setLaser({ points: payload.points, color: payload.color || '#ff3355', alpha: 1 });
    });
    return () => {
      offLive();
      offDoc();
      offFrame();
      offOp();
      offLaser();
    };
  }, []);

  /* Laser fade: a short burst that stops itself (never a permanent loop). */
  const laserTimer = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!laser) return;
    if (laserTimer.current) window.clearInterval(laserTimer.current);
    laserTimer.current = window.setInterval(() => {
      setLaser((prev) => (prev && prev.alpha > 0.12 ? { ...prev, alpha: prev.alpha - 0.18 } : null));
    }, 90);
    return () => {
      if (laserTimer.current) {
        window.clearInterval(laserTimer.current);
        laserTimer.current = null;
      }
    };
  }, [laser?.points]);

  if (!live) return <div className="jz-live-boot" />;

  const geometry = computeGeometry({
    single: false,
    prepSize: { width: size.w, height: size.h },
    liveSize: { width: size.w, height: size.h },
    sizePreset: live.surface.sizePreset,
    customScale: 1,
    margin: live.surface.card.margin,
    layout: live.surface.layout,
    card: live.surface.card,
    paneOpen: false,
  });

  return (
    <LiveSurface
      live={live}
      card={geometry.live}
      size={size}
      frozenFrame={frozenFrame}
      protectionFrame={protectionFrame}
      boardDoc={doc}
      ink={ink}
      liveStroke={liveStroke}
      laser={laser}
      clipPrefix="jz-live"
    />
  );
};

/** The overlay view shares this bundle; the role decides what mounts. */
const role = window.juzt?.role ?? 'live';

if (role === 'overlay') {
  mountOverlay();
} else {
  const root = document.getElementById('root');
  if (root) createRoot(root).render(<LiveApp />);
}
