/**
 * Audience-safety invariants.
 *
 * These are the promises the whole product rests on: LIVE cannot reach prep
 * data, and nothing that reaches LIVE can contain a URL, a title or history.
 * They are asserted against the real shared modules and against a scan of the
 * main-process source, so a future edit that widens the surface fails the build.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CH, EV, LIVE_ALLOWED } from '../dist/test/shared/ipc.js';

const root = new URL('..', import.meta.url).pathname;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

test('LIVE can only invoke its own, effect-only channels', () => {
  const forbidden = [
    CH.APP_SET_SETTINGS,
    CH.APP_QUIT,
    CH.TAB_NEW,
    CH.TAB_CLOSE,
    CH.TAB_NAVIGATE,
    CH.TAB_OPEN_PRIVATE,
    CH.BOARD_CREATE,
    CH.BOARD_DELETE,
    CH.FAV_ADD,
    CH.HIST_LIST,
    CH.HIST_CLEAR,
    CH.PERM_RESPOND,
    CH.FILE_SAVE_IMAGE_DATA,
    CH.FILE_OPEN_IMAGE,
    CH.DISPLAY_SET_OUTPUT,
    CH.SCENE_SAVE,
  ];
  for (const channel of forbidden) {
    assert.equal(LIVE_ALLOWED.has(channel), false, `LIVE must not reach ${channel}`);
  }
});

test('LIVE may not write files or drive navigation', () => {
  // The audience window is allowed exactly one window channel: the read-only
  // "am I fullscreen?" query, so Esc behaves. Nothing that mutates is reachable.
  const readOnlyWindowChannels = new Set([CH.WIN_IS_FULLSCREEN]);
  for (const channel of LIVE_ALLOWED) {
    assert.ok(!channel.startsWith('tab:'), channel);
    assert.ok(!channel.startsWith('board:'), channel);
    assert.ok(!channel.startsWith('file:'), channel);
    assert.ok(!channel.startsWith('hist:'), channel);
    assert.ok(!channel.startsWith('fav:'), channel);
    assert.ok(!channel.startsWith('perm:'), channel);
    assert.ok(!channel.startsWith('bg:'), channel);
    assert.ok(!channel.startsWith('scene:'), channel);
    assert.ok(!channel.startsWith('app:setSettings'), channel);
    if (channel.startsWith('win:')) assert.ok(readOnlyWindowChannels.has(channel), `${channel} is not a read-only window channel`);
  }
});

test('the annotation/effects channels LIVE may use are exactly the intended set', () => {
  const intended = new Set([CH.LIVE_REQUEST_STATE, CH.LIVE_SET_SPOTLIGHT, CH.LIVE_LASER, CH.LIVE_ANNOTATION, CH.LIVE_CAMERA, CH.DIAG_REPORT]);
  for (const channel of intended) assert.ok(LIVE_ALLOWED.has(channel), `${channel} should be allowed`);
  const extras = [...LIVE_ALLOWED].filter((c) => !intended.has(c));
  assert.deepEqual(extras.sort(), [CH.APP_STATE, CH.WIN_IS_FULLSCREEN, CH.SHELL_OPEN_EXTERNAL].sort());
});

test('the public live event carries no private fields', () => {
  // A structural check on the payload contract: LivePayload must not mention
  // urls, titles of prep tabs, history or favorites.
  const types = readFileSync(join(root, 'src/shared/types.ts'), 'utf8');
  const payload = types.slice(types.indexOf('export interface LivePayload'), types.indexOf('export interface LivePayload') + 900);
  for (const leak of ['url', 'urls', 'history', 'favorite', 'favicon', 'private', 'notes']) {
    assert.equal(new RegExp(`\\b${leak}\\b`).test(payload), false, `LivePayload must not carry ${leak}`);
  }
  assert.ok(payload.includes('presentation'), 'the payload must describe what is being shown');
  assert.ok(payload.includes('flags'), 'the payload must carry the audience flags');
});

test('preload exposes a live API without tab, board or file reach', () => {
  const preload = readFileSync(join(root, 'src/preload/index.ts'), 'utf8');
  const liveSection = preload.slice(preload.indexOf('const liveApi'), preload.indexOf('const overlayApi'));
  for (const banned of ['CH.TAB_', 'CH.BOARD_', 'CH.FILE_', 'CH.FAV_', 'CH.HIST_', 'CH.PERM_', 'CH.APP_SET_SETTINGS', 'CH.APP_QUIT']) {
    assert.equal(liveSection.includes(banned), false, `liveApi must not touch ${banned}`);
  }
  assert.ok(liveSection.includes('EV.LIVE'), 'liveApi subscribes to the public payload');
});

test('security-relevant webPreferences are never weakened', () => {
  const main = walk(join(root, 'src/main'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
  assert.equal(/webSecurity\s*:\s*false/.test(main), false, 'webSecurity must never be disabled');
  assert.equal(/nodeIntegration\s*:\s*true/.test(main), false, 'nodeIntegration must never be enabled');
  assert.equal(/allowRunningInsecureContent\s*:\s*true/.test(main), false);
  assert.equal(/ignore-certificate-errors/i.test(main), false, 'TLS must not be bypassed');
  assert.equal(/disableHardwareAcceleration\s*\(/.test(main), false, 'hardware acceleration must not be disabled');
  assert.equal(/certificate-error.*preventDefault/s.test(main), false);

  assert.ok(/contextIsolation:\s*true/.test(main), 'contextIsolation must be explicit');
  assert.ok(/nodeIntegration:\s*false/.test(main), 'nodeIntegration must be explicit');
  assert.ok(/sandbox:\s*true/.test(main), 'website views must run sandboxed');
});

test('IPC handlers validate their sender', () => {
  const ipcutil = readFileSync(join(root, 'src/main/ipcutil.ts'), 'utf8');
  assert.ok(/setSenderRegistry/.test(ipcutil), 'the sender registry must exist');
  assert.ok(/isDestroyed/.test(ipcutil), 'destroyed senders must be rejected');
  assert.ok(/assertChannel|assertSender|registerPrep/.test(ipcutil));
});

test('the media protocol is allow-listed, never an open file proxy', () => {
  const media = readFileSync(join(root, 'src/main/media.ts'), 'utf8');
  assert.ok(/allow/i.test(media), 'the media handler must check an allow-list');
  assert.ok(!/registerFileProtocol/.test(media), 'file: must not be registered globally');
});

test('no throttling kill-switches in main', () => {
  const main = walk(join(root, 'src/main'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
  assert.equal(/disable-renderer-backgrounding/.test(main), false);
  assert.equal(/disable-background-timer-throttling/.test(main), false);
  assert.equal(/disable-backgrounding-occluded-windows/.test(main), false);
});

test('events the PREP UI relies on exist under stable names', () => {
  for (const key of ['LIVE', 'TABS', 'GEOM', 'TOOL', 'INK_OP', 'INK_LIVE', 'LASER', 'FRAME', 'BOARD_DOC', 'BOARD_OPS', 'PRESENT_PROGRESS', 'TOAST']) {
    assert.ok(typeof EV[key] === 'string' && EV[key].length > 0, `EV.${key} is missing`);
  }
  // Channel names are namespaced so a typo is obvious in logs.
  for (const value of Object.values(CH)) assert.ok(value.includes(':'), value);
  for (const value of Object.values(EV)) assert.ok(value.startsWith('ev:'), value);
});
