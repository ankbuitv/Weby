import {
  app,
  BrowserWindow,
  WebContentsView,
  session,
  ipcMain,
  dialog,
  screen,
} from 'electron';
import * as path from 'path';
import { IPC } from '../shared/ipc';
import { loadSettings, saveSettings, loadScenes, saveScenes } from './persistence';
import { Settings } from '../shared/types';

const DEV_URL = 'http://localhost:5173/index.html';

export class StageBrowser {
  private mainWindow!: BrowserWindow;
  private uiWindow!: BrowserWindow;
  private mousePoll: NodeJS.Timeout | null = null;
  private mouseRegions: Array<{ x: number; y: number; width: number; height: number }> = [];
  private capturePointer = false;
  private pointerIgnored = true;
  private lastLoadError: { errorCode: number; errorDescription: string; validatedURL: string } | null = null;
  private webView!: WebContentsView;
  private settings!: Settings;
  private audioMuted = false;

  async init() {
    this.settings = loadSettings();
    if (this.settings.privacyMuteAudio) this.audioMuted = false; // start unmuted, only mute when privacy activated

    await app.whenReady();

    // Secure default session
    const ses = session.fromPartition('persist:stage');
    ses.setPermissionRequestHandler((_wc, _permission, callback) => {
      // Deny dangerous permissions by default; allow safe/mediacapable on request with minimal granting
      callback(false);
    });
    ses.setPermissionCheckHandler(() => false);

    this.createMainWindow();
    this.createWebView();
    this.createOverlayWindow();
    this.registerIPC();
    this.registerWebHandlers();
    this.attachWindowHandlers();
    this.layout();

    // The host window's renderer is intentionally an inert, dark backing surface.
    // The real site is a native WebContentsView above it; React runs in a separate
    // transparent overlay window so its canvas can compose above Chromium.
    await this.mainWindow.loadURL('data:text/html,<html><body style="margin:0;background:%230b0d12"></body></html>');
    if (app.isPackaged) {
      await this.uiWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    } else {
      await this.uiWindow.loadURL(DEV_URL);
    }
    this.startPointerRouting();
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
      thickFrame: true,
      title: 'Stage Browser',
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    this.mainWindow.once('ready-to-show', () => this.mainWindow.show());
    this.mainWindow.on('enter-full-screen', () => {
      this.uiWindow?.webContents.send(IPC.FULLSCREEN_CHANGED, true);
    });
    this.mainWindow.on('leave-full-screen', () => {
      this.uiWindow?.webContents.send(IPC.FULLSCREEN_CHANGED, false);
    });
  }

