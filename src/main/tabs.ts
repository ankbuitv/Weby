import { WebContentsView } from 'electron';
import { EMPTY_TABS, activate, activateIndex, activateNumber, closeOthers, closeTab as closeInList, closeToRight, cycle, insertIndexFor, openTab, reopen as reopenInList, reorder as reorderInList, setPinned, updateTab, type TabList } from '../shared/tabs';
import { tabLabel, type TabState, type WebTab, type WbView } from '../shared/types';
import { hostOf, isInternalPage, resolveInput } from '../shared/url';

/**
 * Tab bookkeeping + one WebContentsView per web tab.
 *
 * Placement is deliberately NOT done here — main/app.ts owns the geometry and
 * windows.ts is the only place `setBounds` is ever called. This class only:
 *   • keeps the tab list (order, pins, active id, reopen stack);
 *   • creates/destroys views lazily so background tabs cost nothing;
 *   • reflects navigation back into the tab record (title, favicon, history);
 *   • exposes `view(id)` for the router.
 *
 * Discarded tabs keep their record but lose their view: switching back reloads.
 */

export interface TabEvents {
  /** Tab metadata changed; `structure` means order/ids/active changed too. */
  onChanged(changed: TabState[], structure: boolean): void;
  /** A main-frame navigation finished — PREP-only history, never sent to LIVE. */
  onVisited(entry: { url: string; title: string }): void;
  onViewsChanged(): void;
  onToast(message: string, tone?: 'info' | 'error'): void;
}

const DISCARD_AFTER_MS = 10 * 60 * 1000;

export class TabManager {
  list: TabList = { ...EMPTY_TABS, tabs: [] };

  private views = new Map<string, WebContentsView>();
  private session: Electron.Session;
  private events: TabEvents;
  private lastActive = new Map<string, number>();
  private zoomFactor = 1;
  private pending = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(session: Electron.Session, events: TabEvents) {
    this.session = session;
    this.events = events;
  }

  /* ------------------------------------------------------------------ *
   * Queries
   * ------------------------------------------------------------------ */

  get tabs(): TabState[] {
    return this.list.tabs;
  }

  get(id: string | null | undefined): TabState | null {
    if (!id) return null;
    return this.list.tabs.find((t) => t.id === id) ?? null;
  }

  active(): TabState | null {
    return this.get(this.list.activeId);
  }

  view(id: string): WebContentsView | null {
    const view = this.views.get(id);
    return view && !view.webContents.isDestroyed() ? view : null;
  }

  /** Views of web tabs (the router walks these). */
  webTabs(): { tab: WebTab; view: WebContentsView | null }[] {
    return this.list.tabs
      .filter((t): t is WebTab => t.kind === 'web')
      .map((tab) => ({ tab, view: this.view(tab.id) }));
  }

  /* ------------------------------------------------------------------ *
   * Lifecycle
   * ------------------------------------------------------------------ */

  restore(initial: TabList): void {
    this.list = { ...initial, tabs: initial.tabs.filter((t) => t.kind !== 'web' || !isInternalPage(t.url)) };
    if (!this.list.tabs.length) this.create({ url: 'juzt://newtab', activate: true });
    const active = this.get(this.list.activeId) ?? this.list.tabs[0];
    if (active) this.activate(active.id);
  }

