/**
 * Workspace / audience render invariants.
 *
 * These are the promises the V2 restoration rests on, asserted against the pure
 * resolver that BOTH main (native view routing) and the PREP renderer (DOM
 * surface) call. If a future change lets two content surfaces stack, or lets a
 * holding screen appear over normal browsing, this file fails the build.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAudience, resolveWorkspace, overlayNeeded } from '../dist/test/shared/workspace.js';

const webTab = (id, url) => ({
  id,
  kind: 'web',
  title: id,
  url,
  loading: false,
  canGoBack: false,
  canGoForward: false,
  muted: false,
  audible: false,
  pinned: false,
  discarded: false,
});

const boardTab = (id) => ({ id, kind: 'whiteboard', boardId: `b_${id}`, name: 'Physics', pinned: false });

const base = { mode: 'single', active: null, privacy: false, frozen: false, presentation: 'holding' };

test('single mode never resolves to a holding screen', () => {
  for (const presentation of ['holding', 'tab', 'board']) {
    assert.equal(resolveAudience({ ...base, mode: 'single', presentation }), null, `${presentation} must not create an audience surface`);
  }
});

test('dual mode resolves exactly one audience surface', () => {
  const seen = new Set();
  for (const presentation of ['holding', 'tab', 'board']) {
    for (const privacy of [false, true]) {
      for (const frozen of [false, true]) {
        const kind = resolveAudience({ ...base, mode: 'dual', presentation, privacy, frozen });
        assert.ok(kind, 'dual mode always has an audience surface');
        seen.add(kind);
      }
    }
  }
  assert.deepEqual([...seen].sort(), ['frozen', 'holding', 'privacy', 'web', 'whiteboard']);
});

test('privacy and freeze outrank whatever was being presented', () => {
  assert.equal(resolveAudience({ ...base, mode: 'dual', presentation: 'tab', privacy: true }), 'privacy');
  assert.equal(resolveAudience({ ...base, mode: 'dual', presentation: 'board', frozen: true }), 'frozen');
  assert.equal(resolveWorkspace({ ...base, active: webTab('t1', 'https://example.com'), privacy: true }).overlay, 'privacy');
  assert.equal(resolveWorkspace({ ...base, active: webTab('t1', 'https://example.com'), frozen: true }).overlay, 'freeze');
});

test('exactly one primary workspace surface at a time', () => {
  const cases = [
    [{ ...base, active: null }, 'newtab'],
    [{ ...base, active: webTab('t1', 'juzt://newtab') }, 'newtab'],
    [{ ...base, active: webTab('t1', 'https://example.com') }, 'web'],
    [{ ...base, active: boardTab('t2') }, 'whiteboard'],
    [{ ...base, active: webTab('t1', 'https://example.com'), privacy: true }, 'web'],
    [{ ...base, active: boardTab('t2'), privacy: true }, 'whiteboard'],
    [{ ...base, active: webTab('t1', 'https://example.com'), frozen: true }, 'web'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(resolveWorkspace(input).kind, expected, JSON.stringify(input));
    assert.equal(resolveWorkspace(input).overlay === 'none' || input.privacy || input.frozen, true);
  }
});

test('a website tab is only ever on screen while it is the active one', () => {
  const input = { ...base, active: webTab('t2', 'https://example.com') };
  assert.equal(resolveWorkspace(input).kind, 'web');
  // The resolver is driven by the *active* tab only, so a background tab can
  // never be the visible surface.
  assert.equal(resolveWorkspace({ ...input, active: webTab('t1', 'https://other.com') }).kind, 'web');
  assert.equal(resolveWorkspace({ ...input, active: boardTab('t3') }).kind, 'whiteboard');
});

test('the overlay is mapped only when it has work to do', () => {
  const idle = { mode: 'single', active: webTab('t1', 'https://example.com'), privacy: false, frozen: false, presentation: 'tab', drawing: false, committedInk: false, cameraDrag: false, effects: false };
  assert.equal(overlayNeeded(idle), false, 'an idle overlay would swallow every click meant for the website');

  assert.equal(overlayNeeded({ ...idle, drawing: true }), true);
  assert.equal(overlayNeeded({ ...idle, committedInk: true }), true);
  assert.equal(overlayNeeded({ ...idle, cameraDrag: true }), true);
  assert.equal(overlayNeeded({ ...idle, effects: true }), true);
  assert.equal(overlayNeeded({ ...idle, privacy: true }), true);
  assert.equal(overlayNeeded({ ...idle, frozen: true }), true);
});
