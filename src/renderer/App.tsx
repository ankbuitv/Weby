import React from 'react';
import { computeGeometry, PREP_CHROME, cardBorderCss, cardShadowCss } from '../shared/layout';
import type { LivePayload, Rect, Settings, TabState } from '../shared/types';
import { tabLabel } from '../shared/types';
import { BackgroundLayer, HoldingScreen, PrivacyScreen } from './live/effects';
import { OutsideCardClip, clipStyle } from './live/mask';
import { WhiteboardCanvas } from './whiteboard/render';
import { WhiteboardEditor } from './whiteboard/WhiteboardEditor';
import { Icon } from './components/Icons';
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
 * PREP shell (`Juzt Prep`).
 *
 *   Dual   — this window is the teacher's private workspace: the active tab's
 *            native view fills the card, the audience output lives in `Juzt Live`.
 *   Single — this window *is* the audience output: the card renders the audience
 *            composition, and the private pane holds the whiteboard editor and
 *            private browsing.
 *
 * The renderer never positions native views: main owns geometry and tells the
 * card rect back through `EV.GEOM`; here we only draw the frame around it.
 */

const App: React.FC = () => {
  const ready = useSel((s) => s.ready);
  const settings = useSel((s) => s.settings);
  const [viewport, setViewport] = React.useState({ w: window.innerWidth, h: window.innerHeight });
  const [cardRect, setCardRect] = React.useState<Rect | null>(null);

  useShortcuts(ready);

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
    const off = window.juzt.on.geom((geom) => setCardRect(geom.card));
    return () => {
      window.removeEventListener('resize', onResize);
      if (pending) cancelAnimationFrame(pending);
      off();
    };
  }, []);

  const single = settings.presentationMode === 'single';
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
      }),
    [single, viewport, settings],
  );
  const card = cardRect ?? (single ? geometry.live : geometry.prepCard);

  return (
    <div className={`jz-app ${single ? 'is-single' : ''} ${useSel((s) => s.cleanMode) ? 'is-clean' : ''}`}>
      <TitleBar />
      <TabStrip />
      <Workspace card={card} pane={geometry.pane} single={single} />
      <Toolbar />
      <StatusHints />
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
 * Title bar
 * ------------------------------------------------------------------ */

const TitleBar: React.FC = () => {
  const appName = useSel((s) => s.appName);
  const version = useSel((s) => s.version);
  const status = useSel(sel.status);
  const presenting = useSel((s) => !!s.live && s.live.presentation.kind !== 'holding');
  const progress = useSel((s) => s.presentProgress);
  const presentingLabel = useSel((s) => s.live?.presentation.label ?? '');
  const settings = useSel((s) => s.settings);

  return (
    <header className="jz-titlebar" onDoubleClick={() => void window.juzt.window.toggleMaximize()}>
      <div className="jz-titlebar__brand">
        <Logo size={22} />
        <strong>{appName}</strong>
        <span className="jz-titlebar__version">v{version}</span>
      </div>

      <div className="jz-titlebar__center">
        <span className={`jz-status jz-status--${status}`}>
          {status === 'privacy' ? '◉ PRIVACY' : status === 'frozen' ? '❄ FROZEN' : status === 'live' ? '● LIVE' : '○ HOLDING'}
        </span>
        {presenting && presentingLabel ? <span className="jz-titlebar__label">{presentingLabel}</span> : null}
        {progress ? <span className={`jz-progress jz-progress--${progress.stage}`}>{progress.message ?? 'Preparing the audience view…'}</span> : null}
      </div>

      <div className="jz-titlebar__actions">
        {progress?.stage === 'error' ? (
          <button className="jz-chip jz-chip--warn" onClick={() => void actions.retryPresent()}>
            Retry
          </button>
        ) : null}
        {presenting ? (
          <button className="jz-chip jz-chip--danger" title="Stop presenting (Esc)" onClick={() => void actions.stopPresenting()}>
            Stop
          </button>
        ) : (
          <button className="jz-chip jz-chip--primary" title="Present this tab (Ctrl+Enter)" onClick={() => void actions.presentActive()}>
            <Icon.broadcast size={16} /> Present
          </button>
        )}
        <button
          className="jz-chip"
          title={settings.presentationMode === 'single' ? 'Switch to dual monitor mode' : 'Switch to single window mode'}
          onClick={() => void actions.setSettings({ presentationMode: settings.presentationMode === 'single' ? 'dual' : 'single' })}
        >
          <Icon.monitor size={16} />
          {settings.presentationMode === 'single' ? 'Single' : 'Dual'}
        </button>
        <button className="jz-win" title="Minimise" onClick={() => void window.juzt.window.minimize()}>
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 5h8" stroke="currentColor" strokeWidth="1.4" /></svg>
        </button>
        <button className="jz-win" title="Maximise" onClick={() => void window.juzt.window.toggleMaximize()}>
          <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
        <button className="jz-win jz-win--close" title="Close" onClick={() => void window.juzt.window.close()}>
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.3" /></svg>
        </button>
      </div>
    </header>
  );
};

/* ------------------------------------------------------------------ *
 * Tab strip
 * ------------------------------------------------------------------ */

const TabStrip: React.FC = () => {
  const tabs = useSel(sel.tabTitles, (a, b) => JSON.stringify(a) === JSON.stringify(b));
  const activeId = useSel((s) => s.activeTabId);
  const presented = useSel((s) => s.live?.presentation.label ?? null);
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);
  const stripRef = React.useRef<HTMLDivElement>(null);
  const [overflowOpen, setOverflowOpen] = React.useState(false);

  return (
    <nav className="jz-tabstrip" ref={stripRef}>
      <div className="jz-tabstrip__scroll">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            className={`jz-tab ${tab.id === activeId ? 'is-active' : ''} ${tab.pinned ? 'is-pinned' : ''} ${tab.kind === 'whiteboard' ? 'is-board' : ''}`}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragIndex !== null && dragIndex !== index) void actions.reorderTabs(dragIndex, index);
              setDragIndex(null);
            }}
            onClick={() => void actions.activateTab(tab.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              store.set({ contextMenu: { kind: 'tab', x: e.clientX, y: e.clientY, tabId: tab.id } });
            }}
            title={tab.label}
          >
            <span className="jz-tab__icon">
              {tab.kind === 'whiteboard' ? (
                <Icon.board size={18} />
              ) : tab.favicon ? (
                <img src={tab.favicon} alt="" width={18} height={18} />
              ) : (
                <Icon.globe size={18} />
              )}
            </span>
            <span className="jz-tab__label">{tab.pinned ? '' : tab.label}</span>
            {presented && presented === tab.label && tab.kind !== 'whiteboard' ? <span className="jz-tab__presenting" title="Presented" /> : null}
            {tab.pinned ? null : (
              <span
                className="jz-tab__x"
                title="Close tab (Ctrl+W)"
                onClick={(e) => {
                  e.stopPropagation();
                  void actions.closeTab(tab.id);
                }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.3" /></svg>
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="jz-tabstrip__actions">
        <button className="jz-tabstrip__action" title="New tab (Ctrl+T)" onClick={() => void actions.newTab()}>
          <Icon.plus size={18} />
        </button>
        <button className="jz-tabstrip__action" title="New whiteboard (Ctrl+Shift+N)" onClick={() => void actions.newWhiteboardTab()}>
          <Icon.board size={18} />
        </button>
        <button
          className="jz-tabstrip__action"
          title="All tabs"
          onClick={() => setOverflowOpen((v) => !v)}
          aria-expanded={overflowOpen}
        >
          <Icon.chevronDown size={18} />
        </button>
      </div>

      {overflowOpen ? (
        <div className="jz-menu jz-menu--tabs">
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              className={tab.id === activeId ? 'is-active' : ''}
              onClick={() => {
                void actions.activateTab(tab.id);
                setOverflowOpen(false);
              }}
            >
              <span className="jz-menu__index">{index + 1 > 9 ? '' : index + 1}</span>
              <span className="jz-menu__label">{tab.label}</span>
              {tab.favicon ? <img src={tab.favicon} alt="" width={16} height={16} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </nav>
  );
};

/* ------------------------------------------------------------------ *
 * Workspace + card
 * ------------------------------------------------------------------ */

const Workspace: React.FC<{ card: Rect; pane: Rect | null; single: boolean }> = ({ card, pane, single }) => {
  const tab = useSel(sel.activeTab);
  const live = useSel((s) => s.live);
  const boardDoc = useSel(sel.activeBoard);
  const presentingBoard = useSel((s) => s.live?.presentation.boardId ?? null);
  const boardShown = useSel((s) => s.live?.presentation.kind === 'whiteboard');
  const clean = useSel((s) => s.cleanMode);
  const settings = useSel((s) => s.settings);
  const [size, setSize] = React.useState({ w: window.innerWidth, h: window.innerHeight });

  React.useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const radius = Math.max(0, settings.card.radius);
  const border = cardBorderCss(settings.card.border);
  const shadow = cardShadowCss(settings.card.shadow);
  const internal = tab && tab.kind === 'web' && tab.url.startsWith('juzt://') ? tab.url : null;
  const boardForCard = single && boardShown ? boardDoc : null;

  return (
    <main className="jz-workspace" style={{ paddingTop: PREP_CHROME.top - 8 }}>
      <div
        className="jz-card"
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
        {/* The native website view (if any) sits exactly here, above this DOM. */}
        {tab && tab.kind === 'whiteboard' && !single ? <WhiteboardEditor doc={boardDoc ?? emptyBoard(tab)} /> : null}
        {tab && tab.kind === 'whiteboard' && single && boardShown && !boardDoc ? <div className="jz-card__empty">Loading board…</div> : null}
        {internal ? <InternalPage url={internal} /> : null}
        {single ? <SingleAudience live={live} card={{ x: 0, y: 0, width: card.width, height: card.height }} size={{ w: card.width, h: card.height }} /> : null}
        {!tab ? <div className="jz-card__empty">Open a tab to get started</div> : null}
      </div>

      {single && pane ? <PrepPane pane={pane} activeTab={tab} board={boardForCard} /> : null}
      {!clean ? null : null}
    </main>
  );
};

/** Single mode: the DOM copy of the audience composition (visible when no native view covers it). */
const SingleAudience: React.FC<{ live: LivePayload | null; card: Rect; size: { w: number; h: number } }> = ({ live, card, size }) => {
  if (!live) return null;
  const presenting = live.presentation.kind !== 'holding';
  const showingBoard = live.presentation.kind === 'whiteboard';
  const boardDoc = useSel((s) => (showingBoard && live.presentation.boardId ? s.boardDocs[live.presentation.boardId] : undefined));
  const radius = Math.max(0, live.surface.card.radius);
  const outsideId = 'jz-prep-outside';

  return (
    <div className="jz-audience">
      <div className="jz-audience__bg" style={clipStyle(outsideId)}>
        <OutsideCardClip id={outsideId} local={{ w: size.w, h: size.h }} card={{ x: 0, y: 0, width: size.w, height: size.h }} radius={0} />
      </div>
      {showingBoard && boardDoc ? (
        <div className="jz-audience__board" style={{ borderRadius: radius }}>
          <WhiteboardCanvas doc={boardDoc} size={{ w: size.w, h: size.h }} />
        </div>
      ) : null}
      {live.flags.privacy ? <PrivacyScreen live={live} size={{ w: size.w, h: size.h }} /> : null}
      {!presenting ? <HoldingScreen live={live} size={{ w: size.w, h: size.h }} /> : null}
      <span className="jz-audience__hint">{presenting ? 'Audience output' : 'Holding screen — press Ctrl+Enter to present'}</span>
    </div>
  );
};

/** Private pane (single mode): whiteboard editor, private browsing hint, notes. */
const PrepPane: React.FC<{ pane: Rect; activeTab: TabState | null; board: import('../shared/types').WhiteboardDoc | null }> = ({ pane, activeTab, board }) => {
  const name = activeTab ? tabLabel(activeTab) : 'Private pane';
  return (
    <aside className="jz-pane" style={{ left: pane.x, top: pane.y, width: pane.width, height: pane.height }}>
      <header className="jz-pane__head">
        <span>{activeTab && activeTab.kind === 'whiteboard' ? 'Editing' : 'Private'}</span>
        <strong>{name}</strong>
      </header>
      <div className="jz-pane__body">
        {board ? <WhiteboardEditor doc={board} /> : <p className="jz-pane__hint">This pane is private — the audience never sees it. Open a whiteboard tab (Ctrl+Shift+N) to edit here.</p>}
      </div>
    </aside>
  );
};

/* ------------------------------------------------------------------ *
 * Status hints (only while relevant — never permanent help text)
 * ------------------------------------------------------------------ */

const StatusHints: React.FC = () => {
  const tool = useSel((s) => s.tool);
  const clean = useSel((s) => s.cleanMode);
  const cameraDrag = useSel((s) => s.cameraDrag);
  const privacy = useSel((s) => s.live?.flags.privacy ?? false);
  const frozen = useSel((s) => s.live?.flags.frozen ?? false);
  const single = useSel((s) => s.settings.presentationMode === 'single');
  if (clean) {
    return (
      <button className="jz-clean-exit" onClick={() => actions.toggleClean()} title="Exit clean mode (Ctrl+Shift+H)">
        Clean mode · Ctrl+Shift+H to exit
      </button>
    );
  }
  if (cameraDrag) {
    return (
      <div className="jz-hints">
        <span className="jz-hint">Move the camera · Esc hands the mouse back to the page</span>
        <button className="jz-hint jz-hint--action" onClick={() => actions.setCameraDrag(false)}>
          Done
        </button>
      </div>
    );
  }
  if (tool === 'cursor' && !privacy && !frozen) return null;
  return (
    <div className="jz-hints">
      {tool !== 'cursor' ? <span className="jz-hint">Tool: {tool} · Esc returns to the cursor</span> : null}
      {privacy ? <span className="jz-hint jz-hint--danger">Privacy screen is up — press F8 to reveal</span> : null}
      {frozen ? <span className="jz-hint">Frozen — press F9 to resume</span> : null}
      {single ? <span className="jz-hint">Single window mode</span> : null}
    </div>
  );
};

function emptyBoard(tab: TabState) {
  const name = tab.kind === 'whiteboard' ? tab.name : 'Whiteboard';
  const id = tab.kind === 'whiteboard' ? tab.boardId : 'board_pending';
  return {
    schemaVersion: 1,
    id,
    name,
    theme: 'dark' as const,
    objects: [],
    view: { x: -600, y: -400, zoom: 1 },
    updatedAt: Date.now(),
    rev: 0,
  };
}

export default App;
export { App, cardShadowCss, BackgroundLayer, cardBorderCss, computeGeometry, type Settings };
