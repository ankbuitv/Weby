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
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
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
  }, []);

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
      const bounds = { x, y, width: vw, height: vh };
      setViewportRect(bounds);
      // layout wrapper div (for annotation overlay positioning)
      wrap.style.left = x + 'px';
      wrap.style.top = y + 'px';
      wrap.style.width = vw + 'px';
      wrap.style.height = vh + 'px';
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
    window.stage.navigate(url).catch(() => {});
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

  // Title bar drag area (frameless window)
  const onDragAreaMouseDown = (e: React.MouseEvent) => {
    // Only enable drag on empty area
    if (cleanMode) return;
    if (e.target !== e.currentTarget) return;
    // Send to main via IPC to drag? Electron supports -webkit-app-region CSS on body;
    // but we set it via a drag region div. We need to be careful to avoid blocking clicks on toolbar.
  };

  // Background style
  const bgStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    backgroundColor: settings.backgroundColor,
    zIndex: 0,
  };
  const bgImgStyle: React.CSSProperties | undefined = settings.backgroundImage
    ? {
        position: 'absolute',
        inset: 0,
        backgroundImage: `url("${fileURL(settings.backgroundImage).replace(/"/g, '%22')}")`,
        backgroundSize:
          settings.backgroundMode === 'cover'
            ? 'cover'
            : settings.backgroundMode === 'contain'
              ? 'contain'
              : 'auto',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        zIndex: 0,
      }
    : undefined;
  const dimStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    background: `rgba(0,0,0,${settings.backgroundDim})`,
    zIndex: 1,
    pointerEvents: 'none',
  };

  const showWebsite = mode === 'live' || mode === 'frozen';

  return (
    <div
      ref={rootRef}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: settings.backgroundColor }}
    >
      <div style={bgStyle} />
      {bgImgStyle && <div style={bgImgStyle} onError={() => {}} />}
      <div style={dimStyle} />

      {/* Frameless drag area top strip */}
      {!cleanMode && (
        <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 32,
          zIndex: 9,
          WebkitAppRegion: 'drag',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          color: 'rgba(255,255,255,0.5)',
          fontSize: 12,
        } as React.CSSProperties}
      >
          <div style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
            Stage Browser{pageTitle ? ' · ' + pageTitle : ''}
          </div>
          <div style={{ WebkitAppRegion: 'no-drag', display: 'flex', gap: 4 } as React.CSSProperties}>
            <WindowBtn label="—" onClick={() => window.stage.minimize()} />
            <WindowBtn label="▢" onClick={() => window.stage.toggleMaximize()} />
            <WindowBtn label="×" onClick={() => window.stage.close()} />
          </div>
        </div>
      )}

      {/* Toolbar */}
      <Toolbar
        visible={!cleanMode}
        tool={tool}
        setTool={setTool}
        color={color}
        onColorChosen={setColor}
        size={size}
        onSizeChange={setSize}
        onUndo={() => annotApiRef.current?.undo()}
        onRedo={() => annotApiRef.current?.redo()}
        onClear={() => annotApiRef.current?.clear()}
        canUndo={histState.canUndo}
        canRedo={histState.canRedo}
        collapsed={toolbarCollapsed}
        onToggleCollapsed={() => setToolbarCollapsed((c) => !c)}
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
          background: '#ffffff',
          zIndex: 2,
        }}
        onMouseDown={onDragAreaMouseDown}
      >
        {/* Website is a real WebContentsView layered BELOW the renderer; so this div acts as the hole where it shows through.
            The annotation canvas and overlays sit in this wrapper above it. */}
        {loadError && (
          <div
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
            <div style={{ fontSize: 18 }}>Unable to load page</div>
            <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>{loadError}</div>
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
            <div style={{ fontSize: 42, fontWeight: 600, letterSpacing: 2 }}>BRB</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>Privacy mode · Press F8 to return</div>
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

      {/* Status/help line bottom */}
      {!cleanMode && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 8,
            textAlign: 'center',
            color: 'rgba(255,255,255,0.35)',
            fontSize: 11,
            zIndex: 9,
            pointerEvents: 'none',
          }}
        >
          Ctrl+L navigate · Alt+←/→ back/forward · V/P/H/E/L tools · F8 privacy · F9 freeze · F10 spotlight · Ctrl+Shift+B background · Ctrl+Shift+H clean mode · F11 fullscreen · Ctrl+Shift+Q quit
        </div>
      )}

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

      {/* subtle cursor hint */}
      {tool !== 'cursor' && !cleanMode && (
        <div
          style={{
            position: 'absolute',
            top: 40,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '6px 12px',
            background: 'rgba(0,0,0,0.5)',
            color: '#fff',
            borderRadius: 8,
            fontSize: 12,
            zIndex: 20,
            pointerEvents: 'none',
          }}
        >
          {tool.toUpperCase()} mode · press V for cursor
        </div>
      )}
    </div>
  );
};

const WindowBtn: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <button
    onClick={onClick}
    style={{
      width: 32,
      height: 24,
      background: 'transparent',
      border: 'none',
      color: 'rgba(255,255,255,0.7)',
      borderRadius: 4,
      cursor: 'pointer',
      fontSize: 12,
    }}
  >
    {label}
  </button>
);

export default App;
