import { contextBridge, ipcRenderer } from 'electron';
import { CH, EV, LIVE_ALLOWED } from '../shared/ipc';
import type {
  BackgroundSpec,
  CameraConfig,
  DiagStats,
  DisplayInfo,
  Favorite,
  HistoryEntry,
  LivePayload,
  PermissionRequest,
  PrepBootstrap,
  PrepUiState,
  PrivacyMask,
  Scene,
  ScreenSource,
  Settings,
  SpotlightState,
  TabState,
  ToastMessage,
  WbObject,
  WbOp,
  WhiteboardDoc,
  WhiteboardMeta,
} from '../shared/types';

/**
 * Juzt preload bridge.
 *
 * The role is decided by main through `additionalArguments`, and only the
 * matching API surface is exposed:
 *   prep    — the full teacher workspace
 *   live    — the audience renderer: state + effects, never tabs or history
 *   overlay — the transparent ink layer
 */

const roleArg = process.argv.find((a) => a.startsWith('--juzt-role='));
const ROLE: 'prep' | 'live' | 'overlay' = (roleArg?.split('=')[1] as 'prep' | 'live' | 'overlay') || 'prep';

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>;

type Unsubscribe = () => void;

function on<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener = (_event: unknown, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

/* ------------------------------------------------------------------ *
 * Shared (all roles)
 * ------------------------------------------------------------------ */

const common = {
  role: ROLE,
  liveState: () => invoke<LivePayload>(CH.LIVE_REQUEST_STATE),
  isFullscreen: () => invoke<boolean>(CH.WIN_IS_FULLSCREEN),
  openExternal: (url: string) => invoke<boolean>(CH.SHELL_OPEN_EXTERNAL, url),
  diagReport: (sample: Partial<DiagStats>) => invoke<boolean>(CH.DIAG_REPORT, sample),
  on: {
    live: (cb: (payload: LivePayload) => void) => on<LivePayload>(EV.LIVE, cb),
    inkOp: (cb: (op: unknown) => void) => on<unknown>(EV.INK_OP, cb),
    inkLive: (cb: (payload: unknown) => void) => on<unknown>(EV.INK_LIVE, cb),
    laser: (cb: (payload: { points: number[]; color: string } | null) => void) => on(EV.LASER, cb),
    frame: (cb: (payload: { kind: 'freeze' | 'protection'; dataUrl: string | null }) => void) => on(EV.FRAME, cb),
    boardDoc: (cb: (doc: WhiteboardDoc) => void) => on<WhiteboardDoc>(EV.BOARD_DOC, cb),
    boardOps: (cb: (payload: { boardId: string; ops: WbOp[]; rev: number }) => void) => on(EV.BOARD_OPS, cb),
    toast: (cb: (payload: ToastMessage) => void) => on<ToastMessage>(EV.TOAST, cb),
    diag: (cb: (payload: { renderer: Partial<DiagStats>; main: Record<string, unknown> }) => void) => on(EV.DIAG, cb),
  },
  /** Audience effects that PREP and the overlay may push. */
  effects: {
    spotlight: (patch: Partial<SpotlightState>) => invoke<boolean>(CH.LIVE_SET_SPOTLIGHT, patch),
    laser: (points: number[], color?: string) => invoke<boolean>(CH.LIVE_LASER, { points, color }),
    ink: (op: unknown) => invoke<boolean>(CH.LIVE_ANNOTATION, op),
    camera: (patch: Partial<CameraConfig>) => invoke<CameraConfig>(CH.LIVE_CAMERA, patch),
  },
};

/* ------------------------------------------------------------------ *
 * PREP
 * ------------------------------------------------------------------ */

const prepApi = {
  ...common,

  getState: () => invoke<PrepBootstrap>(CH.APP_STATE),
  setSettings: (patch: Partial<Settings>) => invoke<Settings>(CH.APP_SET_SETTINGS, patch),
  quit: () => invoke<void>(CH.APP_QUIT),
  clipboardWrite: (text: string) => invoke<boolean>(CH.CLIPBOARD_WRITE, text),

  window: {
    minimize: () => invoke<void>(CH.WIN_MINIMIZE),
    toggleMaximize: () => invoke<boolean>(CH.WIN_TOGGLE_MAXIMIZE),
    close: () => invoke<void>(CH.WIN_CLOSE),
    setFullscreen: (on: boolean) => invoke<boolean>(CH.WIN_SET_FULLSCREEN, on),
  },

  tabs: {
    create: (opts: { url?: string; kind?: 'web' | 'whiteboard'; name?: string; background?: boolean } = {}) => invoke<string>(CH.TAB_NEW, opts),
    close: (id: string) => invoke<void>(CH.TAB_CLOSE, id),
    closeOthers: (id: string) => invoke<void>(CH.TAB_CLOSE_OTHERS, id),
    closeRight: (id: string) => invoke<void>(CH.TAB_CLOSE_RIGHT, id),
    activate: (id: string) => invoke<void>(CH.TAB_ACTIVATE, id),
    reopen: () => invoke<{ kind: string; id: string } | null>(CH.TAB_REOPEN),
    reorder: (from: number, to: number) => invoke<void>(CH.TAB_REORDER, from, to),
    duplicate: (id: string) => invoke<void>(CH.TAB_DUPLICATE, id),
    pin: (id: string, pinned: boolean) => invoke<void>(CH.TAB_PIN, id, pinned),
    mute: (id: string, muted: boolean) => invoke<void>(CH.TAB_MUTE, id, muted),
    navigate: (id: string, url: string) => invoke<boolean>(CH.TAB_NAVIGATE, id, url),
    back: (id: string) => invoke<void>(CH.TAB_BACK, id),
    forward: (id: string) => invoke<void>(CH.TAB_FORWARD, id),
    reload: (id: string) => invoke<void>(CH.TAB_RELOAD, id),
    hardReload: (id: string) => invoke<void>(CH.TAB_HARD_RELOAD, id),
    stop: (id: string) => invoke<void>(CH.TAB_STOP, id),
    zoom: (id: string, factor: number) => invoke<void>(CH.TAB_ZOOM, id, factor),
    openPrivate: (url: string) => invoke<string>(CH.TAB_OPEN_PRIVATE, url),
  },

  boards: {
    list: () => invoke<WhiteboardMeta[]>(CH.BOARD_LIST),
    create: (name?: string) => invoke<WhiteboardDoc>(CH.BOARD_CREATE, name),
    get: (id: string) => invoke<WhiteboardDoc | null>(CH.BOARD_GET, id),
    ops: (boardId: string, ops: WbOp[]) => invoke<{ ok: boolean; canUndo: boolean; canRedo: boolean; rev: number }>(CH.BOARD_OP, { boardId, ops }),
    rename: (id: string, name: string) => invoke<WhiteboardDoc | null>(CH.BOARD_RENAME, id, name),
    remove: (id: string) => invoke<boolean>(CH.BOARD_DELETE, id),
    openInPrep: (id: string) => invoke<string>(CH.BOARD_OPEN_PREP, id),
    present: (id: string) => invoke<LivePayload>(CH.BOARD_OPEN_LIVE, id),
    undoHint: (id: string) => invoke<{ canUndo: boolean; canRedo: boolean }>(CH.BOARD_UNDO_HINT, id),
    undo: (id: string) => invoke<{ ok: boolean; canUndo: boolean; canRedo: boolean }>(CH.BOARD_UNDO, id),
    redo: (id: string) => invoke<{ ok: boolean; canUndo: boolean; canRedo: boolean }>(CH.BOARD_REDO, id),
    pickImage: () => invoke<{ dataUrl: string; naturalW: number; naturalH: number; name: string } | null>(CH.BOARD_IMAGE_PICK),
    exportPng: (dataUrl: string, name?: string) => invoke<string | null>(CH.BOARD_EXPORT_PICK, { dataUrl, name }),
  },

  present: {
    tab: (id: string) => invoke<LivePayload>(CH.LIVE_PRESENT_TAB, id),
    board: (id: string) => invoke<LivePayload>(CH.LIVE_PRESENT_BOARD, id),
    /** Switch to dual output, open Juzt Live and present the active tab. */
    start: () => invoke<LivePayload>(CH.LIVE_START),
    stop: () => invoke<LivePayload>(CH.LIVE_STOP),
    setPrivacy: (on: boolean) => invoke<LivePayload>(CH.LIVE_SET_PRIVACY, on),
    setFreeze: (on: boolean) => invoke<LivePayload>(CH.LIVE_SET_FREEZE, on),
    setHolding: (patch: { text?: string; on?: boolean }) => invoke<LivePayload>(CH.LIVE_SET_HOLDING, patch),
    setMasks: (masks: PrivacyMask[]) => invoke<LivePayload>(CH.LIVE_SET_MASKS, masks),
    requestState: () => invoke<LivePayload>(CH.LIVE_REQUEST_STATE),
    openWindow: () => invoke<boolean>(CH.LIVE_OPEN_WINDOW),
    focusWindow: () => invoke<boolean>(CH.LIVE_FOCUS_WINDOW),
    preview: (enabled: boolean) => invoke<boolean>(CH.LIVE_PREVIEW, enabled),
    /** Navigate the audience page while it is presented (dual mode). */
    navigateAudience: (url: string) => invoke<boolean>(CH.LIVE_NAVIGATE, url),
  },

  /* ------------------------------------------------------------------ *
   * Website compatibility + extensions.
   * PREP only: the LIVE renderer never gets these on its API object, so
   * audience output cannot see engine details or touch extensions.
   * ------------------------------------------------------------------ */
  compat: {
    info: () =>
      invoke<{
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
      }>(CH.COMPAT_INFO),
    setSite: (origin: string, mode: 'clean' | 'app' | 'electron') => invoke<boolean>(CH.COMPAT_SET_SITE, origin, mode),
    resetSite: (origin: string) => invoke<boolean>(CH.COMPAT_RESET_SITE, origin),
    clearSiteData: (origin: string) => invoke<{ ok: boolean; error?: string }>(CH.COMPAT_CLEAR_SITE_DATA, origin),
  },

  extensions: {
    list: () =>
      invoke<
        {
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
        }[]
      >(CH.EXT_LIST),
    /** Pick a folder with a native dialog. */
    pick: () => invoke<{ error: string } | { id: string; name: string; version: string; manifestVersion: number }>(CH.EXT_PICK),
    add: (dir: string) => invoke<{ error: string } | { id: string; name: string; version: string; manifestVersion: number }>(CH.EXT_ADD, dir),
    enable: (id: string) => invoke<boolean>(CH.EXT_ENABLE, id),
    disable: (id: string) => invoke<boolean>(CH.EXT_DISABLE, id),
    reload: (id: string) => invoke<boolean>(CH.EXT_RELOAD, id),
    remove: (id: string) => invoke<boolean>(CH.EXT_REMOVE, id),
    /** Loaded instances are dropped; the approved list is kept. */
    disableAll: () => invoke<unknown[]>(CH.EXT_DISABLE_ALL),
    openOptions: (id: string) => invoke<{ ok: boolean; error?: string }>(CH.EXT_OPEN_OPTIONS, id),
    setSafeMode: (on: boolean) => invoke<boolean>(CH.SAFE_MODE_SET, on),
  },

  scenes: {
    list: () => invoke<{ scenes: Scene[]; activeSceneId?: string }>(CH.SCENE_LIST),
    save: (scene: Scene) => invoke<Scene[]>(CH.SCENE_SAVE, scene),
    remove: (id: string) => invoke<Scene[]>(CH.SCENE_DELETE, id),
    apply: (id: string) => invoke<{ settings: Settings; scene: Scene } | null>(CH.SCENE_APPLY, id),
  },

  backgrounds: {
    pick: (opts: { video?: boolean; image?: boolean } = {}) =>
      invoke<{ path: string; url: string; kind: 'image' | 'video' | 'audio'; name: string; thumb?: string } | null>(CH.BG_PICK, opts),
    apply: (target: 'live' | 'holding' | 'privacy', spec: BackgroundSpec) => invoke<Settings>(CH.BG_APPLY, { target, spec }),
    libraryAdd: (name: string, spec: BackgroundSpec) => invoke<{ id: string }>(CH.BG_LIBRARY_ADD, { name, spec }),
    libraryRename: (id: string, name: string) => invoke<void>(CH.BG_LIBRARY_UPDATE, { id, name }),
    libraryRemove: (id: string) => invoke<void>(CH.BG_LIBRARY_REMOVE, id),
  },

  favorites: {
    list: () => invoke<Favorite[]>(CH.FAV_LIST),
    add: (url: string, title?: string, favicon?: string) => invoke<Favorite[]>(CH.FAV_ADD, { url, title, favicon }),
    remove: (id: string) => invoke<Favorite[]>(CH.FAV_REMOVE, id),
    rename: (id: string, title: string) => invoke<Favorite[]>(CH.FAV_RENAME, { id, title }),
  },

  history: {
    list: () => invoke<HistoryEntry[]>(CH.HIST_LIST),
    clear: () => invoke<boolean>(CH.HIST_CLEAR),
    remove: (id: string) => invoke<boolean>(CH.HIST_REMOVE, id),
  },

  permissions: {
    respond: (payload: { id: string; granted: boolean; remember?: boolean }) => invoke<boolean>(CH.PERM_RESPOND, payload),
    pickSource: (payload: { requestId: string; id: string | null }) => invoke<boolean>(CH.PERM_PICK_SOURCE, payload),
  },

  displays: {
    list: () => invoke<DisplayInfo[]>(CH.DISPLAY_LIST),
    setOutput: (id: number | null) => invoke<DisplayInfo[]>(CH.DISPLAY_SET_OUTPUT, id),
  },

  files: {
    saveImageData: (dataUrl: string, name?: string) => invoke<string | null>(CH.FILE_SAVE_IMAGE_DATA, { dataUrl, name }),
    openImage: () => invoke<{ dataUrl: string; naturalW: number; naturalH: number; name: string } | null>(CH.FILE_OPEN_IMAGE),
    openMedia: (opts: { video?: boolean } = {}) => invoke<{ path: string; url: string; kind: string; name: string } | null>(CH.FILE_OPEN_MEDIA, opts),
  },

  diagnostics: {
    enable: (on: boolean) => invoke<boolean>(CH.DIAG_ENABLE, on),
    report: (sample: Partial<DiagStats>) => invoke<boolean>(CH.DIAG_REPORT, sample),
  },

  ink: {
    /** PREP toolbar → overlay owner (undo/redo/clear). */
    command: (cmd: 'undo' | 'redo' | 'clear') => invoke<boolean>(CH.INK_CMD, { cmd }),
    /** Overlay → main → PREP toolbar (button states). */
    state: (state: { count: number; canUndo: boolean; canRedo: boolean }) => invoke<boolean>(CH.INK_STATE, state),
  },

  ui: {
    /** Drives overlay visibility in main (ink layer / cover) without a state push. */
    state: (ui: Partial<PrepUiState>) => invoke<boolean>(CH.UI_STATE, ui),
  },

  on: {
    ...common.on,
    bootstrapState: (cb: (payload: unknown) => void) => on(EV.STATE, cb),
    geom: (cb: (payload: { single: boolean; windowSize: { width: number; height: number }; card: { x: number; y: number; width: number; height: number }; overlay: { x: number; y: number; width: number; height: number } | null }) => void) =>
      on(EV.GEOM, cb),
    tabs: (cb: (payload: { order: string[]; activeId: string | null; changed: TabState[] }) => void) => on(EV.TABS, cb),
    settings: (cb: (payload: Settings) => void) => on<Settings>(EV.SETTINGS, cb),
    scenes: (cb: (payload: { scenes: Scene[]; activeSceneId?: string }) => void) => on(EV.SCENES, cb),
    favorites: (cb: (payload: Favorite[]) => void) => on<Favorite[]>(EV.FAVORITES, cb),
    history: (cb: (payload: HistoryEntry[]) => void) => on<HistoryEntry[]>(EV.HISTORY, cb),
    boards: (cb: (payload: WhiteboardMeta[]) => void) => on<WhiteboardMeta[]>(EV.BOARD_LIST, cb),
    permissionRequest: (cb: (payload: PermissionRequest) => void) => on<PermissionRequest>(EV.PERM_REQUEST, cb),
    screenSources: (cb: (payload: { sources: ScreenSource[]; requestId: string }) => void) => on(EV.PERM_SOURCES, cb),
    presentProgress: (cb: (payload: { stage: string; message?: string }) => void) => on(EV.PRESENT_PROGRESS, cb),
    previewFrame: (cb: (dataUrl: string) => void) => on<string>(EV.PREVIEW_FRAME, cb),
    focusRestored: (cb: (payload: { ms: number }) => void) => on<{ ms: number }>(EV.FOCUS_RESTORED, cb),
    inkState: (cb: (payload: { kind?: string; count?: number; canUndo?: boolean; canRedo?: boolean }) => void) => on(EV.INK_CMD_EV, cb),
  },
};

/* ------------------------------------------------------------------ *
 * LIVE renderer (audience output)
 * ------------------------------------------------------------------ */

const liveApi = {
  ...common,
  getState: () => invoke<LivePayload>(CH.LIVE_REQUEST_STATE),
  requestState: () => invoke<LivePayload>(CH.LIVE_REQUEST_STATE),
  on: {
    ...common.on,
    live: (cb: (payload: LivePayload) => void) => on<LivePayload>(EV.LIVE, cb),
    geom: (cb: (payload: unknown) => void) => on(EV.GEOM, cb),
  },
};

/* ------------------------------------------------------------------ *
 * Overlay view (transparent ink layer)
 * ------------------------------------------------------------------ */

const overlayApi = {
  ...common,
  ink: {
    command: (cmd: 'undo' | 'redo' | 'clear') => invoke<boolean>(CH.INK_CMD, { cmd }),
    state: (state: { count: number; canUndo: boolean; canRedo: boolean }) => invoke<boolean>(CH.INK_STATE, state),
  },
  on: {
    ...common.on,
    live: (cb: (payload: LivePayload) => void) => on<LivePayload>(EV.LIVE, cb),
    geom: (cb: (payload: { single: boolean; windowSize: { width: number; height: number }; card: { x: number; y: number; width: number; height: number }; overlay: { x: number; y: number; width: number; height: number } | null }) => void) => on(EV.GEOM, cb),
    tool: (
      cb: (payload: {
        tool: string;
        style: { color: string; size: number; opacity: number; fontSize: number };
        number: number;
        single: boolean;
        /** True while the camera preview is being repositioned on the card. */
        cameraDrag?: boolean;
      }) => void,
    ) => on(EV.TOOL, cb),
    inkCmd: (cb: (payload: { cmd?: string }) => void) => on(EV.INK_CMD_EV, cb),
  },
};

const api = ROLE === 'live' ? liveApi : ROLE === 'overlay' ? overlayApi : prepApi;

// A tiny guard so a stray `window.juzt.somePrepThing` in the audience renderer
// throws loudly in development instead of silently doing nothing.
if (ROLE !== 'prep') {
  Object.defineProperty(api, 'prepOnly', { value: true, enumerable: false });
}

contextBridge.exposeInMainWorld('juzt', api);
contextBridge.exposeInMainWorld('stage', api);

export type JuztApi = typeof prepApi;
export type JuztLiveApi = typeof liveApi;
export type JuztOverlayApi = typeof overlayApi;
export { ROLE, LIVE_ALLOWED };
