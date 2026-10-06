import { COMMANDS, matchCommands, type CommandMatch } from '../../shared/commands';
import type {
  BackgroundSpec,
  CameraConfig,
  PrivacyMask,
  Scene,
  Settings,
  SpotlightState,
  ToolId,
  WbObject,
  WbOp,
  WbStyle,
  WbTool,
  WhiteboardThemeId,
} from '../../shared/types';
import { safeFilename } from '../../shared/url';
import { store, type InkStyle, type SettingsTab } from './store';

/**
 * Every user intent from PREP.
 *
 * The main process owns the truth: actions send a request and the new state
 * comes back through an event. Nothing here writes per pointer event.
 */

let toastSeq = 0;

export const actions = {
  /* ------------------------------------------------------------------ *
   * Feedback
   * ------------------------------------------------------------------ */

  toast(message: string, tone: 'info' | 'error' = 'info'): void {
    const id = `t_${Date.now().toString(36)}_${++toastSeq}`;
    store.set((s) => ({ toasts: [...s.toasts, { id, message, tone, at: Date.now() }].slice(-3) }));
  },

  dismissToast(id: string): void {
    store.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  /* ------------------------------------------------------------------ *
   * Tabs
   * ------------------------------------------------------------------ */

  async newTab(url?: string): Promise<string> {
    return window.juzt.tabs.create({ url: url ?? 'juzt://newtab' });
  },
  async newWhiteboardTab(): Promise<string> {
    return window.juzt.tabs.create({ kind: 'whiteboard' });
  },
  async newPrivateTab(): Promise<string> {
    return window.juzt.tabs.openPrivate('juzt://newtab');
  },
  async closeTab(id: string): Promise<void> {
    await window.juzt.tabs.close(id);
  },
  async closeOthers(id: string): Promise<void> {
    await window.juzt.tabs.closeOthers(id);
  },
  async closeToRight(id: string): Promise<void> {
    await window.juzt.tabs.closeRight(id);
  },
  async reopenTab(): Promise<void> {
    const reopened = await window.juzt.tabs.reopen();
    if (!reopened) actions.toast('Nothing left to reopen');
  },
  async activateTab(id: string): Promise<void> {
    await window.juzt.tabs.activate(id);
  },
  async activateIndex(index: number): Promise<void> {
    const tab = store.getState().tabs[index];
    if (tab) await actions.activateTab(tab.id);
  },
  async duplicateTab(id: string): Promise<void> {
    await window.juzt.tabs.duplicate(id);
  },
  async pinTab(id: string, pinned: boolean): Promise<void> {
    await window.juzt.tabs.pin(id, pinned);
  },
  async muteTab(id: string, muted: boolean): Promise<void> {
    await window.juzt.tabs.mute(id, muted);
  },
  async reorderTabs(from: number, to: number): Promise<void> {
    await window.juzt.tabs.reorder(from, to);
  },
  async navigateActive(input: string): Promise<void> {
    const state = store.getState();
    const tab = selActiveWeb(state);
    if (!tab) {
      await actions.newTab(input);
      return;
    }
    const ok = await window.juzt.tabs.navigate(tab.id, input);
    if (!ok) actions.toast('Type a web address or a few words to search', 'error');
  },
  /** Palette navigation is audience-aware while a page is presented (dual mode). */
  /** Palette alias (kept for component compatibility). */
  async navigate(input: string): Promise<void> {
    return actions.navigateFromPalette(input);
  },
  async openUrl(url: string): Promise<void> {
    await actions.navigateFromPalette(url);
  },
  /** Palette alias — naming kept because the palette reads better with it. */
  async openFromPalette(input: string): Promise<void> {
    await actions.navigateFromPalette(input);
  },
  async navigateFromPalette(input: string): Promise<void> {
    const state = store.getState();
    const dual = state.settings.presentationMode === 'dual';
    const presenting = state.live?.presentation.kind === 'web';
    if (dual && presenting) {
      const ok = await window.juzt.present.navigateAudience(input);
      if (!ok) actions.toast('That address could not be opened on the audience output', 'error');
      return;
    }
    await actions.navigateActive(input);
  },
  back(): void {
    const tab = selActiveWeb(store.getState());
    if (tab) void window.juzt.tabs.back(tab.id);
  },
  forward(): void {
    const tab = selActiveWeb(store.getState());
    if (tab) void window.juzt.tabs.forward(tab.id);
  },
  reload(): void {
    const tab = selActiveWeb(store.getState());
    if (tab) void window.juzt.tabs.reload(tab.id);
  },
  hardReload(): void {
    const tab = selActiveWeb(store.getState());
    if (tab) void window.juzt.tabs.hardReload(tab.id);
  },
  stop(): void {
    const tab = selActiveWeb(store.getState());
    if (tab) void window.juzt.tabs.stop(tab.id);
  },
  async setZoom(factor: number): Promise<void> {
    const tab = selActiveWeb(store.getState());
    if (tab) await window.juzt.tabs.zoom(tab.id, factor);
    await actions.setSettings({ zoom: factor });
  },
  async adjustZoom(delta: number): Promise<void> {
    const current = store.getState().settings.zoom ?? 1;
    await actions.setZoom(Math.min(5, Math.max(0.25, Math.round((current + delta) * 100) / 100)));
  },

  /* ------------------------------------------------------------------ *
   * Present
   * ------------------------------------------------------------------ */

  async presentActive(): Promise<void> {
    const { tabs, activeTabId } = store.getState();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    if (tab.kind === 'whiteboard') await actions.presentBoard(tab.boardId);
    else await actions.presentTab(tab.id);
  },
  async presentTab(id: string): Promise<void> {
    store.set({ live: await window.juzt.present.tab(id) });
  },
  async presentBoard(boardId: string): Promise<void> {
    store.set({ live: await window.juzt.present.board(boardId) });
  },
  async stopPresenting(): Promise<void> {
    store.set({ live: await window.juzt.present.stop() });
  },
  async retryPresent(): Promise<void> {
    await actions.presentActive();
  },
  async openLiveWindow(): Promise<void> {
    await window.juzt.present.openWindow();
  },
  /**
   * "Start Presentation" — the explicit switch from the calm single window into
   * the dual (Juzt Prep + Juzt Live) composition. Nothing else in the app turns
   * the second window on, so the two surfaces can never be stacked by accident.
   */
  async startPresentation(): Promise<void> {
    store.set({ live: await window.juzt.present.start() });
  },
  async setPreview(enabled: boolean): Promise<void> {
    store.set({ previewEnabled: enabled });
    await window.juzt.present.preview(enabled);
  },

  async setPrivacy(on: boolean): Promise<void> {
    store.set({ live: await window.juzt.present.setPrivacy(on) });
  },
  async togglePrivacy(): Promise<void> {
    await actions.setPrivacy(!store.getState().live?.flags.privacy);
  },
  async setFreeze(on: boolean): Promise<void> {
    store.set({ live: await window.juzt.present.setFreeze(on) });
  },
  async toggleFreeze(): Promise<void> {
    await actions.setFreeze(!store.getState().live?.flags.frozen);
  },
  async setSpotlight(patch: Partial<SpotlightState>): Promise<void> {
    await window.juzt.effects.spotlight(patch);
  },
  async toggleSpotlight(): Promise<void> {
    await actions.setSpotlight({ on: !store.getState().live?.flags.spotlight });
  },
  async setHolding(on: boolean): Promise<void> {
    store.set({ live: await window.juzt.present.setHolding({ on }), holdingScreen: on });
  },
  async setHoldingText(text: string): Promise<void> {
    store.set({ live: await window.juzt.present.setHolding({ text }) });
  },
  async setMasks(masks: PrivacyMask[]): Promise<void> {
    store.set({ masks, live: await window.juzt.present.setMasks(masks) });
  },
  async addMask(mode: 'solid' | 'blur' = 'solid'): Promise<void> {
    const masks = store.getState().masks;
    await actions.setMasks([...masks, { id: `mask_${Date.now().toString(36)}`, x: 0.14, y: 0.16, w: 0.28, h: 0.2, mode }].slice(0, 8));
  },
  async updateMask(id: string, patch: Partial<PrivacyMask>): Promise<void> {
    await actions.setMasks(store.getState().masks.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  },
  async removeMask(id: string): Promise<void> {
    await actions.setMasks(store.getState().masks.filter((m) => m.id !== id));
  },
  toggleClean(): void {
    store.set({ cleanMode: !store.getState().cleanMode });
  },

  /* ------------------------------------------------------------------ *
   * Ink (website annotation — the overlay renderer owns the model)
   * ------------------------------------------------------------------ */

  setTool(tool: ToolId): void {
    store.set({ tool });
    void window.juzt.ui.state({ tool, inkLayer: store.getState().inkCount > 0 });
  },
  setInk(patch: Partial<{ color: string; size: number; opacity: number; fontSize: number }>): void {
    store.set((s) => ({ ink: { ...s.ink, ...patch } }));
    actions.pushInkUi();
  },
  nudgeInkSize(delta: number): void {
    store.set((s) => ({ ink: { ...s.ink, size: Math.min(80, Math.max(1, s.ink.size + delta)) } }));
    actions.pushInkUi();
  },
  /**
   * Tell main what the card overlay should do.
   *
   * Electron 31 has no per-view click-through (`setIgnoreMouseEvents` exists on
   * windows only), so the overlay is *shown* exactly when it must capture the
   * pointer: a drawing tool is active, committed ink has to be visible, the
   * teacher is repositioning the camera, or an audience effect is on the card.
   * The moment none of that is true the view is hidden and the website gets its
   * normal mouse behaviour back, untouched.
   */
  pushInkUi(): void {
    const s = store.getState();
    void window.juzt.ui.state({
      tool: s.tool,
      inkLayer: s.inkCount > 0 || s.masks.length > 0 || !!s.live?.flags.spotlight,
      cover: s.holdingScreen && s.settings.presentationMode === 'single',
      style: { color: s.ink.color, size: s.ink.size, opacity: s.ink.opacity, fontSize: s.ink.fontSize },
      number: s.inkCount + 1,
      cameraDrag: s.cameraDrag,
    });
  },
  /**
   * "Reposition the camera" mode: while it is on, the overlay keeps the mouse so
   * the preview can be dragged over a live page. Turning it off hands the mouse
   * straight back to the website.
   */
  setCameraDrag(on: boolean): void {
    store.set({ cameraDrag: on });
    actions.pushInkUi();
    if (on) store.set({ tool: 'cursor' });
  },
  inkCommand(cmd: 'undo' | 'redo' | 'clear'): void {
    void window.juzt.ink.command(cmd);
  },

  /* ------------------------------------------------------------------ *
   * Whiteboard
   * ------------------------------------------------------------------ */

  /** Single-op convenience wrapper used by the editor. */
  async wbOp(boardId: string, ops: WbOp[]): Promise<void> {
    return actions.wbOps(boardId, ops);
  },
  setWbView(boardId: string, view: { x: number; y: number; zoom: number }): void {
    store.set((s) => ({ wbView: { ...s.wbView, [boardId]: view } }));
  },
  async wbOps(boardId: string, ops: WbOp[]): Promise<void> {
    const result = await window.juzt.boards.ops(boardId, ops);
    store.set({ wbCanUndo: result.canUndo, wbCanRedo: result.canRedo });
  },
  async wbUndo(boardId?: string | null): Promise<void> {
    const id = boardId ?? selActiveBoardId(store.getState());
    if (!id) return;
    const result = await window.juzt.boards.undo(id);
    store.set({ wbCanUndo: result.canUndo, wbCanRedo: result.canRedo });
  },
  async wbRedo(boardId?: string | null): Promise<void> {
    const id = boardId ?? selActiveBoardId(store.getState());
    if (!id) return;
    const result = await window.juzt.boards.redo(id);
    store.set({ wbCanUndo: result.canUndo, wbCanRedo: result.canRedo });
  },
  async wbClear(boardId: string): Promise<void> {
    await actions.wbOps(boardId, [{ type: 'clear' }]);
  },
  setWbTool(tool: WbTool): void {
    store.set({ wbTool: tool });
  },
  setWbStyle(patch: Partial<InkStyle & { width?: number; fill?: string }>): void {
    store.set((s) => ({ wbStyle: { ...s.wbStyle, ...patch } }));
  },
  setWbSelection(ids: string[]): void {
    store.set({ wbSelection: ids });
  },
  async wbSetTheme(boardId: string, theme: WhiteboardThemeId): Promise<void> {
    await actions.wbOps(boardId, [{ type: 'theme', theme }]);
  },
  async wbRename(boardId: string, name: string): Promise<void> {
    const doc = await window.juzt.boards.rename(boardId, name);
    if (doc) store.set((s) => ({ boardDocs: { ...s.boardDocs, [boardId]: doc }, boards: s.boards.map((b) => (b.id === boardId ? { ...b, name: doc.name } : b)) }));
  },
  async wbImportImage(boardId: string, at?: { x: number; y: number }): Promise<void> {
    return actions.wbInsertImage(boardId, at);
  },
  async wbInsertImage(boardId: string, at?: { x: number; y: number }): Promise<void> {
    const picked = await window.juzt.boards.pickImage();
    if (!picked) return;
    const doc = store.getState().boardDocs[boardId];
    const maxSide = 900;
    const scale = Math.min(1, maxSide / Math.max(picked.naturalW, picked.naturalH));
    const w = Math.round(picked.naturalW * scale);
    const h = Math.round(picked.naturalH * scale);
    const object: WbObject = {
      id: `img_${Date.now().toString(36)}`,
      z: (doc?.objects.reduce((m, o) => Math.max(m, o.z), 0) ?? 0) + 1,
      kind: 'image',
      x: Math.round((at?.x ?? 0) - w / 2),
      y: Math.round((at?.y ?? 0) - h / 2),
      w,
      h,
      src: picked.dataUrl,
      naturalW: picked.naturalW,
      naturalH: picked.naturalH,
    };
    await actions.wbOps(boardId, [{ type: 'add', objects: [object] }]);
  },
  async exportBoard(boardId: string, mode: 'view' | 'all' = 'all'): Promise<void> {
    return actions.wbExport(boardId, mode);
  },
  async wbExport(boardId: string, mode: 'view' | 'all' = 'all'): Promise<void> {
    const doc = store.getState().boardDocs[boardId] ?? (await window.juzt.boards.get(boardId));
    if (!doc) return;
    const { renderBoardPng } = await import('../whiteboard/export');
    const png = await renderBoardPng(doc, mode);
    if (!png) {
      actions.toast('Nothing to export yet', 'error');
      return;
    }
    const saved = await window.juzt.boards.exportPng(png, safeFilename(doc.name, 'png'));
    if (saved) actions.toast(`Exported ${saved}`);
  },
  async createBoard(name?: string): Promise<string> {
    const doc = await window.juzt.boards.create(name);
    store.set((s) => ({ boardDocs: { ...s.boardDocs, [doc.id]: doc } }));
    return doc.id;
  },
  async openBoard(boardId: string): Promise<void> {
    await window.juzt.boards.openInPrep(boardId);
  },
  async deleteBoard(boardId: string): Promise<void> {
    await window.juzt.boards.remove(boardId);
    store.set((s) => ({ boards: s.boards.filter((b) => b.id !== boardId) }));
  },
  async removeBackground(filePath: string): Promise<void> {
    void filePath;
    actions.toast('Removed from the library');
  },

  /* ------------------------------------------------------------------ *
   * Backgrounds
   * ------------------------------------------------------------------ */

  async pickBackground(target: 'live' | 'holding' | 'privacy'): Promise<void> {
    const picked = await window.juzt.backgrounds.pick({ video: true, image: true });
    if (!picked) return;
    await actions.applyBackground(target, {
      kind: picked.kind === 'video' ? 'video' : 'image',
      path: picked.path,
      fit: 'cover',
      loop: true,
      muted: true,
      volume: 0,
      rate: 1,
    });
  },
  async applyBackground(target: 'live' | 'holding' | 'privacy', spec: BackgroundSpec): Promise<void> {
    store.set({ settings: await window.juzt.backgrounds.apply(target, spec) });
  },
  async addPreset(name: string, spec: BackgroundSpec): Promise<void> {
    await window.juzt.backgrounds.libraryAdd(name, spec);
    store.set({ settings: await window.juzt.setSettings({}) });
  },
  async renamePreset(id: string, name: string): Promise<void> {
    await window.juzt.backgrounds.libraryRename(id, name);
    store.set({ settings: await window.juzt.setSettings({}) });
  },
  async removePreset(id: string): Promise<void> {
    await window.juzt.backgrounds.libraryRemove(id);
    store.set({ settings: await window.juzt.setSettings({}) });
  },
  async pickImageOnly(target: 'live' | 'holding' | 'privacy'): Promise<void> {
    const picked = await window.juzt.backgrounds.pick({ video: false, image: true });
    if (!picked) return;
    await actions.applyBackground(target, { kind: 'image', path: picked.path, fit: 'cover', dim: 0 });
  },

  /* ------------------------------------------------------------------ *
   * Scenes
   * ------------------------------------------------------------------ */

  async saveScene(name: string): Promise<void> {
    const s = store.getState();
    const scene: Scene = {
      id: `scene_${Date.now().toString(36)}`,
      name: name.slice(0, 60) || `Scene ${s.scenes.length + 1}`,
      liveBackground: s.settings.liveBackground,
      holdingBackground: s.settings.holdingBackground,
      privacyBackground: s.settings.privacyBackground,
      holdingText: s.settings.holdingText,
      privacyTitle: s.settings.privacyTitle,
      privacySubtitle: s.settings.privacySubtitle,
      card: s.settings.card,
      sizePreset: s.settings.sizePreset,
      customScale: s.settings.customScale,
      layout: s.settings.layout,
      zoom: s.settings.zoom,
      spotlight: s.spotlight,
      masks: s.masks,
      outputDisplayId: s.settings.outputDisplayId,
    };
    store.set({ scenes: await window.juzt.scenes.save(scene) });
    actions.toast(`Scene “${scene.name}” saved`);
  },
  async applyScene(id: string): Promise<void> {
    const result = await window.juzt.scenes.apply(id);
    if (!result) return;
    store.set({ settings: result.settings, activeSceneId: result.scene.id, spotlight: result.scene.spotlight, masks: result.scene.masks });
  },
  async deleteScene(id: string): Promise<void> {
    store.set({ scenes: await window.juzt.scenes.remove(id) });
  },

  /* ------------------------------------------------------------------ *
   * Favorites / history
   * ------------------------------------------------------------------ */

  async toggleFavorite(): Promise<void> {
    const tab = selActiveWeb(store.getState());
    if (!tab || tab.url.startsWith('juzt://')) {
      actions.toast('Open a website first', 'error');
      return;
    }
    store.set({ favorites: await window.juzt.favorites.add(tab.url, tab.title, tab.favicon) });
    actions.toast('Added to favorites');
  },
  async removeFavorite(id: string): Promise<void> {
    store.set({ favorites: await window.juzt.favorites.remove(id) });
  },
  async toggleFavoriteUrl(url: string, title: string): Promise<void> {
    const s = store.getState();
    const existing = s.favorites.find((f) => f.url === url);
    if (existing) await actions.removeFavorite(existing.id);
    else store.set({ favorites: await window.juzt.favorites.add(url, title) });
  },
  async clearHistory(): Promise<void> {
    await window.juzt.history.clear();
    store.set({ history: [] });
  },
  async removeHistory(id: string): Promise<void> {
    await window.juzt.history.remove(id);
    store.set((s) => ({ history: s.history.filter((h) => h.id !== id) }));
  },

  /* ------------------------------------------------------------------ *
   * Settings / UI
   * ------------------------------------------------------------------ */

  async setSettings(patch: Partial<Settings>): Promise<void> {
    store.set({ settings: await window.juzt.setSettings(patch) });
  },
  openSettings(tab: SettingsTab = 'presentation'): void {
    store.set({ settingsOpen: true, settingsTab: tab });
  },
  closeSettings(): void {
    store.set({ settingsOpen: false });
  },
  setSettingsTab(tab: SettingsTab): void {
    store.set({ settingsTab: tab });
  },
  setSettingsOpen(open: boolean, tab?: SettingsTab): void {
    store.set({ settingsOpen: open, ...(tab ? { settingsTab: tab } : {}) });
  },
  /* ------------------------------------------------------------------ *
   * Website compatibility + extensions (PREP only)
   * ------------------------------------------------------------------ */

  /** Pull the private engine report. Never called from LIVE. */
  async refreshCompat(): Promise<void> {
    const info = await window.juzt.compat.info();
    store.set({ compatInfo: info });
  },
  async refreshExtensions(): Promise<void> {
    store.set({ extensions: await window.juzt.extensions.list() });
  },
  async setWebUserAgent(mode: 'clean' | 'app' | 'electron'): Promise<void> {
    store.set({ settings: await window.juzt.setSettings({ webUserAgent: mode }) });
    await actions.refreshCompat();
  },
  async setSiteCompat(origin: string, mode: 'clean' | 'app' | 'electron'): Promise<void> {
    if (!(await window.juzt.compat.setSite(origin, mode))) return;
    await actions.setSettings({});
    await actions.refreshCompat();
  },
  async resetSiteCompat(origin: string): Promise<void> {
    await window.juzt.compat.resetSite(origin);
    await actions.setSettings({});
    await actions.refreshCompat();
    actions.toast(`Reset compatibility settings for ${origin}`);
  },
  async clearSiteData(origin: string): Promise<{ ok: boolean; error?: string }> {
    return window.juzt.compat.clearSiteData(origin);
  },
  async setSafeMode(on: boolean): Promise<void> {
    await window.juzt.extensions.setSafeMode(on);
    await actions.setSettings({});
    await actions.refreshCompat();
  },
  async setExtensionDevMode(on: boolean): Promise<void> {
    await actions.setSettings({ extensionDevMode: on });
  },
  async pickExtension(): Promise<void> {
    const result = await window.juzt.extensions.pick();
    if (result && 'error' in result) {
      if (result.error !== 'cancelled') actions.toast(result.error, 'error');
      return;
    }
    await actions.refreshExtensions();
    await actions.refreshCompat();
    if (result && 'name' in result) actions.toast(`Loaded ${result.name}`);
  },
  async addExtension(dir: string): Promise<void> {
    const result = await window.juzt.extensions.add(dir);
    if ('error' in result) {
      actions.toast(result.error, 'error');
      return;
    }
    await actions.refreshExtensions();
    await actions.refreshCompat();
    actions.toast(`Loaded ${result.name}`);
  },
  async enableExtension(id: string): Promise<void> {
    await window.juzt.extensions.enable(id);
    await actions.refreshExtensions();
    await actions.refreshCompat();
  },
  async disableExtension(id: string): Promise<void> {
    await window.juzt.extensions.disable(id);
    await actions.refreshExtensions();
    await actions.refreshCompat();
  },
  async reloadExtension(id: string): Promise<void> {
    await window.juzt.extensions.reload(id);
    await actions.refreshExtensions();
    actions.toast('Extension reloaded');
  },
  async openExtensionOptions(id: string): Promise<void> {
    const result = await window.juzt.extensions.openOptions(id);
    if (!result.ok) actions.toast(result.error ?? 'No options page.', 'error');
  },
  async removeExtension(id: string): Promise<void> {
    await window.juzt.extensions.remove(id);
    await actions.refreshExtensions();
    await actions.refreshCompat();
  },
  /** Pause every loaded extension without losing the approved list. */
  async disableAllExtensions(): Promise<void> {
    await window.juzt.extensions.disableAll();
    await actions.refreshExtensions();
    await actions.refreshCompat();
    actions.toast('All extensions paused. Your list is kept.');
  },
  toggleExtensionsMenu(): void {
    const open = !store.getState().extensionsOpen;
    store.set({ extensionsOpen: open });
    if (open) void actions.refreshExtensions();
  },
  closeExtensionsMenu(): void {
    store.set({ extensionsOpen: false });
  },

  finishOnboarding(): void {
    store.set({ onboardOpen: false });
    void actions.setSettings({ firstRunDone: true });
  },
  toggleNotes(): void {
    store.set((s) => ({ notesOpen: !s.notesOpen }));
  },
  setNotes(notes: string): void {
    store.set({ notes });
  },
  toggleScenes(): void {
    store.set((s) => ({ scenesOpen: !s.scenesOpen }));
  },
  toggleCamera(): void {
    store.set((s) => ({ cameraOpen: !s.cameraOpen }));
  },
  toggleDiagnostics(): void {
    const open = !store.getState().diagOpen;
    store.set({ diagOpen: open });
    void window.juzt.diagnostics.enable(open);
  },
  setTimerMode(mode: 'off' | 'stopwatch' | 'countdown'): void {
    store.set((s) => ({ timer: { ...s.timer, mode, running: false, base: 0, since: performance.now() } }));
  },
  toggleTimer(): void {
    store.set((s) => {
      const now = performance.now();
      const timer = s.timer;
      const base = timer.running ? timer.base + (now - timer.since) : timer.base;
      return { timer: { ...timer, running: !timer.running, base, since: now } };
    });
  },
  resetTimer(): void {
    store.set((s) => ({ timer: { ...s.timer, base: 0, since: performance.now() } }));
  },

  async setCamera(patch: Partial<CameraConfig>): Promise<void> {
    const camera = await window.juzt.effects.camera(patch);
    store.set((s) => ({ settings: { ...s.settings, camera } }));
  },
  async setOutputDisplay(id: number | null): Promise<void> {
    store.set({ displays: await window.juzt.displays.setOutput(id) });
  },

  /* ------------------------------------------------------------------ *
   * Permissions
   * ------------------------------------------------------------------ */

  async respondPermission(id: string, granted: boolean, remember: boolean): Promise<void> {
    await window.juzt.permissions.respond({ id, granted, remember });
    store.set({ permission: undefined });
  },
  async pickScreenSource(id: string | null): Promise<void> {
    const requestId = store.getState().sourceRequestId;
    if (!requestId) return;
    await window.juzt.permissions.pickSource({ requestId, id });
    store.set({ screenSources: undefined, sourceRequestId: undefined });
  },

  /* ------------------------------------------------------------------ *
   * Palette + commands
   * ------------------------------------------------------------------ */

  openPalette(): void {
    // Never prefill with the current address (Ctrl+L must not reveal where the
    // teacher or the audience is); suggestions carry the context instead.
    store.set({ paletteOpen: true, paletteValue: '' });
  },
  closePalette(): void {
    store.set({ paletteOpen: false, paletteValue: '' });
  },
  setPaletteValue(value: string): void {
    store.set({ paletteValue: value });
  },
  suggest(input: string): CommandMatch[] {
    return matchCommands(input);
  },
  /** Run `>command args` or navigate to an address / search term. */
  async runPalette(value: string): Promise<void> {
    const text = value.trim();
    if (!text) return;
    actions.closePalette();
    if (text.startsWith('>')) {
      const body = text.slice(1).trim();
      const [name, ...rest] = body.split(/\s+/);
      await actions.runCommand(name, rest.join(' '));
      return;
    }
    await actions.navigateFromPalette(text);
  },
  async runCommand(name: string, args: string): Promise<void> {
    const spec = COMMANDS.find((c) => c.name === name);
    if (!spec) {
      actions.toast(`Unknown command “${name}”`, 'error');
      return;
    }
    const s = store.getState();
    const arg = args.trim();
    switch (spec.name) {
      case 'present':
        await actions.presentActive();
        break;
      case 'stop':
        await actions.stopPresenting();
        break;
      case 'privacy':
        await actions.setPrivacy(arg ? arg === 'on' : !s.live?.flags.privacy);
        break;
      case 'freeze':
        await actions.setFreeze(arg ? arg === 'on' : !s.live?.flags.frozen);
        break;
      case 'spotlight':
        await actions.setSpotlight({ on: arg ? arg === 'on' : !s.live?.flags.spotlight });
        break;
      case 'holding':
        await actions.setHolding(arg ? arg === 'on' : true);
        break;
      case 'clean':
        actions.toggleClean();
        break;
      case 'layout':
        if (arg) await actions.setSettings({ layout: arg as Settings['layout'] });
        break;
      case 'size':
        if (arg) await actions.setSettings({ sizePreset: arg as Settings['sizePreset'] });
        break;
      case 'radius':
        if (arg) await actions.setSettings({ card: { ...s.settings.card, radius: Number(arg) as Settings['card']['radius'] } });
        break;
      case 'theme': {
        const boardId = selActiveBoardId(s);
        if (arg && boardId) await actions.wbSetTheme(boardId, arg as WhiteboardThemeId);
        break;
      }
      case 'background':
        await actions.pickBackground(arg === 'holding' || arg === 'privacy' ? arg : 'live');
        break;
      case 'board': {
        const id = await actions.createBoard(arg || undefined);
        await actions.openBoard(id);
        break;
      }
      case 'scene':
        if (arg === 'save') await actions.saveScene(`Scene ${s.scenes.length + 1}`);
        else {
          const scene = s.scenes[Number(arg) - 1];
          if (scene) await actions.applyScene(scene.id);
        }
        break;
      case 'export': {
        const boardId = selActiveBoardId(s);
        if (boardId) await actions.wbExport(boardId, arg === 'view' ? 'view' : 'all');
        break;
      }
      case 'zoom':
        if (arg) await actions.setZoom(Number(arg) / 100);
        break;
      case 'fullscreen':
        await window.juzt.window.setFullscreen(true);
        break;
      case 'notes':
        store.set({ notesOpen: true });
        break;
      case 'camera':
        store.set({ cameraOpen: true });
        break;
      case 'settings':
        actions.openSettings();
        break;
      case 'safe mode':
        await actions.setSafeMode(arg ? arg === 'on' : !s.settings.safeMode);
        break;
      case 'extensions':
        actions.openSettings('extensions');
        break;
      case 'diagnostics':
        actions.toggleDiagnostics();
        break;
      case 'quit':
        await window.juzt.quit();
        break;
      default:
        actions.toast(`“${name}” is not wired up yet`, 'error');
        break;
    }
  },
};

function selActiveWeb(state: ReturnType<typeof store.getState>) {
  const tab = state.tabs.find((t) => t.id === state.activeTabId);
  return tab && tab.kind === 'web' ? tab : null;
}

function selActiveBoardId(state: ReturnType<typeof store.getState>): string | null {
  const tab = state.tabs.find((t) => t.id === state.activeTabId);
  return tab && tab.kind === 'whiteboard' ? tab.boardId : null;
}

export type Actions = typeof actions;
