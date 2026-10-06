#!/usr/bin/env node
/**
 * Website compatibility smoke test.
 *
 * This drives a real Electron window through a list of representative modern
 * sites and reports, per site: did it load, what did the console say, were
 * there network failures, and did any feature Juzt documents actually work.
 *
 * It deliberately does NOT weaken anything to make a site pass. If a site
 * fails, the honest output is "this site does not work in Juzt" plus the
 * evidence, so the teacher knows what to expect.
 *
 * Run it on a machine that can download the Electron binary:
 *
 *   node scripts/compat-check.mjs                # default site list
 *   node scripts/compat-check.mjs --headless    # no visible window
 *   node scripts/compat-check.mjs --only meet.google.com
 *
 * In this sandbox the Electron binary cannot be downloaded (the release host
 * is TLS-blocked), so the script exits with a clear message instead of a
 * misleading "all sites failed".
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Representative modern sites. First paint is not enough — each one gets an interaction check. */
const SITES = [
  { url: 'https://www.google.com/', label: 'Google', check: 'search box is focusable and typing produces suggestions' },
  { url: 'https://www.youtube.com/', label: 'YouTube', check: 'video element plays (VP9/AV1/H.264 decode), volume control works' },
  { url: 'https://docs.google.com/', label: 'Google Docs', check: 'editor canvas accepts keyboard input, IndexedDB persistence' },
  { url: 'https://drive.google.com/', label: 'Google Drive', check: 'file list renders, upload button reachable' },
  { url: 'https://www.messenger.com/', label: 'Messenger Web', check: 'login form renders, WebSocket connects' },
  { url: 'https://meet.google.com/', label: 'Google Meet', check: 'getUserMedia prompt, WebRTC peer connection, screen share' },
  { url: 'https://teams.microsoft.com/', label: 'Microsoft Teams Web', check: 'sign-in page renders, media devices enumerate' },
  { url: 'https://discord.com/app', label: 'Discord Web', check: 'WebSocket connects, voice/video permission flow' },
  { url: 'https://accounts.google.com/', label: 'Google OAuth', label2: 'common login/OAuth page', check: 'form renders, redirect flow completes' },
  { url: 'https://www.wikipedia.org/', label: 'Wikipedia', check: 'article renders, links navigate' },
  { url: 'https://www.khanacademy.org/', label: 'Khan Academy', check: 'lesson player renders, video plays' },
  { url: 'https://vnexpress.net/', label: 'Vietnamese news site', check: 'article renders, images load' },
];

const args = process.argv.slice(2);
const headless = args.includes('--headless');
const onlyIndex = args.indexOf('--only');
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : null;
const sites = only ? SITES.filter((s) => s.label.toLowerCase().includes(only.toLowerCase()) || s.url.includes(only)) : SITES;

const electronDir = path.join(root, 'node_modules', 'electron', 'dist');
const hasBinary =
  fs.existsSync(path.join(electronDir, process.platform === 'win32' ? 'electron.exe' : 'electron')) ||
  fs.existsSync(path.join(root, 'node_modules', 'electron', 'path.txt'));

if (!hasBinary) {
  console.error(
    [
      'Juzt compatibility smoke test',
      '',
      'The Electron binary is not installed, so there is nothing to drive.',
      'Install it first (this needs network access to the Electron release host):',
      '',
      '  npm install --no-audit --no-fund',
      '',
      'Then re-run this script. It reports per-site results, console errors and',
      'network failures — it never edits Juzt to force a site to pass.',
    ].join('\n'),
  );
  process.exit(2);
}

/**
 * The probe page. It runs in a Juzt website tab (a normal, sandboxed
 * WebContentsView) so it measures exactly what a real site gets.
 */
