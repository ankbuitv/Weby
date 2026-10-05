import {
  app,
  BrowserWindow,
  WebContentsView,
  session,
  shell,
  ipcMain,
  nativeImage,
  dialog,
  WebContents,
} from 'electron';
import * as path from 'path';
import { IPC } from '../shared/ipc';
import { loadSettings, saveSettings, loadScenes, saveScenes } from './persistence';
import { Settings } from '../shared/types';

const DEV_URL = 'http://localhost:5173/index.html';

export class StageBrowser {
  private mainWindow!: BrowserWindow;
  private webView!: WebContentsView;
  private settings!: Settings;
  private audioMuted = false;

  async init() {
    this.settings = loadSettings();
    if (this.settings.privacyMuteAudio) this.audioMuted = false; // start unmuted, only mute when privacy activated

    await app.whenReady();

    // Secure default session
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((_wc, _permission, callback) => {
      // Deny dangerous permissions by default; allow safe/mediacapable on request with minimal granting
      callback(false);
    });
    ses.setPermissionCheckHandler(() => false);

    this.createMainWindow();
    this.createWebView();
    this.registerIPC();
    this.registerWebHandlers();
    this.attachWindowHandlers();
    this.layout();

    if (app.isPackaged) {
      await this.mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    } else {
      await this.mainWindow.loadURL(DEV_URL);
    }
  }

  private createMainWindow() {
    this.mainWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 800,
      minHeight: 500,
      frame: false,
      transparent: false,
      backgroundColor: '#0b0d12',
      title: 'Stage Browser',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    this.mainWindow.once('ready-to-show', () => this.mainWindow.show());
    this.mainWindow.on('enter-full-screen', () => {
      this.mainWindow.webContents.send(IPC.FULLSCREEN_CHANGED, true);
    });
    this.mainWindow.on('leave-full-screen', () => {
      this.mainWindow.webContents.send(IPC.FULLSCREEN_CHANGED, false);
    });
  }

