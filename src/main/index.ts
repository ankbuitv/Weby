import { app, globalShortcut, Menu } from 'electron';
import { StageBrowser } from './browser';

// Disable default menu bar
Menu.setApplicationMenu(null);

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

const browser = new StageBrowser();
browser.init().catch((err) => {
  console.error('Failed to init Stage Browser:', err);
  app.quit();
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
