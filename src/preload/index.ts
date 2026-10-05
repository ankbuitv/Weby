import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type { Settings, Scene } from '../shared/types';

const api = {
  navigate: (url: string) => ipcRenderer.invoke(IPC.NAVIGATE, url) as Promise<boolean>,
  goBack: () => ipcRenderer.invoke(IPC.GO_BACK),
  goForward: () => ipcRenderer.invoke(IPC.GO_FORWARD),
  reload: () => ipcRenderer.invoke(IPC.RELOAD),
  hardReload: () => ipcRenderer.invoke(IPC.HARD_RELOAD),
  setZoom: (factor: number) => ipcRenderer.invoke(IPC.SET_ZOOM, factor),
  setFullscreen: (fs: boolean) => ipcRenderer.invoke(IPC.SET_FULLSCREEN, fs),
  toggleFullscreen: () => ipcRenderer.invoke(IPC.TOGGLE_FULLSCREEN),
  pickBackground: () => ipcRenderer.invoke(IPC.PICK_BACKGROUND) as Promise<string | null>,
  clearBackground: () => ipcRenderer.invoke(IPC.CLEAR_BACKGROUND),
  quit: () => ipcRenderer.invoke(IPC.QUIT),

  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<Settings>,
  setSettings: (patch: Partial<Settings>) =>
    ipcRenderer.invoke('settings:set', patch) as Promise<Settings>,

  getScenes: () => ipcRenderer.invoke('scenes:get') as Promise<Scene[]>,
  saveScenes: (scenes: Scene[]) => ipcRenderer.invoke('scenes:save', scenes),

  getURL: () => ipcRenderer.invoke('web:get:url') as Promise<string>,
  getTitle: () => ipcRenderer.invoke('web:get:title') as Promise<string>,
  getLoadError: () => ipcRenderer.invoke('web:get:error') as Promise<{ errorCode: number; errorDescription: string; validatedURL: string } | null>,
  canGoBack: () => ipcRenderer.invoke('web:can:go:back') as Promise<boolean>,
  canGoForward: () => ipcRenderer.invoke('web:can:go:forward') as Promise<boolean>,

  setViewport: (bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke('viewport:set', bounds),
  setMouseRegions: (regions: Array<{ x: number; y: number; width: number; height: number }>) =>
    ipcRenderer.invoke('overlay:regions', regions),
  setOverlayCapture: (capture: boolean) => ipcRenderer.invoke('overlay:capture', capture),
  focusWebView: () => ipcRenderer.invoke('web:focus'),
  onRelayKey: (cb: (key: { key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) => void) => {
    const listener = (_e: unknown, key: { key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) => cb(key);
    ipcRenderer.on('stage:relay-key', listener);
    return () => ipcRenderer.removeListener('stage:relay-key', listener);
  },

  captureFreeze: () =>
    ipcRenderer.invoke(IPC.CAPTURE_FREEZE) as Promise<
      { ok: true; dataUrl: string; size: { width: number; height: number } } | { ok: false; error: string }
    >,
  setAudioMuted: (muted: boolean) => ipcRenderer.invoke(IPC.SET_AUDIO_MUTED, muted),

  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isFullscreen: () => ipcRenderer.invoke('window:isFullScreen') as Promise<boolean>,
  contentBounds: () =>
    ipcRenderer.invoke('window:contentBounds') as Promise<{ x: number; y: number; width: number; height: number }>,

  onFullscreenChanged: (cb: (fs: boolean) => void) => {
    const listener = (_e: unknown, fs: boolean) => cb(fs);
    ipcRenderer.on(IPC.FULLSCREEN_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.FULLSCREEN_CHANGED, listener);
  },
  onLoadCommit: (cb: (info: { url: string; isMainFrame: boolean }) => void) => {
    const listener = (_e: unknown, info: { url: string; isMainFrame: boolean }) => cb(info);
    ipcRenderer.on(IPC.LOAD_COMMIT, listener);
    return () => ipcRenderer.removeListener(IPC.LOAD_COMMIT, listener);
  },
  onTitleUpdated: (cb: (title: string) => void) => {
    const listener = (_e: unknown, title: string) => cb(title);
    ipcRenderer.on(IPC.TITLE_UPDATED, listener);
    return () => ipcRenderer.removeListener(IPC.TITLE_UPDATED, listener);
  },
  onDidFailLoad: (cb: (info: { errorCode: number; errorDescription: string; validatedURL: string }) => void) => {
    const listener = (
      _e: unknown,
      info: { errorCode: number; errorDescription: string; validatedURL: string },
    ) => cb(info);
    ipcRenderer.on(IPC.DID_FAIL_LOAD, listener);
    return () => ipcRenderer.removeListener(IPC.DID_FAIL_LOAD, listener);
  },
  onRendererCrashed: (cb: (info: { reason: string }) => void) => {
    const listener = (_e: unknown, info: { reason: string }) => cb(info);
    ipcRenderer.on(IPC.RENDERER_CRASHED, listener);
    return () => ipcRenderer.removeListener(IPC.RENDERER_CRASHED, listener);
  },
};

contextBridge.exposeInMainWorld('stage', api);

export type StageAPI = typeof api;
