import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { readManifest, normalizeExtensionPath, manifestCompatibility, SUPPORTED_MANIFEST_VERSIONS } = await import('../dist/test/shared/extensions.js');

function tmp(manifest) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'juzt-ext-'));
  if (manifest !== null) fs.writeFileSync(path.join(dir, 'manifest.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  return dir;
}

test('a valid Manifest V3 extension is accepted', () => {
  const dir = tmp({ manifest_version: 3, name: 'Read Aloud', version: '1.2.3', description: 'Speaks pages' });
  const read = readManifest(dir);
  assert.equal(read.ok, true);
  assert.equal(read.name, 'Read Aloud');
  assert.equal(read.version, '1.2.3');
  assert.equal(read.description, 'Speaks pages');
  assert.equal(read.manifestVersion, 3);
});

test('Manifest V2 is accepted and reported honestly', () => {
  const dir = tmp({ manifest_version: 2, name: 'Old Reader', version: '0.1' });
  const read = readManifest(dir);
  assert.equal(read.ok, true);
  assert.equal(read.manifestVersion, 2);
  // The compatibility note must not pretend MV2 is identical to MV3.
  const compat = manifestCompatibility(read.manifestVersion, 152);
  assert.equal(compat.label, 'Partially compatible');
  assert.match(compat.detail, /MV2-only/);
});

test('a folder with no manifest.json is rejected with a usable message', () => {
  const dir = tmp(null);
  const read = readManifest(dir);
  assert.equal(read.ok, false);
  assert.match(read.error ?? '', /manifest\.json/);
});

test('a missing folder is rejected', () => {
  const read = readManifest(path.join(os.tmpdir(), 'juzt-does-not-exist-' + Date.now()));
  assert.equal(read.ok, false);
  assert.match(read.error ?? '', /does not exist/i);
});

test('malformed manifest JSON never gets handed to Chromium', () => {
  const dir = tmp('{ "manifest_version": 3, ');
  const read = readManifest(dir);
  assert.equal(read.ok, false);
  assert.match(read.error ?? '', /not valid JSON/);
});

test('a manifest that is not an object is rejected', () => {
  assert.equal(readManifest(tmp('"just a string"')).ok, false);
  assert.equal(readManifest(tmp('[1,2,3]')).ok, false);
  assert.equal(readManifest(tmp('null')).ok, false);
});

test('an unknown manifest_version is refused rather than guessed at', () => {
  const read = readManifest(tmp({ manifest_version: 4, name: 'Future', version: '1' }));
  assert.equal(read.ok, false);
  assert.match(read.error ?? '', /must be 2 or 3/);
  // ...and the report says plainly that the engine cannot implement it.
  assert.equal(manifestCompatibility(4, 152).label, 'Unknown');
});

test('missing required fields are reported individually', () => {
  assert.match(readManifest(tmp({ manifest_version: 3, version: '1' })).error ?? '', /"name"/);
  assert.match(readManifest(tmp({ manifest_version: 3, name: 'x' })).error ?? '', /"version"/);
  assert.match(readManifest(tmp({ name: 'x', version: '1' })).error ?? '', /manifest_version/);
});

test('only manifest 2 and 3 are ever treated as supported', () => {
  assert.deepEqual([...SUPPORTED_MANIFEST_VERSIONS], [2, 3]);
  assert.equal(manifestCompatibility(3, 152).label, 'Loaded');
});

test('path normalisation rejects junk before it reaches the persisted list', () => {
  const dir = tmp({ manifest_version: 3, name: 'ok', version: '1' });
  assert.equal(normalizeExtensionPath(dir), path.resolve(dir));
  assert.equal(normalizeExtensionPath(''), null);
  assert.equal(normalizeExtensionPath('   '), null);
  assert.equal(normalizeExtensionPath(null), null);
  assert.equal(normalizeExtensionPath(undefined), null);
  assert.equal(normalizeExtensionPath('\0evil'), null);
  assert.equal(normalizeExtensionPath('/no/such/directory/anywhere'), null);
  // A file is not a directory.
  const file = path.join(dir, 'manifest.json');
  assert.equal(normalizeExtensionPath(file), null);
});
