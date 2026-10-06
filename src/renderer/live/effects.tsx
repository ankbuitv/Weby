import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { BackgroundSpec, CameraConfig, LivePayload, PrivacyMask, Rect, SpotlightState } from '../../shared/types';
import { fitSize } from '../../shared/layout';
import { drawInk, type InkItem } from './ink';

/**
 * Audience effects: background, ink canvas, masks, spotlight, camera.
 *
 * Rules that keep this fast:
 *  - nothing here uses a permanent rAF loop;
 *  - ink is repainted only when the item list changes or a live stroke lands;
 *  - the laser fades with a short, self-terminating rAF burst;
 *  - the spotlight moves by writing `transform` on refs, not by re-rendering.
 */

/* ------------------------------------------------------------------ *
 * Background
 * ------------------------------------------------------------------ */

export const BackgroundLayer: React.FC<{
  spec: BackgroundSpec;
  /** Element size in CSS px, used for `cover`/`contain` maths on images. */
  size: { w: number; h: number };
  /** Offset for surfaces that sample window-relative media (single-mode wedges). */
  offset?: { x: number; y: number };
  style?: React.CSSProperties;
  className?: string;
}> = ({ spec, size, offset, style, className }) => {
  const base: React.CSSProperties = { position: 'absolute', inset: 0, ...style };

  if (spec.kind === 'none') return <div className={className} style={base} />;
  if (spec.kind === 'color') {
    return <div className={className} style={{ ...base, background: spec.color ?? '#0b0e14' }} />;
  }
  if (spec.kind === 'gradient') {
    return <div className={className} style={{ ...base, background: spec.gradient ?? '#0b0e14', backgroundSize: offset ? `${size.w}px ${size.h}px` : undefined, backgroundPosition: offset ? `${-offset.x}px ${-offset.y}px` : undefined }} />;
  }
  if (spec.kind === 'image' && spec.path) {
    const url = mediaUrl(spec.path);
    const fit = spec.fit ?? 'cover';
    return (
      <div
        className={className}
        style={{
          ...base,
          backgroundImage: `url("${url}")`,
          backgroundRepeat: 'no-repeat',
          backgroundSize: fit === 'stretch' ? `${size.w}px ${size.h}px` : fit,
          backgroundPosition: offset ? `${-offset.x}px ${-offset.y}px` : 'center',
        }}
      />
    );
  }
  if (spec.kind === 'video' && spec.path) {
    return <VideoBackground spec={spec} size={size} offset={offset} className={className} />;
  }
  return <div className={className} style={base} />;
};

const VideoBackground: React.FC<{ spec: BackgroundSpec; size: { w: number; h: number }; offset?: { x: number; y: number }; className?: string }> = ({ spec, size, offset, className }) => {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.loop = spec.loop !== false;
    video.muted = spec.muted !== false;
    video.volume = spec.volume ?? 0;
    video.playbackRate = spec.rate ?? 1;
    // Chromium refuses to autoplay audible media without a gesture; the
    // background is decorative, so it always stays muted unless the teacher
    // explicitly raised the volume in Settings.
    const promise = video.play();
    if (promise && typeof promise.catch === 'function') promise.catch(() => undefined);
    return () => {
      video.pause();
    };
  }, [spec.path, spec.loop, spec.muted, spec.volume, spec.rate]);
  return (
    <video
      ref={ref}
      className={className}
      src={mediaUrl(spec.path ?? '')}
      playsInline
      disablePictureInPicture
      style={{
        position: 'absolute',
        inset: 0,
        width: size.w,
        height: size.h,
        objectFit: spec.fit === 'stretch' ? 'fill' : spec.fit === 'contain' ? 'contain' : 'cover',
        transform: offset ? `translate(${-offset.x}px, ${-offset.y}px)` : undefined,
        pointerEvents: 'none',
      }}
    />
  );
};

export function mediaUrl(file: string): string {
  if (!file) return '';
  if (file.startsWith('data:') || file.startsWith('juzt-media://') || file.startsWith('file:')) return file;
  return `juzt-media://local/?p=${encodeURIComponent(file)}`;
}

/* ------------------------------------------------------------------ *
 * Ink canvas
 * ------------------------------------------------------------------ */

export const InkCanvas: React.FC<{
  items: InkItem[];
  live?: InkItem | null;
  laser?: { points: number[]; color: string; alpha: number } | null;
  size: { w: number; h: number };
  className?: string;
  style?: React.CSSProperties;
}> = ({ items, live, laser, size, className, style }) => {
  const ref = useRef<HTMLCanvasElement>(null);
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
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawInk(ctx, { width: w, height: h, dpr, items, live, laser });
  }, [items, live, laser, size.w, size.h]);
  return <canvas ref={ref} className={className} style={{ position: 'absolute', inset: 0, width: size.w, height: size.h, pointerEvents: 'none', ...style }} />;
};

/* ------------------------------------------------------------------ *
 * Privacy masks
 * ------------------------------------------------------------------ */

