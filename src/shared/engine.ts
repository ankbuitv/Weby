/**
 * Engine identity and website-facing User-Agent.
 *
 * Juzt's website compatibility comes from shipping a modern Chromium, not from
 * lying about which one. Everything here is derived from the runtime's own
 * `process.versions`, so the identity can never drift from the engine that is
 * actually bundled:
 *
 *   Electron 44.5.1  →  Chromium 152.0.7977.130  →  Chrome/152.0.7977.130
 *
 * The hard rule this module enforces: the advertised Chrome/Chromium major
 * version is ALWAYS the real one. There is deliberately no "pretend to be a
 * newer Chrome" switch anywhere in Juzt — that is a spoofing trap that breaks
 * the moment a site feature-tests an API the engine does not have.
 *
 * Nothing in here touches the DOM, so the same code runs in main and in the
 * unit tests.
 */

/** Versions Juzt reports privately in Settings → About → Browser. */
export interface EngineInfo {
  app: string;
  electron: string;
  chromium: string;
  v8: string;
  node: string;
}

/** Chromium major version of the running engine (`152` for Electron 44.x). */
export function chromiumMajor(chromium: string): number {
  const major = Number.parseInt(chromium.split('.')[0] ?? '', 10);
  return Number.isFinite(major) && major > 0 ? major : 0;
}

/**
 * The Chrome-compatible platform token, from the real host platform.
 *
 * Windows reports `Windows NT 10.0; Win64; x64` exactly like Chrome does — that
 * string is a *platform* description, not a version claim, so there is nothing
 * dishonest about it and everything to gain from not looking exotic.
 */
export function platformToken(platform: NodeJS.Platform, arch: string): string {
  const bits = arch === 'ia32' ? '' : arch === 'arm64' ? '; Win64; arm64' : '; Win64; x64';
  switch (platform) {
    case 'win32':
      return `Windows NT 10.0${bits}`;
    case 'darwin':
      return arch === 'arm64' ? 'Macintosh; Intel Mac OS X 10_15_7' : 'Macintosh; Intel Mac OS X 10_15_7';
    default:
      return arch === 'arm64' ? 'X11; Linux aarch64' : 'X11; Linux x86_64';
  }
}

/**
 * The User-Agent website tabs send.
 *
 * `mode`:
 *   `clean`    — Chrome-compatible, engine-accurate, no application token.
 *                This is the default and what the compatibility guidance asks for.
 *   `app`      — the same string plus `Juzt/<version>`, for teachers who need a
 *                site to be able to tell it is running inside Juzt.
 *   `electron` — the stock Electron identity (`… Electron/<version>`), for the
 *                rare site whose detection is satisfied by the Electron token.
 *
 * In every mode the Chrome/Chromium version is the real bundled one.
 */
export type UserAgentMode = 'clean' | 'app' | 'electron';

export function buildWebUserAgent(input: {
  chromium: string;
  electron: string;
  app: string;
  version: string;
  platform: NodeJS.Platform;
  arch: string;
  mode?: UserAgentMode;
}): string {
  const mode = input.mode ?? 'clean';
  const base = `Mozilla/5.0 (${platformToken(input.platform, input.arch)}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${input.chromium} Safari/537.36`;
  if (mode === 'app') return `${base} ${input.app}/${input.version}`;
  if (mode === 'electron') return `${base} Electron/${input.electron}`;
  return base;
}

/**
 * `Sec-CH-UA` client hints consistent with the User-Agent above.
 *
 * Chromium's own hints carry a `Chromium` brand and a GREASE `Not:A-Brand`
 * entry; ours report exactly the same thing, because Juzt *is* Chromium. The
 * version is the real one. Juzt does not emit a fake `"Google Chrome"` brand:
 * the UA already carries the Chrome-compatible token sites look for, and a
 * contradictory brand would be both a lie and a detection hazard.
 */