  create(opts: { url?: string; kind?: 'web' | 'whiteboard'; boardId?: string; name?: string; activate?: boolean; pinned?: boolean; background?: boolean }): TabState {
    const activateIt = opts.activate ?? !opts.background;
    const id = `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    let tab: TabState;
    if (opts.kind === 'whiteboard') {
      tab = {
        id,
        kind: 'whiteboard',
        boardId: opts.boardId ?? `board_${Date.now().toString(36)}`,
        name: opts.name ?? 'Whiteboard',
        pinned: opts.pinned ?? false,
      };
    } else {
      const url = opts.url && opts.url.length ? opts.url : 'juzt://newtab';
      tab = {
        id,
        kind: 'web',
        title: isInternalPage(url) ? 'New Tab' : hostOf(url) || url,
        url,
        loading: false,
        canGoBack: false,
        canGoForward: false,
        muted: false,
        audible: false,
        pinned: opts.pinned ?? false,
        discarded: false,
      };
    }
    this.list = openTab(this.list, tab, { activate: activateIt });
    if (activateIt) this.lastActive.set(id, Date.now());
    this.events.onChanged([tab], true);
    if (activateIt) this.ensureLoaded(id);
    return tab;
  }

  close(id: string): void {
    const tab = this.get(id);
    if (!tab) return;
    const wasActive = this.list.activeId === id;
    this.list = closeInList(this.list, id);
    this.destroyView(id);
    this.events.onChanged([tab], true);
    if (wasActive) this.ensureLoaded(this.list.activeId);
  }

  closeOthers(id: string): void {
    for (const tab of this.list.tabs) if (tab.id !== id) this.destroyView(tab.id);
    this.list = closeOthers(this.list, id);
    this.events.onChanged(this.list.tabs, true);
    this.ensureLoaded(id);
  }

  closeRight(id: string): void {
    for (const tab of this.list.tabs.slice(this.list.tabs.findIndex((t) => t.id === id) + 1)) this.destroyView(tab.id);
    this.list = closeToRight(this.list, id);
    this.events.onChanged(this.list.tabs, true);
    this.ensureLoaded(this.list.activeId);
  }

  activate(id: string): void {
    if (!this.get(id)) return;
    this.lastActive.set(id, Date.now());
    this.list = activate(this.list, id);
    this.events.onChanged([this.get(id) as TabState], true);
    this.ensureLoaded(id);
  }

  activateIndex(index: number): void {
    this.list = activateIndex(this.list, index);
    const active = this.active();
    if (active) {
      this.lastActive.set(active.id, Date.now());
      this.events.onChanged([active], true);
      this.ensureLoaded(active.id);
    }
  }

  activateNumber(n: number): void {
    this.list = activateNumber(this.list, n);
    const active = this.active();
    if (active) {
      this.lastActive.set(active.id, Date.now());
      this.events.onChanged([active], true);
      this.ensureLoaded(active.id);
    }
  }

  cycle(delta: number): void {
    this.list = cycle(this.list, delta);
    const active = this.active();
    if (active) {
      this.events.onChanged([active], true);
      this.ensureLoaded(active.id);
    }
  }

  reorder(from: number, to: number): void {
    this.list = reorderInList(this.list, from, to);
    this.events.onChanged([], true);
  }

  reopen(): TabState | null {
    const { list, record } = reopenInList(this.list);
    this.list = list;
    if (!record) return null;
    // Recreate the tab from the record (a closed tab keeps no id)…
    const tab =
      record.kind === 'whiteboard'
        ? this.create({ kind: 'whiteboard', boardId: record.boardId, name: record.title, activate: true, pinned: record.pinned })
        : this.create({ url: record.url, activate: true, pinned: record.pinned });
    // …and put it back where it was, the way Ctrl+Shift+T is expected to behave.
    const from = this.list.tabs.findIndex((t) => t.id === tab.id);
    const to = Math.max(0, Math.min(record.index, this.list.tabs.length - 1));
    if (from >= 0 && from !== to) {
      this.list = reorderInList(this.list, from, to);
      this.events.onChanged([tab], true);
    }
    return tab;
  }

  duplicate(id: string): TabState | null {
    const tab = this.get(id);
    if (!tab) return null;
    if (tab.kind === 'whiteboard') return this.create({ kind: 'whiteboard', boardId: tab.boardId, name: tab.name, activate: true });
    if (isInternalPage(tab.url)) return this.create({ url: tab.url, activate: true });
    return this.create({ url: tab.url, activate: true });
  }

  pin(id: string, pinned: boolean): void {
    const tab = this.get(id);
    if (tab?.kind === 'whiteboard') {
      this.list = { ...this.list, tabs: this.list.tabs.map((t) => (t.id === id ? { ...t, pinned } : t)) };
    } else {
      this.list = setPinned(this.list, id, pinned);
    }
    this.events.onChanged([this.get(id) as TabState], true);
  }

  mute(id: string, muted: boolean): void {
    const view = this.view(id);
    if (view) view.webContents.setAudioMuted(muted);
    this.patch(id, { muted });
  }

  /** Move an existing tab (used when a board is opened from the library). */
  setUrl(id: string, url: string): void {
    this.patch(id, { url, title: hostOf(url) || url, loading: true, error: undefined });
  }

  setZoom(id: string, factor: number): void {
    this.zoomFactor = Math.min(5, Math.max(0.25, factor));
    const view = this.view(id);
    if (view) view.webContents.setZoomFactor(this.zoomFactor);
  }

  /** Apply the current zoom to every live view (called after settings change). */
  applyZoomAll(factor: number): void {
    this.zoomFactor = factor;
    for (const [, view] of this.views) view.webContents.setZoomFactor(factor);
  }

  /* ------------------------------------------------------------------ *
   * Navigation
   * ------------------------------------------------------------------ */

  navigate(id: string, input: string): boolean {
    const tab = this.get(id);
    if (!tab || tab.kind !== 'web') return false;
    const url = isInternalPage(input) ? input : resolveInput(input, { search: true });
    if (!url) {
      this.events.onToast('That address cannot be opened safely', 'error');
      return false;
    }
    if (isInternalPage(url)) {
      // Internal pages are rendered by the PREP UI: never load them in a view.
      this.destroyView(id);
      this.patch(id, { url, title: internalTitle(url), loading: false, canGoBack: false, canGoForward: false, error: undefined });
      return true;
    }
    const view = this.ensureView(id);
    if (!view) return false;
    this.patch(id, { url, loading: true, error: undefined });
    void view.webContents.loadURL(url).catch(() => this.onLoadFailed(id, 'Navigation failed'));
    return true;
  }

  back(id: string): void {
    const view = this.view(id);
    if (view?.webContents.canGoBack()) view.webContents.goBack();
  }

  forward(id: string): void {
    const view = this.view(id);
    if (view?.webContents.canGoForward()) view.webContents.goForward();
  }

  reload(id: string, hard: boolean): void {
    const view = this.view(id);
    if (view) {
      if (hard) view.webContents.reloadIgnoringCache();
      else view.webContents.reload();
    }
  }

  stop(id: string): void {
    this.view(id)?.webContents.stop();
  }

  /** Called when the presented tab is duplicated/opened in the audience window. */
  urlOf(id: string): string | null {
    const tab = this.get(id);
    return tab && tab.kind === 'web' ? tab.url : null;
  }

  /* ------------------------------------------------------------------ *
   * Views
   * ------------------------------------------------------------------ */

  /** Ensure the view exists and is loading the tab URL (called on activation). */
  ensureLoaded(id: string | null): void {
    if (!id) return;
    const tab = this.get(id);
    if (!tab || tab.kind !== 'web' || isInternalPage(tab.url)) return;
    const view = this.ensureView(id);
    if (!view) return;
    const wc = view.webContents;
    if (wc.isLoading() || wc.getURL()) return;
    void wc.loadURL(tab.url).catch(() => this.onLoadFailed(id, 'The page could not be loaded'));
  }

  private ensureView(id: string): WebContentsView | null {
    const existing = this.view(id);
    if (existing) return existing;
    const tab = this.get(id);
    if (!tab || tab.kind !== 'web' || isInternalPage(tab.url)) return null;

    const view = new WebContentsView({
      webPreferences: {
        session: this.session,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        // Only the visible tab needs full-rate rendering; the router hides the rest.
        backgroundThrottling: true,
        preload: undefined,
        safeDialogs: true,
        disableDialogs: false,
      },
    });
    view.setBackgroundColor('#ffffff');
    this.views.set(id, view);
    const wc = view.webContents;
    wc.setZoomFactor(this.zoomFactor);
    wc.setWindowOpenHandler(({ url }) => {
      const target = resolveInput(url, { search: false });
      if (target && !isInternalPage(target)) this.create({ url: target, background: true });
      else this.events.onToast('That link was blocked for safety', 'error');
      return { action: 'deny' };
    });
    wc.on('will-navigate', (event, url) => {
      if (isInternalPage(url) || url.startsWith('about:blank')) return;
      if (!/^https?:\/\//i.test(url)) {
        event.preventDefault();
        this.events.onToast('Only http(s) links can be opened', 'error');
      }
    });

    wc.on('did-start-loading', () => this.patch(id, { loading: true, error: undefined }));
    wc.on('did-stop-loading', () => this.patch(id, { loading: false }));
    wc.on('did-navigate', (_e, url, statusCode) => {
      this.patch(id, {
        url,
        title: wc.getTitle() || hostOf(url) || url,
        canGoBack: wc.canGoBack(),
        canGoForward: wc.canGoForward(),
        error: statusCode >= 400 ? `HTTP ${statusCode}` : undefined,
      });
      this.recordVisit(url, wc.getTitle());
    });
    wc.on('did-navigate-in-page', (_e, url, isMain) => {
      if (!isMain) return;
      this.patch(id, { url, canGoBack: wc.canGoBack(), canGoForward: wc.canGoForward() });
      this.recordVisit(url, wc.getTitle());
    });
    wc.on('page-title-updated', () => this.patch(id, { title: wc.getTitle() }));
    wc.on('page-favicon-updated', (_e, favicons) => {
      if (favicons[0]) this.patch(id, { favicon: favicons[0] });
    });
    wc.on('media-started-playing', () => this.patch(id, { audible: wc.isCurrentlyAudible() }));
    wc.on('media-paused', () => this.patch(id, { audible: false }));
    wc.on('audio-state-changed', () => this.patch(id, { audible: wc.isCurrentlyAudible() }));
    wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      if (!isMainFrame || code === -3) return; // -3 = user aborted
      this.onLoadFailed(id, `${desc || 'Load failed'} (${code})`, url);
    });
    wc.on('render-process-gone', () => {
      this.patch(id, { loading: false, error: 'The page stopped responding — reload the tab', discarded: true });
      this.destroyView(id);
    });
    wc.on('enter-html-full-screen', () => undefined);
    this.views.set(id, view);
    this.events.onViewsChanged();
    return view;
  }

  private onLoadFailed(id: string, message: string, url?: string): void {
    const tab = this.get(id);
    if (!tab || tab.kind !== 'web') return;
    // Never let a dead address sit in the "presented" position by accident: the
    // audience keeps the last valid frame and PREP shows a retry affordance.
    this.patch(id, { loading: false, error: message, url: url && url.startsWith('http') ? url : tab.url });
  }

  destroyView(id: string): void {
    const view = this.views.get(id);
    this.views.delete(id);
    if (view) {
      try {
        view.webContents.removeAllListeners();
        view.webContents.close();
      } catch {
        /* already gone */
      }
      this.events.onViewsChanged();
    }
  }

  private patch(id: string, patch: Partial<WebTab>): void {
    this.list = updateTab(this.list, id, patch as Partial<TabState>);
    const tab = this.get(id);
    if (tab) this.events.onChanged([tab], false);
  }

  private recordVisit(url: string, title: string): void {
    if (!url || isInternalPage(url) || url.startsWith('about:') || url.startsWith('devtools:')) return;
    this.events.onVisited({ url, title: title || hostOf(url) || url });
  }

  /* ------------------------------------------------------------------ *
   * Memory: discard background tabs, but never the active or presented one
   * ------------------------------------------------------------------ */

  startSweeper(protectedId: () => string | null): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      const keep = protectedId();
      const now = Date.now();
      for (const tab of this.list.tabs) {
        if (tab.kind !== 'web' || tab.pinned || tab.id === this.list.activeId || tab.id === keep) continue;
        if (!this.views.has(tab.id)) continue;
        const seen = this.lastActive.get(tab.id) ?? 0;
        if (now - seen < DISCARD_AFTER_MS) continue;
        this.destroyView(tab.id);
        this.patch(tab.id, { discarded: true, loading: false });
        break; // one per tick keeps this free
      }
    }, 60_000);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    for (const id of [...this.views.keys()]) this.destroyView(id);
  }

  clearPending(): void {
    this.pending.clear();
  }

  /** Kept for the router: pending navigations are resolved by load events. */
  isPending(id: string): boolean {
    return this.pending.has(id);
  }

  /** Called by the router when a board tab resolves its board id. */
  setBoardName(id: string, name: string): void {
    this.list = { ...this.list, tabs: this.list.tabs.map((t) => (t.id === id && t.kind === 'whiteboard' ? { ...t, name } : t)) };
    const tab = this.get(id);
    if (tab) this.events.onChanged([tab], false);
  }

  viewOf(id: string): WebContentsView | null {
    return this.view(id);
  }

  setViewZoom(view: WbView | null): void {
    void view;
  }
}

/** Convenience for callers that only have a tab record. */
export function titleOf(tab: TabState): string {
  return tabLabel(tab);
}

function internalTitle(url: string): string {
  const page = url.replace('juzt://', '');
  switch (page) {
    case 'favorites':
      return 'Favorites';
    case 'history':
      return 'History';
    case 'boards':
      return 'Whiteboards';
    case 'settings':
      return 'Settings';
    case 'about':
      return 'About Juzt';
    default:
      return 'New Tab';
  }
}

export { insertIndexFor, EMPTY_TABS };