export const MaskLayer: React.FC<{ masks: PrivacyMask[]; size: { w: number; h: number } }> = ({ masks, size }) => (
  <>
    {masks.map((m) => (
      <div
        key={m.id}
        style={{
          position: 'absolute',
          left: m.x * size.w,
          top: m.y * size.h,
          width: m.w * size.w,
          height: m.h * size.h,
          background: m.mode === 'solid' ? 'rgba(8,10,14,0.97)' : undefined,
          backdropFilter: m.mode === 'blur' ? 'blur(14px)' : undefined,
          borderRadius: 6,
          pointerEvents: 'none',
        }}
      />
    ))}
  </>
);

/* ------------------------------------------------------------------ *
 * Spotlight
 * ------------------------------------------------------------------ */

export const SpotlightLayer: React.FC<{
  spotlight: SpotlightState;
  /** Set while the teacher is moving the spotlight (imperative updates). */
  register?: (api: { move: (x: number, y: number) => void }) => void;
  size: { w: number; h: number };
  interactive?: boolean;
  onMove?: (x: number, y: number) => void;
}> = ({ spotlight, register, size, interactive, onMove }) => {
  const ref = useRef<HTMLDivElement>(null);
  const pos = useRef({ x: spotlight.x, y: spotlight.y });

  useEffect(() => {
    const apply = () => {
      if (!ref.current) return;
      ref.current.style.transform = `translate3d(${pos.current.x * size.w}px, ${pos.current.y * size.h}px, 0) translate(-50%, -50%)`;
    };
    apply();
    register?.({ move: (x, y) => { pos.current = { x, y }; apply(); } });
  }, [register, size.w, size.h]);

  useEffect(() => {
    pos.current = { x: spotlight.x, y: spotlight.y };
    if (ref.current) ref.current.style.transform = `translate3d(${spotlight.x * size.w}px, ${spotlight.y * size.h}px, 0) translate(-50%, -50%)`;
  }, [spotlight.x, spotlight.y, size.w, size.h]);

  if (!spotlight.on) return null;
  const diameter = Math.max(40, spotlight.r * size.w * 2);
  return (
    <div
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}
      onMouseMove={
        interactive && onMove
          ? (e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              onMove((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
            }
          : undefined
      }
    >
      <div
        ref={ref}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: diameter,
          height: diameter,
          borderRadius: spotlight.shape === 'circle' ? '50%' : 12,
          boxShadow: `0 0 0 100vmax rgba(4,6,10,${spotlight.dim})`,
        }}
      />
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * Teacher camera
 * ------------------------------------------------------------------ */

let sharedStream: MediaStream | null = null;
let sharedDevice: string | undefined;

export async function acquireCamera(deviceId?: string): Promise<MediaStream | null> {
  if (sharedStream && (!deviceId || sharedDevice === deviceId)) return sharedStream;
  if (sharedStream) {
    sharedStream.getTracks().forEach((t) => t.stop());
    sharedStream = null;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    sharedStream = stream;
    sharedDevice = deviceId;
    return stream;
  } catch {
    return null;
  }
}

export function releaseCamera(): void {
  sharedStream?.getTracks().forEach((t) => t.stop());
  sharedStream = null;
}

export const CameraView: React.FC<{
  camera: CameraConfig;
  card: Rect;
  /** Which side this view is rendered for. */
  role: 'prep' | 'live';
  onRectChange?: (rect: CameraConfig['rect']) => void;
  /**
   * Whether this preview may be dragged. Only true in an explicit
   * "reposition the camera" mode — otherwise the preview must never swallow a
   * click that belongs to the page underneath.
   */
  interactive?: boolean;
}> = ({ camera, card, role, onRectChange, interactive = false }) => {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0, w: 0, h: 0 });

  const visible = camera.enabled && (camera.exposure === 'both' || camera.exposure === role);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    void acquireCamera(camera.deviceId).then((s) => {
      if (alive) setStream(s);
    });
    return () => {
      alive = false;
    };
  }, [visible, camera.deviceId]);

  useEffect(() => {
    const video = videoRef.current;
    if (video && stream) {
      video.srcObject = stream;
      const promise = video.play();
      if (promise && typeof promise.catch === 'function') promise.catch(() => undefined);
    }
  }, [stream]);

  const rect = useMemo(
    () => ({
      x: camera.rect.x * card.width,
      y: camera.rect.y * card.height,
      w: camera.rect.w * card.width,
      h: camera.rect.h * card.height,
    }),
    [camera.rect, card.width, card.height],
  );

  const frame = useMemo(() => {
    const box = { width: rect.w, height: rect.h };
    const natural = { width: videoRef.current?.videoWidth || 16, height: videoRef.current?.videoHeight || 9 };
    const fit = fitSize(natural, box, 'cover');
    return { left: (box.width - fit.width) / 2, top: (box.height - fit.height) / 2, width: fit.width, height: fit.height };
  }, [rect.w, rect.h, crop]);

  if (!visible) return null;

  const startDrag = (e: React.PointerEvent) => {
    if (!onRectChange || !interactive) return;
    dragRef.current = { dx: e.clientX - rect.x, dy: e.clientY - rect.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onDrag = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || !onRectChange) return;
    const x = Math.min(1 - camera.rect.w, Math.max(0, (e.clientX - drag.dx) / Math.max(1, card.width)));
    const y = Math.min(1 - camera.rect.h, Math.max(0, (e.clientY - drag.dy) / Math.max(1, card.height)));
    onRectChange({ ...camera.rect, x, y });
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        borderRadius: camera.shape === 'circle' ? '50%' : camera.radius,
        overflow: 'hidden',
        boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
        border: interactive ? '1px solid rgba(74,163,255,0.55)' : '1px solid rgba(255,255,255,0.14)',
        background: '#0a0d13',
        cursor: interactive ? 'grab' : 'default',
        pointerEvents: interactive ? 'auto' : 'none',
      }}
      onPointerDown={startDrag}
      onPointerMove={onDrag}
      onPointerUp={endDrag}
    >
      <video
        ref={videoRef}
        muted
        playsInline
        style={{
          position: 'absolute',
          left: frame.left,
          top: frame.top,
          width: frame.width,
          height: frame.height,
          objectFit: 'cover',
          transform: camera.mirror ? 'scaleX(-1)' : undefined,
        }}
      />
    </div>
  );
};

