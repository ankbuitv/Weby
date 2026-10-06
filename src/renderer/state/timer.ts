/** Tiny helper so events.ts and actions.ts agree on the elapsed-time baseline. */

export function resetTimerBase(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function elapsed(timer: { base: number; since: number; running: boolean }): number {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return timer.running ? timer.base + (now - timer.since) : timer.base;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
