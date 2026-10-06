/**
 * Windows, native views and the single place where bounds are applied.
 *
 * Architecture (chosen after checking Electron 31's actual capabilities — there
 * is no `view.setBorderRadius` and a `WebContentsView` cannot be shown in two
 * windows):
 *
 *   Juzt Live  (BaseWindow, dual mode only)
 *     ├─ stageView   WebContentsView, the *audience* web page (own instance on
 *     │              the shared `persist:juzt` session, same URL as the tab)
 *     └─ surfaceView WebContentsView, full window, transparent rounded hole
 *                    punched over the card → background, card frame, holding /
 *                    privacy / freeze layers, whiteboard, ink, spotlight, masks
 *
 *   Juzt Prep  (BrowserWindow)
 *     ├─ page        the React UI (chrome, palette, whiteboard editor…)
 *     ├─ tab views   one WebContentsView per web tab, shown at the card rect
 *     └─ cardOverlay WebContentsView, transparent, above the card:
 *                    ink + corner wedges + (single mode) audience layers
 *
 * Transparency of `surfaceView`/`cardOverlay` uses the documented
 * `setBackgroundColor('#00000000')` pattern; stacking order is the documented
 * `addChildView` order. `applyPlacements()` never calls `setBounds` for an
 * unchanged rectangle — that was one of the biggest V2 stutter sources.
 */

import { BaseWindow, BrowserWindow, WebContentsView, screen } from 'electron';
import path from 'node:path';
import { countBounds } from './diagnostics';
import { devServerUrl, isDev } from './paths';
import { sameRect } from '../shared/layout';
import type { Rect } from '../shared/types';

export type WinRole = 'prep' | 'live';

export interface Placement {
  view: WebContentsView;
  /** Owning window; moving between windows is not supported for views. */
  role: WinRole;
  rect: Rect | null;
  visible: boolean;
  /** True for the audience surface / overlay views (transparent). */
  transparent?: boolean;
}

interface Applied {
  rect: Rect | null;
  visible: boolean;
}

export class JuztWindows {
  prep: BrowserWindow | null = null;
  live: BaseWindow | null = null;
  /** The LIVE window's audience surface (dual mode). */
  surfaceView: WebContentsView | null = null;
  /** The LIVE window's presented web page (dual mode). */
  stageView: WebContentsView | null = null;
  /** Transparent layer above the PREP card. */
  cardOverlay: WebContentsView | null = null;

  private placements = new Map<WebContentsView, Placement>();
  private applied = new Map<WebContentsView, Applied>();
  private rendererReady = new Set<string>();

  /* ------------------------------------------------------------------ *
   * Windows
   * ------------------------------------------------------------------ */

