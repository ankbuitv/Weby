import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Toolbar } from './components/Toolbar';
import { Palette } from './components/Palette';
import { SettingsPanel } from './components/Settings';
import { AnnotationCanvas } from './annotation/AnnotationCanvas';
import { useShortcuts } from './hooks/useShortcuts';
import type { PresentationMode, Settings, ToolId } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';

const fileURL = (p: string) => {
  const normalized = p.replace(/\\/g, '/');
  return 'file:///' + encodeURI(normalized.replace(/^\//, ''));
};

const App: React.FC = () => {
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS });
  const [backgroundNaturalSize, setBackgroundNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [mode, setMode] = useState<PresentationMode>('live');
  const [cleanMode, setCleanMode] = useState(false);
  const [spotlight, setSpotlight] = useState(false);
  const [frozenImage, setFrozenImage] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteInitial, setPaletteInitial] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tool, setTool] = useState<ToolId>('cursor');
  const [color, setColor] = useState<string>(DEFAULT_SETTINGS.defaultPenColor);
  const [size, setSize] = useState<number>(DEFAULT_SETTINGS.defaultPenSize);
  const [opacity, setOpacity] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pageTitle, setPageTitle] = useState('');
  const [pageURL, setPageURL] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewportRect, setViewportRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [histState, setHistState] = useState({ canUndo: false, canRedo: false, count: 0 });
  const annotApiRef = useRef<{ undo: () => void; redo: () => void; clear: () => void } | null>(null);

  const webWrapperRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Load settings
  useEffect(() => {
    window.stage.getSettings().then((s) => {
      setSettings(s);
      setColor(s.defaultPenColor);
      setSize(s.defaultPenSize);
      setOpacity(1);
      window.stage.setZoom(s.zoom).catch(() => {});
    });
    window.stage.isFullscreen().then(setIsFullscreen);
    window.stage.onFullscreenChanged(setIsFullscreen);
    window.stage.onLoadCommit(({ url }) => {
      setPageURL(url);
      setLoadError(null);
    });
    window.stage.onTitleUpdated(setPageTitle);
    window.stage.onDidFailLoad(({ errorDescription, validatedURL }) => {
      setLoadError(`Failed to load ${validatedURL}: ${errorDescription}`);
    });
    window.stage.onRendererCrashed(({ reason }) => {
      setLoadError(`Web process crashed: ${reason}`);
    });
    window.stage.getURL().then(setPageURL);
    window.stage.getTitle().then(setPageTitle);
    window.stage.getLoadError().then((info) => { if (info) setLoadError(`${info.errorDescription} · ${info.validatedURL}`); });
  }, []);

  useEffect(() => {
    if (!settings.backgroundImage) { setBackgroundNaturalSize(null); return; }
    const image = new Image();
    image.onload = () => setBackgroundNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => setBackgroundNaturalSize(null);
    image.src = fileURL(settings.backgroundImage);
  }, [settings.backgroundImage]);

  // Keyboard shortcuts must continue to work while the native website view has focus.
  useEffect(() => {
    const unsubscribe = window.stage.onRelayKey((key) => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: key.key, ctrlKey: key.ctrlKey, shiftKey: key.shiftKey, altKey: key.altKey,
        bubbles: true, cancelable: true,
      }));
    });
    return () => { unsubscribe(); };
  }, []);

  // The transparent overlay passes pointer input through to the website in Cursor
  // mode, except for measured UI hit zones. Drawing/privacy modes capture the surface.
  useEffect(() => {
    window.stage.setOverlayCapture(tool !== 'cursor' || spotlight || mode !== 'live' || paletteOpen || settingsOpen).catch(() => {});
  }, [tool, spotlight, mode, paletteOpen, settingsOpen]);

  useEffect(() => {
    const syncRegions = () => {
      const regions = Array.from(document.querySelectorAll<HTMLElement>('[data-ui-region]'))
        .filter((el) => el.offsetParent !== null)
        .map((el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
      window.stage.setMouseRegions(regions).catch(() => {});
    };
    syncRegions();
    const timer = window.setInterval(syncRegions, 300);
    const observer = new MutationObserver(syncRegions);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    return () => { window.clearInterval(timer); observer.disconnect(); };
  }, [tool, cleanMode, paletteOpen, settingsOpen]);

  // Compute viewport bounds based on window size and ratio. Relay to main.
  useEffect(() => {
    const updateBounds = () => {
      const root = rootRef.current;
      const wrap = webWrapperRef.current;
      if (!root || !wrap) return;
      const w = root.clientWidth;
      const h = root.clientHeight;
      let vw = w;
      let vh = h;
      const margin = cleanMode ? 0 : 80;
      const availW = Math.max(200, w - margin * 2);
      const availH = Math.max(200, h - margin * 2);
      if (settings.viewportRatio === '16:9') {
        const r = 16 / 9;
        if (availW / availH > r) {
          vh = availH;
          vw = vh * r;
        } else {
          vw = availW;
          vh = vw / r;
        }
      } else if (settings.viewportRatio === '4:3') {
        const r = 4 / 3;
        if (availW / availH > r) {
          vh = availH;
          vw = vh * r;
        } else {
          vw = availW;
          vh = vw / r;
        }
      } else if (settings.viewportRatio === 'portrait') {
        const r = 3 / 4;
        if (availW / availH > r) {
          vh = availH;
          vw = vh * r;
        } else {
          vw = availW;
          vh = vw / r;
        }
      } else {
        vw = availW;
        vh = availH;
      }
      const x = (w - vw) / 2;
      const y = (h - vh) / 2;
      // One rounded CSS-pixel calculation feeds both Chromium and the overlay canvas.
      const bounds = { x: Math.round(x), y: Math.round(y), width: Math.round(vw), height: Math.round(vh) };
      setViewportRect(bounds);
      wrap.style.left = bounds.x + 'px';
      wrap.style.top = bounds.y + 'px';
      wrap.style.width = bounds.width + 'px';
      wrap.style.height = bounds.height + 'px';
      // relay to main so WebContentsView matches
      window.stage.setViewport(bounds).catch(() => {});
    };
    updateBounds();
    const ro = new ResizeObserver(updateBounds);
    if (rootRef.current) ro.observe(rootRef.current);
    window.addEventListener('resize', updateBounds);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateBounds);
    };
  }, [settings.viewportRatio, cleanMode]);

  const persistSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      window.stage.setSettings(patch).catch(() => {});
      return next;
    });
  }, []);

  const navigate = useCallback((url: string) => {
    window.stage.navigate(url).then((ok) => { if (ok) setTimeout(() => window.stage.focusWebView().catch(() => {}), 80); }).catch(() => {});
  }, []);

  const togglePrivacy = useCallback(() => {
    setMode((m) => {
      const next: PresentationMode = m === 'privacy' ? 'live' : 'privacy';
      if (next === 'privacy' && settings.privacyMuteAudio) {
        window.stage.setAudioMuted(true).catch(() => {});
      } else {
        window.stage.setAudioMuted(false).catch(() => {});
      }
      if (next !== 'privacy') {
        setFrozenImage(null);
      }
      return next;
    });
  }, [settings.privacyMuteAudio]);

  const toggleFreeze = useCallback(async () => {
    if (mode === 'frozen') {
      setMode('live');
      setFrozenImage(null);
      return;
    }
    const res = await window.stage.captureFreeze();
    if (res.ok) {
      setFrozenImage(res.dataUrl);
      setMode('frozen');
    }
  }, [mode]);

  const toggleSpotlight = useCallback(() => {
    setSpotlight((s) => !s);
    if (!spotlight) setTool('cursor');
  }, [spotlight, setTool]);

  const toggleClean = useCallback(() => setCleanMode((c) => !c), []);
  const toggleFullscreen = useCallback(() => window.stage.toggleFullscreen(), []);

  const openPalette = useCallback((initial = '') => {
    setPaletteInitial(initial);
    setPaletteOpen(true);
  }, []);

  const doCommand = useCallback(
    (cmd: string, args: string) => {
      switch (cmd) {
        case 'privacy':
          togglePrivacy();
          break;
        case 'freeze':
          toggleFreeze();
          break;
        case 'clean':
          toggleClean();
          break;
        case 'clear':
          annotApiRef.current?.clear();
          break;
        case 'background':
          pickBackground();
          break;
        case 'fullscreen':
          toggleFullscreen();
          break;
        case 'settings':
          setSettingsOpen(true);
          break;
        case 'zoom': {
          const n = parseFloat(args);
          if (!isNaN(n)) {
            const f = Math.max(0.25, Math.min(5, n / 100));
            window.stage.setZoom(f).catch(() => {});
            persistSettings({ zoom: f });
          }
          break;
        }
        default:
          break;
      }
    },
    [togglePrivacy, toggleFreeze, toggleClean, toggleFullscreen, persistSettings],
  );

  const pickBackground = useCallback(async () => {
    const p = await window.stage.pickBackground();
    if (p) persistSettings({ backgroundImage: p });
  }, [persistSettings]);

  const clearBackground = useCallback(() => {
    window.stage.clearBackground().catch(() => {});
    persistSettings({ backgroundImage: undefined });
  }, [persistSettings]);

  // Zoom factor for tool
  const adjustZoom = useCallback(
    (delta: number) => {
      setSettings((s) => {
        const next = Math.max(0.25, Math.min(5, +(s.zoom + delta).toFixed(2)));
        window.stage.setZoom(next).catch(() => {});
        window.stage.setSettings({ zoom: next }).catch(() => {});
        return { ...s, zoom: next };
      });
    },
    [],
  );

  const resetZoom = useCallback(() => {
    setSettings((s) => {
      window.stage.setZoom(1).catch(() => {});
      window.stage.setSettings({ zoom: 1 }).catch(() => {});
      return { ...s, zoom: 1 };
    });
  }, []);

  // Keyboard shortcuts
  useShortcuts({
    global: {
      'Ctrl+l': () => {
        openPalette(pageURL);
      },
      'Ctrl+Shift+q': () => {
        window.stage.quit();
      },
      'Ctrl+Shift+h': () => toggleClean(),
      'F8': () => togglePrivacy(),
      'F9': () => toggleFreeze(),
      'F10': () => toggleSpotlight(),
      'F11': () => toggleFullscreen(),
      'Ctrl+Shift+b': () => pickBackground(),
      'Escape': () => {
        if (paletteOpen) {
          setPaletteOpen(false);
          return;
        }
        if (settingsOpen) {
          setSettingsOpen(false);
          return;
        }
        if (spotlight) {
          setSpotlight(false);
          return;
        }
        if (mode === 'privacy') {
          togglePrivacy();
          return;
        }
        if (mode === 'frozen') {
          toggleFreeze();
          return;
        }
      },
      'Ctrl+z': () => annotApiRef.current?.undo(),
      'Ctrl+Shift+z': () => annotApiRef.current?.redo(),
      'Ctrl+Shift+c': () => annotApiRef.current?.clear(),
      'Alt+ArrowLeft': () => window.stage.goBack(),
      'Alt+ArrowRight': () => window.stage.goForward(),
      'Ctrl+r': () => window.stage.reload(),
      'Ctrl+Shift+r': () => window.stage.hardReload(),
      'Ctrl+=': () => adjustZoom(0.1),
      'Ctrl+-': () => adjustZoom(-0.1),
      'Ctrl+0': () => resetZoom(),
    },
    normal: {
      v: () => setTool('cursor'),
      p: () => setTool('pen'),
      h: () => setTool('highlighter'),
      e: () => setTool('eraser'),
      l: () => setTool('laser'),
      '[': () => setSize((s) => Math.max(1, s - 2)),
      ']': () => setSize((s) => Math.min(80, s + 2)),
    },
  });

  // When tool changes to non-cursor and spotlight is on, keep spotlight behavior (dim overlay)
  const interactiveAnnotations = tool !== 'cursor' || spotlight;

  // Draw the backdrop in four regions around the native website view. The center
  // stays transparent so Chromium is visible through the separate overlay window.
  const rootWidth = rootRef.current?.clientWidth || window.innerWidth;
  const rootHeight = rootRef.current?.clientHeight || window.innerHeight;
  const vr = viewportRect || { x: 0, y: 0, width: rootWidth, height: rootHeight };
  const backdropImage = settings.backgroundImage
    ? `url("${fileURL(settings.backgroundImage).replace(/"/g, '%22')}")`
    : 'radial-gradient(ellipse at 72% 12%, rgba(101,111,210,0.16), transparent 44%), linear-gradient(145deg, #10131c, #090b10 68%)';
  const backdropPanels = viewportRect ? [
    { x: 0, y: 0, width: rootWidth, height: vr.y },
    { x: 0, y: vr.y, width: vr.x, height: vr.height },
    { x: vr.x + vr.width, y: vr.y, width: rootWidth - vr.x - vr.width, height: vr.height },
    { x: 0, y: vr.y + vr.height, width: rootWidth, height: rootHeight - vr.y - vr.height },
  ] : [{ x: 0, y: 0, width: rootWidth, height: rootHeight }];
  let imageWidth = rootWidth;
  let imageHeight = rootHeight;
  let imageOffsetX = 0;
  let imageOffsetY = 0;
  if (backgroundNaturalSize && settings.backgroundImage) {
    const scale = settings.backgroundMode === 'cover'
      ? Math.max(rootWidth / backgroundNaturalSize.width, rootHeight / backgroundNaturalSize.height)
      : settings.backgroundMode === 'contain'
        ? Math.min(rootWidth / backgroundNaturalSize.width, rootHeight / backgroundNaturalSize.height)
        : 1;
    imageWidth = backgroundNaturalSize.width * scale;
    imageHeight = backgroundNaturalSize.height * scale;
    imageOffsetX = (rootWidth - imageWidth) / 2;
    imageOffsetY = (rootHeight - imageHeight) / 2;
  }
  const panelStyle = (r: { x: number; y: number; width: number; height: number }): React.CSSProperties => {
    const firstSize = `${rootWidth}px ${rootHeight}px`;
    const imageSize = `${imageWidth}px ${imageHeight}px`;
    const backgroundSize = settings.backgroundDim > 0
      ? `${firstSize}, ${settings.backgroundImage ? imageSize : firstSize}, ${firstSize}`
      : `${settings.backgroundImage ? imageSize : firstSize}, ${firstSize}`;
    const imagePosition = `${imageOffsetX - r.x}px ${imageOffsetY - r.y}px`;
    const backgroundPosition = settings.backgroundDim > 0
      ? `-${r.x}px -${r.y}px, ${settings.backgroundImage ? imagePosition : `-${r.x}px -${r.y}px`}, -${r.x}px -${r.y}px`
      : `${settings.backgroundImage ? imagePosition : `-${r.x}px -${r.y}px`}, -${r.x}px -${r.y}px`;
    return {
      position: 'absolute', left: r.x, top: r.y, width: r.width, height: r.height,
      backgroundColor: settings.backgroundColor,
      backgroundImage: `${settings.backgroundDim > 0 ? `linear-gradient(rgba(0,0,0,${settings.backgroundDim}),rgba(0,0,0,${settings.backgroundDim})),` : ''}${backdropImage}`,
      backgroundSize, backgroundPosition, backgroundRepeat: 'no-repeat', pointerEvents: 'none', zIndex: 0,
    };
  };

  const showWebsite = mode === 'live' || mode === 'frozen';

  return (
    <div
      ref={rootRef}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: 'transparent' }}
    >
      {backdropPanels.map((r, i) => r.width > 0 && r.height > 0 && <div key={i} style={panelStyle(r)} />)}

      {/* Toolbar */}
      <Toolbar
        visible={!cleanMode}
        tool={spotlight ? 'spotlight' : tool}
        setTool={(next) => { if (next === 'spotlight') { setSpotlight((v) => !v); setTool('cursor'); } else { if (next === 'highlighter' && tool !== 'highlighter') { setColor(settings.defaultHighlighterColor); setOpacity(settings.defaultHighlighterOpacity); } if (next === 'pen' && tool !== 'pen') { setColor(settings.defaultPenColor); setOpacity(1); } setTool(next); if (next === 'cursor') setSpotlight(false); } }}
        color={color}
        onColorChosen={setColor}
        size={size}
        onSizeChange={setSize}
        opacity={opacity}
        onOpacityChange={setOpacity}
        onUndo={() => annotApiRef.current?.undo()}
        onRedo={() => annotApiRef.current?.redo()}
        canUndo={histState.canUndo}
        canRedo={histState.canRedo}
        onToggleCollapsed={() => setSettingsOpen(true)}
      />

      {/* Website wrapper (positioned by effect) */}
      <div
        ref={webWrapperRef}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 1,
          height: 1,
          borderRadius: cleanMode ? 0 : 14,
          overflow: 'hidden',
          boxShadow: cleanMode ? 'none' : '0 20px 60px rgba(0,0,0,0.5)',
          background: 'transparent',
          zIndex: 2,
        }}
      >
        {/* Transparent overlay content; native WebContentsView beneath is exposed through the clear center. */}
        {loadError && (
          <div
            data-ui-region="true"
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(10,12,18,0.95)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
              gap: 12,
              zIndex: 6,
              pointerEvents: 'auto',
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 600 }}>Couldn’t load this page</div>
            <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>Check your connection, then try again.</div>
            <button
              onClick={() => window.stage.reload()}
              style={{
                marginTop: 8,
                padding: '8px 16px',
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)',
                color: '#fff',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        )}
        {mode === 'privacy' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'linear-gradient(135deg, #1a1f2e 0%, #0b0d12 100%)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
              zIndex: 8,
              gap: 8,
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 550, letterSpacing: '-.01em' }}>Presentation paused</div>
          </div>
        )}
        {mode === 'frozen' && frozenImage && (
          <img
            src={frozenImage}
            alt="frozen"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', zIndex: 7, pointerEvents: 'none' }}
          />
        )}
        {/* Annotation canvas always mounted; interactive only when drawing mode */}
        <AnnotationCanvas
          interactive={interactiveAnnotations}
          tool={tool}
          color={color}
          size={size}
          opacity={opacity}
          spotlightActive={spotlight}
          onHistoryChange={setHistState}
          registerUndoRedo={(api) => {
            annotApiRef.current = api;
          }}
        />
        {!showWebsite && mode !== 'privacy' && !pageURL && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(0,0,0,0.4)', fontSize: 18, zIndex: 2 }}>
            Press Ctrl+L to begin
          </div>
        )}
      </div>

      <Palette
        open={paletteOpen}
        initialValue={paletteInitial}
        onClose={() => setPaletteOpen(false)}
        onNavigate={(url) => navigate(url)}
        onCommand={doCommand}
      />

      <SettingsPanel
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onSave={(patch) => persistSettings(patch)}
        onPickBackground={pickBackground}
        onClearBackground={clearBackground}
      />


    </div>
  );
};

export default App;
