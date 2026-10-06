import { desktopCapturer, type Session } from 'electron';
import { hostOf } from '../shared/url';
import type { PermissionRequest, ScreenSource } from '../shared/types';

/**
 * Permission broker.
 *
 * Nothing is ever auto-granted. Media on a call site is offered with an explicit
 * PREP decision, screen sharing additionally requires picking the exact source in
 * PREP, and the "remember" answer is per host (never global).
 */

export interface PermissionEvents {
  /** Prompt the teacher in PREP (never the audience window). */
  sendRequest(request: PermissionRequest): void;
  /** Show the source picker (screen/window list) in PREP. */
  sendSources(sources: ScreenSource[], requestId: string): void;
  toast(message: string, tone?: 'info' | 'error'): void;
}

type PermDetails = {
  requestingUrl?: string;
  mediaTypes?: ('video' | 'audio')[];
};

interface Pending {
  resolve: (granted: boolean) => void;
  timer: NodeJS.Timeout;
  remember: boolean | null;
}

interface Waiter {
  resolve: (granted: boolean) => void;
  timer: NodeJS.Timeout;
}

const PROMPT_TIMEOUT_MS = 60_000;
const SOURCE_TIMEOUT_MS = 45_000;

export class PermissionBroker {
  private events: PermissionEvents;
  /** Requests waiting for a PREP answer, keyed by request id. */
  private waiters = new Map<string, Waiter>();
  /** Per-host memory: `permission:<host>` → granted. */
  private remembered = new Map<string, boolean>();
  private sourceResolver: ((id: string | null) => void) | null = null;
  private sourceTimer: NodeJS.Timeout | null = null;
  private mediaInFlight = false;
  private counter = 0;

  constructor(events: PermissionEvents) {
    this.events = events;
  }

  setRemembered(key: string, granted: boolean): void {
    this.remembered.set(key, granted);
  }

  rememberedFor(url: string, permission: string): boolean | undefined {
    const host = safeHost(url);
    if (!host) return undefined;
    return this.remembered.get(`${permission}:${host}`);
  }

  /* ------------------------------------------------------------------ *
   * Session wiring
   * ------------------------------------------------------------------ */

  attach(session: Session): void {
    session.setPermissionRequestHandler((wc, permission, callback, details) => {
      void this.handleRequest(wc, permission, details as PermDetails, callback);
    });

    // Synchronous checks (used for `getUserMedia`-style flows): default deny,
    // allow only what was remembered for this host.
    session.setPermissionCheckHandler((wc, permission, requestingOrigin) => {
      if (!wc) return false;
      const answer = this.rememberedFor(requestingOrigin, permission);
      if (answer === true) return true;
      return false;
    });

    // Electron 31 takes a single argument here (no options object).
    session.setDisplayMediaRequestHandler((_request, callback) => {
      void this.handleDisplayMedia(callback);
    });
  }

  /** PREP answers a prompt (or cancels). */
  respond(id: string, granted: boolean, remember: boolean): boolean {
    const waiter = this.waiters.get(id);
    if (!waiter) return false;
    clearTimeout(waiter.timer);
    this.waiters.delete(id);
    waiter.resolve(granted);
    void remember;
    return true;
  }

  /** PREP picked (or cancelled) a screen source. */
  pickSource(requestId: string, sourceId: string | null): boolean {
    void requestId;
    if (!this.sourceResolver) return false;
    if (this.sourceTimer) clearTimeout(this.sourceTimer);
    this.sourceTimer = null;
    const resolve = this.sourceResolver;
    this.sourceResolver = null;
    resolve(sourceId);
    return true;
  }

  cancelAll(): void {
    for (const [, waiter] of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(false);
    }
    this.waiters.clear();
    if (this.sourceResolver) {
      this.sourceResolver(null);
      this.sourceResolver = null;
    }
    if (this.sourceTimer) clearTimeout(this.sourceTimer);
    this.sourceTimer = null;
  }

  /* ------------------------------------------------------------------ *
   * Prompts
   * ------------------------------------------------------------------ */

  private async handleRequest(
    wc: Electron.WebContents,
    permission: string,
    details: PermDetails,
    callback: (granted: boolean) => void,
  ): Promise<void> {
    const url = details.requestingUrl || wc.getURL();
    const host = safeHost(url) || 'this page';

    // A camera/mic request from a page while PREP is already asking must not
    // stack prompts: the teacher answers one at a time.
    if (permission === 'media' && this.mediaInFlight) {
      callback(false);
      return;
    }

    const remembered = this.rememberedFor(url, permission);
    if (remembered !== undefined) {
      callback(remembered);
      return;
    }

    if (permission === 'media' && details.mediaTypes?.includes('video')) {
      this.mediaInFlight = true;
    }

    const granted = await this.ask(permission, url, host, details.mediaTypes ?? []);
    if (permission === 'media') this.mediaInFlight = false;
    callback(granted);
  }

  private ask(permission: string, url: string, host: string, mediaTypes: ('video' | 'audio')[]): Promise<boolean> {
    const id = `perm_${++this.counter}_${Date.now().toString(36)}`;
    const request: PermissionRequest = {
      id,
      origin: url,
      host,
      kinds: [permission],
      mediaKinds: mediaTypes,
      rememberable: true,
    };
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        this.events.toast(`${host} was not allowed to use ${label(permission)} (no answer)`, 'error');
        resolve(false);
      }, PROMPT_TIMEOUT_MS);
      this.waiters.set(id, {
        resolve: (granted) => {
          this.remembered.set(`${permission}:${host}`, granted);
          resolve(granted);
        },
        timer,
      });
      this.events.sendRequest(request);
    });
  }

  private async handleDisplayMedia(callback: (streams: Electron.Streams) => void): Promise<void> {
    if (!this.sourceResolver) {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
      const list: ScreenSource[] = sources.map((s) => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : undefined,
        displayId: s.display_id || undefined,
      }));
      const requestId = `src_${Date.now().toString(36)}`;
      this.events.sendSources(list, requestId);
      const picked = await new Promise<string | null>((resolve) => {
        this.sourceResolver = resolve;
        this.sourceTimer = setTimeout(() => {
          this.sourceResolver = null;
          resolve(null);
        }, SOURCE_TIMEOUT_MS);
      });
      if (!picked) {
        callback({});
        return;
      }
      const source = list.find((s) => s.id === picked);
      if (!source) {
        callback({});
        return;
      }
      // Confirm once more in PREP: picking a source is not the same as sharing it.
      const granted = await this.ask('display', source.name, 'screen share', ['video']);
      if (!granted) {
        callback({});
        return;
      }
      callback({ video: { id: source.id, name: source.name } });
      return;
    }
    callback({});
  }
}

function safeHost(url: string): string {
  try {
    return hostOf(url) || '';
  } catch {
    return '';
  }
}

function label(permission: string): string {
  switch (permission) {
    case 'media':
      return 'the camera or microphone';
    case 'display':
      return 'screen sharing';
    case 'notifications':
      return 'notifications';
    case 'fullscreen':
      return 'fullscreen';
    case 'clipboard-read':
    case 'clipboard-sanitized-write':
      return 'the clipboard';
    default:
      return permission;
  }
}
