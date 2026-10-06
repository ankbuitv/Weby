/**
 * Whiteboard document model.
 *
 * These tests pin the parts that are expensive to get wrong: op application
 * (the same ops run in main, in PREP and in LIVE), the vector document format,
 * migration of older files, and the fact that the canvas is never one huge
 * bitmap (i.e. everything is expressed in board units and a view transform).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARD_SCHEMA_VERSION,
  newId,
  MIN_ZOOM,
  MAX_ZOOM,
  applyOp,
  applyOps,
  clampView,
  createDoc,
  migrateDoc,
  metaOf,
  serialize,
  objectBounds,
  contentBounds,
  translateObject,
  scaleObject,
  hitTest,
  objectAt,
  eraseAt,
  nextZ,
  strokeStyle,
} from '../dist/test/shared/whiteboard.js';

const stroke = (id, points, extra = {}) => ({
  id,
  z: 1,
  kind: 'stroke',
  tool: 'pen',
  points,
  style: { color: '#ffffff', width: 4, opacity: 1 },
  ...extra,
});

const rect = (id, x, y, w, h) => ({
  id,
  z: 2,
  kind: 'rect',
  x1: x,
  y1: y,
  x2: x + w,
  y2: y + h,
  style: { color: '#ffffff', width: 3, opacity: 1 },
});

test('a new document is versioned, empty and on-screen', () => {
  const doc = createDoc('Fractions', 'grid');
  assert.equal(doc.schemaVersion, BOARD_SCHEMA_VERSION);
  assert.equal(doc.name, 'Fractions');
  assert.equal(doc.theme, 'grid');
  assert.deepEqual(doc.objects, []);
  assert.ok(Number.isFinite(doc.view.x) && Number.isFinite(doc.view.zoom));
});

test('add / delete / move / replace / clear all apply purely', () => {
  let doc = createDoc();
  doc = applyOp(doc, { type: 'add', objects: [stroke('a', [0, 0, 10, 10]), rect('b', 20, 20, 40, 40)] });
  assert.equal(doc.objects.length, 2);

  doc = applyOp(doc, { type: 'move', ids: ['b'], dx: 5, dy: -5 });
  const moved = doc.objects.find((o) => o.id === 'b');
  assert.equal(moved.x1, 25);
  assert.equal(moved.y1, 15);

  doc = applyOp(doc, { type: 'replace', id: 'b', object: rect('b', 0, 0, 10, 10) });
  assert.equal(doc.objects.find((o) => o.id === 'b').x2, 10);

  doc = applyOp(doc, { type: 'delete', ids: ['a'] });
  assert.deepEqual(doc.objects.map((o) => o.id), ['b']);

  doc = applyOp(doc, { type: 'clear' });
  assert.deepEqual(doc.objects, []);
});

test('theme / name / view ops only touch their field', () => {
  let doc = createDoc();
  doc = applyOp(doc, { type: 'add', objects: [stroke('a', [0, 0, 1, 1])] });
  doc = applyOp(doc, { type: 'theme', theme: 'blackboard' });
  doc = applyOp(doc, { type: 'name', name: 'Algebra 2' });
  doc = applyOp(doc, { type: 'view', view: { x: 120, y: -40, zoom: 2 } });
  assert.equal(doc.theme, 'blackboard');
  assert.equal(doc.name, 'Algebra 2');
  assert.deepEqual(doc.view, { x: 120, y: -40, zoom: 2 });
  assert.equal(doc.objects.length, 1, 'a view change must not drop objects');
});

test('the input document is never mutated', () => {
  const doc = createDoc();
  const before = JSON.stringify(doc);
  applyOps(doc, [{ type: 'add', objects: [stroke('a', [0, 0, 5, 5])] }]);
  assert.equal(JSON.stringify(doc), before);
});

test('zoom clamps to the supported range (pan feels infinite, bitmap never does)', () => {
  assert.equal(clampView({ x: 0, y: 0, zoom: 0.0001 }).zoom, MIN_ZOOM);
  assert.equal(clampView({ x: 0, y: 0, zoom: 1000 }).zoom, MAX_ZOOM);
  assert.equal(clampView({ x: 1e9, y: -1e9, zoom: 1 }).zoom, 1);
});

test('bounds cover strokes, shapes and the union of everything', () => {
  const s = stroke('a', [10, 10, 30, 20]);
  const sb = objectBounds(s);
  assert.ok(sb.width >= 20 && sb.height >= 10, JSON.stringify(sb));

  // Shape bounds include half the stroke width, so the box is a hair larger.
  const r = objectBounds(rect('b', -50, -50, 100, 100));
  assert.ok(r.x <= -50 && r.x >= -54, `x was ${r.x}`);
  assert.ok(r.width >= 100 && r.width <= 108, `width was ${r.width}`);

  const union = contentBounds([s, rect('b', -50, -50, 100, 100)], 0);
  assert.ok(union.x <= -50 && union.x + union.width >= 30, JSON.stringify(union));
});

test('translate keeps a stroke cohesive and a rect square', () => {
  const movedStroke = translateObject(stroke('a', [0, 0, 10, 10]), 5, -5);
  assert.deepEqual(movedStroke.points, [5, -5, 15, 5]);

  const movedRect = translateObject(rect('b', 0, 0, 20, 10), 3, 4);
  assert.deepEqual([movedRect.x1, movedRect.y1, movedRect.x2, movedRect.y2], [3, 4, 23, 14]);
  assert.equal(movedRect.x2 - movedRect.x1, 20, 'width is preserved');
});

test('scaling a rect from a corner keeps the far corner pinned', () => {
  const scaled = scaleObject(rect('b', 0, 0, 100, 100), 2, 2, 0, 0);
  assert.equal(scaled.x1, 0);
  assert.equal(scaled.y1, 0);
  assert.equal(scaled.x2, 200);
  assert.equal(scaled.y2, 200);
});

test('hit testing finds the topmost object and eraseAt removes what it covers', () => {
  const a = stroke('a', [0, 0, 100, 0]);
  const b = stroke('b', [0, 50, 100, 50]);
  assert.equal(hitTest(a, 50, 0, 4), true);
  assert.equal(hitTest(a, 50, 40, 4), false);
  assert.equal(objectAt([a, b], 50, 50, 4).id, 'b');
  assert.deepEqual(eraseAt([a, b], 50, 50, 8).sort(), ['b']);
  assert.deepEqual(eraseAt([a, b], 500, 500, 8), []);
});

test('z ordering helper always returns a free layer', () => {
  const objects = [stroke('a', [0, 0, 1, 1], { z: 3 }), rect('b', 0, 0, 1, 1)];
  assert.ok(nextZ(objects) > 3);
});

test('pen/marker/highlighter styles are distinct and opaque where expected', () => {
  const pen = strokeStyle('pen', '#ff0000', 4, 1);
  const marker = strokeStyle('marker', '#ff0000', 4, 1);
  const highlighter = strokeStyle('highlighter', '#ff0000', 4, 1);
  assert.ok(marker.width > pen.width, 'a marker is thicker than a pen');
  assert.ok(highlighter.width >= marker.width);
  assert.ok(highlighter.opacity < 0.6, 'a highlighter stays translucent');
  assert.equal(pen.opacity, 1);
});

test('serialize + migrate round-trips and rejects rubbish', () => {
  const doc = applyOps(createDoc('Round trip'), [{ type: 'add', objects: [stroke('a', [0, 0, 9, 9])] }]);
  const restored = migrateDoc(JSON.parse(serialize(doc)));
  assert.ok(restored, 'a serialized document must migrate back');
  assert.equal(restored.id, doc.id);
  assert.equal(restored.objects.length, 1);
  assert.equal(restored.schemaVersion, BOARD_SCHEMA_VERSION);

  assert.equal(migrateDoc(null), null);
  assert.equal(migrateDoc({ nope: true }), null);
  assert.equal(migrateDoc({ schemaVersion: 99, objects: [] }), null, 'a future schema is refused rather than misread');
});

test('object ids are unique even inside one millisecond', () => {
  const ids = new Set(Array.from({ length: 5000 }, () => newId('st')));
  assert.equal(ids.size, 5000, 'two objects must never share an id');
});

test('metaOf reports what the internal pages and the boards list need', () => {
  const doc = applyOps(createDoc('Meta'), [{ type: 'add', objects: [stroke('a', [0, 0, 1, 1])] }]);
  const meta = metaOf(doc);
  assert.equal(meta.id, doc.id);
  assert.equal(meta.name, 'Meta');
  assert.equal(meta.objectCount, 1);
  assert.equal(typeof meta.updatedAt, 'number');
});