/** Camera device list for the preview settings. */
export async function listCameras(): Promise<{ id: string; label: string }[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput').map((d) => ({ id: d.deviceId, label: d.label || 'Camera' }));
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ *
 * Holding / privacy / protection screens
 * ------------------------------------------------------------------ */

export const JuztMark: React.FC<{ size?: number }> = ({ size = 64 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
    <defs>
      <linearGradient id="jz-frame" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#6ea8ff" />
        <stop offset="100%" stopColor="#8b6bff" />
      </linearGradient>
    </defs>
    <rect x="6" y="6" width="52" height="52" rx="15" fill="none" stroke="url(#jz-frame)" strokeWidth="3.4" opacity="0.9" />
    <path d="M36 19 V35.5 A8.6 8.6 0 0 1 18.9 35.5" fill="none" stroke="#ffffff" strokeWidth="6" strokeLinecap="round" />
    <circle cx="43.5" cy="19.5" r="4" fill="url(#jz-frame)" />
  </svg>
);

export const HoldingScreen: React.FC<{ live: LivePayload; size: { w: number; h: number } }> = ({ live, size }) => (
  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, color: '#eef2f9' }}>
    <JuztMark size={Math.min(120, size.w * 0.09)} />
    <div style={{ fontSize: Math.max(20, Math.min(46, size.w * 0.031)), fontWeight: 600, letterSpacing: '-0.01em' }}>{live.surface.holdingText || 'Ready when you are'}</div>
    <div style={{ fontSize: Math.max(12, size.w * 0.011), opacity: 0.5, letterSpacing: '0.16em', textTransform: 'uppercase' }}>{live.appName}</div>
  </div>
);

export const PrivacyScreen: React.FC<{ live: LivePayload; size: { w: number; h: number } }> = ({ live, size }) => (
  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, color: '#f2f7fb', textAlign: 'center', padding: 40 }}>
    <div style={{ fontSize: Math.max(26, Math.min(64, size.w * 0.045)), fontWeight: 700 }}>{live.surface.privacyTitle || 'Không được xem 👀'}</div>
    <div style={{ fontSize: Math.max(13, size.w * 0.014), opacity: 0.72, maxWidth: 720 }}>{live.surface.privacySubtitle || 'Đang chuẩn bị nội dung...'}</div>
    <div style={{ fontSize: 11, opacity: 0.34, marginTop: 14, letterSpacing: '0.12em' }}>JUZT</div>
  </div>
);

export const ProtectionLayer: React.FC<{ frame: string | null; size: { w: number; h: number }; radius: number }> = ({ frame, size, radius }) => (
  <div style={{ position: 'absolute', inset: 0, borderRadius: radius, overflow: 'hidden', background: '#0b0e14' }}>
    {frame ? <img src={frame} alt="" style={{ position: 'absolute', inset: 0, width: size.w, height: size.h, objectFit: 'cover', filter: 'brightness(0.72) saturate(0.9)' }} /> : null}
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 34, height: 34, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.28)', borderTopColor: 'rgba(255,255,255,0.9)', animation: 'jz-spin 900ms linear infinite' }} />
    </div>
  </div>
);

export const FreezeFrame: React.FC<{ frame: string | null; size: { w: number; h: number } }> = ({ frame, size }) =>
  frame ? <img src={frame} alt="" style={{ position: 'absolute', inset: 0, width: size.w, height: size.h, objectFit: 'cover' }} /> : <div style={{ position: 'absolute', inset: 0, background: '#0b0e14' }} />;
