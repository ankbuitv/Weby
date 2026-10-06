import React from 'react';
import { createRoot } from 'react-dom/client';
import type { CameraConfig, LivePayload, PrivacyMask, SpotlightState, ToolId } from '../../shared/types';
import { AnnotationLayer, type AnnotationLayerHandle } from '../annotation/AnnotationLayer';
import { CameraView } from './effects';
import type { InkItem, InkOp } from './ink';

/**
 * PREP overlay host.
 *
 * This renderer owns the transparent `WebContentsView` that main positions over
 * the private card. It exists because a DOM layer in the PREP window cannot paint
 * above the website's native view — so the ink, masks, spotlight and the camera
 * drag handle all live here, on top of everything.
 *
 * Main keeps the view's bounds equal to the card rect and toggles
 * `setIgnoreMouseEvents` while the cursor tool is active, which is what lets
 * normal clicks reach the website again.
 */

interface ToolState {
  tool: ToolId;
  style: { color: string; size: number; opacity: number; fontSize: number };
  number: number;
  inkLayer: boolean;
  /** Repositioning the camera: keep the mouse, draw no ink. */
  cameraDrag: boolean;
}

const OverlayApp: React.FC = () => {
  const [live, setLive] = React.useState<LivePayload | null>(null);
  const [tool, setTool] = React.useState<ToolState>({
    tool: 'cursor',
    style: { color: '#4aa3ff', size: 4, opacity: 1, fontSize: 34 },
    number: 1,
    inkLayer: false,
    cameraDrag: false,
  });
  const [frame, setFrame] = React.useState<{ kind: 'freeze' | 'protection'; dataUrl: string } | null>(null);
  const handle = React.useRef<AnnotationLayerHandle | null>(null);
  const cardSize = React.useRef({ w: 1280, h: 720 });

  React.useEffect(() => {
    const api = window.juzt;
    const offTool = api.on.tool((payload) =>
      setTool({
        tool: payload.tool as ToolId,
        style: payload.style,
        number: payload.number,
        inkLayer: payload.tool !== 'cursor',
        cameraDrag: !!payload.cameraDrag,
      }),
    );
    const offLive = api.on.live((payload) => setLive(payload));
    const offFrame = api.on.frame(({ kind, dataUrl }) => setFrame(dataUrl ? { kind, dataUrl } : null));
    const offCmd = api.on.inkCmd(({ cmd }) => {
      if (cmd === 'undo') handle.current?.undo();
      else if (cmd === 'redo') handle.current?.redo();
      else if (cmd === 'clear') handle.current?.clear();
    });
    void api.liveState().then((payload) => setLive(payload));
    return () => {
      offTool();
      offLive();
      offFrame();
      offCmd();
    };
  }, []);

  /** The overlay view is exactly as large as the card, so local coords are card coords. */
  const surface = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
  cardSize.current = { w: surface.width, h: surface.height };

  const masks: PrivacyMask[] = live?.masks ?? [];
  const spotlight: SpotlightState = live?.spotlight ?? { on: false, x: 0.5, y: 0.5, r: 0.24, dim: 0.6, shape: 'circle' };
  const camera = live?.camera;

  return (
    <div className="jz-overlay-root">
      {(live?.flags.frozen || live?.flags.protecting) && frame ? (
        <img className="jz-overlay-frame" src={frame.dataUrl} alt="" draggable={false} />
      ) : null}

      <AnnotationLayer
        rect={surface}
        size={{ w: surface.width, h: surface.height }}
        tool={tool.tool}
        style={tool.style}
        numberStart={tool.number}
        interactive={tool.tool !== 'cursor'}
        cameraInteractive={tool.cameraDrag}
        masks={masks}
        spotlight={spotlight}
        onRegister={(h) => {
          handle.current = h;
          void window.juzt.ink.state(h.state());
        }}
        onHistoryChange={(state) => void window.juzt.ink.state(state)}
        onCommit={(op: InkOp) => void window.juzt.effects.ink(op)}
        onLiveStroke={(item: InkItem | null) => void window.juzt.effects.ink({ kind: 'live', item })}
        onLaser={(points, color) => void window.juzt.effects.laser(points, color)}
        camera={
          camera && camera.enabled && (camera.exposure === 'prep' || camera.exposure === 'both') ? (
            <CameraView
              camera={camera}
              card={{ x: 0, y: 0, width: surface.width, height: surface.height }}
              role="prep"
              interactive={tool.cameraDrag}
              onRectChange={(rect: CameraConfig['rect']) => void window.juzt.effects.camera({ rect })}
            />
          ) : null
        }
      />
    </div>
  );
};

/** Mount the overlay into the transparent document. */
export function mountOverlay(): void {
  document.documentElement.classList.add('jz-overlay-doc');
  document.body.classList.add('jz-overlay-doc');
  const root = document.getElementById('root') ?? document.body;
  createRoot(root).render(<OverlayApp />);
}
