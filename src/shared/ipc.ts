export const IPC = {
  // Renderer -> Main
  NAVIGATE: 'navigate',
  GO_BACK: 'go:back',
  GO_FORWARD: 'go:forward',
  RELOAD: 'reload',
  HARD_RELOAD: 'hard:reload',
  SET_ZOOM: 'set:zoom',
  SET_FULLSCREEN: 'set:fullscreen',
  TOGGLE_FULLSCREEN: 'toggle:fullscreen',
  PICK_BACKGROUND: 'pick:background',
  CLEAR_BACKGROUND: 'clear:background',
  QUIT: 'quit',
  CAPTURE_FREEZE: 'capture:freeze',
  CAPTURE_FREEZE_RESULT: 'capture:freeze:result',
  DOWNLOAD_PATH: 'download:path',
  SET_AUDIO_MUTED: 'set:audio:muted',
  OPEN_SETTINGS_FILE: 'open:settings:file',

  // Main -> Renderer
  FULLSCREEN_CHANGED: 'fullscreen:changed',
  LOAD_COMMIT: 'load:commit',
  TITLE_UPDATED: 'title:updated',
  DID_FAIL_LOAD: 'did:fail:load',
  RENDERER_CRASHED: 'renderer:crashed',
} as const;

export type IPCChannel = (typeof IPC)[keyof typeof IPC];