  createPrep(restore?: { width: number; height: number; x?: number; y?: number }): BrowserWindow {
    const win = new BrowserWindow({
      width: restore?.width ?? 1440,
      height: restore?.height ?? 900,
      x: restore?.x,
      y: restore?.y,
      minWidth: 940,
      minHeight: 620,
      show: false,
      frame: false,
      backgroundColor: '#0b0e14',
      title: 'Juzt Prep',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        // Internal UI: never throttled, it drives the teacher's controls.
        backgroundThrottling: false,
        spellcheck: false,
        webSecurity: true,
        additionalArguments: ['--juzt-role=prep'],
      },
    });
    this.prep = win;
    win.once('ready-to-show', () => win.show());
    this.loadRenderer(win, 'index.html', 'prep');
    win.on('closed', () => {
      this.prep = null;
      this.rendererReady.delete('prep');
    });
    return win;
  }

  createLive(session: Electron.Session, fullscreenOn?: Electron.Display | null): BaseWindow {
    const bounds = fullscreenOn?.bounds ?? screen.getPrimaryDisplay().bounds;
    const win = new BaseWindow({
      x: fullscreenOn ? bounds.x : undefined,
      y: fullscreenOn ? bounds.y : undefined,
      width: bounds.width,
      height: bounds.height,
      show: false,
      frame: false,
      backgroundColor: '#00000000',
      title: 'Juzt Live',
    });
    this.live = win;

    this.stageView = new WebContentsView({
      webPreferences: {
        session,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        webSecurity: true,
        partition: undefined,
        // The audience page never gets a preload: it is a plain web page.
        preload: undefined,
      },
    });
    this.stageView.setBackgroundColor('#00000000');
    win.contentView.addChildView(this.stageView);

    this.surfaceView = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
        additionalArguments: ['--juzt-role=live'],
      },
    });
    this.surfaceView.setBackgroundColor('#00000000');
    win.contentView.addChildView(this.surfaceView);
    this.loadRenderer(this.surfaceView.webContents, 'live.html', 'live');

    win.on('closed', () => {
      this.live = null;
      this.surfaceView = null;
      this.stageView = null;
      this.rendererReady.delete('live');
    });
    return win;
  }

  /** Drop the LIVE window's views (called before closing it). */
  releaseLive(): void {
    this.surfaceView = null;
    this.stageView = null;
    this.live = null;
    this.rendererReady.delete('live');
  }

  /** Transparent ink/effect layer above the PREP card (dual mode). */
  ensureCardOverlay(): WebContentsView {
    if (this.cardOverlay) return this.cardOverlay;
    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
        additionalArguments: ['--juzt-role=overlay'],
      },
    });
    view.setBackgroundColor('#00000000');
    this.cardOverlay = view;
    this.register({ view, role: 'prep', rect: null, visible: false, transparent: true });
    this.loadRenderer(view.webContents, 'live.html?mode=ink', 'overlay');
    return view;
  }

  private loadRenderer(target: BrowserWindow | Electron.WebContents, file: string, role: string): void {
    const dev = devServerUrl();
    const wc = 'webContents' in target ? target.webContents : target;
    wc.on('did-finish-load', () => this.rendererReady.add(role));
    const [filePath, query] = file.split('?');
    if (dev) {
      void wc.loadURL(`${dev}/${filePath}${query ? `?${query}&dev=1` : '?dev=1'}`);
    } else {
      void wc.loadFile(path.join(__dirname, `../renderer/${filePath}`), query ? { query: Object.fromEntries(new URLSearchParams(query)) } : undefined);
    }
  }

  isReady(role: string): boolean {
    return this.rendererReady.has(role);
  }

  /** Accessors: reading through a call keeps TS narrowing from going stale. */
  prepWindow(): BrowserWindow | null {
    return this.prep;
  }

  liveWindow(): BaseWindow | null {
    return this.live;
  }

  stageWindowView(): WebContentsView | null {
    return this.stageView;
  }

  surface(): WebContentsView | null {
    return this.surfaceView;
  }

  overlay(): WebContentsView | null {
    return this.cardOverlay;
  }

  /* ------------------------------------------------------------------ *
   * Placements (the only place setBounds happens)
   * ------------------------------------------------------------------ */

  register(placement: Placement): void {
    this.placements.set(placement.view, placement);
  }

  unregister(view: WebContentsView): void {
    this.placements.delete(view);
    this.applied.delete(view);
  }

  /** Detach and release a view (tab closed / stage no longer needed). */
  destroy(view: WebContentsView): void {
    this.unregister(view);
    try {
      view.setVisible(false);
      view.webContents.close();
    } catch {
      /* already gone */
    }
  }

  private windowFor(role: WinRole): BrowserWindow | BaseWindow | null {
    return role === 'prep' ? this.prepWindow() : this.liveWindow();
  }

  /**
   * Apply every placement, skipping anything whose geometry has not changed and
   * anything whose window is gone. Cheap: O(views), no IPC, no relayout storms.
   */
  applyPlacements(): void {
    for (const placement of this.placements.values()) {
      const { view, role, rect, visible } = placement;
      if (view.webContents.isDestroyed()) {
        this.unregister(view);
        continue;
      }
      const parent = this.windowFor(role);
      const contentView = parent?.contentView;
      if (!contentView) {
        if (this.applied.get(view)?.visible) {
          view.setVisible(false);
          this.applied.set(view, { rect: null, visible: false });
        }
        continue;
      }
      if (!contentView.children.includes(view)) {
        contentView.addChildView(view);
        this.applied.delete(view); // fresh parent → geometry must be re-applied
      }
      const prev = this.applied.get(view);
      const want: Applied = { rect: visible && rect ? rect : null, visible: visible && !!rect };
      if (prev && prev.visible === want.visible && sameRect(prev.rect, want.rect)) {
        countBounds(false); // skipped: this is the win we care about
        continue;
      }
      if (want.visible && want.rect) {
        view.setBounds({ x: want.rect.x, y: want.rect.y, width: want.rect.width, height: want.rect.height });
      }
      view.setVisible(want.visible);
      this.applied.set(view, want);
      countBounds(true);
    }
    this.reorderStack();
  }

  /**
   * Deterministic z-order. `contentView.children` order is the paint order, so
   * the audience surface and the card overlay must always end up last.
   */
  private reorderStack(): void {
    const order: WebContentsView[] = [];
    const surface = this.surface();
    const stage = this.stageWindowView();
    if (surface && stage && this.liveWindow()) {
      order.push(stage, surface);
    }
    const overlay = this.overlay();
    if (overlay) order.push(overlay);
    for (const view of order) {
      if (view.webContents.isDestroyed()) continue;
      const parent = this.placements.get(view)?.role === 'live' ? this.liveWindow()?.contentView : this.prepWindow()?.contentView;
      if (!parent) continue;
      const last = parent.children[parent.children.length - 1];
      if (last === view) continue;
      parent.removeChildView(view);
      parent.addChildView(view);
      this.applied.delete(view);
    }
  }

  /** Enumerate every tracked view (diagnostics + shutdown). */
  allViews(): WebContentsView[] {
    return [...this.placements.keys()];
  }

  hasLiveWindow(): boolean {
    return !!this.liveWindow();
  }

  closeAllViews(): void {
    for (const view of this.allViews()) {
      try {
        view.webContents.close();
      } catch {
        /* ignore */
      }
    }
    this.placements.clear();
    this.applied.clear();
  }

  /** Move the LIVE window onto a display (or recreate it in single mode). */
  placeLiveWindow(display: Electron.Display | null, fullscreen: boolean): void {
    const win = this.liveWindow();
    if (!win) return;
    if (display) {
      win.setBounds(display.bounds);
      if (fullscreen && !win.isFullScreen()) win.setFullScreen(true);
    } else if (fullscreen && !win.isFullScreen()) {
      win.setFullScreen(true);
    }
  }

  liveBounds(): Rect | null {
    const win = this.liveWindow();
    if (!win) return null;
    const b = win.getContentBounds();
    return { x: 0, y: 0, width: b.width, height: b.height };
  }

  prepContentSize(): { width: number; height: number } {
    const b = this.prepWindow()?.getContentBounds();
    return { width: b?.width ?? 0, height: b?.height ?? 0 };
  }

  isDev(): boolean {
    return isDev();
  }
}

export const windows = new JuztWindows();
