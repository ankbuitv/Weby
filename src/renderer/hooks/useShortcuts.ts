import { useEffect } from 'react';
import { sel, store } from '../state/store';
import { actions } from '../state/actions';
import type { ToolId, WbTool } from '../../shared/types';

/**
 * Centralised, context-aware keyboard handling.
 *
 * Rules:
 *  - global combos (tabs, present, F-keys) always fire;
 *  - single-letter tool shortcuts only fire when the focus is not in an input,
 *    textarea, contenteditable, the palette, settings, notes or a whiteboard text
 *    box (nothing Juzt does may steal normal typing);
 *  - nothing here touches high-frequency state.
 */

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.isContentEditable) return true;
  if (el.closest?.('[data-text-editor="true"]')) return true;
  if (el.closest?.('[data-palette="true"]')) return true;
  if (el.closest?.('[data-settings="true"]')) return true;
  if (el.closest?.('[data-notes="true"]')) return true;
  if (el.closest?.('[data-whiteboard-text="true"]')) return true;
  return false;
}

const WEBSITE_TOOLS: Record<string, ToolId> = {
  v: 'cursor',
  p: 'pen',
  m: 'marker',
  h: 'highlighter',
  e: 'eraser',
  i: 'line',
  a: 'arrow',
  r: 'rect',
  o: 'ellipse',
  t: 'text',
  n: 'number',
  s: 'spotlight',
  l: 'laser',
};

const BOARD_TOOLS: Record<string, WbTool> = {
  v: 'select',
  p: 'pen',
  m: 'marker',
  h: 'highlighter',
  e: 'eraser',
  i: 'line',
  a: 'arrow',
  r: 'rect',
  o: 'ellipse',
  t: 'text',
  n: 'number',
  l: 'laser',
  g: 'image',
  x: 'hand',
};