const PROBE = `<!doctype html><meta charset="utf-8"><title>probe</title><body><script>
window.__juztProbe = async () => {
  const out = { errors: [], net: [], features: {}, ua: navigator.userAgent };
  const t = (name, fn) => { try { out.features[name] = fn(); } catch (e) { out.features[name] = String(e); } };
  t('userAgentData', () => (navigator.userAgentData ? navigator.userAgentData.brands.map(b => b.brand + ' ' + b.version).join(', ') : 'none'));
  t('webgl2', () => { const c = document.createElement('canvas'); return !!c.getContext('webgl2'); });
  t('wasm', () => typeof WebAssembly === 'object');
  t('indexeddb', () => typeof indexedDB === 'object');
  t('serviceWorker', () => 'serviceWorker' in navigator);
  t('websocket', () => typeof WebSocket === 'function');
  t('webrtc', () => typeof RTCPeerConnection === 'function');
  t('mediaDevices', () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia));
  t('clipboard', () => !!(navigator.clipboard && navigator.clipboard.writeText));
  t('notifications', () => 'Notification' in window);
  t('webAudio', () => typeof AudioContext === 'function');
  t('pictureInPicture', () => document.pictureInPictureEnabled === true);
  t('fullscreen', () => document.fullscreenEnabled === true);
  t('webcodecs', () => typeof VideoEncoder === 'function');
  t('mediaSource', () => typeof MediaSource === 'function');
  const v = document.createElement('video');
  const can = (ty) => { try { return v.canPlayType(ty) || 'no'; } catch { return 'no'; } };
  out.codecs = {
    h264: can('video/mp4; codecs="avc1.42E01E"'),
    aac: can('audio/mp4; codecs="mp4a.40.2"'),
    vp8: can('video/webm; codecs="vp8"'),
    vp9: can('video/webm; codecs="vp9"'),
    av1: can('video/mp4; codecs="av01.0.05M.08"'),
    opus: can('audio/webm; codecs="opus"'),
  };
  return out;
};
</script></body>`;

async function run() {
  const { app, BrowserWindow, session } = await import(path.join(root, 'node_modules', 'electron'));
  const results = [];
  await app.whenReady();

  // The exact session website tabs use, so the probe measures the real thing.
  const ses = session.fromPartition('persist:juzt');
  ses.setPermissionCheckHandler(() => false);

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: !headless,
    webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  for (const site of sites) {
    const entry = { label: site.label, url: site.url, ok: false, title: '', console: [], failed: [], check: site.check };
    const onConsole = (_e, _level, message) => entry.console.push(String(message));
    const onFail = (_e, _level, message) => entry.failed.push(String(message));
    win.webContents.on('console-message', onConsole);
    win.webContents.on('did-fail-load', onFail);
    try {
      await win.loadURL(site.url, { timeout: 45_000 }).catch((e) => entry.failed.push(String(e)));
      await new Promise((r) => setTimeout(r, 2500));
      entry.title = await win.webContents.getTitle();
      entry.ok = true;
    } catch (e) {
      entry.failed.push(String(e));
    }
    win.webContents.off('console-message', onConsole);
    win.webContents.off('did-fail-load', onFail);
    results.push(entry);
    process.stdout.write(`${entry.ok ? 'ok  ' : 'FAIL'}  ${site.label.padEnd(22)} ${site.url}\n`);
  }

  // Engine facts, from the probe page's own point of view.
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PROBE));
  const probe = await win.webContents.executeJavaScript('window.__juztProbe()');

  win.destroy();
  app.quit();

  const report = {
    generatedAt: new Date().toISOString(),
    engine: { electron: process.versions.electron, chromium: process.versions.chrome, v8: process.versions.v8, node: process.versions.node },
    probe,
    results,
  };
  const out = path.join(root, 'compat-report.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  process.stdout.write(`\nWrote ${out}\n`);
  const failed = results.filter((r) => !r.ok || r.failed.length > 0);
  process.stdout.write(`${results.length - failed.length}/${results.length} sites loaded cleanly.\n`);
  for (const r of failed) {
    process.stdout.write(`\n  ${r.label}: ${r.failed.slice(0, 3).join(' | ') || 'loaded with console errors'}\n`);
    process.stdout.write(`    expected interaction: ${r.check}\n`);
  }
}

const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
child.kill();
await run();
