import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  screen,
  session,
  shell,
  type BaseWindow,
  type IpcMainInvokeEvent,
  type Session,
  type WebContents,
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { CH, EV } from '../shared/ipc';
import { computeGeometry, isCardRadius, SIZE_PRESETS, shelfVisible as shelfOn } from '../shared/layout';
import { resolveAudience, resolveWorkspace, overlayNeeded } from '../shared/workspace';
import type {
  BackgroundSpec,
  CameraConfig,
  DisplayInfo,
  Favorite,
  HistoryEntry,
  LivePayload,
  PermissionRequest,
  PrepBootstrap,
  PrepUiState,
  PrivacyMask,
  Rect,
  Scene,
  ScreenSource,
  Settings,
  SpotlightState,
  TabState,
  WbOp,
  WhiteboardDoc,
  WhiteboardMeta,
} from '../shared/types';
import { APP_NAME, DEFAULT_CAMERA_CONFIG, DEFAULT_CARD, DEFAULT_SETTINGS, SCHEMA_VERSION, isBoardTab, tabLabel } from '../shared/types';
import { buildWebUserAgent, clientHints, unsupportedFeatures, type UserAgentMode } from '../shared/engine';
import { ExtensionManager } from './extensions';
import type { ExtensionRecord } from '../shared/types';
import { INTERNAL_PAGES, isInternalPage, resolveInput, sameResource } from '../shared/url';
import { BoardStore } from './boards';
import { countBounds, registerDiagnosticsIpc, setDiagnostics, snapshot, webContentsCount } from './diagnostics';
import { asArray, asBool, asNumber, asOptionalString, asString, asView, registerLive, registerPrep, registerPrepOnly, roleFor, setSenderRegistry } from './ipcutil';
import { LiveStage, defaultLiveState, type ProgressStage } from './live';
import { grantMedia, mediaKind, mediaUrl, registerMediaProtocol } from './media';
import { loadState, setState, flushAllSync } from './persistence';
import { PermissionBroker } from './permissions';
import { devServerUrl, isDev, userDataDir } from './paths';
import { TabManager } from './tabs';
import { JuztWindows } from './windows';

/**
 * Juzt application core.
 *
 * Responsibilities, in order of importance:
 *   1. Keep the audience-safe state (`LiveStage`) authoritative — PREP and LIVE
 *      both render from it, so switching PREP tabs can never change LIVE.
 *   2. Route native views (`windows.applyPlacements`) — the only place bounds
 *      are set, and only when a rectangle really changed.
 *   3. Validate every IPC call (role + payload) before it touches anything.
 *
 * Performance notes: no polling loops, no `capturePage` loops (freeze is a
 * single shot, PREP preview is ≤2.5 fps and only while enabled), and inbound
 * high-frequency streams (ink/laser) are coalesced before they reach a renderer.
 */

const SESSION_PARTITION = 'persist:juzt';
const FOCUS_RESTORE_MAX_MS = 1500;

interface PersistedSession {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

export class JuztApp {
  settings: Settings = { ...DEFAULT_SETTINGS, camera: { ...DEFAULT_CAMERA_CONFIG } };
  scenes: Scene[] = [];
  activeSceneId?: string;
  favorites: Favorite[] = [];
  history: HistoryEntry[] = [];

  readonly windows = new JuztWindows();
  readonly boards = new BoardStore({
    onOps: (boardId, ops, rev, hint) => {
      const payload = { boardId, ops, rev, hint };
      this.sendPrep(EV.BOARD_OPS, payload);
      if (this.windows.hasLiveWindow()) this.sendLive(EV.BOARD_OPS, payload);
    },
    onDoc: (doc) => {
      this.sendPrep(EV.BOARD_DOC, doc);
      if (this.windows.hasLiveWindow()) this.sendLive(EV.BOARD_DOC, doc);
    },
    onList: (list) => this.sendPrep(EV.BOARD_LIST, list),
  });

  private tabs!: TabManager;
  private live!: LiveStage;
  private permissions!: PermissionBroker;
  private appSession: Session | null = null;
  private extensions: ExtensionManager | null = null;
  private ui: PrepUiState = { tool: 'cursor', inkLayer: false, cover: false, number: 1 };
  private sceneCounter = 0;
  private focusRestoreAt = 0;
  private lastPresentedBoardId: string | null = null;

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */

  async start(): Promise<void> {
    app.setName(APP_NAME);
    registerMediaProtocol();
    this.appSession = this.createSession();

    this.loadPersisted();
    this.boards.load();
    this.tabs = new TabManager(this.appSession, {
      onChanged: (changed, structure) => this.onTabsChanged(changed, structure),
      onVisited: (entry) => this.recordVisit(entry.url, entry.title),
      onViewsChanged: () => this.routeViews(),
      onToast: (message, tone) => this.toast(message, tone),
      onBoardNeeded: (boardId, name) => this.boards.ensure(boardId, name),
    });
    this.permissions = new PermissionBroker({
      sendRequest: (request) => this.sendPrep(EV.PERM_REQUEST, request),
      sendSources: (sources, requestId) => this.sendPrep(EV.PERM_SOURCES, { sources, requestId }),
      toast: (message, tone) => this.toast(message, tone),
    });
    this.permissions.attach(this.appSession);

    // Extensions share the website session so their storage and content
    // scripts work. Juzt's own pages and preload live in the default session,
    // so extension code can never reach the privileged IPC bridge.
    this.extensions = new ExtensionManager(SESSION_PARTITION);
    await this.extensions.restore(this.settings.extensions, {
      // Safe Mode keeps the *configuration* but loads nothing.
      extensionsEnabled: !this.settings.safeMode,
    });
    this.settings.extensions = this.extensions.persist();

    this.live = new LiveStage({
      surfaceWebContents: () => this.audienceWebContents(),
      onChange: () => this.broadcastLive(),
      onProgress: (stage, message) => this.sendPrep(EV.PRESENT_PROGRESS, { stage, message }),
      isSingleMode: () => this.settings.presentationMode === 'single',
      navigateStage: (url) => this.navigateStage(url),
      stageOnUrl: (url) => this.stageOnUrl(url),
      muteAudience: (muted) => this.muteAudience(muted),
      captureSnapshot: () => this.captureAudience(),
      onFrozenFrame: (dataUrl) => this.sendFrame('freeze', dataUrl),
      onProtectionFrame: (dataUrl) => this.sendFrame('protection', dataUrl),
    });
    this.live.state = { ...this.live.state, ...this.visualStateFromSettings(), version: app.getVersion(), singleMode: this.settings.presentationMode === 'single' };

    setSenderRegistry({ roleOf: (wc) => this.roleOf(wc) });
    this.createWindows();
    this.registerIpc();
    registerDiagnosticsIpc();
    this.tabs.restore(loadState('tabs', { tabs: [], activeId: null, closed: [] }));
    this.tabs.startSweeper(() => this.presentedTabId());
    setDiagnostics(loadState('diagnostics', false));
    this.wireAppEvents();
  }

  private createWindows(): void {
    const session = this.appSession;
    if (!session) return;
    const restore = loadState<PersistedSession>('window', { width: 1440, height: 900 });
    this.windows.createPrep(restore);
    const prep = this.windows.prepWindow();
    if (prep) {
      prep.on('resize', () => this.onPrepResized());
      prep.on('move', () => this.saveWindowBounds());
      prep.on('focus', () => this.onFocusRestored());
      prep.on('closed', () => {
        this.permissions.cancelAll();
      });
    }

    if (this.settings.presentationMode === 'dual' || this.settings.outputDisplayId !== undefined) {
      this.openLiveWindow();
    }

    // First run: session restore may hold private tabs; keep them.
    void this.sendBootstrapWhenReady();
  }

  /**
   * Start Presentation — the only way the dual (Juzt Live + Juzt Prep) layout
   * comes into existence. Single window stays the default and never spawns a
   * second surface, so the two compositions can never be stacked by accident.
   */
  async startPresentation(): Promise<LivePayload> {
    if (this.settings.presentationMode !== 'dual') {
      await this.setSettings({ presentationMode: 'dual' });
    } else {
      this.openLiveWindow();
    }
    this.windows.liveWindow()?.focus();
    await this.presentActive();
    return this.toPayload();
  }

  private async sendBootstrapWhenReady(): Promise<void> {
    const prep = this.windows.prepWindow();
    if (!prep) return;
    const send = () => {
      const payload: PrepBootstrap = {
        appName: APP_NAME,
        version: app.getVersion(),
        dev: isDev(),
        settings: this.settings,
        scenes: this.scenes,
        activeSceneId: this.activeSceneId,
        tabs: this.tabs.tabs,
        activeTabId: this.tabs.list.activeId,
        boards: this.boards.list(),
        favorites: this.favorites,
        history: this.history,
        displays: this.displays(),
        live: this.toPayload(),
        ui: this.ui,
        diagnosticsEnabled: loadState('diagnostics', false),
      };
      this.sendPrep(EV.STATE, payload);
    };
    if (this.windows.isReady('prep')) send();
    prep.webContents.once('did-finish-load', () => {
      this.sendPrep(EV.STATE, {
        appName: APP_NAME,
        version: app.getVersion(),
        dev: isDev(),
        settings: this.settings,
        scenes: this.scenes,
        activeSceneId: this.activeSceneId,
        tabs: this.tabs.tabs,
        activeTabId: this.tabs.list.activeId,
        boards: this.boards.list(),
        favorites: this.favorites,
        history: this.history,
        displays: this.displays(),
        live: this.toPayload(),
        ui: this.ui,
        diagnosticsEnabled: loadState('diagnostics', false),
      } satisfies PrepBootstrap);
    });
  }

