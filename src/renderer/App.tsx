import React from 'react';
import { computeGeometry, cardBorderCss, cardShadowCss, TOOLBAR, TOP_BAR, TAB_SHELF, workspaceInsets, shelfVisible as shelfOn } from '../shared/layout';
import type { LivePayload, Rect, Settings, TabState } from '../shared/types';
import { tabLabel } from '../shared/types';
import { resolveWorkspace } from '../shared/workspace';
import { BackgroundLayer } from './live/effects';
import { WhiteboardEditor } from './whiteboard/WhiteboardEditor';
import { Icon } from './components/Icons';
import { ExtensionsMenu } from './components/BrowserPanels';
import { Logo } from './components/Logo';
import { Toolbar } from './components/Toolbar';
import { Palette } from './components/Palette';
import {
  BackgroundsPanel,
  CameraPanel,
  ContextMenu,
  DiagPanel,
  InternalPage,
  NotesPanel,
  Onboarding,
  PermissionDialogs,
  ScenesPanel,
  SettingsPanel,
  Toasts,
} from './components/Panels';
import { useShortcuts } from './hooks/useShortcuts';
import { actions } from './state/actions';
import { sel, store, useSel } from './state/store';

/**
 * PREP shell.
 *
 *   Single  (default) — this window *is* the V2 workspace: full-window
 *            presentation background, one large centred content card, one
 *            compact floating toolbar on the left. Exactly one of NEW_TAB /
 *            WEB / WHITEBOARD is ever mounted inside the card; privacy and
 *            freeze are the only overlays, and they are drawn by the card
 *            overlay view (the one layer that can paint above the page).
 *   Dual    — "Start Presentation" opened `Juzt Live`; this window becomes the
 *            teacher's private prep workspace and the audience lives in the
 *            other window. The two are never rendered on top of each other.
 *
 * Geometry is never guessed here: main owns the native views and publishes the
 * authoritative card rect through `EV.GEOM`; this shell only draws the frame
 * around exactly that rectangle (and falls back to the same
 * `computeGeometry()` call main makes while the first message is in flight).
 */