  private createOverlayWindow() {
    const bounds = this.mainWindow.getBounds();
    this.uiWindow = new BrowserWindow({
      ...bounds,
      parent: this.mainWindow,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    this.uiWindow.setIgnoreMouseEvents(true, { forward: true });
    this.uiWindow.once('ready-to-show', () => {
      if (!this.mainWindow.isVisible()) this.mainWindow.show();
      this.uiWindow.show();
    });
    this.uiWindow.on('closed', () => {
      if (this.mousePoll) clearInterval(this.mousePoll);
      this.mousePoll = null;
    });
  }

  private startPointerRouting() {
    // Transparent top-level overlay passes all non-UI pointer input through to the
    // live site. Drawing mode captures the full surface; toolbar/popover hit zones
    // are selectively interactive while Cursor is active.
    this.mousePoll = setInterval(() => {
      if (!this.uiWindow || this.uiWindow.isDestroyed() || !this.mainWindow.isVisible()) return;
      const p = screen.getCursorScreenPoint();
      const b = this.uiWindow.getBounds();
      const x = p.x - b.x;
      const y = p.y - b.y;
      const inControl = this.mouseRegions.some((r) => x >= r.x && y >= r.y && x <= r.x + r.width && y <= r.y + r.height);
      const shouldIgnore = !this.capturePointer && !inControl;
      if (shouldIgnore !== this.pointerIgnored) {
        this.pointerIgnored = shouldIgnore;
        this.uiWindow.setIgnoreMouseEvents(shouldIgnore, { forward: true });
      }
    }, 12);
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
    // Electron 31: addChildView places the native page above the host renderer.
    // Never move it to index 0: that hid the site behind the opaque React DOM.
    this.webView.setBackgroundColor('#ffffff');

    const wc = this.webView.webContents;
    wc.setWindowOpenHandler(({ url }) => {
      // Keep ordinary links in this stage view; deny custom operating-system protocols.
      if (url.startsWith('http://') || url.startsWith('https://')) {
        wc.loadURL(url).catch(() => {});
      }
      // Never hand untrusted custom protocols to the operating system.
      return { action: 'deny' };
    });

    wc.on('did-navigate', (_e, url) => {
      this.lastLoadError = null;
      this.uiWindow?.webContents.send(IPC.LOAD_COMMIT, { url, isMainFrame: true });
    });
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (isMainFrame) this.uiWindow?.webContents.send(IPC.LOAD_COMMIT, { url, isMainFrame });
    });
    wc.on('page-title-updated', (_e, title) => {
      this.uiWindow?.webContents.send(IPC.TITLE_UPDATED, title);
    });
    wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) {
        this.lastLoadError = { errorCode, errorDescription, validatedURL };
        this.uiWindow?.webContents.send(IPC.DID_FAIL_LOAD, this.lastLoadError);
      }
    });
    wc.on('render-process-gone', (_e, details) => {
      this.uiWindow?.webContents.send(IPC.RENDERER_CRASHED, { reason: details.reason });
    });
    wc.on('will-navigate', (e, url) => {
      if (!(url.startsWith('http://') || url.startsWith('https://') || url === 'about:blank')) {
        e.preventDefault();
      }
    });

    wc.setAudioMuted(this.audioMuted);

    // Set user agent to be Chrome-compatible but not masquerade fully
    const existingUA = wc.userAgent;
    const productUA = existingUA.replace(/Electron\/\S+\s*/, '');
    wc.setUserAgent(productUA);
    wc.loadURL('https://www.google.com').catch(() => {});

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
    this.mainWindow.on('move', relayout);
  }

  // Layout is driven by renderer via IPC to match its CSS viewport.
  // We store the viewport bounds set by renderer.
  private viewport: { x: number; y: number; width: number; height: number } | null = null;

  setViewport(bounds: { x: number; y: number; width: number; height: number }) {
    this.viewport = bounds;
    this.layout();
  }

  private layout() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    if (this.uiWindow && !this.uiWindow.isDestroyed()) this.uiWindow.setBounds(this.mainWindow.getBounds());
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
      if (input.type !== 'keyDown') return;
      const key = input.key.toLowerCase();
      const ctrl = input.control || input.meta;
      const routed =
        (ctrl && (key === 'l' || key === 'q' || key === 'r' || key === 'z' || key === '0' || key === '-' || key === '=' || key === '+' || (input.shift && ['q', 'h', 'b', 'c', 'z', 'r'].includes(key)))) ||
        (input.alt && (input.key === 'ArrowLeft' || input.key === 'ArrowRight')) ||
        ['F8', 'F9', 'F10', 'F11', 'Escape'].includes(input.key);
      if (!routed) return;
      event.preventDefault();
      this.uiWindow?.webContents.send('stage:relay-key', {
        key: input.key,
        ctrlKey: !!ctrl,
        shiftKey: !!input.shift,
        altKey: !!input.alt,
      });
      if (ctrl && key === 'l') this.uiWindow?.focus();
    });
  }

  private registerIPC() {
    ipcMain.handle('overlay:regions', (_e, regions) => {
      if (!Array.isArray(regions)) return;
      this.mouseRegions = regions.filter((r: any) => [r?.x, r?.y, r?.width, r?.height].every(Number.isFinite));
    });
    ipcMain.handle('overlay:capture', (_e, capture: boolean) => {
      this.capturePointer = !!capture;
    });
    ipcMain.handle('web:focus', () => this.webView.webContents.focus());
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
    ipcMain.handle('web:get:error', () => this.lastLoadError);
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