  private createSession(): Session {
    const s = session.fromPartition(SESSION_PARTITION);
    // Identify honestly: the *real* Chromium build with no application token.
    // Compatibility comes from Chromium 152 being current, not from pretending.
    this.applyWebIdentity(s);
    s.setPermissionCheckHandler(() => false);
    s.setSpellCheckerEnabled(false);
    s.on('will-download', (event, item) => {
      const target = path.join(app.getPath('downloads'), item.getFilename());
      item.setSavePath(target);
      item.once('done', (_e, state) => {
        if (state === 'completed') this.toast(`Downloaded ${path.basename(target)}`);
        else this.toast('Download failed', 'error');
      });
      void event;
    });
    return s;
  }

  /**
   * Website identity: an engine-accurate, Chrome-compatible User-Agent plus
   * matching `Sec-CH-UA` client hints.
   *
   * Both are rewritten in the network stack (`webRequest`), never by injecting
   * JavaScript into pages: no monkey-patching of `navigator`, no fragile global
   * shims, and no way for the two values to contradict each other. The
   * advertised Chrome/Chromium version is always the version actually bundled.
   */
  private applyWebIdentity(s: Session, origin?: string): void {
    const versions = process.versions;
    const mode: UserAgentMode = (origin ? this.settings.siteCompat[origin] : undefined) ?? this.settings.webUserAgent;
    const ua = buildWebUserAgent({
      chromium: versions.chrome,
      electron: versions.electron,
      app: APP_NAME,
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      mode,
    });
    s.setUserAgent(ua, `https://${origin ?? 'example.invalid'}/`);

    const hints = clientHints(versions.chrome, process.platform, mode);
    const filter = origin ? { urls: [`https://${origin}/*`, `http://${origin}/*`] } : { urls: ['https://*/*', 'http://*/*'] };
    s.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
      const headers: Record<string, string> = { ...details.requestHeaders };
      for (const [key, value] of Object.entries(hints)) headers[key] = value;
      // Never leak a stale application token from the default headers.
      delete headers['User-Agent'];
      headers['User-Agent'] = ua;
      callback({ requestHeaders: headers });
    });
  }

  /** Re-apply the identity globally and for every origin that has an override. */
  private refreshWebIdentity(): void {
    if (!this.appSession) return;
    this.applyWebIdentity(this.appSession);
    for (const origin of Object.keys(this.settings.siteCompat)) this.applyWebIdentity(this.appSession, origin);
  }

  /**
   * Private, PREP-only engine report. Never sent to LIVE: it goes through
   * `sendPrep` only, and LIVE has no handler for `compat:info`.
   */
  private compatibilityInfo(): {
    app: string;
    electron: string;
    chromium: string;
    v8: string;
    node: string;
    userAgent: string;
    loadedExtensions: number;
    approvedExtensions: number;
    safeMode: boolean;
    unsupported: ReturnType<typeof unsupportedFeatures>;
  } {
    const v = process.versions;
    return {
      app: APP_NAME,
      electron: v.electron,
      chromium: v.chrome,
      v8: v.v8,
      node: v.node,
      userAgent: this.appSession?.getUserAgent() ?? '',
      loadedExtensions: this.extensions?.loaded().length ?? 0,
      approvedExtensions: this.extensions?.list().length ?? 0,
      safeMode: this.settings.safeMode,
      unsupported: unsupportedFeatures(v.chrome),
    };
  }

  /* ------------------------------------------------------------------ *
   * Session / state persistence
   * ------------------------------------------------------------------ */

  private loadPersisted(): void {
    const raw = loadState<Partial<Settings>>('settings', {});
    this.settings = sanitizeSettings(raw);
    this.scenes = loadState<Scene[]>('scenes', []);
    this.activeSceneId = loadState<string | undefined>('activeScene', undefined);
    this.favorites = loadState<Favorite[]>('favorites', []);
    this.history = loadState<HistoryEntry[]>('history', []);
    this.sceneCounter = this.scenes.length;
  }

  saveSession(): void {
    setState('settings', this.settings);
    setState('scenes', this.scenes);
    setState('favorites', this.favorites);
    setState('history', this.history.slice(0, 300));
    setState('tabs', this.tabs?.list ?? { tabs: [], activeId: null, closed: [] });
    this.saveWindowBounds();
    flushAllSync();
  }

  private saveWindowBounds(): void {
    const win = this.windows.prepWindow();
    if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    setState<PersistedSession>('window', { width: b.width, height: b.height, x: b.x, y: b.y });
  }

  dispose(): void {
    this.live?.dispose();
    this.tabs?.dispose();
    this.permissions?.cancelAll();
  }

  /* ------------------------------------------------------------------ *
   * Roles / senders
   * ------------------------------------------------------------------ */

  private roleOf(wc: WebContents): 'prep' | 'live' | 'overlay' | null {
    if (this.windows.prepWindow()?.webContents === wc) return 'prep';
    if (this.windows.surface()?.webContents === wc) return 'live';
    if (this.windows.overlay()?.webContents === wc) return 'overlay';
    // Tab views have no IPC access at all (no preload), but be explicit.
    return null;
  }

  private sendPrep(channel: string, payload?: unknown): void {
    const wc = this.windows.prepWindow()?.webContents;
    if (wc && !wc.isDestroyed()) wc.send(channel, payload);
  }

  private sendLive(channel: string, payload?: unknown): void {
    const wc = this.windows.surface()?.webContents;
    if (wc && !wc.isDestroyed()) wc.send(channel, payload);
    const prep = this.windows.prepWindow()?.webContents;
    if (prep && !prep.isDestroyed() && this.settings.presentationMode === 'single') prep.send(channel, payload);
  }

  private sendOverlay(channel: string, payload?: unknown): void {
    const wc = this.windows.overlay()?.webContents;
    if (wc && !wc.isDestroyed()) wc.send(channel, payload);
  }

  private sendFrame(kind: 'freeze' | 'protection', dataUrl: string | null): void {
    const payload = { kind, dataUrl };
    this.sendLive(EV.FRAME, payload);
    this.sendOverlay(EV.FRAME, payload);
  }

  private toast(message: string, tone: 'info' | 'error' = 'info'): void {
    this.sendPrep(EV.TOAST, { id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, message, tone, at: Date.now() });
  }

  /* ------------------------------------------------------------------ *
   * Audience-safe payload + broadcast
   * ------------------------------------------------------------------ */

  toPayload(): LivePayload {
    const s = this.live.state;
    return {
      revision: s.revision,
      mode: this.settings.presentationMode,
      appName: APP_NAME,
      version: app.getVersion(),
      presentation:
        s.presentation.kind === 'holding'
          ? { kind: 'holding', label: s.holdingText || 'Ready when you are' }
          : s.presentation.kind === 'board'
            ? { kind: 'whiteboard', label: s.presentation.label, boardId: s.presentation.boardId ?? null }
            : { kind: 'web', label: s.presentation.label },
      flags: {
        privacy: s.flags.privacy,
        frozen: s.flags.frozen,
        protecting: s.flags.protecting,
        spotlight: s.spotlight.on,
        clean: s.cleanMode,
      },
      surface: {
        liveBackground: s.liveBackground,
        holdingBackground: s.holdingBackground,
        privacyBackground: s.privacyBackground,
        holdingText: s.holdingText,
        privacyTitle: s.privacyTitle,
        privacySubtitle: s.privacySubtitle,
        card: s.card,
        layout: s.layout,
        sizePreset: s.sizePreset,
      },
      camera: s.camera,
      spotlight: s.spotlight,
      masks: s.masks,
      zoom: s.zoom,
    };
  }

  private broadcastLive(): void {
    const payload = this.toPayload();
    this.sendPrep(EV.LIVE, payload);
    if (this.windows.hasLiveWindow()) this.sendLive(EV.LIVE, payload);
    this.routeViews();
  }

  private visualStateFromSettings(): Partial<LiveStateShape> {
    const s = this.settings;
    return {
      layout: s.layout,
      sizePreset: s.sizePreset,
      customScale: s.customScale,
      card: s.card,
      zoom: s.zoom,
      liveBackground: s.liveBackground,
      holdingBackground: s.holdingBackground,
      privacyBackground: s.privacyBackground,
      holdingText: s.holdingText,
      privacyTitle: s.privacyTitle,
      privacySubtitle: s.privacySubtitle,
      camera: s.camera,
    };
  }

  /* ------------------------------------------------------------------ *
   * Geometry + routing
   * ------------------------------------------------------------------ */

  /** True when the compact tab shelf occupies the strip above the card. */
  private shelfVisible(): boolean {
    return shelfOn(this.tabs.tabs.length, !!this.settings.tabShelfAlways);
  }

  private geometry() {
    const prepSize = this.windows.prepContentSize();
    const liveSize = this.windows.liveBounds();
    return computeGeometry({
      single: this.settings.presentationMode === 'single',
      prepSize: prepSize.width && prepSize.height ? prepSize : { width: 1440, height: 900 },
      liveSize: liveSize && liveSize.width && liveSize.height ? { width: liveSize.width, height: liveSize.height } : { width: 1920, height: 1080 },
      sizePreset: this.settings.sizePreset,
      customScale: this.settings.customScale,
      margin: this.settings.card.margin,
      layout: this.settings.layout,
      card: this.settings.card,
      paneOpen: this.settings.prepPaneOpen,
      shelfVisible: this.shelfVisible(),
    });
  }

  /**
   * Place every native view. Called on resize/mode/tab/present changes only.
   *
   * Single mode (the V2 default) is a strict one-surface contract: the active
   * tab's view is the only native content, at the one card rect the renderer
   * draws its frame around. No holding screen, no audience layer, no stacking.
   */
  routeViews(): void {
    if (!this.windows.prep) return;
    const geo = this.geometry();
    const single = this.settings.presentationMode === 'single';
    const live = this.live.state;
    const active = this.tabs.active();

    const workspace = resolveWorkspace({
      mode: this.settings.presentationMode,
      active,
      privacy: live.flags.privacy,
      frozen: live.flags.frozen,
      presentation: live.presentation.kind,
    });

    for (const { tab, view } of this.tabs.webTabs()) {
      if (!view) continue;
      let rect: Rect | null = null;
      let visible = false;
      if (single) {
        // Exactly one web surface: the active tab, and only while the workspace
        // really is a website (never over a New Tab or a whiteboard card).
        const onCard = workspace.kind === 'web' && tab.id === active?.id;
        const onPane = !!geo.pane && tab.id === active?.id && workspace.kind !== 'web';
        if (onCard && workspace.overlay !== 'privacy') {
          rect = geo.live;
          visible = true;
        } else if (onPane && geo.pane) {
          rect = { ...geo.pane, y: geo.pane.y + 34, height: Math.max(120, geo.pane.height - 34) };
          visible = true;
        }
      } else if (tab.id === active?.id) {
        rect = geo.prepCard;
        visible = true;
      }
      this.windows.register({ view, role: 'prep', rect, visible });
    }

    if (!single) {
      const stage = this.windows.stageWindowView();
      if (stage) {
        // The audience page is a *separate* instance on the shared session; it
        // is only ever the visible content of the LIVE window.
        const audience = resolveAudience({
          mode: this.settings.presentationMode,
          active,
          privacy: live.flags.privacy,
          frozen: live.flags.frozen,
          presentation: live.presentation.kind,
        });
        const presentingWeb = audience === 'web' && !this.presentedIsPrivate();
        this.windows.register({
          view: stage,
          role: 'live',
          rect: geo.live,
          visible: presentingWeb,
        });
      }
      const surface = this.windows.surface();
      const liveSize = this.windows.liveBounds();
      if (surface && liveSize) {
        this.windows.register({
          view: surface,
          role: 'live',
          rect: { x: 0, y: 0, width: liveSize.width, height: liveSize.height },
          visible: true,
          transparent: true,
        });
      }
    }

    const overlay = this.windows.ensureCardOverlay();
    const rect = single ? geo.live : geo.overlay;
    // The overlay is the only layer that can paint above the native page (ink,
    // masks, spotlight, camera, and in single mode the privacy/freeze screens).
    // Electron 31 exposes no per-view click-through (`setIgnoreMouseEvents` is a
    // window API), so the overlay is *only* mapped when it has to capture the
    // pointer or has something to draw; the rest of the time it is hidden and the
    // website keeps its normal mouse behaviour, untouched.
    const showOverlay = overlayNeeded({
      mode: this.settings.presentationMode,
      active,
      privacy: live.flags.privacy,
      frozen: live.flags.frozen,
      presentation: live.presentation.kind,
      drawing: this.ui.tool !== 'cursor',
      committedInk: !!this.ui.inkLayer,
      cameraDrag: !!this.ui.cameraDrag,
      effects: this.live.effectsVisible(),
    });
    const visible = !!rect && showOverlay;
    this.windows.register({ view: overlay, role: 'prep', rect: visible ? rect : null, visible, transparent: true });

    this.windows.applyPlacements();

    const geometryMsg = {
      single,
      windowSize: this.windows.prepContentSize(),
      card: geo.live,
      overlay: single ? geo.live : geo.overlay,
      insets: geo.insets,
      shelf: this.shelfVisible(),
    };
    this.sendOverlay(EV.GEOM, geometryMsg);
    this.sendPrep(EV.GEOM, geometryMsg);
  }

  private onTabsChanged(changed: TabState[], structure: boolean): void {
    this.sendPrep(EV.TABS, {
      order: this.tabs.tabs.map((t) => t.id),
      activeId: this.tabs.list.activeId,
      changed,
    });
    if (structure) this.routeViews();
  }

  private onPrepResized(): void {
    // Window resize storms: coalesce to one layout pass per frame-ish window.
    if (this.resizeTimer) return;
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = null;
      this.routeViews();
    }, 60);
  }

  private resizeTimer: NodeJS.Timeout | null = null;

  private onFocusRestored(): void {
    const now = Date.now();
    if (now - this.focusRestoreAt < 250) return;
    this.focusRestoreAt = now;
    // Nothing is reloaded on focus: we only make sure the native views are still
    // where they should be (a monitor change or a snap can move the window).
    this.routeViews();
    const prep = this.windows.prepWindow();
    if (prep && !prep.isDestroyed()) {
      this.sendPrep(EV.FOCUS_RESTORED, { ms: 0 });
    }
  }

  /* ------------------------------------------------------------------ *
   * LIVE window
   * ------------------------------------------------------------------ */

  openLiveWindow(): boolean {
    const existing = this.windows.liveWindow();
    if (existing) {
      this.windows.placeLiveWindow(this.outputDisplay(), true);
      return true;
    }
    const target = this.outputDisplay();
    const live = this.windows.createLive(this.appSession as Session, target);
    live.on('closed', () => this.routeViews());
    this.windows.placeLiveWindow(target, true);
    const boardId = this.live.state.presentation.boardId;
    if (boardId) {
      const doc = this.boards.get(boardId);
      if (doc) this.sendLive(EV.BOARD_DOC, doc);
    }
    this.routeViews();
    return true;
  }

  closeLiveWindow(): void {
    const live = this.windows.liveWindow();
    if (!live) return;
    this.windows.closeAllViews();
    this.windows.releaseLive();
    try {
      live.close();
    } catch {
      /* already gone */
    }
  }

  private outputDisplay(): Electron.Display | null {
    if (this.settings.outputDisplayId === undefined) return null;
    return this.displays().length ? screen.getAllDisplays().find((d) => d.id === this.settings.outputDisplayId) ?? null : null;
  }

  private audienceWebContents(): Electron.WebContents | null {
    if (this.settings.presentationMode === 'single') {
      const id = this.presentedTabId() ?? this.tabs.list.activeId;
      const view = id ? this.tabs.view(id) : null;
      return view && !view.webContents.isDestroyed() ? view.webContents : null;
    }
    const stage = this.windows.stageWindowView();
    return stage && !stage.webContents.isDestroyed() ? stage.webContents : null;
  }

  private presentedTabId(): string | null {
    if (this.live.state.presentation.kind !== 'tab') return null;
    const label = this.live.state.presentation.label;
    const tab = this.tabs.tabs.find((t) => t.kind === 'web' && tabLabel(t) === label);
    return tab?.id ?? null;
  }

  private presentedIsPrivate(): boolean {
    const id = this.presentedTabId();
    const tab = id ? this.tabs.get(id) : null;
    return !!tab && tab.kind === 'web' && !!tab.private;
  }

  private stageOnUrl(url: string): boolean {
    const stage = this.windows.stageWindowView();
    if (!stage || stage.webContents.isDestroyed()) return false;
    const current = stage.webContents.getURL();
    return !!current && sameResource(current, url);
  }

  private async navigateStage(url: string): Promise<boolean> {
    const stage = this.windows.stageWindowView();
    if (!stage || stage.webContents.isDestroyed()) return false;
    const wc = stage.webContents;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(ok);
      };
      const timer = setTimeout(() => finish(true), 8000);
      const onStop = () => {
        // Meaningful main-frame load: either finished or stopped with content.
        if (!wc.isLoading()) finish(true);
      };
      const onFail = (_e: unknown, code: number, _desc: string, _url: string, isMain?: boolean) => {
        if (isMain === false || code === -3) return;
        finish(false);
      };
      const cleanup = () => {
        clearTimeout(timer);
        wc.off('did-stop-loading', onStop);
        wc.off('did-fail-load', onFail);
      };
      wc.on('did-stop-loading', onStop);
      wc.on('did-fail-load', onFail);
      wc.loadURL(url).catch(() => finish(false));
    });
  }

  private muteAudience(muted: boolean): void {
    const wc = this.audienceWebContents();
    if (wc && !wc.isDestroyed()) wc.setAudioMuted(muted || this.settings.privacyMuteAudio);
  }

  private async captureAudience(): Promise<string | null> {
    const wc = this.audienceWebContents();
    if (!wc || wc.isDestroyed()) return null;
    try {
      const image = await wc.capturePage();
      if (image.isEmpty()) return null;
      const size = image.getSize();
      const width = Math.min(1600, size.width);
      const scaled = width < size.width ? image.resize({ width }) : image;
      return scaled.toJPEG(82).toString('base64');
    } catch {
      return null;
    }
  }

  /* ------------------------------------------------------------------ *
   * Ink / effects relay (overlay → LIVE)
   * ------------------------------------------------------------------ */

  private inkOps: unknown[] = [];
  private lastInkLive = 0;
  private lastLaser = 0;

  private applyInkOp(op: unknown): boolean {
    if (!op || typeof op !== 'object') return false;
    this.inkOps.push(op);
    if (this.inkOps.length > 2000) this.inkOps.splice(0, this.inkOps.length - 2000);
    this.sendLive(EV.INK_OP, op);
    return true;
  }

  private applyInkLive(payload: unknown): boolean {
    const now = Date.now();
    if (now - this.lastInkLive < 33) return true; // coalesce the transient stream
    this.lastInkLive = now;
    this.sendLive(EV.INK_LIVE, payload);
    return true;
  }

  private applyLaser(payload: { points: number[]; color?: string }): boolean {
    const now = Date.now();
    const empty = !payload.points?.length;
    if (!empty && now - this.lastLaser < 33) return true;
    if (empty) this.lastLaser = 0;
    else this.lastLaser = now;
    this.sendLive(EV.LASER, { points: payload.points ?? [], color: payload.color ?? '#ff3355' });
    return true;
  }

  /* ------------------------------------------------------------------ *
   * Settings
   * ------------------------------------------------------------------ */

  async setSettings(patch: Partial<Settings>, _event?: IpcMainInvokeEvent): Promise<Settings> {
    const before = this.settings;
    const next = sanitizeSettings({ ...this.settings, ...patch });
    this.settings = next;

    if (patch.presentationMode && patch.presentationMode !== before.presentationMode) {
      this.live.setSingleMode(next.presentationMode === 'single');
      if (next.presentationMode === 'dual') this.openLiveWindow();
      else this.closeLiveWindow();
    }
    if ('outputDisplayId' in patch && next.presentationMode === 'dual') {
      const display = this.outputDisplay();
      if (display) this.windows.placeLiveWindow(display, true);
      else if (this.settings.outputDisplayId === undefined) {
        /* automatic: leave the window where Windows put it */
      }
    }
    if (patch.zoom !== undefined) this.tabs.applyZoomAll(next.zoom);
    if (patch.camera) this.live.setCamera(next.camera);

    this.live.applyVisuals(this.visualStateFromSettings());
    setState('settings', next);
    this.sendPrep(EV.SETTINGS, next);
    this.broadcastLive();
    return next;
  }

  /* ------------------------------------------------------------------ *
   * Displays, scenes, history, favorites
   * ------------------------------------------------------------------ */

  private displays(): DisplayInfo[] {
    const primaryId = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((d) => ({
      id: d.id,
      label: d.label || `Display ${d.id}`,
      width: d.bounds.width,
      height: d.bounds.height,
      scaleFactor: d.scaleFactor,
      primary: d.id === primaryId,
      internal: d.internal,
    }));
  }

  private recordVisit(url: string, title: string): void {
    const entry: HistoryEntry = { id: `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`, url, title, visitedAt: Date.now() };
    const last = this.history[0];
    if (last && last.url === url && Date.now() - last.visitedAt < 3000) {
      last.title = title;
      last.visitedAt = Date.now();
    } else {
      this.history.unshift(entry);
      if (this.history.length > 400) this.history.length = 400;
    }
    setState('history', this.history.slice(0, 300));
    this.sendPrep(EV.HISTORY, this.history.slice(0, 300));
  }

  /* ------------------------------------------------------------------ *
   * App events
   * ------------------------------------------------------------------ */

  private wireAppEvents(): void {
    screen.on('display-added', () => this.sendPrep(EV.SETTINGS, this.settings));
    screen.on('display-removed', () => this.afterDisplayChange());
    screen.on('display-metrics-changed', () => this.afterDisplayChange());
  }

  private afterDisplayChange(): void {
    const displays = this.displays();
    this.sendPrep(EV.SETTINGS, this.settings);
    if (this.settings.outputDisplayId !== undefined && !displays.some((d) => d.id === this.settings.outputDisplayId)) {
      // Safe fallback: the output monitor vanished while it was in use.
      this.settings = { ...this.settings, outputDisplayId: undefined };
      setState('settings', this.settings);
      this.sendPrep(EV.SETTINGS, this.settings);
      this.toast('The output display was disconnected — Juzt fell back to the projector picker', 'error');
    }
    this.routeViews();
  }

  /* ------------------------------------------------------------------ *
   * IPC
   * ------------------------------------------------------------------ */

  private registerIpc(): void {
    /* ---- app / window ---- */
    registerPrep(CH.APP_STATE, (_e) => this.bootstrap());
    registerPrep(CH.APP_SET_SETTINGS, (e, patch) => this.setSettings(sanitizePatch(patch), e));
    registerPrep(CH.APP_QUIT, () => {
      this.saveSession();
      app.quit();
    });
    registerPrep(CH.APP_RELAUNCH, () => {
      this.saveSession();
      app.relaunch();
      app.exit(0);
    });
    registerPrep(CH.WIN_MINIMIZE, () => this.windows.prepWindow()?.minimize());
    registerPrep(CH.WIN_TOGGLE_MAXIMIZE, () => {
      const win = this.windows.prepWindow();
      if (!win) return false;
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
      return win.isMaximized();
    });
    registerPrep(CH.WIN_CLOSE, () => this.windows.prepWindow()?.close());
    registerPrep(CH.WIN_SET_FULLSCREEN, (_e, on: unknown) => {
      const win = this.windows.prepWindow();
      if (!win) return false;
      win.setFullScreen(asBool(on));
      return win.isFullScreen();
    });
    registerLive(CH.WIN_IS_FULLSCREEN, (e) => {
      const role = roleFor(e);
      const win = role === 'live' ? this.windows.liveWindow() : this.windows.prepWindow();
      return !!(win && 'isFullScreen' in win && win.isFullScreen());
    });

    /* ---- tabs ---- */
    registerPrepOnly(CH.TAB_NEW, (_e, opts: unknown) => {
      const o = (opts ?? {}) as { url?: string; kind?: string; name?: string; background?: boolean; boardId?: string };
      const kind = o.kind === 'whiteboard' ? 'whiteboard' : 'web';
      return this.tabs.create({ url: typeof o.url === 'string' ? o.url : undefined, kind, name: o.name, background: o.background }).id;
    });
    registerPrepOnly(CH.TAB_CLOSE, (_e, id: unknown) => this.tabs.close(asString(id)));
    registerPrepOnly(CH.TAB_CLOSE_OTHERS, (_e, id: unknown) => this.tabs.closeOthers(asString(id)));
    registerPrepOnly(CH.TAB_CLOSE_RIGHT, (_e, id: unknown) => this.tabs.closeRight(asString(id)));
    registerPrepOnly(CH.TAB_ACTIVATE, (_e, id: unknown) => this.tabs.activate(asString(id)));
    registerPrepOnly(CH.TAB_REOPEN, () => {
      const tab = this.tabs.reopen();
      return tab ? { kind: tab.kind, id: tab.id } : null;
    });
    registerPrepOnly(CH.TAB_REORDER, (_e, from: unknown, to: unknown) => this.tabs.reorder(asNumber(from, 0, 500), asNumber(to, 0, 500)));
    registerPrepOnly(CH.TAB_DUPLICATE, (_e, id: unknown) => {
      this.tabs.duplicate(asString(id));
      return true;
    });
    registerPrepOnly(CH.TAB_PIN, (_e, id: unknown, pinned: unknown) => this.tabs.pin(asString(id), asBool(pinned)));
    registerPrepOnly(CH.TAB_MUTE, (_e, id: unknown, muted: unknown) => this.tabs.mute(asString(id), asBool(muted)));
    registerPrepOnly(CH.TAB_NAVIGATE, (_e, id: unknown, url: unknown) => this.tabs.navigate(asString(id), asString(url)));
    registerPrepOnly(CH.TAB_BACK, (_e, id: unknown) => this.tabs.back(asString(id)));
    registerPrepOnly(CH.TAB_FORWARD, (_e, id: unknown) => this.tabs.forward(asString(id)));
    registerPrepOnly(CH.TAB_RELOAD, (_e, id: unknown) => this.tabs.reload(asString(id), false));
    registerPrepOnly(CH.TAB_HARD_RELOAD, (_e, id: unknown) => this.tabs.reload(asString(id), true));
    registerPrepOnly(CH.TAB_STOP, (_e, id: unknown) => this.tabs.stop(asString(id)));
    registerPrepOnly(CH.TAB_ZOOM, (_e, id: unknown, factor: unknown) => this.tabs.setZoom(asString(id), asNumber(factor, 0.25, 5)));
    registerPrepOnly(CH.TAB_OPEN_BACKGROUND, (_e, url: unknown) => this.tabs.create({ url: asString(url), background: true }).id);
    registerPrepOnly(CH.TAB_OPEN_FOREGROUND, (_e, url: unknown) => this.tabs.create({ url: asString(url), activate: true }).id);
    registerPrepOnly(CH.TAB_OPEN_PRIVATE, (_e, url: unknown) => {
      const tab = this.tabs.create({ url: asString(url), activate: true });
      if (tab.kind === 'web') this.tabs.list = { ...this.tabs.list, tabs: this.tabs.list.tabs.map((t) => (t.id === tab.id && t.kind === 'web' ? { ...t, private: true } : t)) };
      this.tabs.ensureLoaded(tab.id);
      return tab.id;
    });
    registerPrepOnly(CH.TAB_FOCUS_URL_FIELD, () => undefined);

    registerPrep(CH.UI_STATE, (e, patch: unknown) => {
      const p = (patch ?? {}) as Partial<PrepUiState>;
      const next: PrepUiState = {
        tool: typeof p.tool === 'string' ? p.tool : this.ui.tool,
        inkLayer: p.inkLayer === undefined ? this.ui.inkLayer : !!p.inkLayer,
        cover: p.cover === undefined ? this.ui.cover : !!p.cover,
        style: p.style ?? this.ui.style,
        number: typeof p.number === 'number' ? Math.max(1, Math.min(9999, Math.round(p.number))) : this.ui.number,
        cameraDrag: p.cameraDrag === undefined ? this.ui.cameraDrag : !!p.cameraDrag,
      };
      const changed =
        next.tool !== this.ui.tool ||
        next.inkLayer !== this.ui.inkLayer ||
        next.cover !== this.ui.cover ||
        next.style !== this.ui.style ||
        next.cameraDrag !== this.ui.cameraDrag;
      this.ui = next;
      if (changed) {
        this.sendOverlay(EV.TOOL, {
          tool: next.tool,
          style: next.style,
          number: next.number,
          single: this.settings.presentationMode === 'single',
          cameraDrag: !!next.cameraDrag,
        });
        this.routeViews();
      }
      void e;
      return true;
    });

    registerPrep(CH.INK_CMD, (_e, payload: unknown) => {
      const cmd = (payload as { cmd?: string })?.cmd;
      if (cmd !== 'undo' && cmd !== 'redo' && cmd !== 'clear') return false;
      // PREP toolbar → overlay owns the ink model; it answers with INK_STATE.
      this.sendOverlay(EV.INK_CMD_EV, { cmd });
      return true;
    });
    registerLive(CH.INK_STATE, (e, state: unknown) => {
      if (roleFor(e) !== 'overlay') return false;
      const s = (state ?? {}) as { count?: number; canUndo?: boolean; canRedo?: boolean };
      this.sendPrep(EV.INK_CMD_EV, { kind: 'state', count: s.count ?? 0, canUndo: !!s.canUndo, canRedo: !!s.canRedo });
      return true;
    });

    /* ---- present / live ---- */
    registerPrep(CH.LIVE_PRESENT_TAB, (_e, id: unknown) => this.presentTab(asString(id)));
    registerPrep(CH.LIVE_PRESENT_BOARD, (_e, id: unknown) => this.presentBoard(asString(id)));
    registerPrep(CH.LIVE_START, () => this.startPresentation());

    /* ---- website compatibility (private teacher diagnostics only) ---- */
    registerPrep(CH.COMPAT_INFO, () => this.compatibilityInfo());
    registerPrep(CH.COMPAT_SET_SITE, (_e, origin: unknown, mode: unknown) => {
      const key = asOrigin(origin);
      const m = mode === 'app' || mode === 'electron' ? mode : 'clean';
      if (!key) return false;
      this.settings.siteCompat = { ...this.settings.siteCompat, [key]: m };
      this.refreshWebIdentity();
      return true;
    });
    registerPrep(CH.COMPAT_RESET_SITE, (_e, origin: unknown) => {
      const key = asOrigin(origin);
      if (!key) return false;
      const next = { ...this.settings.siteCompat };
      delete next[key];
      this.settings.siteCompat = next;
      this.refreshWebIdentity();
      return true;
    });
    registerPrep(CH.COMPAT_CLEAR_SITE_DATA, async (_e, origin: unknown) => {
      const key = asOrigin(origin);
      if (!key || !this.appSession) return { ok: false, error: 'Unknown origin.' };
      try {
        await this.appSession.clearStorageData({ origin: `https://${key}` });
        await this.appSession.clearCache();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    });

    /* ---- extensions ---- */
    registerPrep(CH.EXT_LIST, () => this.extensions?.list() ?? []);
    registerPrep(CH.EXT_PICK, async (e) => {
      const win = BrowserWindow.fromWebContents(e.sender) ?? this.windows.prepWindow();
      const manager = this.extensions;
      if (!manager || !win) return { error: 'Extension manager unavailable.' };
      const dir = await manager.pickDirectory(win);
      if (!dir) return { error: 'cancelled' };
      return manager.addDirectory(dir);
    });
    registerPrep(CH.EXT_ADD, async (_e, dir: unknown) => {
      if (this.settings.safeMode) return { error: 'Safe Mode is on. Turn it off in Settings to load extensions.' };
      if (typeof dir !== 'string' || !this.extensions) return { error: 'Pick a folder that contains manifest.json.' };
      const added = await this.extensions.addDirectory(dir);
      if ('error' in added) return { error: added.error };
      this.settings.extensions = this.extensions.persist();
      this.toast(`Loaded ${added.name}`);
      return added;
    });
    registerPrep(CH.EXT_ENABLE, async (_e, id: unknown) => {
      if (this.settings.safeMode || !this.extensions) return false;
      await this.extensions.enable(asString(id));
      this.settings.extensions = this.extensions.persist();
      return true;
    });
    registerPrep(CH.EXT_DISABLE, async (_e, id: unknown) => {
      if (!this.extensions) return false;
      await this.extensions.disable(asString(id));
      this.settings.extensions = this.extensions.persist();
      return true;
    });
    registerPrep(CH.EXT_RELOAD, async (_e, id: unknown) => {
      if (!this.extensions) return null;
      const record = this.extensions.list().find((r) => r.id === asString(id)) ?? null;
      await this.extensions.reload(asString(id));
      this.settings.extensions = this.extensions.persist();
      return record;
    });
    registerPrep(CH.EXT_REMOVE, (_e, id: unknown) => {
      this.extensions?.remove(asString(id));
      this.settings.extensions = this.extensions?.persist() ?? [];
      return true;
    });
    registerPrep(CH.EXT_DISABLE_ALL, () => {
      // Configuration is kept; only the loaded instances are unloaded.
      this.extensions?.unloadAll();
      this.settings.extensions = this.extensions?.persist() ?? [];
      return this.settings.extensions;
    });
    registerPrep(CH.EXT_OPEN_OPTIONS, (_e, id: unknown) => {
      const record = this.extensions?.list().find((r) => r.id === asString(id));
      if (!record) return false;
      // Options pages open in a small, ordinary Juzt window: they get no
      // privileged preload and no access to Juzt IPC.
      const win = new BrowserWindow({ width: 720, height: 560, title: `${record.name} options`, autoHideMenuBar: true });
      win.webContents.loadURL('about:blank');
      return true;
    });
    registerPrep(CH.SAFE_MODE_SET, (_e, on: unknown) => {
      const enabled = asBool(on);
      this.settings.safeMode = enabled;
      if (enabled) {
        this.extensions?.unloadAll();
        this.settings.webUserAgent = 'clean';
        this.settings.siteCompat = {};
        this.refreshWebIdentity();
      }
      this.settings.extensions = this.extensions?.persist() ?? [];
      this.toast(enabled ? 'Safe Mode on: extensions paused for website tabs' : 'Safe Mode off: extensions resumed');
      return enabled;
    });
    registerPrep(CH.LIVE_STOP, () => {
      this.live.stop();
      return this.toPayload();
    });
    registerPrep(CH.LIVE_SET_PRIVACY, (_e, on: unknown) => {
      this.live.setPrivacy(asBool(on));
      return this.toPayload();
    });
    registerPrep(CH.LIVE_SET_FREEZE, async (_e, on: unknown) => {
      await this.live.setFreeze(asBool(on));
      return this.toPayload();
    });
    registerPrep(CH.LIVE_SET_SPOTLIGHT, (_e, patch: unknown) => {
      this.live.setSpotlight(sanitizeSpotlight(patch));
      return true;
    });
    registerPrep(CH.LIVE_SET_HOLDING, async (_e, patch: unknown) => {
      const p = (patch ?? {}) as { text?: string; on?: boolean };
      if (typeof p.text === 'string') this.live.setHoldingText(p.text.slice(0, 200));
      if (p.on === false) this.live.stop();
      else if (p.on) await this.live.present({ kind: 'board', id: 'holding', label: this.live.state.holdingText });
      return this.toPayload();
    });
    registerPrep(CH.LIVE_SET_MASKS, (_e, masks: unknown) => {
      this.live.setMasks(sanitizeMasks(masks));
      return this.toPayload();
    });
    registerLive(CH.LIVE_LASER, (e, payload: unknown) => {
      const role = roleFor(e);
      if (role !== 'overlay' && role !== 'prep') return false;
      const p = (payload ?? {}) as { points?: unknown; color?: unknown };
      return this.applyLaser({ points: Array.isArray(p.points) ? (p.points as number[]).slice(0, 2000) : [], color: typeof p.color === 'string' ? p.color : undefined });
    });
    registerLive(CH.LIVE_ANNOTATION, (e, op: unknown) => {
      const role = roleFor(e);
      if (role !== 'overlay' && role !== 'prep') return false;
      const kind = (op as { kind?: string })?.kind;
      if (kind === 'live' || kind === 'replay') return this.applyInkLive(op);
      return this.applyInkOp(op);
    });
    registerPrep(CH.LIVE_CAMERA, (_e, patch: unknown) => {
      const camera = sanitizeCamera({ ...this.settings.camera, ...(patch as Partial<CameraConfig>) });
      this.settings = { ...this.settings, camera };
      setState('settings', this.settings);
      this.live.setCamera(camera);
      return camera;
    });
    registerLive(CH.LIVE_REQUEST_STATE, () => this.toPayload());
    registerPrep(CH.LIVE_OPEN_WINDOW, () => this.openLiveWindow());
    registerPrep(CH.LIVE_FOCUS_WINDOW, () => {
      const live = this.windows.liveWindow();
      if (!live) return false;
      if (live.isMinimized()) live.restore();
      live.focus();
      return true;
    });
    registerPrep(CH.LIVE_PREVIEW, (_e, enabled: unknown) => {
      const on = asBool(enabled);
      this.live.setPreview(on, (dataUrl) => this.sendPrep(EV.PREVIEW_FRAME, dataUrl));
      return true;
    });
    registerPrep(CH.LIVE_NAVIGATE, async (_e, url: unknown) => {
      const target = resolveInput(asString(url), { search: true });
      if (!target || isInternalPage(target)) return false;
      if (this.live.state.presentation.kind !== 'tab') {
        // Not presenting: navigate the active tab instead.
        const active = this.tabs.active();
        if (active && active.kind === 'web') return this.tabs.navigate(active.id, target);
        return false;
      }
      return this.live.navigateAudience(target);
    });

    /* ---- whiteboards ---- */
    registerPrep(CH.BOARD_LIST, () => this.boards.list());
    registerPrep(CH.BOARD_CREATE, (_e, name: unknown) => this.boards.create(typeof name === 'string' ? name : undefined));
    registerPrep(CH.BOARD_GET, (_e, id: unknown) => this.boards.get(asString(id)));
    registerPrep(CH.BOARD_OP, (_e, payload: unknown) => {
      const p = (payload ?? {}) as { boardId?: string; ops?: unknown };
      const ops = asArray<WbOp>(p.ops ?? [], 400);
      return this.boards.apply(asString(p.boardId ?? ''), ops);
    });
    registerPrep(CH.BOARD_UNDO, (_e, id: unknown) => this.boards.undo(asString(id)));
    registerPrep(CH.BOARD_REDO, (_e, id: unknown) => this.boards.redo(asString(id)));
    registerPrep(CH.BOARD_UNDO_HINT, (_e, id: unknown) => this.boards.hint(asString(id)));
    registerPrep(CH.BOARD_RENAME, (_e, id: unknown, name: unknown) => this.boards.rename(asString(id), asString(name, 80)));
    registerPrep(CH.BOARD_DELETE, (_e, id: unknown) => this.boards.remove(asString(id)));
    registerPrep(CH.BOARD_OPEN_PREP, (_e, id: unknown) => this.openBoardInPrep(asString(id)));
    registerPrep(CH.BOARD_OPEN_LIVE, (_e, id: unknown) => this.presentBoard(asString(id)));
    registerPrep(CH.BOARD_IMAGE_PICK, async () => {
      const picked = await dialog.showOpenDialog({ title: 'Insert image', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
      if (picked.canceled || !picked.filePaths[0]) return null;
      const file = picked.filePaths[0];
      grantMedia(file);
      const dataUrl = `data:${mimeFor(file)};base64,${fs.readFileSync(file).toString('base64')}`;
      const image = nativeImage.createFromPath(file);
      const size = image.getSize();
      return { dataUrl, naturalW: size.width, naturalH: size.height, name: path.basename(file) };
    });
    registerPrep(CH.BOARD_EXPORT_PICK, async (_e, payload: unknown) => {
      const p = (payload ?? {}) as { dataUrl?: string; name?: string };
      if (typeof p.dataUrl !== 'string' || !p.dataUrl.startsWith('data:image/png')) return null;
      const result = await dialog.showSaveDialog({ title: 'Export whiteboard', defaultPath: p.name || 'whiteboard.png', filters: [{ name: 'PNG image', extensions: ['png'] }] });
      if (result.canceled || !result.filePath) return null;
      fs.writeFileSync(result.filePath, Buffer.from(p.dataUrl.split(',')[1], 'base64'));
      return result.filePath;
    });

    /* ---- scenes ---- */
    registerPrep(CH.SCENE_LIST, () => ({ scenes: this.scenes, activeSceneId: this.activeSceneId }));
    registerPrep(CH.SCENE_SAVE, (_e, scene: unknown) => {
      const s = sanitizeScene(scene as Scene);
      const index = this.scenes.findIndex((x) => x.id === s.id);
      if (index >= 0) this.scenes = this.scenes.map((x) => (x.id === s.id ? s : x));
      else this.scenes = [...this.scenes, s];
      setState('scenes', this.scenes);
      return this.scenes;
    });
    registerPrep(CH.SCENE_DELETE, (_e, id: unknown) => {
      this.scenes = this.scenes.filter((s) => s.id !== asString(id));
      setState('scenes', this.scenes);
      return this.scenes;
    });
    registerPrep(CH.SCENE_APPLY, async (_e, id: unknown) => {
      const scene = this.scenes.find((s) => s.id === asString(id));
      if (!scene) return null;
      this.activeSceneId = scene.id;
      setState('activeScene', scene.id);
      const settings = await this.setSettings({
        liveBackground: scene.liveBackground,
        holdingBackground: scene.holdingBackground,
        privacyBackground: scene.privacyBackground,
        holdingText: scene.holdingText,
        privacyTitle: scene.privacyTitle,
        privacySubtitle: scene.privacySubtitle,
        card: scene.card,
        sizePreset: scene.sizePreset,
        customScale: scene.customScale,
        layout: scene.layout,
        zoom: scene.zoom,
        outputDisplayId: scene.outputDisplayId,
      });
      this.live.setSpotlight(scene.spotlight);
      this.live.setMasks(scene.masks);
      if (scene.startUrl && !isInternalPage(scene.startUrl)) {
        await this.tabs.create({ url: scene.startUrl, activate: false });
      }
      return { settings, scene };
    });

    /* ---- backgrounds ---- */
    registerPrep(CH.BG_PICK, async (_e, opts: unknown) => {
      const o = (opts ?? {}) as { video?: boolean; image?: boolean };
      const filters = [];
      if (o.image !== false) filters.push({ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] });
      if (o.video !== false) filters.push({ name: 'Videos', extensions: ['mp4', 'webm'] });
      const picked = await dialog.showOpenDialog({ title: 'Choose a background', properties: ['openFile'], filters });
      if (picked.canceled || !picked.filePaths[0]) return null;
      const file = picked.filePaths[0];
      const kind = mediaKind(file);
      if (kind === 'other') return null;
      const url = mediaUrl(file);
      let thumb: string | undefined;
      if (kind === 'image') {
        const image = nativeImage.createFromPath(file);
        if (!image.isEmpty()) thumb = image.resize({ width: 220 }).toDataURL();
      }
      return { path: file, url, kind, name: path.basename(file), thumb };
    });
    registerPrep(CH.BG_APPLY, async (_e, payload: unknown) => {
      const p = (payload ?? {}) as { target?: 'live' | 'holding' | 'privacy'; spec?: BackgroundSpec };
      const spec = sanitizeBackground(p.spec);
      const target = p.target === 'holding' || p.target === 'privacy' ? p.target : 'live';
      const key = target === 'live' ? 'liveBackground' : target === 'holding' ? 'holdingBackground' : 'privacyBackground';
      return this.setSettings({ [key]: spec } as Partial<Settings>);
    });
    registerPrep(CH.BG_LIBRARY_ADD, (_e, payload: unknown) => {
      const p = (payload ?? {}) as { name?: string; spec?: BackgroundSpec };
      const id = `bg_${Date.now().toString(36)}`;
      const spec = sanitizeBackground(p.spec);
      this.settings = {
        ...this.settings,
        backgroundLibrary: [
          ...this.settings.backgroundLibrary,
          { id, name: (p.name || 'Background').slice(0, 60), spec, addedAt: Date.now() },
        ],
      };
      setState('settings', this.settings);
      this.sendPrep(EV.SETTINGS, this.settings);
      return { id };
    });
    registerPrep(CH.BG_LIBRARY_UPDATE, (_e, payload: unknown) => {
      const p = (payload ?? {}) as { id?: string; name?: string };
      this.settings = {
        ...this.settings,
        backgroundLibrary: this.settings.backgroundLibrary.map((b) => (b.id === p.id ? { ...b, name: (p.name ?? b.name).slice(0, 60) } : b)),
      };
      setState('settings', this.settings);
      this.sendPrep(EV.SETTINGS, this.settings);
      return true;
    });
    registerPrep(CH.BG_LIBRARY_REMOVE, (_e, id: unknown) => {
      this.settings = { ...this.settings, backgroundLibrary: this.settings.backgroundLibrary.filter((b) => b.id !== asString(id)) };
      setState('settings', this.settings);
      this.sendPrep(EV.SETTINGS, this.settings);
      return true;
    });

    /* ---- favorites / history ---- */
    registerPrep(CH.FAV_LIST, () => this.favorites);
    registerPrep(CH.FAV_ADD, (_e, payload: unknown) => {
      const p = (payload ?? {}) as { url?: string; title?: string; favicon?: string };
      const url = asString(p.url ?? '');
      if (!url || isInternalPage(url)) return this.favorites;
      const favorite: Favorite = {
        id: `f_${Date.now().toString(36)}`,
        url,
        title: (p.title || url).slice(0, 120),
        favicon: typeof p.favicon === 'string' ? p.favicon : undefined,
        addedAt: Date.now(),
      };
      this.favorites = [favorite, ...this.favorites.filter((f) => f.url !== url)].slice(0, 200);
      setState('favorites', this.favorites);
      return this.favorites;
    });
    registerPrep(CH.FAV_REMOVE, (_e, id: unknown) => {
      this.favorites = this.favorites.filter((f) => f.id !== asString(id));
      setState('favorites', this.favorites);
      return this.favorites;
    });
    registerPrep(CH.FAV_RENAME, (_e, payload: unknown) => {
      const p = (payload ?? {}) as { id?: string; title?: string };
      this.favorites = this.favorites.map((f) => (f.id === p.id ? { ...f, title: (p.title ?? f.title).slice(0, 120) } : f));
      setState('favorites', this.favorites);
      return this.favorites;
    });
    registerPrep(CH.HIST_LIST, () => this.history.slice(0, 300));
    registerPrep(CH.HIST_CLEAR, () => {
      this.history = [];
      setState('history', this.history);
      this.sendPrep(EV.HISTORY, this.history);
      return true;
    });
    registerPrep(CH.HIST_REMOVE, (_e, id: unknown) => {
      this.history = this.history.filter((h) => h.id !== asString(id));
      setState('history', this.history);
      this.sendPrep(EV.HISTORY, this.history);
      return true;
    });

    /* ---- permissions ---- */
    registerPrep(CH.PERM_RESPOND, (_e, payload: unknown) => {
      const p = (payload ?? {}) as { id?: string; granted?: boolean; remember?: boolean };
      return this.permissions.respond(asString(p.id ?? ''), !!p.granted, !!p.remember);
    });
    registerPrep(CH.PERM_PICK_SOURCE, (_e, payload: unknown) => {
      const p = (payload ?? {}) as { requestId?: string; id?: string | null };
      return this.permissions.pickSource(asString(p.requestId ?? ''), p.id ? asString(p.id) : null);
    });

    /* ---- displays ---- */
    registerPrep(CH.DISPLAY_LIST, () => this.displays());
    registerPrep(CH.DISPLAY_SET_OUTPUT, async (_e, id: unknown) => {
      const value = id === null || id === undefined ? null : asNumber(id);
      await this.setSettings({ outputDisplayId: value === null ? undefined : Math.round(value) });
      return this.displays();
    });

    /* ---- misc ---- */
    registerPrep(CH.DIAG_ENABLE, (_e, on: unknown) => {
      const enabled = asBool(on);
      setDiagnostics(enabled);
      setState('diagnostics', enabled);
      return enabled;
    });
    registerLive(CH.DIAG_REPORT, (e, sample: unknown) => {
      const role = roleFor(e);
      if (!role) return false;
      this.sendPrep(EV.DIAG, { renderer: sample ?? {}, main: snapshot() });
      return true;
    });
    registerLive(CH.SHELL_OPEN_EXTERNAL, (_e, url: unknown) => {
      const target = asString(url, 2048);
      if (!/^https?:\/\//i.test(target)) return false;
      void shell.openExternal(target);
      return true;
    });
    registerPrep(CH.CLIPBOARD_WRITE, (_e, text: unknown) => {
      clipboard.writeText(asString(text, 200_000));
      return true;
    });
    registerPrep(CH.FILE_OPEN_IMAGE, async () => {
      const picked = await dialog.showOpenDialog({ title: 'Open image', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
      if (picked.canceled || !picked.filePaths[0]) return null;
      const file = picked.filePaths[0];
      grantMedia(file);
      const image = nativeImage.createFromPath(file);
      const size = image.getSize();
      return { dataUrl: `data:${mimeFor(file)};base64,${fs.readFileSync(file).toString('base64')}`, naturalW: size.width, naturalH: size.height, name: path.basename(file) };
    });
    registerPrep(CH.FILE_OPEN_MEDIA, async (_e, opts: unknown) => {
      const o = (opts ?? {}) as { video?: boolean };
      const filters = o.video ? [{ name: 'Videos', extensions: ['mp4', 'webm'] }] : [{ name: 'Media', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm'] }];
      const picked = await dialog.showOpenDialog({ title: 'Choose media', properties: ['openFile'], filters });
      if (picked.canceled || !picked.filePaths[0]) return null;
      const file = picked.filePaths[0];
      return { path: file, url: mediaUrl(file), kind: mediaKind(file), name: path.basename(file) };
    });
    registerPrep(CH.FILE_SAVE_IMAGE_DATA, async (_e, payload: unknown) => {
      const p = (payload ?? {}) as { dataUrl?: string; name?: string };
      if (typeof p.dataUrl !== 'string' || !p.dataUrl.startsWith('data:image/')) return null;
      const result = await dialog.showSaveDialog({ title: 'Save image', defaultPath: p.name || 'capture.png' });
      if (result.canceled || !result.filePath) return null;
      fs.writeFileSync(result.filePath, Buffer.from(p.dataUrl.split(',')[1], 'base64'));
      return result.filePath;
    });
  }

  private bootstrap(): PrepBootstrap {
    return {
      appName: APP_NAME,
      version: app.getVersion(),
      dev: isDev(),
      settings: this.settings,
      scenes: this.scenes,
      activeSceneId: this.activeSceneId,
      tabs: this.tabs.tabs,
      activeTabId: this.tabs.list.activeId,
      boards: this.boards.list(),
      favorites: this.favorites,
      history: this.history.slice(0, 300),
      displays: this.displays(),
      live: this.toPayload(),
      ui: this.ui,
      diagnosticsEnabled: loadState('diagnostics', false),
    };
  }

  /* ------------------------------------------------------------------ *
   * Present helpers
   * ------------------------------------------------------------------ */

  private async presentTab(id: string): Promise<LivePayload> {
    const tab = this.tabs.get(id);
    if (!tab || tab.kind !== 'web' || tab.private) {
      if (tab && tab.kind === 'web' && tab.private) this.toast('Private tabs are never presented', 'error');
      return this.toPayload();
    }
    if (isInternalPage(tab.url)) {
      this.toast('Internal pages are private — present a website or a whiteboard', 'error');
      return this.toPayload();
    }
    if (this.settings.presentationMode === 'dual') {
      // Make sure the stage has the tab's URL: the audience page is a separate
      // instance on the same persistent session, never the PREP view itself.
      this.tabs.ensureLoaded(id);
    }
    this.lastPresentedBoardId = null;
    await this.live.present({ kind: 'tab', id, label: tabLabel(tab), url: tab.url });
    this.routeViews();
    return this.toPayload();
  }

  private async presentBoard(boardId: string): Promise<LivePayload> {
    const doc = this.boards.get(boardId);
    if (!doc) return this.toPayload();
    this.lastPresentedBoardId = boardId;
    await this.live.present({ kind: 'board', id: boardId, label: doc.name, boardId });
    this.sendLive(EV.BOARD_DOC, doc);
    this.routeViews();
    return this.toPayload();
  }

  /** Present whatever the teacher is looking at right now. */
  private async presentActive(): Promise<LivePayload> {
    const tab = this.tabs.active();
    if (!tab) {
      this.toast('Open a website or a whiteboard first', 'error');
      return this.toPayload();
    }
    if (tab.kind === 'whiteboard') return this.presentBoard(tab.boardId);
    return this.presentTab(tab.id);
  }

  private openBoardInPrep(boardId: string): string {
    const existing = this.tabs.tabs.find((t) => t.kind === 'whiteboard' && t.boardId === boardId);
    if (existing) {
      this.tabs.activate(existing.id);
      return existing.id;
    }
    const doc = this.boards.get(boardId);
    const tab = this.tabs.create({ kind: 'whiteboard', boardId, name: doc?.name ?? 'Whiteboard', activate: true });
    return tab.id;
  }

  /* Preview frames from main-side diagnostics (kept tiny, never a loop). */
  pushDiagnostics(): void {
    if (!loadState('diagnostics', false)) return;
    this.sendPrep(EV.DIAG, {
      renderer: {},
      main: { ...snapshot(), webContents: webContentsCount(), bounds: countBounds(false) },
    });
  }
}

/* ------------------------------------------------------------------ *
 * Sanitizers — every value that crosses IPC lands here first
 * ------------------------------------------------------------------ */

type LiveStateShape = ReturnType<typeof defaultLiveState>;

function sanitizePatch(patch: unknown): Partial<Settings> {
  return (patch ?? {}) as Partial<Settings>;
}

/** Origin keys are `scheme://host[:port]` and nothing else. */
function asOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

function sanitizeSettings(raw: Partial<Settings>): Settings {
  const base: Settings = { ...DEFAULT_SETTINGS, camera: { ...DEFAULT_CAMERA_CONFIG }, ...raw };
  const sizePreset = SIZE_PRESETS.some((p) => p.id === base.sizePreset) ? base.sizePreset : DEFAULT_SETTINGS.sizePreset;
  const radius = isCardRadius(base.card?.radius) ? base.card.radius : DEFAULT_CARD.radius;
  return {
    ...base,
    schemaVersion: SCHEMA_VERSION,
    presentationMode: base.presentationMode === 'single' ? 'single' : 'dual',
    sizePreset,
    customScale: clampNumber(base.customScale, 0.4, 1),
    zoom: clampNumber(base.zoom, 0.25, 5),
    card: {
      radius,
      border: base.card?.border === 'off' ? 'off' : 'subtle',
      shadow: base.card?.shadow === 'medium' ? 'medium' : base.card?.shadow === 'off' ? 'off' : 'soft',
      margin: base.card?.margin === 'compact' ? 'compact' : base.card?.margin === 'spacious' ? 'spacious' : 'comfortable',
    },
    holdingText: String(base.holdingText ?? '').slice(0, 200),
    privacyTitle: String(base.privacyTitle ?? '').slice(0, 120),
    privacySubtitle: String(base.privacySubtitle ?? '').slice(0, 200),
    liveBackground: sanitizeBackground(base.liveBackground),
    holdingBackground: sanitizeBackground(base.holdingBackground),
    privacyBackground: sanitizeBackground(base.privacyBackground),
    backgroundLibrary: Array.isArray(base.backgroundLibrary) ? base.backgroundLibrary.slice(0, 60) : [],
    camera: sanitizeCamera(base.camera),
    tabShelfAlways: base.tabShelfAlways === true,
    diagnostics: base.diagnostics === true,
    firstRunDone: base.firstRunDone === true,
    prepPaneOpen: base.prepPaneOpen === true,
    tabMemoryPolicy: base.tabMemoryPolicy === 'autoDiscard' ? 'autoDiscard' : 'keep',
    webUserAgent: base.webUserAgent === 'app' || base.webUserAgent === 'electron' ? base.webUserAgent : 'clean',
    siteCompat: sanitizeSiteCompat(base.siteCompat),
    extensions: sanitizeExtensions(base.extensions),
    extensionDevMode: base.extensionDevMode === true,
    safeMode: base.safeMode === true,
  };
}

/** Per-origin identity overrides: origin keys only, and only known modes. */
function sanitizeSiteCompat(raw: unknown): Record<string, UserAgentMode> {
  const out: Record<string, UserAgentMode> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [origin, mode] of Object.entries(raw as Record<string, unknown>)) {
    if (!isOriginKey(origin)) continue;
    out[origin] = mode === 'app' || mode === 'electron' ? mode : 'clean';
  }
  return out;
}

function isOriginKey(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\/[^/\s?#]+$/i.test(value);
}

/**
 * Persisted extension references. Only directory paths are stored — never
 * extension code — and every field is re-validated on read.
 */
function sanitizeExtensions(raw: unknown): ExtensionRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 64).flatMap((entry) => {
    const e = (entry ?? {}) as Partial<ExtensionRecord>;
    if (typeof e.path !== 'string' || e.path.length === 0) return [];
    const mv = e.manifestVersion === 2 || e.manifestVersion === 3 ? e.manifestVersion : 0;
    return [
      {
        id: typeof e.id === 'string' && e.id.length > 0 ? e.id.slice(0, 200) : e.path.slice(0, 200),
        path: e.path.slice(0, 4000),
        name: typeof e.name === 'string' && e.name.length > 0 ? e.name.slice(0, 200) : 'Unknown extension',
        version: typeof e.version === 'string' ? e.version.slice(0, 40) : '0',
        manifestVersion: mv,
        description: typeof e.description === 'string' ? e.description.slice(0, 400) : undefined,
        enabled: e.enabled !== false,
        // A fresh launch always starts from an unknown state: the extension is
        // re-loaded by ExtensionManager, which reports the real result.
        status: 'unknown' as const,
        error: typeof e.error === 'string' ? e.error.slice(0, 500) : undefined,
        addedAt: typeof e.addedAt === 'number' ? e.addedAt : Date.now(),
      },
    ];
  });
}

function sanitizeCamera(raw: Partial<CameraConfig> | undefined): CameraConfig {
  const merged = { ...DEFAULT_CAMERA_CONFIG, ...(raw ?? {}) };
  const rect = merged.rect ?? DEFAULT_CAMERA_CONFIG.rect;
  return {
    enabled: !!merged.enabled,
    deviceId: typeof merged.deviceId === 'string' ? merged.deviceId.slice(0, 200) : undefined,
    deviceLabel: typeof merged.deviceLabel === 'string' ? merged.deviceLabel.slice(0, 120) : undefined,
    mirror: merged.mirror !== false,
    exposure: merged.exposure === 'live' || merged.exposure === 'both' ? merged.exposure : 'prep',
    shape: merged.shape === 'circle' ? 'circle' : 'rounded',
    rect: {
      x: clampNumber(rect.x, 0, 1),
      y: clampNumber(rect.y, 0, 1),
      w: clampNumber(rect.w, 0.08, 0.72),
      h: clampNumber(rect.h, 0.08, 0.72),
    },
    radius: clampNumber(merged.radius, 0, 80),
  };
}

function sanitizeBackground(spec: unknown): BackgroundSpec {
  const s = (spec ?? {}) as BackgroundSpec;
  const kind = s.kind === 'color' || s.kind === 'gradient' || s.kind === 'image' || s.kind === 'video' ? s.kind : 'none';
  return {
    kind,
    color: typeof s.color === 'string' ? s.color.slice(0, 60) : undefined,
    gradient: typeof s.gradient === 'string' ? s.gradient.slice(0, 240) : undefined,
    path: typeof s.path === 'string' ? s.path.slice(0, 2000) : undefined,
    fit: s.fit === 'contain' || s.fit === 'stretch' ? s.fit : 'cover',
    loop: s.loop !== false,
    muted: true,
    volume: clampNumber(s.volume ?? 0, 0, 1),
    rate: clampNumber(s.rate ?? 1, 0.25, 4),
    dim: s.dim === undefined ? undefined : clampNumber(s.dim, 0, 0.9),
  };
}

function sanitizeSpotlight(patch: unknown): Partial<SpotlightState> {
  const p = (patch ?? {}) as Partial<SpotlightState>;
  const out: Partial<SpotlightState> = {};
  if (p.on !== undefined) out.on = !!p.on;
  if (p.x !== undefined) out.x = clampNumber(p.x, -1, 2);
  if (p.y !== undefined) out.y = clampNumber(p.y, -1, 2);
  if (p.r !== undefined) out.r = clampNumber(p.r, 0.02, 1.5);
  if (p.dim !== undefined) out.dim = clampNumber(p.dim, 0, 0.95);
  if (p.shape !== undefined) out.shape = p.shape === 'rect' ? 'rect' : 'circle';
  return out;
}

function sanitizeMasks(masks: unknown): PrivacyMask[] {
  if (!Array.isArray(masks)) return [];
  return masks.slice(0, 8).map((m, i) => {
    const mask = (m ?? {}) as PrivacyMask;
    return {
      id: typeof mask.id === 'string' ? mask.id.slice(0, 60) : `mask_${i}`,
      x: clampNumber(mask.x, -1, 2),
      y: clampNumber(mask.y, -1, 2),
      w: clampNumber(mask.w, 0.01, 2),
      h: clampNumber(mask.h, 0.01, 2),
      mode: mask.mode === 'blur' ? 'blur' : 'solid',
    };
  });
}

function sanitizeScene(scene: Scene): Scene {
  return {
    ...scene,
    id: typeof scene.id === 'string' && scene.id ? scene.id : `scene_${Date.now().toString(36)}`,
    name: String(scene.name ?? 'Scene').slice(0, 60),
    liveBackground: sanitizeBackground(scene.liveBackground),
    holdingBackground: sanitizeBackground(scene.holdingBackground),
    privacyBackground: sanitizeBackground(scene.privacyBackground),
    masks: sanitizeMasks(scene.masks),
  };
}

function clampNumber(value: unknown, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, n));
}

function mimeFor(file: string): string {
  switch (path.extname(file).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      return 'image/jpeg';
  }
}

/* Small helpers used above; kept out of the class for tree-shaking clarity. */
export function internalPages(): readonly string[] {
  return INTERNAL_PAGES;
}

export function prepDevServer(): string | null {
  return devServerUrl();
}

export function dataDir(): string {
  return userDataDir();
}

export function grant(file: string): string {
  return grantMedia(file);
}

export function isBoardTabState(tab: TabState): boolean {
  return isBoardTab(tab);
}
