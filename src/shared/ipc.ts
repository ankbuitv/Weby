/**
 * IPC channel registry.
 *
 * Names are stable strings; groups are namespaced with `:` so a mistaken
 * channel is obvious in logs. Every `invoke` channel is validated in main
 * (payload shape + sender), and LIVE is additionally restricted to
 * `LIVE_ALLOWED` — it must never be able to drive tabs or read prep data.
 */

export const CH = {
  /* app / window */
  APP_STATE: 'app:state',
  APP_SET_SETTINGS: 'app:setSettings',
  APP_QUIT: 'app:quit',
  APP_RELAUNCH: 'app:relaunch',
  WIN_MINIMIZE: 'win:minimize',
  WIN_TOGGLE_MAXIMIZE: 'win:toggleMaximize',
  WIN_CLOSE: 'win:close',
  WIN_SET_FULLSCREEN: 'win:setFullscreen',
  WIN_IS_FULLSCREEN: 'win:isFullscreen',

  /* tabs */
  TAB_NEW: 'tab:new',
  TAB_CLOSE: 'tab:close',
  TAB_CLOSE_OTHERS: 'tab:closeOthers',
  TAB_CLOSE_RIGHT: 'tab:closeRight',
  TAB_ACTIVATE: 'tab:activate',
  TAB_REOPEN: 'tab:reopen',
  TAB_REORDER: 'tab:reorder',
  TAB_DUPLICATE: 'tab:duplicate',
  TAB_PIN: 'tab:pin',
  TAB_MUTE: 'tab:mute',
  TAB_NAVIGATE: 'tab:navigate',
  TAB_BACK: 'tab:back',
  TAB_FORWARD: 'tab:forward',
  TAB_RELOAD: 'tab:reload',
  TAB_HARD_RELOAD: 'tab:hardReload',
  TAB_STOP: 'tab:stop',
  TAB_ZOOM: 'tab:zoom',
  TAB_OPEN_BACKGROUND: 'tab:openBackground',
  TAB_OPEN_FOREGROUND: 'tab:openForeground',
  TAB_OPEN_PRIVATE: 'tab:openPrivate',
  TAB_FOCUS_URL_FIELD: 'tab:focusUrlField',
  UI_STATE: 'ui:state',
  INK_CMD: 'ink:cmd',
  INK_STATE: 'ink:state',

  /* present / live */
  LIVE_PRESENT_TAB: 'live:presentTab',
  LIVE_PRESENT_BOARD: 'live:presentBoard',
  /** Switch to dual output and open Juzt Live (explicit "Start Presentation"). */
  LIVE_START: 'live:start',
  LIVE_STOP: 'live:stop',
  LIVE_SET_PRIVACY: 'live:setPrivacy',
  LIVE_SET_FREEZE: 'live:setFreeze',
  LIVE_SET_SPOTLIGHT: 'live:setSpotlight',
  LIVE_SET_HOLDING: 'live:setHolding',
  LIVE_SET_MASKS: 'live:setMasks',
  LIVE_LASER: 'live:laser',
  LIVE_ANNOTATION: 'live:annotation',
  LIVE_CAMERA: 'live:camera',          // PREP: apply camera config
  LIVE_REQUEST_STATE: 'live:requestState',
  LIVE_INPUT: 'live:input',
  LIVE_PREVIEW: 'live:preview',
  LIVE_OPEN_WINDOW: 'live:openWindow',
  LIVE_FOCUS_WINDOW: 'live:focusWindow',
  /** Navigate the audience page while presenting (teacher typed a new address). */
  LIVE_NAVIGATE: 'live:navigate',

  /* whiteboard */
  BOARD_LIST: 'board:list',
  BOARD_CREATE: 'board:create',
  BOARD_GET: 'board:get',
  BOARD_OP: 'board:op',
  BOARD_DELETE: 'board:delete',
  BOARD_RENAME: 'board:rename',
  BOARD_OPEN_PREP: 'board:openPrep',
  BOARD_OPEN_LIVE: 'board:openLive',
  BOARD_UNDO_HINT: 'board:undoHint',
  BOARD_UNDO: 'board:undo',
  BOARD_REDO: 'board:redo',
  BOARD_IMAGE_PICK: 'board:imagePick',
  BOARD_EXPORT_PICK: 'board:exportPick',

  /* scenes */
  SCENE_LIST: 'scene:list',
  SCENE_SAVE: 'scene:save',
  SCENE_DELETE: 'scene:delete',
  SCENE_APPLY: 'scene:apply',

  /* backgrounds */
  BG_PICK: 'bg:pick',
  BG_APPLY: 'bg:apply',
  BG_LIBRARY_ADD: 'bg:libraryAdd',
  BG_LIBRARY_UPDATE: 'bg:libraryUpdate',
  BG_LIBRARY_REMOVE: 'bg:libraryRemove',
  BG_SOLID: 'bg:solid',

  /* favorites / history */
  FAV_LIST: 'fav:list',
  FAV_ADD: 'fav:add',
  FAV_REMOVE: 'fav:remove',
  FAV_RENAME: 'fav:rename',
  HIST_LIST: 'hist:list',
  HIST_CLEAR: 'hist:clear',
  HIST_REMOVE: 'hist:remove',

  /* permissions */
  PERM_RESPOND: 'perm:respond',
  PERM_SOURCES: 'perm:sources',
  PERM_PICK_SOURCE: 'perm:pickSource',

  /* displays */
  DISPLAY_LIST: 'display:list',
  DISPLAY_SET_OUTPUT: 'display:setOutput',

  /* misc */
  DIAG_ENABLE: 'diag:enable',
  DIAG_REPORT: 'diag:report',
  SHELL_OPEN_EXTERNAL: 'shell:openExternal',
  CLIPBOARD_WRITE: 'clipboard:write',
  FILE_SAVE: 'file:save',
  FILE_OPEN_IMAGE: 'file:openImage',
  FILE_SAVE_IMAGE_DATA: 'file:saveImageData',
  FILE_OPEN_MEDIA: 'file:openMedia',
  /* website compatibility + extensions (PREP only, never LIVE) */
  COMPAT_INFO: 'compat:info',
  COMPAT_SET_SITE: 'compat:setSite',
  COMPAT_RESET_SITE: 'compat:resetSite',
  COMPAT_CLEAR_SITE_DATA: 'compat:clearSiteData',
  EXT_LIST: 'ext:list',
  EXT_ADD: 'ext:add',
  EXT_PICK: 'ext:pick',
  EXT_ENABLE: 'ext:enable',
  EXT_DISABLE: 'ext:disable',
  EXT_RELOAD: 'ext:reload',
  EXT_REMOVE: 'ext:remove',
  EXT_DISABLE_ALL: 'ext:disableAll',
  EXT_OPEN_OPTIONS: 'ext:openOptions',
  SAFE_MODE_SET: 'app:safeMode',
} as const;

