/**
 * Palette command catalogue and the `>` autocomplete.
 *
 * The catalogue is data; execution lives in the PREP renderer. What matters
 * here is that the fuzzy matcher is predictable, that every command has a hint
 * (no developer-looking surface), and that the audience-touching ones are marked.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, matchCommands, completeArg } from '../dist/test/shared/commands.js';

const required = [
  'present',
  'stop',
  'privacy',
  'freeze',
  'spotlight',
  'holding',
  'clean',
  'layout',
  'size',
  'radius',
  'theme',
  'background',
  'board',
  'scene',
  'export',
  'zoom',
  'fullscreen',
  'notes',
  'camera',
  'settings',
  'diagnostics',
  'about',
  'quit',
];

test('every documented command exists exactly once', () => {
  const names = COMMANDS.map((c) => c.name);
  assert.equal(new Set(names).size, names.length, 'duplicate command names');
  for (const name of required) assert.ok(names.includes(name), `>${name} is missing`);
});

test('no command leaks developer jargon into the palette', () => {
  const banned = /ipc|webcontents|renderer|json|node|api|debug/i;
  for (const command of COMMANDS) {
    assert.ok(command.hint.length > 0, `>${command.name} has no hint`);
    assert.equal(banned.test(command.hint), false, `>${command.name} hint reads like an internal: "${command.hint}"`);
  }
});

test('audience-touching commands are marked, prep-only ones are not', () => {
  const audience = new Set(['present', 'stop', 'privacy', 'freeze', 'spotlight', 'holding', 'layout', 'size', 'radius', 'theme', 'background']);
  for (const command of COMMANDS) {
    assert.equal(!!command.audience, audience.has(command.name), `>${command.name} audience flag`);
  }
  assert.equal(COMMANDS.find((c) => c.name === 'notes').audience, undefined, 'notes are private');
});

test('prefix matches come first', () => {
  const matches = matchCommands('pre', 5);
  assert.equal(matches[0].name, 'present');
  assert.ok(matches[0].positions.length > 0, 'match positions are reported for highlighting');
});

test('word starts beat interior subsequences', () => {
  const names = matchCommands('sp', 6).map((m) => m.name);
  assert.equal(names[0], 'spotlight', names.join(','));
});

test('option arguments autocomplete and free arguments stay free', () => {
  const size = COMMANDS.find((c) => c.name === 'size');
  assert.ok(size.arg.options.includes('16:9'));
  assert.equal(completeArg(size, 'co'), 'comfortable');
  assert.equal(completeArg(size, 'zzz'), null);

  const board = COMMANDS.find((c) => c.name === 'board');
  assert.equal(board.arg.free, true);
  assert.equal(completeArg(board, 'anything'), null, 'a free argument is never rewritten');
});

test('an empty query lists commands instead of nothing', () => {
  assert.ok(matchCommands('', 8).length > 0);
});

test('a query that matches nothing returns nothing (the palette then offers search)', () => {
  assert.deepEqual(matchCommands('zzzzqqq', 8), []);
});

test('the result count is respected', () => {
  assert.ok(matchCommands('', 3).length <= 3);
  assert.ok(matchCommands('e', 10).length <= 10);
});