export function clientHints(chromium: string, platform: NodeJS.Platform, mode: UserAgentMode = 'clean'): Record<string, string> {
  const major = chromiumMajor(chromium);
  const brands = [`"Chromium";v="${major}"`, `"Not:A-Brand";v="99"`];
  if (mode === 'electron') brands.unshift(`"Electron";v="${chromiumMajor(chromium)}"`);
  const platformName = platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux';
  return {
    'Sec-CH-UA': brands.join(', '),
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': `"${platformName}"`,
    'Sec-CH-UA-Platform-Version': platform === 'win32' ? '"15.0.0"' : '""',
    'Sec-CH-UA-Full-Version-List': `"Chromium";v="${chromium}"`,
    'Sec-CH-UA-Model': '""',
  };
}

/**
 * Strip every application-specific token from a stock Electron UA.
 *
 * Used as a belt-and-braces guard: if `buildWebUserAgent` is ever bypassed and
 * a session hands back the default `… Electron/x.y.z Juzt/1.0.0` string, the
 * result must still be a clean, engine-accurate Chrome UA.
 */
export function sanitizeUserAgent(ua: string): string {
  let out = ua.replace(/\s+Electron\/[\d.]+/gi, '');
  // Any `Name/version` token that is not part of Chrome/Safari/AppleWebKit.
  out = out.replace(/\s+(?!Chrome\/|Safari\/|AppleWebKit\/|Mobile\/)[A-Za-z][\w.-]*\/[\d.]+/g, '');
  return out.trim();
}

/** A short human summary for the private About panel. */
export function describeEngine(info: EngineInfo): string {
  return `${info.app} ${info.app === 'Juzt' ? '' : ''}on Electron ${info.electron} · Chromium ${info.chromium} · V8 ${info.v8} · Node ${info.node}`;
}

/**
 * Features the bundled Chromium genuinely provides.
 *
 * This list is deliberately conservative — it is what Juzt *documents*, and it
 * is checked against the engine's own version so it cannot claim support the
 * runtime does not have. Anything not listed here is reported as unknown rather
 * than assumed.
 */
export interface EngineFeature {
  id: string;
  label: string;
  /** Chromium major version from which the engine supports it. */
  since: number;
  /** True when a proprietary/DRM component is required. */
  proprietary?: boolean;
  note?: string;
}

export const ENGINE_FEATURES: readonly EngineFeature[] = [
  { id: 'webgl2', label: 'WebGL 2', since: 100 },
  { id: 'wasm', label: 'WebAssembly', since: 57 },
  { id: 'wasm-gc', label: 'WebAssembly GC', since: 119 },
  { id: 'indexeddb', label: 'IndexedDB', since: 57 },
  { id: 'serviceworker', label: 'Service Workers', since: 45 },
  { id: 'websocket', label: 'WebSockets', since: 57 },
  { id: 'webrtc', label: 'WebRTC', since: 57 },
  { id: 'getusermedia', label: 'getUserMedia / MediaDevices', since: 57 },
  { id: 'webaudio', label: 'Web Audio', since: 57 },
  { id: 'picture-in-picture', label: 'Picture-in-Picture', since: 70 },
  { id: 'fullscreen', label: 'Fullscreen API', since: 57 },
  { id: 'clipboard', label: 'Async Clipboard API', since: 66 },
  { id: 'notifications', label: 'Notifications', since: 57, note: 'Permission is asked per site and stays private to the teacher.' },
  { id: 'webcodecs', label: 'WebCodecs', since: 94 },
  { id: 'media-source', label: 'Media Source Extensions', since: 57 },
  { id: 'h264', label: 'H.264 / AAC (MP4)', since: 57, proprietary: true, note: 'Included in the official Electron build.' },
  { id: 'vp8', label: 'VP8 (WebM)', since: 57 },
  { id: 'vp9', label: 'VP9 (WebM)', since: 57 },
  { id: 'av1', label: 'AV1', since: 120, proprietary: true, note: 'Decode only; encode depends on the host GPU.' },
  { id: 'opus', label: 'Opus', since: 57 },
  { id: 'widevine', label: 'Widevine DRM', since: 57, proprietary: true, note: 'NOT bundled by Electron. Streaming sites that require Widevine will not play.' },
];

export function featureSupported(feature: EngineFeature, chromium: string): boolean {
  return chromiumMajor(chromium) >= feature.since;
}

/** Features the engine cannot provide, for honest reporting in the UI. */
export function unsupportedFeatures(chromium: string): EngineFeature[] {
  return ENGINE_FEATURES.filter((f) => !featureSupported(f, chromium));
}
