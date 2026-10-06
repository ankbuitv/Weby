/**
 * Geometry — the contract that keeps the native website view aligned with the
 * DOM card frame. If these numbers drift, the card looks broken on a projector.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeGeometry, computeCardRect, computePaneRect, sameRect, MARGINS, SIZE_PRESETS } from '../dist/test/shared/layout.js';

const KEEP_AWAKE = { top: 0, left: 0, right: 0, bottom: 0 };

const base = {
  single: false,
  prepSize: { width: 1440, height: 900 },
  liveSize: { width: 1920, height: 1080 },
  sizePreset: 'comfortable',
  customScale: 0.8,
  margin: 'comfortable',
  layout: 'focus',
  card: { radius: 18, border: 'subtle', shadow: 'soft', margin: 'comfortable' },
  paneOpen: false,
};

test('dual mode: the audience card fits inside the projector', () => {
  const geo = computeGeometry({ ...base, single: false });
  const card = geo.live;
  assert.ok(card.x >= 0 && card.y >= 0, JSON.stringify(card));
  assert.ok(card.x + card.width <= 1920, JSON.stringify(card));
  assert.ok(card.y + card.height <= 1080, JSON.stringify(card));
  assert.ok(card.width > 800, 'the card should use most of a 1080p screen');
  assert.equal(geo.pane, null);
  assert.equal(geo.single, false);
});

test('the private card never overlaps the toolbar or the top chrome', () => {
  const geo = computeGeometry({ ...base, single: false });
  assert.ok(geo.prepCard.x >= 78, `left edge was ${geo.prepCard.x}`);
  assert.ok(geo.prepCard.y >= 96, `top edge was ${geo.prepCard.y}`);
  assert.ok(geo.prepCard.x + geo.prepCard.width <= 1440, JSON.stringify(geo.prepCard));
  assert.ok(geo.prepCard.y + geo.prepCard.height <= 900, JSON.stringify(geo.prepCard));
});

test('every size preset stays on screen', () => {
  for (const preset of SIZE_PRESETS.map((p) => p.id)) {
    for (const surface of [
      { width: 1920, height: 1080 },
      { width: 1280, height: 800 },
      { width: 3440, height: 1440 },
    ]) {
      const card = computeCardRect(surface, {
        size: preset,
        safeInset: 18,
        customScale: 0.8,
        margin: 'comfortable',
        layout: 'focus',
      });
      const label = `${preset} @ ${surface.width}x${surface.height}`;
      assert.ok(card.width > 120 && card.height > 90, label);
      assert.ok(card.x >= 0 && card.y >= 0, label);
      assert.ok(card.x + card.width <= surface.width, label);
      assert.ok(card.y + card.height <= surface.height, label);
    }
  }
});

test('a 16:9 preset really is 16:9 (within a rounding pixel)', () => {
  const card = computeCardRect({ width: 1920, height: 1080 }, { size: '16:9', safeInset: 18, customScale: 1, margin: 'comfortable', layout: 'focus' });
  assert.ok(Math.abs(card.width / card.height - 16 / 9) < 0.01, `${card.width}x${card.height}`);
});

test('single mode puts the audience surface in this window and exposes a pane', () => {
  const geo = computeGeometry({ ...base, single: true, paneOpen: true });
  assert.equal(geo.single, true);
  assert.ok(geo.pane, 'single mode with the pane open must return a pane rect');
  assert.ok(geo.pane.width >= 360, `pane was ${geo.pane.width}`);
  assert.ok(geo.live.x + geo.live.width <= geo.pane.x + 8, 'the card must not run under the pane');
  assert.equal(sameRect(geo.prepCard, geo.live), true);
});

test('single mode with the pane closed leaves the full width to the card', () => {
  const geo = computeGeometry({ ...base, single: true, paneOpen: false });
  assert.equal(geo.pane, null);
  assert.ok(geo.live.width > 900, String(geo.live.width));
});

test('margins are monotonic: compact > comfortable > spacious for card size', () => {
  const size = { width: 1920, height: 1080 };
  const opts = { size: 'large', safeInset: 18, customScale: 1, layout: 'focus' };
  const compact = computeCardRect(size, { ...opts, margin: 'compact' });
  const comfy = computeCardRect(size, { ...opts, margin: 'comfortable' });
  const roomy = computeCardRect(size, { ...opts, margin: 'spacious' });
  assert.ok(compact.width > comfy.width, `${compact.width} !> ${comfy.width}`);
  assert.ok(comfy.width > roomy.width, `${comfy.width} !> ${roomy.width}`);
  assert.ok(MARGINS.compact < MARGINS.comfortable && MARGINS.comfortable < MARGINS.spacious);
});

test('never returns out-of-range rects for a tiny window', () => {
  const geo = computeGeometry({ ...base, single: false, prepSize: { width: 500, height: 360 }, liveSize: { width: 640, height: 400 } });
  for (const rect of [geo.live, geo.prepCard]) {
    assert.ok(rect.width >= 0 && rect.height >= 0, JSON.stringify(rect));
    assert.ok(Number.isFinite(rect.x) && Number.isFinite(rect.y), JSON.stringify(rect));
  }
});

test('computePaneRect matches the geometry helper', () => {
  const rect = computePaneRect({ width: 1440, height: 900 }, true);
  assert.ok(rect && rect.x > 1440 * 0.5, JSON.stringify(rect));
  assert.equal(computePaneRect({ width: 1440, height: 900 }, false), null);
});

test('sameRect treats nulls and rounding correctly', () => {
  assert.equal(sameRect(null, undefined), true);
  assert.equal(sameRect({ x: 1.2, y: 2, width: 10, height: 10 }, { x: 1, y: 2, width: 10, height: 10 }), true);
  assert.equal(sameRect({ x: 1, y: 2, width: 10, height: 10 }, { x: 9, y: 2, width: 10, height: 10 }), false);
  assert.ok(KEEP_AWAKE.top === 0);
});