const App: React.FC = () => {
  const ready = useSel((s) => s.ready);
  const settings = useSel((s) => s.settings);
  const tabs = useSel((s) => s.tabs);
  const activeTab = useSel(sel.activeTab);

  useShortcuts(ready);

  const [viewport, setViewport] = React.useState({ w: window.innerWidth, h: window.innerHeight });
  const [geom, setGeom] = React.useState<(Rect & { windowSize: { width: number; height: number }; insets?: { top: number; right: number; bottom: number; left: number }; shelf?: boolean }) | null>(null);

  // One coalesced resize observer for the whole shell.
  React.useEffect(() => {
    let pending = 0;
    const onResize = () => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        setViewport({ w: window.innerWidth, h: window.innerHeight });
      });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (pending) cancelAnimationFrame(pending);
    };
  }, []);

  React.useEffect(() => {
    const off = window.juzt.on.geom((g) =>
      setGeom({
        ...g.card,
        windowSize: g.windowSize,
        insets: (g as { insets?: { top: number; right: number; bottom: number; left: number } }).insets,
        shelf: (g as { shelf?: boolean }).shelf,
      }),
    );
    return () => {
      off();
    };
  }, []);

  const single = settings.presentationMode !== 'dual';
  const shelf = shelfOn(tabs.length, !!settings.tabShelfAlways);

  const geometry = React.useMemo(
    () =>
      computeGeometry({
        single,
        prepSize: { width: viewport.w, height: viewport.h },
        liveSize: { width: viewport.w, height: viewport.h },
        sizePreset: settings.sizePreset,
        customScale: settings.customScale,
        margin: settings.card.margin,
        layout: settings.layout,
        card: settings.card,
        paneOpen: settings.prepPaneOpen,
        shelfVisible: shelf,
      }),
    [single, viewport, settings, shelf],
  );

  // Trust main's rect only while it describes the window we are actually
  // looking at; otherwise fall back to the identical local computation. That is
  // what keeps the native view glued to the DOM frame through startup, resize,
  // maximise, fullscreen and the shelf appearing/disappearing.
  const sameWindow =
    !!geom && Math.abs(geom.windowSize.width - viewport.w) < 2 && Math.abs(geom.windowSize.height - viewport.h) < 2;
  const card = sameWindow && geom ? geom : single ? geometry.live : geometry.prepCard;
  const pane = geometry.pane;

  // The very same numbers that placed the card become CSS custom properties, so
  // the toolbar, the shelf and the frame can never disagree with the native view.
  const insetVars = React.useMemo(
    () =>
      ({
        '--jz-inset-left': `${geometry.insets.left}px`,
        '--jz-inset-top': `${geometry.insets.top}px`,
        '--jz-inset-right': `${geometry.insets.right}px`,
        '--jz-inset-bottom': `${geometry.insets.bottom}px`,
        '--jz-card-x': `${card.x}px`,
        '--jz-card-y': `${card.y}px`,
        '--jz-card-w': `${card.width}px`,
        '--jz-card-h': `${card.height}px`,
        '--jz-card-radius': `${Math.max(0, settings.card.radius)}px`,
        '--jz-toolbar-w': `${TOOLBAR.width}px`,
        '--jz-toolbar-offset': `${TOOLBAR.offsetLeft}px`,
        '--jz-toolbar-radius': `${TOOLBAR.radius}px`,
        '--jz-topbar-h': `${TOP_BAR.height}px`,
        '--jz-shelf-h': `${TAB_SHELF.height}px`,
      }) as React.CSSProperties,
    [geometry, card, settings.card.radius],
  );

  return (
    <div className={`jz-app ${single ? 'is-single' : 'is-dual'} ${useSel((s) => s.cleanMode) ? 'is-clean' : ''}`}>
      {/* 1 — the full-window presentation background */}
      <BackgroundLayer spec={settings.liveBackground} size={{ w: viewport.w, h: viewport.h }} className="jz-stage-bg" />

      {/* 2 — tiny floating top strip: brand, Present, subtle window controls */}
      <TopBar single={single} />

      {/* 3 — compact tab shelf, only when it earns its space */}
      {shelf ? <TabShelf /> : null}

      {/* 4 — ONE content card */}
      <Workspace card={card} pane={pane} single={single} insetVars={insetVars} />

      {/* 5 — the compact floating teaching toolbar */}
      <Toolbar />

      <Palette />
      <SettingsPanel />
      <ScenesPanel />
      <NotesPanel />
      <CameraPanel />
      <BackgroundsPanel />
      <PermissionDialogs />
      <ContextMenu />
      <DiagPanel />
      <Toasts />
      <Onboarding />
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * Top strip — deliberately tiny. Never a full-width application header.
 * ------------------------------------------------------------------ */

const TopBar: React.FC<{ single: boolean }> = ({ single }) => {
  const appName = useSel((s) => s.appName);
  const version = useSel((s) => s.version);
  const presenting = useSel((s) => !!s.live && s.live.presentation.kind !== 'holding');
  const progress = useSel((s) => s.presentProgress);
  const settings = useSel((s) => s.settings);
  const extensionsOpen = useSel((s) => s.extensionsOpen);
  const loadedCount = useSel((s) => s.extensions.filter((e) => e.status === 'loaded').length);
  const safeMode = useSel((s) => s.settings.safeMode);

  return (
    <header className="jz-top" onDoubleClick={() => void window.juzt.window.toggleMaximize()}>
      <div className="jz-top__drag">
        <Logo size={16} variant="mono" />
        <span className="jz-top__name">{appName}</span>
        <span className="jz-top__ver">v{version}</span>
      </div>

      <div className="jz-top__actions">
        {progress?.stage === 'error' ? (
          <button className="jz-chip jz-chip--warn" onClick={() => void actions.retryPresent()}>
            Retry
          </button>
        ) : null}

        {single ? (
          <button className="jz-present" title="Start Presentation (Ctrl+Enter) — opens Juzt Live" onClick={() => void actions.startPresentation()}>
            <Icon.broadcast size={14} /> Present
          </button>
        ) : presenting ? (
          <>
            <button
              className="jz-chip jz-chip--danger"
              title="Stop presenting (Esc)"
              onClick={() => void actions.stopPresenting()}
            >
              Stop
            </button>
            <button className="jz-present is-live" title="Present the active tab (Ctrl+Enter)" onClick={() => void actions.presentActive()}>
              <Icon.broadcast size={14} /> Presenting
            </button>
          </>
        ) : (
          <button className="jz-present" title="Present the active tab (Ctrl+Enter)" onClick={() => void actions.presentActive()}>
            <Icon.broadcast size={14} /> Present
          </button>
        )}

        <button
          className="jz-top__mini"
          title={single ? 'Switch to dual monitor output' : 'Back to the single calm window'}
          onClick={() => void actions.setSettings({ presentationMode: single ? 'dual' : 'single' })}
        >
          <Icon.monitor size={14} />
          {single ? 'Dual' : 'Single'}
        </button>

        {/* Extensions: PREP only. LIVE never renders a top bar at all. */}
        <span className="jz-top__extwrap">
          <button
            className={`jz-top__mini jz-top__ext${loadedCount > 0 ? ' has-ext' : ''}${safeMode ? ' is-off' : ''}`}
            title={safeMode ? 'Extensions paused (Safe Mode)' : `${loadedCount} extension${loadedCount === 1 ? '' : 's'} running`}
            onClick={() => actions.toggleExtensionsMenu()}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M6 1.6h4l.6 2.1 1.9 1.1 2.1-.6 2 3.4-1.6 1.4v2.2l1.6 1.4-2 3.4-2.1-.6-1.9 1.1L10 14.4H6l-.6-2.1-1.9-1.1-2.1.6-2-3.4L1 6.9V4.7L-.6 3.3l2-3.4 2.1.6L5.4 3.7 6 1.6Z"
                transform="translate(1)"
                stroke="currentColor"
                strokeWidth="1.1"
              />
              <circle cx="8" cy="8" r="1.6" stroke="currentColor" strokeWidth="1.1" />
            </svg>
            {loadedCount > 0 ? <b>{loadedCount}</b> : null}
          </button>
          {extensionsOpen ? <ExtensionsMenu /> : null}
        </span>

        <span className="jz-top__win">
          <button className="jz-win" title="Minimise" onClick={() => void window.juzt.window.minimize()}>
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M1 5h8" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </button>
          <button className="jz-win" title="Maximise" onClick={() => void window.juzt.window.toggleMaximize()}>
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
          <button className="jz-win jz-win--close" title="Close" onClick={() => void window.juzt.window.close()}>
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          </button>
        </span>
      </div>
    </header>
  );
};

/* ------------------------------------------------------------------ *
 * Tab shelf — compact, above the card, collapsed unless it is needed
 * ------------------------------------------------------------------ */

const TabShelf: React.FC = () => {
  const tabs = useSel(sel.tabTitles, (a, b) => JSON.stringify(a) === JSON.stringify(b));
  const activeId = useSel((s) => s.activeTabId);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [menuOpen]);

  return (
    <nav className="jz-shelf">
      <div className="jz-shelf__scroll">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`jz-tab ${tab.id === activeId ? 'is-active' : ''} ${tab.kind === 'whiteboard' ? 'is-board' : ''}`}
            onClick={() => void actions.activateTab(tab.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              store.set({ contextMenu: { kind: 'tab', x: e.clientX, y: e.clientY, tabId: tab.id } });
            }}
            title={tab.label}
          >
            <span className="jz-tab__icon">
              {tab.kind === 'whiteboard' ? (
                <Icon.board size={15} />
              ) : tab.favicon ? (
                <img src={tab.favicon} alt="" width={15} height={15} />
              ) : (
                <Icon.globe size={15} />
              )}
            </span>
            <span className="jz-tab__label">{tab.label}</span>
            {tabs.length > 1 ? (
              <span
                className="jz-tab__x"
                title="Close tab (Ctrl+W)"
                onClick={(e) => {
                  e.stopPropagation();
                  void actions.closeTab(tab.id);
                }}
              >
                <svg width="9" height="9" viewBox="0 0 10 10">
                  <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="jz-shelf__actions" ref={menuRef}>
        <button className="jz-shelf__action" title="New web tab (Ctrl+T)" onClick={() => void actions.newTab()}>
          <Icon.plus size={16} />
        </button>
        <button className="jz-shelf__action" title="New whiteboard (Ctrl+Shift+N)" onClick={() => void actions.newWhiteboardTab()}>
          <Icon.board size={16} />
        </button>
        <button
          className="jz-shelf__action"
          title="All tabs"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <Icon.chevronDown size={16} />
        </button>

        {menuOpen ? (
          <div className="jz-menu jz-menu--tabs">
            {tabs.map((tab, index) => (
              <button
                key={tab.id}
                className={tab.id === activeId ? 'is-active' : ''}
                onClick={() => {
                  void actions.activateTab(tab.id);
                  setMenuOpen(false);
                }}
              >
                <span className="jz-menu__index">{index + 1 > 9 ? '' : index + 1}</span>
                <span className="jz-menu__label">{tab.label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </nav>
  );
};

/* ------------------------------------------------------------------ *
 * Workspace + the one content card
 * ------------------------------------------------------------------ */

const Workspace: React.FC<{ card: Rect; pane: Rect | null; single: boolean; insetVars: React.CSSProperties }> = ({ card, pane, single, insetVars }) => {
  const tab = useSel(sel.activeTab);
  const live = useSel((s) => s.live);
  const boardDoc = useSel(sel.activeBoard);
  const settings = useSel((s) => s.settings);

  const workspace = resolveWorkspace({
    mode: settings.presentationMode,
    active: tab,
    privacy: !!live?.flags.privacy,
    frozen: !!live?.flags.frozen,
    presentation: live?.presentation.kind ?? 'holding',
  });

  const radius = Math.max(0, settings.card.radius);
  const border = cardBorderCss(settings.card.border);
  const shadow = cardShadowCss(settings.card.shadow);

  // A website tab renders nothing in the DOM: its native WebContentsView is
  // placed by main at exactly this rect. The DOM only draws the frame.
  return (
    <main className="jz-workspace" style={insetVars}>
      <div
        className={`jz-card is-${workspace.kind} ${workspace.overlay !== 'none' ? 'is-covered' : ''}`}
        style={{
          left: card.x,
          top: card.y,
          width: card.width,
          height: card.height,
          borderRadius: radius,
          boxShadow: shadow,
          border: border.width > 0 ? `${border.width}px solid ${border.color}` : undefined,
        }}
      >
        {workspace.kind === 'whiteboard' && boardDoc ? <WhiteboardEditor doc={boardDoc} /> : null}
        {workspace.kind === 'whiteboard' && !boardDoc ? <div className="jz-card__empty">Opening the whiteboard…</div> : null}
        {workspace.kind === 'newtab' && tab && tab.kind === 'web' && tab.url.startsWith('juzt://') ? <InternalPage url={tab.url} /> : null}
        {workspace.kind === 'newtab' && !tab ? <NewTabFallback /> : null}
      </div>

      {single && pane ? <PrepPane pane={pane} activeTab={tab} board={boardDoc} /> : null}
    </main>
  );
};

/** Shown only before main has handed us a tab list at all. */
const NewTabFallback: React.FC = () => {
  const appName = useSel((s) => s.appName);
  return (
    <div className="jz-start">
      <Logo size={54} />
      <h1>{appName}</h1>
      <form
        className="jz-start__field"
        onSubmit={(e) => {
          e.preventDefault();
          const value = (e.currentTarget.elements.namedItem('q') as HTMLInputElement | null)?.value ?? '';
          if (value.trim()) void actions.navigateActive(value.trim());
        }}
      >
        <Icon.search size={17} />
        <input name="q" placeholder="Search or enter address" autoFocus spellCheck={false} />
      </form>
    </div>
  );
};

/** Private pane (single monitor): a quiet side surface, off by default. */
const PrepPane: React.FC<{ pane: Rect; activeTab: TabState | null; board: import('../shared/types').WhiteboardDoc | null }> = ({ pane, activeTab, board }) => {
  const name = activeTab ? tabLabel(activeTab) : 'Private pane';
  return (
    <aside className="jz-pane" style={{ left: pane.x, top: pane.y, width: pane.width, height: pane.height }}>
      <header className="jz-pane__head">
        <span>{activeTab && activeTab.kind === 'whiteboard' ? 'Editing' : 'Private'}</span>
        <strong>{name}</strong>
      </header>
      <div className="jz-pane__body">
        {board ? <WhiteboardEditor doc={board} /> : <p className="jz-pane__hint">This pane is private — the audience never sees it.</p>}
      </div>
    </aside>
  );
};

export default App;
export { App, TOP_BAR, TAB_SHELF, TOOLBAR, workspaceInsets };