export function useShortcuts(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const state = store.getState();
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key;

      if (key === 'Escape') {
        if (state.cameraDrag) {
          actions.setCameraDrag(false);
          return;
        }
        if (state.paletteOpen) {
          actions.closePalette();
          return;
        }
        if (state.settingsOpen) {
          store.set({ settingsOpen: false });
          return;
        }
        if (state.diagOpen) {
          store.set({ diagOpen: false });
          return;
        }
        if (state.cameraOpen) {
          store.set({ cameraOpen: false });
          return;
        }
        if (state.contextMenu) {
          store.set({ contextMenu: undefined });
          return;
        }
        if (state.spotlight.on) {
          void actions.setSpotlight({ on: false });
          return;
        }
        if (state.cleanMode) {
          store.set({ cleanMode: false });
          return;
        }
        return;
      }

      // Never intercept typing (Ctrl+L / Ctrl+T etc. are handled below).
      const typing = isTypingTarget(e.target);
      if (typing && !(ctrl && ['l', 't', 'w', 'Tab'].includes(key))) {
        return;
      }

      /* ---- tabs ---- */
      if (ctrl && !e.shiftKey && key.toLowerCase() === 't') {
        e.preventDefault();
        void actions.newTab();
        return;
      }
      if (ctrl && e.shiftKey && key.toLowerCase() === 'n') {
        e.preventDefault();
        void actions.newWhiteboardTab();
        return;
      }
      if (ctrl && !e.shiftKey && key.toLowerCase() === 'w') {
        e.preventDefault();
        if (state.activeTabId) void actions.closeTab(state.activeTabId);
        return;
      }
      if (ctrl && e.shiftKey && key.toLowerCase() === 't') {
        e.preventDefault();
        void actions.reopenTab();
        return;
      }
      if (ctrl && key === 'Tab') {
        e.preventDefault();
        const tabs = state.tabs;
        const i = tabs.findIndex((t) => t.id === state.activeTabId);
        const next = e.shiftKey ? (i - 1 + tabs.length) % tabs.length : (i + 1) % tabs.length;
        const target = tabs[next];
        if (target) void actions.activateTab(target.id);
        return;
      }
      if (ctrl && !e.shiftKey && !e.altKey && /^[1-9]$/.test(key)) {
        e.preventDefault();
        const index = key === '9' ? state.tabs.length - 1 : Number(key) - 1;
        const target = state.tabs[index];
        if (target) void actions.activateTab(target.id);
        return;
      }
      if (e.altKey && !ctrl && /^[1-9]$/.test(key)) {
        e.preventDefault();
        const scene = state.scenes[Number(key) - 1];
        if (scene) void actions.applyScene(scene.id);
        return;
      }

      /* ---- present / live ---- */
      if (ctrl && key === 'Enter') {
        e.preventDefault();
        void actions.presentActive();
        return;
      }
      if (ctrl && e.shiftKey && key.toLowerCase() === 'q') {
        e.preventDefault();
        void window.juzt.quit();
        return;
      }
      if (ctrl && e.shiftKey && key.toLowerCase() === 'h') {
        e.preventDefault();
        actions.toggleClean();
        return;
      }
      if (ctrl && e.shiftKey && key.toLowerCase() === 'b') {
        e.preventDefault();
        void actions.pickBackground('live');
        return;
      }
      if (ctrl && e.shiftKey && key.toLowerCase() === 'p') {
        e.preventDefault();
        void actions.setSettings({ prepPaneOpen: !state.settings.prepPaneOpen });
        return;
      }
      if (ctrl && !e.shiftKey && key.toLowerCase() === 'd') {
        e.preventDefault();
        void actions.toggleFavorite();
        return;
      }
      if (ctrl && !e.shiftKey && key.toLowerCase() === 'l') {
        e.preventDefault();
        actions.openPalette();
        return;
      }
      if (ctrl && key.toLowerCase() === 'z') {
        const boardId = sel.activeBoardId(state);
        if (boardId) {
          e.preventDefault();
          if (e.shiftKey) void actions.wbRedo(boardId);
          else void actions.wbUndo(boardId);
        }
        return;
      }
      if (key === 'F8' || key === 'F9' || key === 'F10' || key === 'F11') {
        e.preventDefault();
        if (e.repeat) return;
        if (key === 'F8') void actions.togglePrivacy();
        else if (key === 'F9') void actions.toggleFreeze();
        else if (key === 'F10') void actions.toggleSpotlight();
        else void window.juzt.isFullscreen().then((on) => window.juzt.window.setFullscreen(!on));
        return;
      }
      if (ctrl && (key === '=' || key === '+')) {
        e.preventDefault();
        void actions.adjustZoom(0.1);
        return;
      }
      if (ctrl && key === '-') {
        e.preventDefault();
        void actions.adjustZoom(-0.1);
        return;
      }
      if (ctrl && key === '0') {
        e.preventDefault();
        void actions.setZoom(1);
        return;
      }
      if (ctrl && !e.shiftKey && key.toLowerCase() === 'r') {
        e.preventDefault();
        void actions.reload();
        return;
      }
      if (ctrl && e.shiftKey && key.toLowerCase() === 'r') {
        e.preventDefault();
        void actions.hardReload();
        return;
      }
      if (e.altKey && key === 'ArrowLeft') {
        e.preventDefault();
        void actions.back();
        return;
      }
      if (e.altKey && key === 'ArrowRight') {
        e.preventDefault();
        void actions.forward();
        return;
      }

      if (typing || ctrl || e.altKey) return;

      /* ---- tools (context sensitive) ---- */
      const lower = key.toLowerCase();
      const boardId = sel.activeBoardId(state);
      if (boardId) {
        const tool = BOARD_TOOLS[lower];
        if (tool) {
          e.preventDefault();
          store.set({ wbTool: tool });
        }
        if (key === '[') store.set((s) => ({ wbStyle: { ...s.wbStyle, size: Math.max(1, s.wbStyle.size - 2) } }));
        if (key === ']') store.set((s) => ({ wbStyle: { ...s.wbStyle, size: Math.min(80, s.wbStyle.size + 2) } }));
        if (key === 'Delete' && state.wbSelection.length) {
          e.preventDefault();
        }
        return;
      }
      const tool = WEBSITE_TOOLS[lower];
      if (tool) {
        e.preventDefault();
        actions.setTool(tool);
      }
      if (key === '[') {
        e.preventDefault();
        actions.nudgeInkSize(-2);
      }
      if (key === ']') {
        e.preventDefault();
        actions.nudgeInkSize(2);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [enabled]);
}
