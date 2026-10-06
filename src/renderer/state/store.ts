import React, { useSyncExternalStore } from 'react';
import type {
  DisplayInfo,
  Favorite,
  HistoryEntry,
  LivePayload,
  PermissionRequest,
  PrivacyMask,
  PrepBootstrap,
  Scene,
  ScreenSource,
  Settings,
  SpotlightState,
  TabState,
  ToastMessage,
  ToolId,
  WbStyle,
  WbView,
  WbTool,
  WhiteboardDoc,
  WhiteboardMeta,
} from '../../shared/types';
import { tabLabel, isWebTab } from '../../shared/types';

/**
 * PREP renderer store.
 *
 * Deliberately tiny: a single snapshot object, subscribers, and a `useSel`
 * selector hook. High-frequency streams (pointer moves, live strokes, the laser
 * trail) never enter this store — they live inside the effect layers.
 */

export interface InkStyle {
  color: string;
  size: number;
  opacity: number;
  fontSize: number;
}

export interface TimerState {
  mode: 'off' | 'stopwatch' | 'countdown';
  running: boolean;
  base: number;
  since: number;
  targetMs: number;
}

export type SettingsTab = 'presentation' | 'backgrounds' | 'whiteboard' | 'tabs' | 'camera' | 'permissions' | 'browser' | 'extensions' | 'about';

/** What the engine actually is. Private diagnostics, PREP only. */
export interface CompatInfo {
  app: string;
  electron: string;
  chromium: string;
  v8: string;
  node: string;
  userAgent: string;
  loadedExtensions: number;
  approvedExtensions: number;
  safeMode: boolean;
  unsupported: { id: string; label: string; proprietary?: boolean; note?: string }[];
}

/** An approved extension directory reference, as the UI sees it. */
export interface ExtensionInfo {
  id: string;
  path: string;
  name: string;
  version: string;
  manifestVersion: number;
  description?: string;
  enabled: boolean;
  status: 'loaded' | 'disabled' | 'failed' | 'unknown';
  error?: string;
  addedAt: number;
}

export interface UiState {
  ready: boolean;
  appName: string;
  version: string;
  dev: boolean;

  settings: Settings;
  scenes: Scene[];
  activeSceneId?: string;
  tabs: TabState[];
  activeTabId: string | null;
  boards: WhiteboardMeta[];
  boardDocs: Record<string, WhiteboardDoc>;
  favorites: Favorite[];
  history: HistoryEntry[];
  displays: DisplayInfo[];
  live: LivePayload | null;
  presentProgress: { stage: string; message?: string } | null;

  paletteOpen: boolean;
  paletteValue: string;
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  extensionsOpen: boolean;
  compatInfo: CompatInfo | null;
  extensions: ExtensionInfo[];
  scenesOpen: boolean;
  notesOpen: boolean;
  notes: string;
  timer: TimerState;
  cameraOpen: boolean;
  diagOpen: boolean;
  onboardOpen: boolean;
  contextMenu?: { kind: 'tab' | 'card'; x: number; y: number; tabId?: string };

  tool: ToolId;
  ink: InkStyle;
  masks: PrivacyMask[];
  spotlight: SpotlightState;
  inkCount: number;
  canUndoInk: boolean;
  canRedoInk: boolean;
  cleanMode: boolean;
  holdingScreen: boolean;
  /** The teacher is repositioning the camera preview on the card. */
  cameraDrag: boolean;

  wbTool: WbTool;
  wbStyle: InkStyle & { width?: number; fill?: string };
  wbNumber: number;
  wbSelection: string[];
  wbView: Record<string, WbView>;
  wbCanUndo: boolean;
  wbCanRedo: boolean;

  permission?: PermissionRequest;
  screenSources?: ScreenSource[];
  sourceRequestId?: string;
  previewFrame?: string;
  previewEnabled: boolean;
  toasts: ToastMessage[];
  diagStats: Record<string, unknown>;
  addressHint: string;
}

const initialState: UiState = {
  ready: false,
  appName: 'Juzt',
  version: '1.0.0',
  dev: false,
  settings: {} as Settings,
  scenes: [],
  tabs: [],
  activeTabId: null,
  boards: [],
  boardDocs: {},
  favorites: [],
  history: [],
  displays: [],
  live: null,
  presentProgress: null,
  paletteOpen: false,
  paletteValue: '',
  settingsOpen: false,
  settingsTab: 'presentation',
  extensionsOpen: false,
  compatInfo: null,
  extensions: [],
  scenesOpen: false,
  notesOpen: false,
  notes: '',
  timer: { mode: 'off', running: false, base: 0, since: 0, targetMs: 5 * 60 * 1000 },
  cameraOpen: false,
  diagOpen: false,
  onboardOpen: false,
  tool: 'cursor',
  ink: { color: '#4aa3ff', size: 4, opacity: 1, fontSize: 32 },
  masks: [],
  spotlight: { on: false, x: 0.5, y: 0.5, r: 0.24, dim: 0.6, shape: 'circle' },
  inkCount: 0,
  canUndoInk: false,
  canRedoInk: false,
  cleanMode: false,
  holdingScreen: false,
  cameraDrag: false,
  wbTool: 'pen',
  wbStyle: { color: '#4aa3ff', size: 4, opacity: 1, fontSize: 32 },
  wbNumber: 1,
  wbSelection: [],
  wbView: {},
  wbCanUndo: false,
  wbCanRedo: false,
  previewEnabled: false,
  toasts: [],
  diagStats: {},
  addressHint: '',
};

