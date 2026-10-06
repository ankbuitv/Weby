import { app, BrowserWindow } from 'electron';
import { JuztApp } from './app';

/**
 * Juzt entry point.
 *
 * The single-instance lock is taken before any window exists; a second launch
 * focuses the PREP window instead of starting a competing session.
 */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  const juzt = new JuztApp();

  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.whenReady().then(() => {
    void juzt.start();
  });

  app.on('activate', () => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
    win?.show();
  });

  app.on('before-quit', () => {
    juzt.saveSession();
    juzt.dispose();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  process.on('uncaughtException', (err) => {
    // Never die silently in front of a class.
    process.emitWarning(`Juzt uncaught exception: ${String(err)}`);
  });
}
