/**
 * Tab list behaviour: ordering, pinning, closing rules, reopen and Ctrl+1..9.
 *
 * Main owns the authoritative list, but the PREP strip updates optimistically
 * from the same pure functions — so these tests cover both paths at once.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_TABS,
  activeTab,
  activate,
  activateIndex,
  activateNumber,
  closeOthers,
  closeTab,
  closeToRight,
  countBackground,
  cycle,
  indexOf,
  insertIndexFor,
  openTab,
  reopen,
  reorder,
  setPinned,
  updateTab,
} from '../dist/test/shared/tabs.js';

const web = (id, url = `https://example.com/${id}`, extra = {}) => ({
  id,
  kind: 'web',
  url,
  title: id,
  favicon: undefined,
  loading: false,
  canGoBack: false,
  canGoForward: false,
  pinned: false,
  muted: false,
  discardable: true,
  private: false,
  zoom: 1,
  ...extra,
});

const board = (id, name = id) => ({
  id,
  kind: 'whiteboard',
  boardId: `b_${id}`,
  name,
  pinned: false,
  private: false,
  zoom: 1,
});

function seed(...tabs) {
  return tabs.reduce((list, tab) => openTab(list, tab), EMPTY_TABS);
}

test('opening activates by default and can be backgrounded', () => {
  let list = seed(web('a'));
  assert.equal(list.activeId, 'a');
  list = openTab(list, web('b'), { activate: false });
  assert.equal(list.activeId, 'a', 'a background tab must not steal focus');
  assert.deepEqual(list.tabs.map((t) => t.id), ['a', 'b']);
  list = openTab(list, board('c'));
  assert.equal(list.activeId, 'c');
  assert.equal(activeTab(list).kind, 'whiteboard');
});

test('pinned tabs always sit before unpinned ones', () => {
  let list = seed(web('a'));
  list = openTab(list, web('b'), { activate: false });
  list = setPinned(list, 'b', true);
  assert.deepEqual(list.tabs.map((t) => t.id), ['b', 'a']);
  list = openTab(list, web('c'), { activate: false });
  assert.deepEqual(list.tabs.map((t) => t.id), ['b', 'a', 'c'], 'a new tab opens at the end, never before the pinned block');
  assert.equal(insertIndexFor(list, true), 1, 'a new *pinned* tab goes after the pinned block');
});

test('closing the active tab activates its neighbour, never nothing', () => {
  let list = seed(web('a'), web('b'), web('c'));
  list = activate(list, 'b');
  list = closeTab(list, 'b');
  assert.deepEqual(list.tabs.map((t) => t.id), ['a', 'c']);
  assert.equal(list.activeId, 'c', 'the tab to the right takes over');

  list = closeTab(list, 'c');
  assert.equal(list.activeId, 'a', 'the last one closes to the left neighbour');

  list = closeTab(list, 'a');
  assert.equal(list.activeId, null);
  assert.deepEqual(list.tabs, []);
});

test('closing a background tab leaves the active tab alone', () => {
  let list = seed(web('a'), web('b'));
  list = closeTab(list, 'a');
  assert.equal(list.activeId, 'b');
});

test('closing a presented or private tab is handled by ids only', () => {
  let list = seed(web('p', 'https://example.com/private', { private: true }), web('q'));
  list = closeTab(list, 'p');
  assert.deepEqual(list.tabs.map((t) => t.id), ['q']);
  assert.equal(list.closed.length, 1, 'closed tabs are remembered for Ctrl+Shift+T');
});

test('close others keeps exactly one tab and its active state', () => {
  let list = seed(web('a'), web('b'), web('c'));
  list = closeOthers(list, 'b');
  assert.deepEqual(list.tabs.map((t) => t.id), ['b']);
  assert.equal(list.activeId, 'b');
  assert.equal(list.closed.length, 2);
});

test('close to the right only removes the tabs after the anchor', () => {
  let list = seed(web('a'), web('b'), web('c'), web('d'));
  list = activate(list, 'c');
  list = closeToRight(list, 'b');
  assert.deepEqual(list.tabs.map((t) => t.id), ['a', 'b']);
  assert.equal(list.activeId, 'b', 'the active tab was closed, so the anchor takes over');
});

test('the reopen stack hands back the record with its original position', () => {
  let list = seed(web('a'), web('b'), web('c'));
  list = closeTab(list, 'b');
  const { list: after, record } = reopen(list);

  assert.equal(record.kind, 'web');
  assert.equal(record.url, 'https://example.com/b');
  assert.equal(record.index, 1, 'the original slot is remembered so the tab comes back where it was');
  assert.equal(record.pinned, false);
  assert.deepEqual(after.tabs.map((t) => t.id), ['a', 'c'], 'popping the stack does not reinsert by itself');
  assert.equal(after.closed.length, 0);

  const empty = reopen(after);
  assert.equal(empty.record, null, 'reopening with an empty stack reports nothing');
});

test('a reopened tab is recreated and moved back to its old slot', () => {
  // This mirrors what TabManager.reopen() does: pop, recreate, then reorder.
  let list = seed(web('a'), web('b'), web('c'));
  list = closeTab(list, 'b');
  const { list: popped, record } = reopen(list);
  const recreated = { ...web('b2'), url: record.url, title: record.title };
  let restored = openTab(popped, recreated, { activate: true });
  restored = reorder(restored, restored.tabs.findIndex((t) => t.id === 'b2'), record.index);

  assert.deepEqual(restored.tabs.map((t) => t.url ?? t.id), ['https://example.com/a', 'https://example.com/b', 'https://example.com/c']);
  assert.equal(restored.activeId, 'b2');
});

test('reopening restores a whiteboard with its board id', () => {
  let list = seed(board('x'));
  const meta = list.tabs[0];
  list = closeTab(list, 'x');
  const { record } = reopen(list);
  assert.equal(record.kind, 'whiteboard');
  assert.equal(record.boardId, meta.boardId);
  assert.equal(record.title, 'x');
});

test('the reopen stack is bounded', () => {
  let list = seed(...Array.from({ length: 30 }, (_, i) => web(`t${i}`)));
  for (let i = 0; i < 30; i += 1) list = closeTab(list, `t${i}`);
  assert.ok(list.closed.length <= 25, `stack grew to ${list.closed.length}`);
});

test('Ctrl+Tab cycles with wraparound in both directions', () => {
  let list = seed(web('a'), web('b'), web('c'));
  list = activate(list, 'a');
  list = cycle(list, 1);
  assert.equal(list.activeId, 'b');
  list = cycle(list, -1);
  assert.equal(list.activeId, 'a');
  list = cycle(list, -1);
  assert.equal(list.activeId, 'c', 'cycling backwards from the first tab wraps');
});

test('Ctrl+1..8 pick a position; Ctrl+9 picks the last tab', () => {
  const list = seed(web('a'), web('b'), web('c'));
  assert.equal(activateNumber(list, 2).activeId, 'b');
  assert.equal(activateNumber(list, 9).activeId, 'c');
  assert.equal(activateIndex(list, 0).activeId, 'a');
  assert.equal(activateIndex(list, 99).activeId, 'c', 'an out-of-range index is clamped, not a crash');
  assert.equal(indexOf(list, 'c'), 2);
});

test('reordering keeps the same tab active', () => {
  let list = seed(web('a'), web('b'), web('c'));
  list = activate(list, 'c');
  list = reorder(list, 2, 0);
  assert.deepEqual(list.tabs.map((t) => t.id), ['c', 'a', 'b']);
  assert.equal(list.activeId, 'c');
});

test('patching a tab never mutates the list', () => {
  const list = seed(web('a'));
  const before = JSON.stringify(list);
  const next = updateTab(list, 'a', { title: 'Renamed', loading: true });
  assert.equal(JSON.stringify(list), before);
  assert.equal(next.tabs[0].title, 'Renamed');
  assert.equal(next.tabs[0].loading, true);
});

test('background tab accounting feeds the memory policy', () => {
  let list = seed(web('a'), web('b'), web('c'));
  list = activate(list, 'b');
  assert.equal(countBackground(list), 2);
  list = activate(list, 'a');
  assert.equal(countBackground(list), 2);
});
