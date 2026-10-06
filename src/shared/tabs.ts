/**
 * Pure tab-list logic shared by main (authoritative tab manager) and the PREP
 * renderer (instant, optimistic UI updates).
 *
 * Keeping this pure means the interesting behaviour — ordering, pinning,
 * reopen, "close others", "close to the right", Ctrl+1..9 — is unit-testable
 * without Electron.
 */

import type { ReopenRecord, TabState } from './types';

export interface TabList {
  tabs: TabState[];
  activeId: string | null;
  closed: ReopenRecord[];
}

export const EMPTY_TABS: TabList = { tabs: [], activeId: null, closed: [] };

const MAX_CLOSED = 25;

export function activeTab(list: TabList): TabState | null {
  return list.tabs.find((t) => t.id === list.activeId) ?? null;
}

export function indexOf(list: TabList, id: string): number {
  return list.tabs.findIndex((t) => t.id === id);
}

export function insertIndexFor(list: TabList, pinned: boolean): number {
  if (!pinned) return list.tabs.length;
  let i = 0;
  while (i < list.tabs.length && list.tabs[i].pinned) i += 1;
  return i;
}

export function openTab(list: TabList, tab: TabState, opts: { activate?: boolean } = {}): TabList {
  const at = insertIndexFor(list, tab.pinned);
  const tabs = [...list.tabs.slice(0, at), tab, ...list.tabs.slice(at)];
  return { ...list, tabs, activeId: opts.activate === false ? list.activeId : tab.id };
}

export function closeTab(list: TabList, id: string): TabList {
  const i = indexOf(list, id);
  if (i < 0) return list;
  const tab = list.tabs[i];
  const tabs = list.tabs.filter((t) => t.id !== id);
  let activeId = list.activeId;
  if (activeId === id) {
    const next = tabs[Math.min(i, tabs.length - 1)];
    activeId = next ? next.id : null;
  }
  const record: ReopenRecord = {
    kind: tab.kind,
    url: tab.kind === 'web' ? tab.url : undefined,
    boardId: tab.kind === 'whiteboard' ? tab.boardId : undefined,
    pinned: tab.pinned,
    index: i,
    title: tab.kind === 'web' ? tab.title : tab.name,
  };
  return { tabs, activeId, closed: [record, ...list.closed].slice(0, MAX_CLOSED) };
}

export function closeOthers(list: TabList, id: string): TabList {
  const keep = list.tabs.find((t) => t.id === id);
  if (!keep) return list;
  const removed = list.tabs.filter((t) => t.id !== id);
  const closed = [...removed.map(toRecord), ...list.closed].slice(0, MAX_CLOSED);
  return { tabs: [keep], activeId: id, closed };
}

export function closeToRight(list: TabList, id: string): TabList {
  const i = indexOf(list, id);
  if (i < 0) return list;
  const removed = list.tabs.slice(i + 1);
  if (removed.length === 0) return list;
  const tabs = list.tabs.slice(0, i + 1);
  const closed = [...removed.map(toRecord), ...list.closed].slice(0, MAX_CLOSED);
  const activeId = tabs.some((t) => t.id === list.activeId) ? list.activeId : tabs[tabs.length - 1].id;
  return { tabs, activeId, closed };
}

function toRecord(tab: TabState): ReopenRecord {
  return {
    kind: tab.kind,
    url: tab.kind === 'web' ? tab.url : undefined,
    boardId: tab.kind === 'whiteboard' ? tab.boardId : undefined,
    pinned: tab.pinned,
    index: 0,
    title: tab.kind === 'web' ? tab.title : tab.name,
  };
}

export function reopen(list: TabList): { list: TabList; record: ReopenRecord | null } {
  const [record, ...closed] = list.closed;
  if (!record) return { list, record: null };
  return { list: { ...list, closed }, record };
}

export function activate(list: TabList, id: string): TabList {
  return indexOf(list, id) < 0 ? list : { ...list, activeId: id };
}

export function activateIndex(list: TabList, index: number): TabList {
  const tab = list.tabs[index];
  return tab ? { ...list, activeId: tab.id } : list;
}

/** Ctrl+1..8 select that tab, Ctrl+9 selects the last tab. */
export function activateNumber(list: TabList, n: number): TabList {
  if (n === 9) return list.tabs.length ? { ...list, activeId: list.tabs[list.tabs.length - 1].id } : list;
  return activateIndex(list, n - 1);
}

export function cycle(list: TabList, delta: number): TabList {
  if (list.tabs.length < 2) return list;
  const i = indexOf(list, list.activeId ?? '');
  const next = (i + delta + list.tabs.length) % list.tabs.length;
  return { ...list, activeId: list.tabs[next].id };
}

export function reorder(list: TabList, from: number, to: number): TabList {
  if (from === to || from < 0 || to < 0 || from >= list.tabs.length || to >= list.tabs.length) return list;
  const tabs = [...list.tabs];
  const [moved] = tabs.splice(from, 1);
  tabs.splice(to, 0, moved);
  // Pinned tabs always stay in front after a drag.
  const pinned = tabs.filter((t) => t.pinned);
  const rest = tabs.filter((t) => !t.pinned);
  return { ...list, tabs: [...pinned, ...rest] };
}

export function updateTab(list: TabList, id: string, patch: Partial<TabState>): TabList {
  const i = indexOf(list, id);
  if (i < 0) return list;
  const tabs = [...list.tabs];
  tabs[i] = { ...tabs[i], ...patch } as TabState;
  return { ...list, tabs };
}

export function setPinned(list: TabList, id: string, pinned: boolean): TabList {
  const updated = updateTab(list, id, { pinned } as Partial<TabState>);
  const i = indexOf(updated, id);
  if (i < 0) return updated;
  const tab = updated.tabs[i];
  const tabs = updated.tabs.filter((t) => t.id !== id);
  const at = insertIndexFor({ ...updated, tabs }, pinned);
  tabs.splice(at, 0, tab);
  return { ...updated, tabs };
}

/**
 * Which web tabs may be discarded to reclaim memory. Conservative on purpose:
 * only long-idle, inactive, unpinned, silent, untrashed background tabs.
 */
export function discardCandidates(
  list: TabList,
  idleSince: Record<string, number>,
  now: number,
  minIdleMs: number,
  protectedIds: ReadonlySet<string>,
): string[] {
  return list.tabs
    .filter((t) => t.kind === 'web')
    .filter((t) => t.id !== list.activeId && !t.pinned && !t.muted && !t.audible && !protectedIds.has(t.id))
    .filter((t) => now - (idleSince[t.id] ?? now) > minIdleMs)
    .map((t) => t.id);
}

export function countBackground(list: TabList): number {
  return list.tabs.filter((t) => t.id !== list.activeId).length;
}
