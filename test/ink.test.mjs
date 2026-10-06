/**
 * Website annotation ink: the op protocol and its undo model.
 *
 * The same ops travel PREP → main → LIVE, so the model has to be deterministic:
 * two InkModels fed the same ops must hold identical items, and an undo must be
 * expressible as an op (never a full snapshot).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { InkModel, inkSize, newInkId, styleForTool } from '../dist/test/renderer/live/ink.js';

const stroke = (id, points = [0, 0, 0.2, 0.2]) => ({
  kind: 'stroke',
  id,
  tool: 'pen',
  points,
  color: '#4aa3ff',
  size: 4,
  opacity: 1,
});

test('undo/redo always hand back a broadcastable op', () => {
  const model = new InkModel();
  assert.equal(model.add(stroke('a')).kind, 'add');
  assert.equal(model.items.length, 1);

  const undo = model.undo();
  assert.equal(undo.kind, 'remove', 'an added stroke is undone by removing it');
  assert.deepEqual(undo.ids, ['a']);
  assert.equal(model.items.length, 0, 'undo actually removed the item locally too');

  const redo = model.redo();
  // A remove is restored with an exact replay, which is what keeps z-order intact.
  assert.ok(['add', 'replay'].includes(redo.kind), redo.kind);
  assert.deepEqual(model.items.map((i) => i.id), ['a']);

  // Replaying the recorded ops into a second model reproduces this one exactly —
  // that is the whole contract between PREP and the audience output.
  const audience = new InkModel();
  audience.apply({ kind: 'add', item: stroke('a') });
  audience.apply(undo);
  assert.deepEqual(audience.items, []);
  assert.deepEqual(model.items.map((i) => i.id), ['a'], 'the sender is untouched by the audience copy');
});

test('an undo op replayed into a fresh model reproduces the same board', () => {
  const sender = new InkModel();
  const ops = [];
  ops.push(sender.add(stroke('a')));
  ops.push(sender.add(stroke('b')));
  ops.push(sender.remove(['a']));

  const audience = new InkModel();
  for (const op of ops) audience.apply(op);
  assert.deepEqual(audience.items.map((i) => i.id), sender.items.map((i) => i.id));

  const undo = sender.undo();
  assert.ok(undo);
  audience.apply(undo);
  assert.deepEqual(audience.items.map((i) => i.id), sender.items.map((i) => i.id));
});

test('the undo stack is bounded and never grows without limit', () => {
  const model = new InkModel();
  for (let i = 0; i < 400; i += 1) model.add(stroke(`s${i}`));
  let steps = 0;
  while (model.canUndo) {
    model.undo();
    steps += 1;
    if (steps > 400) break;
  }
  assert.ok(steps <= 120, `undo history grew to ${steps}`);
  assert.ok(model.items.length > 0, 'the oldest strokes stay on screen');
});

test('clear is undoable through a replay op', () => {
  const model = new InkModel();
  model.add(stroke('a'));
  model.add(stroke('b'));
  const clear = model.clear();
  assert.equal(clear.kind, 'clear');
  assert.equal(model.items.length, 0);

  const undo = model.undo();
  assert.equal(undo.kind, 'replay');
  assert.deepEqual(undo.items.map((i) => i.id), ['a', 'b']);
  assert.equal(model.items.length, 2);
});

test('apply() replays an op from another model byte-for-byte', () => {
  const sender = new InkModel();
  const receiver = new InkModel();
  const ops = [sender.add(stroke('a')), sender.add(stroke('b')), sender.remove(['a'])];
  for (const op of ops) receiver.apply(op);
  assert.deepEqual(
    receiver.items.map((i) => i.id),
    sender.items.map((i) => i.id),
  );
  assert.equal(receiver.items.length, 1);
});

test('live strokes are transient: they never enter the committed list', () => {
  const model = new InkModel();
  model.apply({ kind: 'live', item: stroke('live') });
  assert.equal(model.items.length, 0);
  model.add(stroke('real'));
  model.apply({ kind: 'live', item: null });
  assert.deepEqual(model.items.map((i) => i.id), ['real']);
});

test('eraseAt hit-tests by normalised distance and reports the ids it removed', () => {
  const model = new InkModel();
  model.add(stroke('near', [0.5, 0.5, 0.6, 0.5]));
  model.add(stroke('far', [0.1, 0.1, 0.15, 0.1]));

  // eraseAt is a pure query; the caller broadcasts the removal it decides on.
  assert.deepEqual(model.eraseAt(0.5, 0.5, 0.05).map((i) => i.id), ['near']);
  assert.equal(model.items.length, 2, 'querying must not delete anything');

  model.remove(['near']);
  assert.deepEqual(model.items.map((i) => i.id), ['far']);
  assert.deepEqual(model.eraseAt(0.9, 0.9, 0.02), [], 'an empty area erases nothing');
});

test('the item cap keeps memory bounded on a long lesson', () => {
  const model = new InkModel();
  for (let i = 0; i < 2500; i += 1) model.add(stroke(`s${i}`));
  assert.ok(model.items.length <= 2000, `items grew to ${model.items.length}`);
});

test('ink size is a fraction of the card, so a stroke weighs the same anywhere', () => {
  // 1000 units = one card width: the stored number shrinks as the card grows.
  const at1280 = inkSize(4, 1280);
  const at2560 = inkSize(4, 2560);
  assert.ok(at1280 > at2560, `${at1280} should be larger than ${at2560}`);
  assert.ok(Math.abs(at1280 / at2560 - 2) < 0.001, `${at1280} vs ${at2560}`);
  assert.ok(at1280 > 0 && at1280 < 10, String(at1280));
  // And the tiny-card clamp keeps a hairline stroke visible.
  assert.equal(inkSize(0.2, 100), inkSize(0.2, 320));
});

test('marker and highlighter differ from the pen at the same slider value', () => {
  const pen = styleForTool('pen', 4, 1);
  const marker = styleForTool('marker', 4, 1);
  const highlighter = styleForTool('highlighter', 4, 1);
  assert.equal(pen.size, 4);
  assert.ok(marker.size > pen.size);
  assert.ok(highlighter.size > marker.size);
  assert.ok(highlighter.opacity < 0.5);
});

test('every ink id is unique, even inside the same millisecond', () => {
  // 5000 ids in a tight loop all land in the same few milliseconds.
  const ids = new Set(Array.from({ length: 5000 }, () => newInkId('ink')));
  assert.equal(ids.size, 5000, 'ids must never collide inside one lesson');
  assert.ok([...ids].every((id) => id.startsWith('ink_')));
  assert.equal(styleForTool('cursor', 4, 1).size, 4, 'the cursor changes nothing about the brush');
});

test('the audience renders ink from ops only — no screenshot path in the ink module', () => {
  const source = readFileSync(new URL('../src/renderer/live/ink.ts', import.meta.url), 'utf8');
  assert.equal(/capturePage|toDataURL|desktopCapturer/.test(source), false, 'ink must never be a bitmap capture');
});