/* main → renderer events */
export const EV = {
  STATE: 'ev:state',                 // sparse prep state patch
  LIVE: 'ev:live',                   // public LiveState snapshot
  TABS: 'ev:tabs',
  BOARD_DOC: 'ev:boardDoc',
  BOARD_OPS: 'ev:boardOps',
  BOARD_LIST: 'ev:boardList',
  SCENES: 'ev:scenes',
  SETTINGS: 'ev:settings',
  FAVORITES: 'ev:favorites',
  HISTORY: 'ev:history',
  PERM_REQUEST: 'ev:permRequest',
  PERM_SOURCES: 'ev:permSources',
  DIAG: 'ev:diag',
  FOCUS_RESTORED: 'ev:focusRestored',
  PREVIEW_FRAME: 'ev:previewFrame',
  ZOOM: 'ev:zoom',
  NAV_STATE: 'ev:navState',
  PRESENT_PROGRESS: 'ev:presentProgress',
  TOAST: 'ev:toast',
  FRAME: 'ev:frame',
  /** Committed ink ops (overlay → LIVE). */
  INK_OP: 'ev:inkOp',
  /** In-progress stroke / laser: transient, coalesced, dropped without a LIVE window. */
  INK_LIVE: 'ev:inkLive',
  LASER: 'ev:laser',
  GEOM: 'ev:geom',
  TOOL: 'ev:tool',
  INK_CMD_EV: 'ev:inkCmd',
} as const;

/**
 * Channels the LIVE renderer is allowed to invoke. Anything else is rejected in
 * main before it reaches a handler, so a compromised LIVE page cannot touch
 * tabs, history or the filesystem.
 */
export const LIVE_ALLOWED: ReadonlySet<string> = new Set<string>([
  CH.APP_STATE,
  CH.LIVE_REQUEST_STATE,
  CH.LIVE_SET_SPOTLIGHT,
  CH.LIVE_LASER,
  CH.LIVE_ANNOTATION,
  CH.LIVE_CAMERA,
  CH.DIAG_REPORT,
  CH.WIN_IS_FULLSCREEN,
  CH.SHELL_OPEN_EXTERNAL,
]);

export interface StatePatch {
  [key: string]: unknown;
}
