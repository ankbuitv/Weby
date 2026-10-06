import { net, protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Local media without widening file access.
 *
 * Backgrounds and board images are referenced as `juzt-media://local/?p=…`.
 * The handler only serves absolute paths with an allow-listed media extension,
 * so a crafted document or page cannot turn this into a filesystem reader.
 */

export const MEDIA_SCHEME = 'juzt-media';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.svg']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.m4v', '.mov', '.ogv']);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.ogg', '.opus', '.m4a', '.flac']);
const ALLOWED = new Set([...IMAGE_EXT, ...VIDEO_EXT, ...AUDIO_EXT]);

/** Files the teacher explicitly picked; granting is what makes a path servable. */
const granted = new Set<string>();

export function grantMedia(filePath: string): string {
  const resolved = path.resolve(filePath);
  granted.add(resolved);
  return resolved;
}

export function mediaKind(filePath: string): 'image' | 'video' | 'audio' | 'other' {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  return 'other';
}

export function mediaUrl(filePath: string): string {
  return `${MEDIA_SCHEME}://local/?p=${encodeURIComponent(grantMedia(filePath))}`;
}

/** Scheme privileges must be declared before `app.whenReady()`. */
export const MEDIA_SCHEME_PRIVILEGES = {
  scheme: MEDIA_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false },
} as const;

export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      const raw = url.searchParams.get('p') ?? '';
      if (!raw) return new Response('missing path', { status: 400 });
      const filePath = path.resolve(decodeURIComponent(raw));
      if (!path.isAbsolute(filePath)) return new Response('bad path', { status: 400 });
      const ext = path.extname(filePath).toLowerCase();
      if (!ALLOWED.has(ext)) return new Response('unsupported type', { status: 415 });
      if (!granted.has(filePath)) return new Response('not granted', { status: 403 });
      if (!fs.existsSync(filePath)) return new Response('not found', { status: 404 });
      return await net.fetch(pathToFileURL(filePath).toString(), { bypassCustomProtocolHandlers: true });
    } catch (error) {
      return new Response(`media error: ${String(error)}`, { status: 500 });
    }
  });
}

/** Data URLs are used for board images (already in memory, never on disk). */
export function isDataUrl(value: string): boolean {
  return value.startsWith('data:image/');
}
