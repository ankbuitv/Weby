import test from 'node:test';
import assert from 'node:assert/strict';

const mod = await import('../dist/test/shared/engine.js');
const {
  buildWebUserAgent,
  clientHints,
  chromiumMajor,
  featureSupported,
  platformToken,
  sanitizeUserAgent,
  unsupportedFeatures,
  ENGINE_FEATURES,
} = mod;

const BASE = {
  chromium: '152.0.7977.130',
  electron: '44.5.1',
  app: 'Juzt',
  version: '1.0.0',
  platform: 'win32',
  arch: 'x64',
};

test('the advertised Chrome version is always the engine that is really bundled', () => {
  const ua = buildWebUserAgent({ ...BASE, mode: 'clean' });
  assert.match(ua, /^Mozilla\/5\.0 \(Windows NT 10\.0; Win64; x64\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/152\.0\.7977\.130 Safari\/537\.36$/);
  // The one thing that must never happen: a version newer than the engine.
  const major = chromiumMajor(BASE.chromium);
  assert.equal(major, 152);
  for (const ua2 of [buildWebUserAgent({ ...BASE }), buildWebUserAgent({ ...BASE, mode: 'app' }), buildWebUserAgent({ ...BASE, mode: 'electron' })]) {
    const advertised = Number(ua2.match(/Chrome\/(\d+)/)?.[1]);
    assert.equal(advertised, major, 'UA must not advertise a Chrome major the engine does not have');
  }
});

test('a website UA carries no application token unless the teacher asks for it', () => {
  const clean = buildWebUserAgent({ ...BASE, mode: 'clean' });
  assert.doesNotMatch(clean, /Electron\//);
  assert.doesNotMatch(clean, /Juzt\//);
  // ...but the token is available for the site that genuinely needs it.
  assert.match(buildWebUserAgent({ ...BASE, mode: 'app' }), / Juzt\/1\.0\.0$/);
  assert.match(buildWebUserAgent({ ...BASE, mode: 'electron' }), / Electron\/44\.5\.1$/);
});

test('the platform token matches the real host platform', () => {
  assert.equal(platformToken('win32', 'x64'), 'Windows NT 10.0; Win64; x64');
  assert.equal(platformToken('darwin', 'arm64'), 'Macintosh; Intel Mac OS X 10_15_7');
  assert.equal(platformToken('linux', 'x64'), 'X11; Linux x86_64');
  assert.equal(platformToken('linux', 'arm64'), 'X11; Linux aarch64');
  assert.equal(platformToken('win32', 'ia32'), 'Windows NT 10.0');
});

test('client hints agree with the User-Agent instead of contradicting it', () => {
  const hints = clientHints(BASE.chromium, 'win32', 'clean');
  assert.match(hints['Sec-CH-UA'], /"Chromium";v="152"/);
  assert.equal(hints['Sec-CH-UA-Mobile'], '?0');
  assert.equal(hints['Sec-CH-UA-Platform'], '"Windows"');
  assert.match(hints['Sec-CH-UA-Full-Version-List'], /"Chromium";v="152\.0\.7977\.130"/);
  // The advertised major in the hints is the same one the UA advertises.
  const hintMajor = Number(hints['Sec-CH-UA'].match(/"Chromium";v="(\d+)"/)?.[1]);
  const uaMajor = Number(buildWebUserAgent({ ...BASE }).match(/Chrome\/(\d+)/)?.[1]);
  assert.equal(hintMajor, uaMajor);
});

test('a stale stock Electron UA is sanitised down to a clean Chrome UA', () => {
  const stock = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Electron/44.5.1 Juzt/1.0.0 Safari/537.36';
  const out = sanitizeUserAgent(stock);
  assert.doesNotMatch(out, /Electron\//);
  assert.doesNotMatch(out, /Juzt\//);
  assert.equal(out, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36');
  // Idempotent, and never mangles the tokens that legitimately contain a version.
  assert.equal(sanitizeUserAgent(out), out);
  assert.match(sanitizeUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'), /Safari\/537\.36$/);
});

test('the engine reports the features it actually has', () => {
  assert.equal(featureSupported({ id: 'wasm', label: 'WebAssembly', since: 57 }, '152.0.7977.130'), true);
  assert.equal(featureSupported({ id: 'widevine', label: 'Widevine DRM', since: 57, proprietary: true }, '152.0.7977.130'), true);
  // A feature that arrives in Chromium 160 must not be claimed at 152.
  assert.equal(featureSupported({ id: 'future', label: 'Future', since: 160 }, '152.0.7977.130'), false);
  // Widevine is documented as NOT bundled with Electron even though the
  // Chromium API exists — the honest caveat travels with the entry.
  const widevine = ENGINE_FEATURES.find((f) => f.id === 'widevine');
  assert.ok(widevine);
  assert.match(widevine.note ?? '', /NOT bundled/i);
  // The bundled engine supports everything Juzt documents.
  assert.equal(unsupportedFeatures('152.0.7977.130').length, 0);
  // An older engine must NOT claim the newer features.
  assert.deepEqual(unsupportedFeatures('50.0.0').map((f) => f.id), [
    'webgl2',
    'wasm',
    'wasm-gc',
    'indexeddb',
    'websocket',
    'webrtc',
    'getusermedia',
    'webaudio',
    'picture-in-picture',
    'fullscreen',
    'clipboard',
    'notifications',
    'webcodecs',
    'media-source',
    'h264',
    'vp8',
    'vp9',
    'av1',
    'opus',
    'widevine',
  ]);
  // Chromium 90: WebCodecs and AV1 are out, everything older is in.
  const at90 = unsupportedFeatures('90.0.0').map((f) => f.id);
  assert.deepEqual(at90, ['webgl2', 'wasm-gc', 'webcodecs', 'av1']);
  assert.equal(at90.includes('h264'), false);
});
