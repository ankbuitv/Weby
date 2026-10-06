/**
 * Address resolution — the security-relevant half of the palette.
 *
 * `node --test` runs these against the compiled `dist/shared` output so the
 * tests exercise exactly the code the app ships.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveInput, internalPage, isInternalPage, safeFilename, hostOf, prettyUrl } from '../dist/test/shared/url.js';

test('a full URL is kept, normalised', () => {
  assert.equal(resolveInput('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(resolveInput('  https://EXAMPLE.com/Path  '), 'https://example.com/Path');
});

test('a bare domain becomes http, not a search', () => {
  assert.equal(resolveInput('example.com'), 'http://example.com');
  assert.equal(resolveInput('sub.example.co.uk/x'), 'http://sub.example.co.uk/x');
  assert.equal(resolveInput('localhost:5173'), 'http://localhost:5173');
});

test('the exact addresses a teacher types during a lesson', () => {
  // Regression: these were reported as "That address cannot be opened safely".
  const hosts = ['google.com', 'www.google.com', 'https://google.com', 'https://www.google.com', 'example.com', 'https://example.com'];
  for (const host of hosts) {
    const out = resolveInput(host, { search: true });
    assert.ok(out, `${host} must resolve to something navigable`);
    assert.match(out, /^https?:\/\//, host);
    assert.ok(!out.includes('duckduckgo'), `${host} is an address, not a search`);
  }
  assert.equal(resolveInput('google.com'), 'http://google.com');
  assert.equal(resolveInput('https://google.com'), 'https://google.com/');
  assert.equal(resolveInput('example.com'), 'http://example.com');
  assert.equal(resolveInput('https://example.com'), 'https://example.com/');
});

test('a search query is never mistaken for an address', () => {
  for (const q of ['Newton laws', 'ôn tập vật lý', 'how to teach fractions', 'vật lý 10 bài 1']) {
    const out = resolveInput(q);
    assert.ok(out.startsWith('https://duckduckgo.com/?q='), `${q} should search`);
    assert.equal(resolveInput(q, { search: false }), null);
  }
});

test('free text falls through to the search engine', () => {
  const out = resolveInput('how to teach fractions');
  assert.ok(out.startsWith('https://duckduckgo.com/?q='), out);
  assert.ok(out.includes('how%20to%20teach%20fractions'));
});

test('search can be disabled for a strict address field', () => {
  assert.equal(resolveInput('just some words', { search: false }), null);
});

test('dangerous schemes are refused outright', () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'file:///etc/passwd', 'vbscript:x', 'blob:https://x/y']) {
    assert.equal(resolveInput(bad), null, bad);
  }
});

test('internal pages normalise and are recognised', () => {
  assert.equal(resolveInput('juzt://newtab'), 'juzt://newtab');
  assert.equal(resolveInput('juzt://'), 'juzt://newtab');
  assert.equal(resolveInput('juzt://nonsense'), 'juzt://newtab');
  assert.equal(isInternalPage('juzt://favorites'), true);
  assert.equal(internalPage('juzt://boards'), 'boards');
  assert.equal(internalPage('https://boards'), null);
});

test('retired Stage pages are not navigable', () => {
  assert.equal(resolveInput('stage://newtab'), null);
  assert.equal(resolveInput('stage://settings'), null);
});

test('empty input resolves to nothing', () => {
  assert.equal(resolveInput(''), null);
  assert.equal(resolveInput('   '), null);
});

test('host labels are human-friendly', () => {
  assert.equal(hostOf('https://www.example.com/a'), 'www.example.com');
  // The query is kept: two links to the same path with different queries are
  // different pages, and the label is the only way to tell them apart.
  assert.equal(prettyUrl('https://www.example.com/a/b?c=1'), 'example.com/a/b?c=1');
  assert.equal(prettyUrl('juzt://newtab'), '');
});

test('file names are sanitised for the save dialog', () => {
  const name = safeFilename('My Board: 1/2*', 'png');
  assert.ok(name.startsWith('My-Board-12-'), name);
  assert.ok(name.endsWith('.png'));
  assert.ok(!/[\\/:*?"<>|]/.test(name), name);

  assert.ok(safeFilename('', 'png').startsWith('juzt-'));
  assert.ok(!safeFilename('..\\../etc', 'png').includes('/'));
});
