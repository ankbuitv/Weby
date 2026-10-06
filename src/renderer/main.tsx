import React from 'react';
import { createRoot } from 'react-dom/client';
import type { Favorite, HistoryEntry, Scene, Settings, TabState, WhiteboardMeta, WbObject, WbOp } from '../shared/types';
import App from './App';
import { actions } from './state/actions';
import { store } from './state/store';
import './styles/global.css';

/**
 * PREP renderer entry.
 *
 * One `getState()` round trip for the first paint, then everything arrives as
 * events. No polling, no per-frame IPC, no timers that keep the CPU warm.
 *
 * Board documents are patched locally from ops so the editor never needs a
 * round trip per stroke — main owns the authoritative document.
 */

const api = window.juzt;

void boot().catch((error) => {
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `<div style="font:14px system-ui;color:#cfd6e4;padding:28px">Juzt could not start: ${String(error)}</div>`;
  }
});

async function boot(): Promise<void> {
  api.on.bootstrapState((payload) => store.hydrate(payload as Parameters<typeof store.hydrate>[0]));

  api.on.tabs(({ order, activeId, changed }) => {
    store.set((s) => {
      const byId = new Map(s.tabs.map((t) => [t.id, t] as const));
      for (const tab of changed as TabState[]) byId.set(tab.id, { ...(byId.get(tab.id) ?? {}), ...tab } as TabState);
      const tabs = order.map((id) => byId.get(id)).filter((t): t is TabState => !!t);
      return { tabs, activeTabId: activeId };
    });
  });

  api.on.live((payload) => store.set({ live: payload, masks: payload.masks, spotlight: payload.spotlight }));
  api.on.settings((settings: Settings) => store.set({ settings }));
  api.on.scenes(({ scenes, activeSceneId }) => store.set({ scenes: scenes as Scene[], activeSceneId }));
  api.on.favorites((favorites: Favorite[]) => store.set({ favorites }));
  api.on.history((history: HistoryEntry[]) => store.set({ history }));
  api.on.diag((payload) => store.set((s) => ({ diagStats: { ...s.diagStats, ...payload } })));

  api.on.boardDoc((doc) => store.set((s) => ({ boardDocs: { ...s.boardDocs, [doc.id]: doc } })));
  api.on.boardOps(({ boardId, ops, rev }) => {
    store.set((s) => {
      const doc = s.boardDocs[boardId];
      if (!doc) return {};
      let objects = doc.objects;
      let theme = doc.theme;
      let view = doc.view;
      for (const op of ops as WbOp[]) {
        switch (op.type) {
          case 'add':
            objects = [...objects, ...op.objects];
            break;
          case 'delete': {
            const ids = new Set(op.ids);
            objects = objects.filter((o) => !ids.has(o.id));
            break;
          }
          case 'move':
            objects = objects.map((o) => (op.ids.includes(o.id) ? translate(o, op.dx, op.dy) : o));
            break;
          case 'replace':
            objects = objects.map((o) => (o.id === op.id ? op.object : o));
            break;
          case 'clear':
            objects = [];
            break;
          case 'theme':
            theme = op.theme;
            break;
          case 'view':
            view = op.view;
            break;
          default:
            break;
        }
      }
      return { boardDocs: { ...s.boardDocs, [boardId]: { ...doc, objects, theme, view, rev } } };
    });
  });

  api.on.permissionRequest((request) => store.set({ permission: request }));
  api.on.screenSources(({ sources, requestId }) => store.set({ screenSources: sources, sourceRequestId: requestId }));
  api.on.presentProgress(({ stage, message }) => {
    store.set({ presentProgress: stage === 'idle' ? null : { stage, message } });
    if (stage === 'error' && message) actions.toast(message, 'error');
  });
  api.on.previewFrame((dataUrl) => store.set({ previewFrame: dataUrl || undefined }));
  api.on.focusRestored(({ ms }) => store.set((s) => ({ diagStats: { ...s.diagStats, focusRestoreMs: ms } })));
  api.on.toast((toast) => store.set((s) => ({ toasts: [...s.toasts, toast].slice(-3) })));
  api.on.inkState((state) => store.set({ inkCount: state.count ?? 0, canUndoInk: !!state.canUndo, canRedoInk: !!state.canRedo }));

  const bootstrap = await api.getState();
  store.hydrate(bootstrap);
  store.set({ ready: true });

  if (store.getState().dev || store.getState().diagOpen) {
    const { startFrameProbe, setDiagEnabled } = await import('./diag');
    setDiagEnabled(true);
    startFrameProbe((fps) => store.set((s) => ({ diagStats: { ...s.diagStats, fps } })));
  }

  const root = document.getElementById('root');
  if (!root) return;
  createRoot(root).render(<App />);
}

function translate(o: WbObject, dx: number, dy: number): WbObject {
  switch (o.kind) {
    case 'stroke': {
      const points = o.points.slice();
      for (let i = 0; i < points.length; i += 2) {
        points[i] += dx;
        points[i + 1] += dy;
      }
      return { ...o, points };
    }
    case 'line':
    case 'arrow':
    case 'rect':
    case 'ellipse':
      return { ...o, x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy };
    default:
      return { ...o, x: o.x + dx, y: o.y + dy };
  }
}
