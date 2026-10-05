const URL_LIKE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
const DOMAIN = /^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+(?:\/.*)?$/;
const IP_ADDRESS = /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:\/.*)?$/;
const LOCALHOST = /^localhost(?::\d+)?(?:\/.*)?$/i;

export function looksLikeURL(input: string): boolean {
  const s = input.trim();
  if (!s) return false;
  if (URL_LIKE.test(s)) return true;
  if (DOMAIN.test(s)) return true;
  if (IP_ADDRESS.test(s)) return true;
  if (LOCALHOST.test(s)) return true;
  return false;
}

export function normalizeURL(input: string): string {
  let s = input.trim();
  if (!s) return '';
  if (!URL_LIKE.test(s)) {
    s = 'https://' + s;
  }
  try {
    const u = new URL(s);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return u.toString();
    }
    return '';
  } catch {
    return '';
  }
}

export function toSearchURL(query: string): string {
  const q = encodeURIComponent(query.trim());
  return `https://www.google.com/search?q=${q}`;
}

export function resolveAddress(input: string): { url: string; isSearch: boolean } {
  const s = input.trim();
  if (looksLikeURL(s)) {
    const norm = normalizeURL(s);
    if (norm) return { url: norm, isSearch: false };
  }
  return { url: toSearchURL(s), isSearch: true };
}

export function parseCommand(input: string): { isCommand: boolean; cmd: string; args: string } {
  const s = input.trim();
  if (s.startsWith('>')) {
    const rest = s.slice(1).trim();
    const space = rest.indexOf(' ');
    if (space === -1) return { isCommand: true, cmd: rest.toLowerCase(), args: '' };
    return {
      isCommand: true,
      cmd: rest.slice(0, space).toLowerCase(),
      args: rest.slice(space + 1).trim(),
    };
  }
  return { isCommand: false, cmd: '', args: '' };
}
