import React from 'react';
import type { LivePayload, Rect, WhiteboardDoc } from '../../shared/types';
import { cardBorderCss, cardShadowCss } from '../../shared/layout';
import { BackgroundLayer, CameraView, FreezeFrame, HoldingScreen, InkCanvas, MaskLayer, PrivacyScreen, ProtectionLayer, SpotlightLayer } from './effects';
import type { InkItem } from './ink';
import { InsideCardClip, OutsideCardClip, clipStyle } from './mask';
import { WhiteboardCanvas } from '../whiteboard/render';

/**
 * The audience surface — the only UI the audience ever sees.
 *
 * Layering (bottom → top):
 *   background (clipped *outside* the rounded card)
 *   card shadow / border
 *   the native website view (owned by main, below every DOM layer)
 *   protection frame → freeze frame → whiteboard canvas → ink → masks
 *   spotlight dim → camera
 *   holding / privacy screens (opaque, cover everything)
 *
 * The component is pure: every input comes from `LivePayload` plus the effects
 * the renderer received over IPC, so PREP and LIVE always agree.
 */

export interface LiveSurfaceProps {
  live: LivePayload;
  /** Card rect in this renderer's window coordinates. */
  card: Rect;
  /** Window size in CSS px. */
  size: { w: number; h: number };
  frozenFrame?: string | null;
  protectionFrame?: string | null;
  boardDoc?: WhiteboardDoc | null;
  /** Committed ink (audience view) or null when the overlay owns it. */
  ink?: InkItem[] | null;
  liveStroke?: InkItem | null;
  laser?: { points: number[]; color: string; alpha: number } | null;
  spotlightMove?: (x: number, y: number) => void;
  cameraInteractive?: boolean;
  onCameraRect?: (rect: LivePayload['camera']['rect']) => void;
  /** Rendered above the ink layer (teacher-only interactive layer in PREP). */
  overlay?: React.ReactNode;
  /** True when the surface is transparent outside the card (PREP overlay). */
  transparentOutside?: boolean;
  /** Unique prefix for SVG clip ids (two surfaces can share a document). */
  clipPrefix?: string;
  /** Imperative spotlight handle (audience surface moves it without re-rendering). */
  spotlightLayerRef?: React.MutableRefObject<{ move: (x: number, y: number) => void } | null>;
}

export const LiveSurface: React.FC<LiveSurfaceProps> = ({
  live,
  card,
  size,
  frozenFrame,
  protectionFrame,
  boardDoc,
  ink,
  liveStroke,
  laser,
  spotlightMove,
  cameraInteractive,
  onCameraRect,
  overlay,
  transparentOutside,
  clipPrefix = 'jz-surface',
  spotlightLayerRef,
}) => {
  const radius = Math.max(0, live.surface.card.radius);
  const presenting = live.presentation.kind !== 'holding';
  const showingBoard = live.presentation.kind === 'whiteboard';
  const outsideId = `${clipPrefix}-outside`;
  const insideId = `${clipPrefix}-inside`;
  const border = cardBorderCss(live.surface.card.border);

  const background = live.flags.privacy ? live.surface.privacyBackground : presenting ? live.surface.liveBackground : live.surface.holdingBackground;
  const cardSize = { w: card.width, h: card.height };
  const boardTheme = boardDoc?.theme;

  return (
    <div className="jz-surface" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {/* background: everything outside the rounded card */}
      <div style={{ position: 'absolute', inset: 0, ...(presenting && !live.flags.privacy ? clipStyle(outsideId) : undefined) }}>
        <OutsideCardClip id={outsideId} local={size} card={card} radius={radius} />
        <BackgroundLayer spec={background} size={size} />
        {background.dim ? <div style={{ position: 'absolute', inset: 0, background: `rgba(0,0,0,${background.dim})` }} /> : null}
      </div>

      {presenting && !live.flags.privacy ? (
        <>
          {/* card shadow */}
          <div
            style={{
              position: 'absolute',
              left: card.x,
              top: card.y,
              width: card.width,
              height: card.height,
              borderRadius: radius,
              boxShadow: cardShadowCss(live.surface.card.shadow),
              pointerEvents: 'none',
            }}
          />

          {/* freeze / protection sit above the native view, below the ink */}
          <div style={{ position: 'absolute', left: card.x, top: card.y, width: card.width, height: card.height, borderRadius: radius, overflow: 'hidden', pointerEvents: 'none' }}>
            {live.flags.frozen ? <FreezeFrame frame={frozenFrame ?? null} size={cardSize} /> : null}
            {live.flags.protecting ? <ProtectionLayer frame={protectionFrame ?? null} size={cardSize} radius={radius} /> : null}
          </div>

          {showingBoard ? (
            <div style={{ position: 'absolute', left: card.x, top: card.y, width: card.width, height: card.height, borderRadius: radius, overflow: 'hidden' }}>
              {boardDoc ? <WhiteboardCanvas doc={boardDoc} theme={boardTheme} size={cardSize} /> : <div style={{ position: 'absolute', inset: 0, background: '#0e1116' }} />}
            </div>
          ) : null}

          {ink ? <div style={{ position: 'absolute', inset: 0 }}><InkCanvas items={ink} live={liveStroke} laser={laser} size={size} /></div> : null}

          <div style={{ position: 'absolute', left: card.x, top: card.y, width: card.width, height: card.height, borderRadius: radius, overflow: 'hidden', pointerEvents: 'none' }}>
            <MaskLayer masks={live.masks} size={cardSize} />
          </div>

          <div style={{ position: 'absolute', left: card.x, top: card.y, width: card.width, height: card.height, borderRadius: radius, overflow: 'hidden', pointerEvents: 'none' }}>
            <SpotlightLayer
              spotlight={live.spotlight}
              size={cardSize}
              interactive={!!spotlightMove}
              onMove={spotlightMove}
              register={(api) => {
                if (spotlightLayerRef) spotlightLayerRef.current = api;
              }}
            />
          </div>

          <div style={{ position: 'absolute', left: card.x, top: card.y, width: card.width, height: card.height }}>
            <CameraView camera={live.camera} card={{ x: 0, y: 0, width: card.width, height: card.height }} role="live" onRectChange={cameraInteractive ? onCameraRect : undefined} />
          </div>

          {/* card border */}
          {border.width > 0 ? (
            <div
              style={{
                position: 'absolute',
                left: card.x,
                top: card.y,
                width: card.width,
                height: card.height,
                borderRadius: radius,
                border: `${border.width}px solid ${border.color}`,
                pointerEvents: 'none',
              }}
            />
          ) : null}

          {overlay}
        </>
      ) : null}

      {overlay ? <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>{overlay}</div> : null}

      {/* audience-only screens */}
      {live.flags.privacy ? <PrivacyScreen live={live} size={size} /> : null}
      {!live.flags.privacy && !presenting ? <HoldingScreen live={live} size={size} /> : null}
      {transparentOutside ? null : null}
      <InsideCardClip id={insideId} card={card} radius={radius} />
    </div>
  );
};