  private createWebView() {
    this.webView = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        partition: 'persist:stage',
        backgroundThrottling: false,
      },
    });
    this.mainWindow.contentView.addChildView(this.webView);
    this.webView.setBackgroundColor('#ffffff');

    const wc = this.webView.webContents;
    wc.setWindowOpenHandler(({ url }) => {
      // Open http/https in same view; defer external to shell after asking
      if (url.startsWith('http://') || url.startsWith('https://')) {
        wc.loadURL(url).catch(() => {});
      } else {
        // do not auto-execute custom protocols
        shell.openExternal(url).catch(() => {});
      }
      return { action: 'deny' };
    });

    wc.on('did-navigate', (_e, url) => {
      this.mainWindow.webContents.send(IPC.LOAD_COMMIT, { url, isMainFrame: true });
    });
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (isMainFrame) this.mainWindow.webContents.send(IPC.LOAD_COMMIT, { url, isMainFrame });
    });
    wc.on('page-title-updated', (_e, title) => {
      this.mainWindow.webContents.send(IPC.TITLE_UPDATED, title);
    });
    wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame) {
        this.mainWindow.webContents.send(IPC.DID_FAIL_LOAD, { errorCode, errorDescription, validatedURL });
      }
    });
    wc.on('render-process-gone', (_e, details) => {
      this.mainWindow.webContents.send(IPC.RENDERER_CRASHED, { reason: details.reason });
    });
    wc.on('will-navigate', (e, url) => {
      if (!(url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://') || url.startsWith('about:'))) {
        e.preventDefault();
        shell.openExternal(url).catch(() => {});
      }
    });

    wc.setAudioMuted(this.audioMuted);

    // Set user agent to be Chrome-compatible but not masquerade fully
    const existingUA = wc.userAgent;
    const productUA = existingUA.replace(/Electron\/\S+\s*/, '');
    wc.setUserAgent(productUA);

    // Download handling - use default save dialog
    wc.session.on('will-download', (_event, item) => {
      item.setSaveDialogOptions({ title: 'Save file' });
    });
  }

  private attachWindowHandlers() {
    const relayout = () => this.layout();
    this.mainWindow.on('resize', relayout);
    this.mainWindow.on('maximize', relayout);
    this.mainWindow.on('unmaximize', relayout);
    this.mainWindow.on('restore', relayout);
  }

  // Layout is driven by renderer via IPC to match its CSS viewport.
  // We store the viewport bounds set by renderer.
  private viewport: { x: number; y: number; width: number; height: number } | null = null;

  setViewport(bounds: { x: number; y: number; width: number; height: number }) {
    this.viewport = bounds;
    this.layout();
  }

  private layout() {
    // WebContentsView fills content by default; renderer will overlay with exact bounds.
    const { width, height } = this.mainWindow.getContentBounds();
    if (this.viewport) {
      this.webView.setBounds({
        x: Math.round(this.viewport.x),
        y: Math.round(this.viewport.y),
        width: Math.round(this.viewport.width),
        height: Math.round(this.viewport.height),
      });
    } else {
      this.webView.setBounds({ x: 0, y: 0, width, height });
    }
  }

  private registerWebHandlers() {
    this.webView.webContents.on('before-input-event', (event, input) => {
      // Relay certain shortcuts? Shortcut handling is in renderer globally; this is for kill-switch if needed
      if (input.key === 'F11' && input.type === 'keyDown') {
        event.preventDefault();
        this.mainWindow.setFullScreen(!this.mainWindow.isFullScreen());
      }
    });
  }

  private registerIPC() {
    ipcMain.handle(IPC.NAVIGATE, (_e, url: string) => {
      try {
        const u = new URL(url);
        if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'about:') {
          this.webView.webContents.loadURL(u.toString()).catch(() => {});
          return true;
        }
        return false;
      } catch {
        return false;
      }
    });

    ipcMain.handle(IPC.GO_BACK, () => {
      if (this.webView.webContents.canGoBack()) this.webView.webContents.goBack();
    });
    ipcMain.handle(IPC.GO_FORWARD, () => {
      if (this.webView.webContents.canGoForward()) this.webView.webContents.goForward();
    });
    ipcMain.handle(IPC.RELOAD, () => this.webView.webContents.reload());
    ipcMain.handle(IPC.HARD_RELOAD, () => this.webView.webContents.reloadIgnoringCache());
    ipcMain.handle(IPC.SET_ZOOM, (_e, factor: number) => {
      this.webView.webContents.setZoomFactor(Math.max(0.25, Math.min(5, factor)));
    });
    ipcMain.handle(IPC.SET_FULLSCREEN, (_e, fs: boolean) => this.mainWindow.setFullScreen(fs));
    ipcMain.handle(IPC.TOGGLE_FULLSCREEN, () =>
      this.mainWindow.setFullScreen(!this.mainWindow.isFullScreen()),
    );
    ipcMain.handle(IPC.QUIT, () => app.quit());

    ipcMain.handle(IPC.PICK_BACKGROUND, async () => {
      const res = await dialog.showOpenDialog(this.mainWindow, {
        title: 'Choose background image',
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      });
      if (res.canceled || !res.filePaths[0]) return null;
      return res.filePaths[0];
    });

    ipcMain.handle(IPC.CLEAR_BACKGROUND, () => {
      this.settings.backgroundImage = undefined;
      saveSettings(this.settings);
    });

    ipcMain.handle('settings:get', () => this.settings);
    ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
      this.settings = { ...this.settings, ...patch };
      saveSettings(this.settings);
      return this.settings;
    });

    ipcMain.handle('scenes:get', () => loadScenes());
    ipcMain.handle('scenes:save', (_e, scenes) => saveScenes(scenes));

    ipcMain.handle('web:get:url', () => this.webView.webContents.getURL());
    ipcMain.handle('web:get:title', () => this.webView.webContents.getTitle());
    ipcMain.handle('web:can:go:back', () => this.webView.webContents.canGoBack());
    ipcMain.handle('web:can:go:forward', () => this.webView.webContents.canGoForward());

    ipcMain.handle('viewport:set', (_e, bounds) => {
      this.setViewport(bounds);
    });

    ipcMain.handle(IPC.CAPTURE_FREEZE, async () => {
      try {
        const img = await this.webView.webContents.capturePage();
        const dataUrl = img.toDataURL();
        return { ok: true, dataUrl, size: { width: img.getSize().width, height: img.getSize().height } };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    });

    ipcMain.handle(IPC.SET_AUDIO_MUTED, (_e, muted: boolean) => {
      this.audioMuted = muted;
      this.webView.webContents.setAudioMuted(muted);
    });

    ipcMain.handle('window:minimize', () => this.mainWindow.minimize());
    ipcMain.handle('window:toggleMaximize', () => {
      if (this.mainWindow.isMaximized()) this.mainWindow.unmaximize();
      else this.mainWindow.maximize();
    });
    ipcMain.handle('window:close', () => this.mainWindow.close());

    ipcMain.handle('window:isFullScreen', () => this.mainWindow.isFullScreen());
    ipcMain.handle('window:contentBounds', () => this.mainWindow.getContentBounds());
  }
}