class Store {
  private state: UiState = initialState;
  private listeners = new Set<() => void>();

  getState = (): UiState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  set(patch: Partial<UiState> | ((s: UiState) => Partial<UiState>)): void {
    const next = typeof patch === 'function' ? patch(this.state) : patch;
    let changed = false;
    for (const key of Object.keys(next) as (keyof UiState)[]) {
      if (this.state[key] !== next[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...this.state, ...next };
    this.listeners.forEach((l) => l());
  }

  hydrate(bootstrap: PrepBootstrap): void {
    this.state = {
      ...this.state,
      ready: true,
      appName: bootstrap.appName,
      version: bootstrap.version,
      dev: bootstrap.dev,
      settings: bootstrap.settings,
      scenes: bootstrap.scenes,
      activeSceneId: bootstrap.activeSceneId,
      tabs: bootstrap.tabs,
      activeTabId: bootstrap.activeTabId,
      boards: bootstrap.boards,
      favorites: bootstrap.favorites,
      history: bootstrap.history,
      displays: bootstrap.displays,
      live: bootstrap.live,
      masks: bootstrap.live.masks,
      spotlight: bootstrap.live.spotlight,
      onboardOpen: !bootstrap.settings.firstRunDone,
      diagOpen: bootstrap.diagnosticsEnabled,
      ink: {
        color: bootstrap.ui.style?.color ?? this.state.ink.color,
        size: bootstrap.ui.style?.size ?? this.state.ink.size,
        opacity: bootstrap.ui.style?.opacity ?? this.state.ink.opacity,
        fontSize: bootstrap.ui.style?.fontSize ?? this.state.ink.fontSize,
      },
      tool: (bootstrap.ui.tool as ToolId) ?? 'cursor',
      wbNumber: bootstrap.settings.numberStampStart ?? 1,
    };
    this.listeners.forEach((l) => l());
  }
}

export const store = new Store();

/**
 * Selector hook.
 *
 * `useSyncExternalStore` requires a *stable* snapshot: a selector that builds a
 * new object on every call would re-render forever. The memo below only
 * recomputes when the store state identity changed and only reuses the previous
 * value when the custom equality says it is the same — so `useSel(sel.tabTitles,
 * shallowEqual)` is safe and cheap.
 */
export function useSel<T>(selector: (s: UiState) => T, equal: (a: T, b: T) => boolean = Object.is): T {
  const cache = React.useRef<{ state: UiState | null; value: T }>({ state: null, value: undefined as unknown as T });
  const selectorRef = React.useRef(selector);
  const equalRef = React.useRef(equal);
  selectorRef.current = selector;
  equalRef.current = equal;

  const getSnapshot = React.useCallback((): T => {
    const state = store.getState();
    const cached = cache.current;
    if (cached.state === state) return cached.value;
    const next = selectorRef.current(state);
    if (cached.state !== null && equalRef.current(cached.value, next)) {
      cache.current = { state, value: cached.value };
      return cached.value;
    }
    cache.current = { state, value: next };
    return next;
  }, []);

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/** Shallow array/object equality for selectors that build new values. */
export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const key of ka) if (!Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
  return true;
}

export const sel = {
  activeTab: (s: UiState): TabState | null => s.tabs.find((t) => t.id === s.activeTabId) ?? null,
  activeWeb: (s: UiState) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return isWebTab(tab) ? tab : null;
  },
  activeBoardId: (s: UiState): string | null => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab && tab.kind === 'whiteboard' ? tab.boardId : null;
  },
  activeBoard: (s: UiState): WhiteboardDoc | null => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    if (!tab || tab.kind !== 'whiteboard') return null;
    return s.boardDocs[tab.boardId] ?? null;
  },
  internalPage: (s: UiState): string | null => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    if (!isWebTab(tab)) return null;
    return tab.url.startsWith('juzt://') ? tab.url.replace('juzt://', '') : null;
  },
  presentedLabel: (s: UiState): string | null => s.live?.presentation.label ?? null,
  status: (s: UiState): 'holding' | 'live' | 'frozen' | 'privacy' => {
    if (!s.live) return 'holding';
    if (s.live.flags.privacy) return 'privacy';
    if (s.live.flags.frozen) return 'frozen';
    if (s.live.presentation.kind === 'holding') return 'holding';
    return 'live';
  },
  tabTitles: (s: UiState): { id: string; label: string; favicon?: string; pinned: boolean; muted: boolean; kind: TabState['kind']; url?: string }[] =>
    s.tabs.map((tab) => ({
      id: tab.id,
      label: tabLabel(tab),
      favicon: tab.kind === 'web' ? tab.favicon : undefined,
      pinned: tab.pinned,
      muted: tab.kind === 'web' ? tab.muted : false,
      kind: tab.kind,
      // The palette shows suggestions only; it is never rendered into LIVE.
      url: tab.kind === 'web' ? tab.url : undefined,
    })),
  favorites: (s: UiState): Favorite[] => s.favorites,
  /** Newest first, capped: the palette never renders the whole history. */
  historyPreview: (s: UiState): HistoryEntry[] => s.history.slice(0, 24),
};
