/**
 * IPC validation helpers.
 *
 * Every handler in main registers through one of these wrappers, so:
 *  - the sender is checked (PREP page / LIVE surface / card overlay only);
 *  - LIVE can only reach the channels in `LIVE_ALLOWED`;
 *  - payloads are shape-checked before anything touches the filesystem, the
 *    network or a view's bounds.
 */

import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { CH, LIVE_ALLOWED } from '../shared/ipc';
import type { Rect, WbView } from '../shared/types';

export type SenderRole = 'prep' | 'live' | 'overlay';

export interface SenderRegistry {
  roleOf(wc: WebContents): SenderRole | null;
}

let registry: SenderRegistry | null = null;

export function setSenderRegistry(r: SenderRegistry): void {
  registry = r;
}

export function roleFor(event: IpcMainInvokeEvent): SenderRole | null {
  return registry?.roleOf(event.sender) ?? null;
}

export class IpcError extends Error {}

/**
 * Reject a message whose sender has already gone away.
 *
 * A frame can finish unloading between the click and the handler running; doing
 * work for a destroyed WebContents either throws deep inside Electron or, worse,
 * silently succeeds against a view the teacher can no longer see.
 */
function assertSenderAlive(event: IpcMainInvokeEvent, channel: string): void {
  const sender = event.sender;
  if (!sender || sender.isDestroyed()) throw new IpcError(`${channel}: sender is gone`);
}

export function registerPrep<A extends unknown[], R>(channel: string, fn: (event: IpcMainInvokeEvent, ...args: A) => R | Promise<R>): void {
  ipcMain.handle(channel, async (event, ...args) => {
    assertSenderAlive(event, channel);
    const role = roleFor(event);
    if (role !== 'prep' && role !== 'overlay') throw new IpcError(`${channel}: sender not allowed (${role ?? 'unknown'})`);
    return fn(event, ...(args as A));
  });
}

export function registerLive<A extends unknown[], R>(channel: string, fn: (event: IpcMainInvokeEvent, ...args: A) => R | Promise<R>): void {
  ipcMain.handle(channel, async (event, ...args) => {
    assertSenderAlive(event, channel);
    const role = roleFor(event);
    if (!role) throw new IpcError(`${channel}: unknown sender`);
    if (!LIVE_ALLOWED.has(channel) && role !== 'prep' && role !== 'overlay') {
      throw new IpcError(`${channel}: not available to the live renderer`);
    }
    return fn(event, ...(args as A));
  });
}

/** Registered on a channel PREP may call, LIVE may not (e.g. tabs, history). */
export function registerPrepOnly<A extends unknown[], R>(channel: string, fn: (event: IpcMainInvokeEvent, ...args: A) => R | Promise<R>): void {
  ipcMain.handle(channel, async (event, ...args) => {
    assertSenderAlive(event, channel);
    const role = roleFor(event);
    if (role !== 'prep') throw new IpcError(`${channel}: prep renderer only`);
    return fn(event, ...(args as A));
  });
}

/* ------------------------------------------------------------------ *
 * Payload guards
 * ------------------------------------------------------------------ */

export function asString(value: unknown, max = 4096): string {
  if (typeof value !== 'string') throw new IpcError('expected string');
  return value.slice(0, max);
}

export function asOptionalString(value: unknown, max = 4096): string | undefined {
  return value === undefined || value === null ? undefined : asString(value, max);
}

export function asBool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new IpcError('expected boolean');
  return value;
}

export function asNumber(value: unknown, min = -1e9, max = 1e9): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new IpcError('expected finite number');
  return Math.min(max, Math.max(min, value));
}

export function asRect(value: unknown): Rect {
  if (!value || typeof value !== 'object') throw new IpcError('expected rect');
  const r = value as Partial<Rect>;
  return {
    x: asNumber(r.x, -100000, 100000),
    y: asNumber(r.y, -100000, 100000),
    width: asNumber(r.width, 0, 100000),
    height: asNumber(r.height, 0, 100000),
  };
}

export function asArray<T>(value: unknown, max = 5000): T[] {
  if (!Array.isArray(value) || value.length > max) throw new IpcError('expected array');
  return value as T[];
}

export function asView(value: unknown): WbView {
  if (!value || typeof value !== 'object') throw new IpcError('expected view');
  const v = value as Partial<WbView>;
  return { x: asNumber(v.x, -1e7, 1e7), y: asNumber(v.y, -1e7, 1e7), zoom: asNumber(v.zoom, 0.05, 20) };
}

export function assertChannel(channel: string): void {
  if (!Object.values(CH).includes(channel as never)) throw new IpcError(`unknown channel ${channel}`);
}
