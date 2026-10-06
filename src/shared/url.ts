/**
 * URL handling shared by main and both renderers.
 *
 * Two hard rules:
 *  1. `resolveInput` never guesses a search from something that looks like a
 *     host unless it really is one, and never produces `file:`/`javascript:`
 *     URLs for navigation.
 *  2. Nothing here is ever rendered on the LIVE output — LIVE receives no URLs
 *     at all (`LiveState` has no url field, by design).
 */

export const INTERNAL_PREFIX = 'juzt://';
export const INTERNAL_PAGES = ['newtab', 'favorites', 'history', 'boards', 'about'] as const;
export type InternalPage = (typeof INTERNAL_PAGES)[number];

export const SEARCH_ENGINE = 'https://duckduckgo.com/?q=%s';

const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;
/**
 * Schemes a tab is allowed to load.
 *
 * `file:`, `data:` and `blob:` are deliberately absent: a typed address must
 * never be able to load local files or hand-rolled documents into a tab. Local
 * media reaches the renderer through the `juzt-media:` protocol instead, which
 * is a read-only allow-listed handler in main.
 */
const NAVIGABLE = new Set(['http:', 'https:', 'juzt:', 'about:']);
const BLOCKED_SCHEMES = new Set([
  'javascript:',
  'file:',
  'data:',
  'blob:',
  'chrome:',
  'chrome-extension:',
  'vscode:',
  'ms-msdt:',
  'jar:',
  'vbscript:',
  'view-source:',
]);

export function isInternalPage(url: string): boolean {
  return url.startsWith(INTERNAL_PREFIX);
}

export function internalPage(url: string): InternalPage | null {
  if (!isInternalPage(url)) return null;
  const page = url.slice(INTERNAL_PREFIX.length).split(/[/?#]/)[0];
  return (INTERNAL_PAGES as readonly string[]).includes(page) ? (page as InternalPage) : 'newtab';
}

/** Looks like a bare host (`example.com`, `localhost:3000`, `192.168.0.4`). */
export function looksLikeHost(value: string): boolean {
  const v = value.trim();
  if (!v || /\s/.test(v)) return false;
  if (v.startsWith('localhost') || v.startsWith('127.0.0.1')) return true;
  const host = v.split('/')[0];
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(host)) return true;
  const name = host.split(':')[0];
  return name.includes('.') && !name.endsWith('.') && !name.startsWith('.');
}

export function looksLikeUrl(value: string): boolean {
  const scheme = SCHEME_RE.exec(value.trim())?.[1]?.toLowerCase();
  if (!scheme) return false;
  return NAVIGABLE.has(`${scheme}:`) && !BLOCKED_SCHEMES.has(`${scheme}:`);
}

/**
 * Turn palette/history input into something a tab can load.
 *
 * Returns `null` when the input cannot be resolved to a safe navigable URL —
 * callers must not navigate then.
 */
export function resolveInput(input: string, opts: { search?: boolean } = {}): string | null {
  const raw = input.trim();
  if (!raw) return null;

  if (isInternalPage(raw)) return normalizeInternal(raw);

  const scheme = SCHEME_RE.exec(raw)?.[1]?.toLowerCase();
  if (scheme) {
    const withColon = `${scheme}:`;
    if (BLOCKED_SCHEMES.has(withColon)) return null;
    if (NAVIGABLE.has(withColon)) {
      try {
        return new URL(raw).toString();
      } catch {
        return null;
      }
    }
    // An unknown "scheme" is usually a host that happens to contain a colon
    // (`localhost:5173`, `example.com:8080`) — fall through to host handling
    // rather than silently refusing a perfectly good address.
    if (!looksLikeHost(raw)) return null;
  }

  if (looksLikeHost(raw)) {
    const host = raw.split(/[/?#]/)[0];
    const rest = raw.slice(host.length);
    return `http://${host}${rest}`;
  }

  if (opts.search === false) return null;
  return SEARCH_ENGINE.replace('%s', encodeURIComponent(raw));
}

function normalizeInternal(url: string): string {
  const page = internalPage(url) ?? 'newtab';
  return `${INTERNAL_PREFIX}${page}`;
}

/** Human-friendly host for tab labels and the (PREP-only) URL field. */
export function prettyUrl(url: string): string {
  if (!url) return '';
  if (isInternalPage(url)) return '';
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname + u.search;
    return `${u.host.replace(/^www\./, '')}${path}`.slice(0, 120);
  } catch {
    return url.slice(0, 120);
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** Same-page check used by the "unchanged URL" fast path when presenting. */
export function sameResource(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    if (ua.host !== ub.host) return false;
    const norm = (u: URL) => (u.pathname.replace(/\/$/, '') || '/') + u.search;
    return norm(ua) === norm(ub);
  } catch {
    return false;
  }
}

/** Suggested filename for exports/snapshots. */
export function safeFilename(name: string, ext: string): string {
  const base = name
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/[^a-z0-9-_ ]/gi, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'juzt';
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `${base}-${stamp}.${ext}`;
}
