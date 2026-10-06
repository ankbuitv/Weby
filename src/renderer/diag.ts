/**
 * Renderer-side diagnostics.
 *
 * Off unless the build is a dev build or the teacher turned it on, and never
 * transmitted anywhere: main only echoes the samples back to the PREP overlay.
 * The rAF sampler is self-terminating when diagnostics are disabled.
 */

export interface RendererSample {
  fps: number;
  worstFrameMs: number;
  longTasks: number;
  longestTaskMs: number;
}

let enabled = false;
let raf = 0;
let frames = 0;
let windowStart = 0;
let worst = 0;
let longTasks = 0;
let longestTask = 0;
let lastReport = 0;
let onFps: ((fps: number) => void) | null = null;

const FPS_TARGET = 60;

function loop(ts: number): void {
  if (!enabled) {
    raf = 0;
    return;
  }
  if (windowStart === 0) windowStart = ts;
  frames += 1;
  const delta = ts - windowStart;
  if (delta >= 1000) {
    const fps = Math.round((frames * 1000) / delta);
    onFps?.(fps);
    frames = 0;
    windowStart = ts;
    report(fps);
  }
  raf = requestAnimationFrame(loop);
}

function report(fps: number): void {
  const now = Date.now();
  if (now - lastReport < 2500) return;
  lastReport = now;
  void window.juzt?.diagReport({ fps, worstFrameMs: Math.round(worst), longTasks, longestTaskMs: Math.round(longestTask) }).catch(() => undefined);
  worst = 0;
  longTasks = 0;
  longestTask = 0;
}

/** Frame-time probe: the same loop that feeds the overlay is the measurement. */
export function startFrameProbe(cb: (fps: number) => void): void {
  onFps = cb;
  if (raf) return;
  const measure = (ts: number) => {
    const delta = ts - (lastFrame || ts);
    lastFrame = ts;
    if (delta > worst) worst = delta;
    raf = requestAnimationFrame(measure);
  };
  let lastFrame = 0;
  raf = requestAnimationFrame(measure);
}

export function setDiagEnabled(on: boolean): void {
  enabled = on;
  if (on && !raf) {
    windowStart = 0;
    frames = 0;
    raf = requestAnimationFrame(loop);
  }
  if (on) observeLongTasks();
}

let observing = false;
function observeLongTasks(): void {
  if (observing) return;
  observing = true;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks += 1;
        if (entry.duration > longestTask) longestTask = entry.duration;
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch {
    /* longtask is not available everywhere; fps still works */
  }
}

export const diagTarget = FPS_TARGET;
