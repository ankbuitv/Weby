import { APP_NAME, DEFAULT_CAMERA_CONFIG, DEFAULT_SETTINGS } from '../shared/types';
import type { CameraConfig, LiveState, MaskRect, SpotlightState } from '../shared/types';

/**
 * The live stage: presentation state machine + the audience-safe state.
 *
 * Presentation strategy (Electron 31 supports neither `setBorderRadius` on a
 * view nor one view in two windows):
 *
 *   Dual mode  — the audience page runs in the LIVE window's own WebContentsView
 *                on the same persistent session (`persist:juzt`). Presenting a
 *                tab navigates that stage to the tab's URL; if it is already on
 *                the same URL nothing reloads at all. Audience protection: the
 *                surface covers the stage with the previous frame (one capture,
 *                never a loop) until the new page has meaningfully loaded.
 *   Single mode — the presented tab's own view is shown in the PREP card and the
 *                teacher keeps interacting with it directly.
 *
 * A stale async completion can never override a newer Present: every transition
 * carries a revision and only the newest one may finish.
 */

export interface PresentTarget {
  kind: 'tab' | 'board';
  id: string;
  label: string;
  url?: string;
  boardId?: string;
}

export type ProgressStage = 'idle' | 'protecting' | 'loading' | 'revealing' | 'error';

export interface LiveDeps {
  /** The web contents that carries the audience page (stage, or the card view in single mode). */
  surfaceWebContents(): Electron.WebContents | null;
  /** Called whenever the public state changes (broadcast + view routing). */
  onChange(state: LiveState): void;
  onProgress(stage: ProgressStage, message?: string): void;
  isSingleMode(): boolean;
  /** Navigate the audience page (dual mode); resolves when the load settled. */
  navigateStage(url: string): Promise<boolean>;
  /** True when the audience page is already on that URL. */
  stageOnUrl(url: string): boolean;
  /** Silence the audience page while the privacy screen is up. */
  muteAudience(muted: boolean): void;
  /** One snapshot of what the audience currently sees (never a loop). */
  captureSnapshot(): Promise<string | null>;
  onFrozenFrame(dataUrl: string | null): void;
  onProtectionFrame(dataUrl: string | null): void;
  onPreviewFrame?(dataUrl: string): void;
}

export const MIN_PROTECT_MS = 150;
export const REVEAL_FADE_MS = 220;
/** Upper bound on how long the audience stays protected while a page loads. */
export const MAX_PROTECT_MS = 8000;
/** PREP live preview: 1–5 fps is plenty, and it stops when hidden. */
export const PREVIEW_INTERVAL_MS = 400;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function defaultLiveState(): LiveState {
  const s = DEFAULT_SETTINGS;
  return {
    revision: 0,
    presentation: { kind: 'holding', label: s.holdingText },
    flags: { privacy: false, frozen: false, protecting: false },
    layout: s.layout,
    sizePreset: s.sizePreset,
    customScale: s.customScale,
    card: s.card,
    zoom: s.zoom,
    liveBackground: s.liveBackground,
    holdingBackground: s.holdingBackground,
    privacyBackground: s.privacyBackground,
    holdingText: s.holdingText,
    privacyTitle: s.privacyTitle,
    privacySubtitle: s.privacySubtitle,
    spotlight: { on: false, x: 0.5, y: 0.5, r: 0.22, dim: 0.55, shape: 'circle' },
    masks: [],
    camera: { ...DEFAULT_CAMERA_CONFIG },
    appName: APP_NAME,
    version: '',
    cleanMode: false,
    singleMode: false,
  };
}

export class LiveStage {
  state: LiveState;
  private deps: LiveDeps;
  private revision = 0;
  private protectStartedAt = 0;
  private previewTimer: NodeJS.Timeout | null = null;
  private previewBusy = false;

  constructor(deps: LiveDeps, initial: LiveState = defaultLiveState()) {
    this.deps = deps;
    this.state = initial;
    this.revision = initial.revision;
  }

  /* ------------------------------------------------------------------ *
   * State plumbing
   * ------------------------------------------------------------------ */

  private commit(): void {
    this.revision += 1;
    this.state = { ...this.state, revision: this.revision };
    this.deps.onChange(this.state);
  }

  patch(partial: Partial<LiveState>): void {
    this.state = { ...this.state, ...partial };
    this.commit();
  }

  get currentRevision(): number {
    return this.revision;
  }

  setCleanMode(on: boolean): void {
    if (this.state.cleanMode === on) return;
    this.patch({ cleanMode: on });
  }

  setSingleMode(on: boolean): void {
    if (this.state.singleMode === on) return;
    this.patch({ singleMode: on });
  }

  /* ------------------------------------------------------------------ *
   * Presenting
   * ------------------------------------------------------------------ */

  async present(target: PresentTarget): Promise<boolean> {
    const revision = ++this.revision;
    this.state = {
      ...this.state,
      presentation:
        target.kind === 'board'
          ? { kind: 'board', label: target.label, boardId: target.boardId }
          : { kind: 'tab', label: target.label },
      freezeUrl: undefined,
      protectionUrl: undefined,
      flags: { ...this.state.flags, protecting: false, frozen: false, privacy: false },
      revision,
    };
    this.deps.onFrozenFrame(null);
    this.deps.onProtectionFrame(null);
    this.commit();

    if (target.kind === 'board') {
      this.deps.onProgress('idle');
      return true;
    }
    if (!target.url) {
      this.deps.onProgress('error', 'This tab has no address to present yet');
      return false;
    }
    if (this.deps.isSingleMode() || this.deps.stageOnUrl(target.url)) {
      this.deps.onProgress('idle');
      return true;
    }

    // Protect the audience: one capture of the previous frame, kept up until the
    // new page has meaningfully loaded.
    const previous = await this.deps.captureSnapshot();
    if (revision !== this.revision) return false; // a newer Present won
    if (previous) {
      this.state = { ...this.state, protectionUrl: previous };
      this.deps.onProtectionFrame(previous);
    }
    this.state = { ...this.state, flags: { ...this.state.flags, protecting: true } };
    this.commit();
    this.protectStartedAt = Date.now();
    this.deps.onProgress('protecting');

    let ok = false;
    try {
      ok = await Promise.race([
        this.deps.navigateStage(target.url),
        delay(MAX_PROTECT_MS).then(() => true),
      ]);
    } catch {
      ok = false;
    }
    if (revision !== this.revision) return false;

    if (!ok) {
      this.state = { ...this.state, flags: { ...this.state.flags, protecting: false }, protectionUrl: undefined };
      this.commit();
      this.deps.onProtectionFrame(null);
      this.deps.onProgress('error', 'The page could not be loaded — the audience is still on the previous frame');
      return false;
    }

    const waited = Date.now() - this.protectStartedAt;
    if (waited < MIN_PROTECT_MS) await delay(MIN_PROTECT_MS - waited);
    if (revision !== this.revision) return false;

    this.deps.onProgress('revealing');
    await delay(REVEAL_FADE_MS);
    if (revision !== this.revision) return false;
    this.state = { ...this.state, flags: { ...this.state.flags, protecting: false }, protectionUrl: undefined };
    this.commit();
    this.deps.onProtectionFrame(null);
    this.deps.onProgress('idle');
    return true;
  }

  /** Audience-only navigation while a page is presented (safe: same guards). */
  async navigateAudience(url: string): Promise<boolean> {
    const revision = ++this.revision;
    if (this.deps.isSingleMode()) {
      // In single mode the audience page is the tab the teacher is browsing.
      return false;
    }
    if (this.deps.stageOnUrl(url)) return true;
    const previous = await this.deps.captureSnapshot();
    if (revision !== this.revision) return false;
    if (previous) {
      this.state = { ...this.state, protectionUrl: previous, flags: { ...this.state.flags, protecting: true } };
      this.deps.onProtectionFrame(previous);
    } else {
      this.state = { ...this.state, flags: { ...this.state.flags, protecting: true } };
    }
    this.commit();
    this.deps.onProgress('protecting');
    let ok = true;
    try {
      ok = await this.deps.navigateStage(url);
    } catch {
      ok = false;
    }
    if (revision !== this.revision) return false;
    await delay(REVEAL_FADE_MS);
    if (revision !== this.revision) return false;
    this.state = { ...this.state, protectionUrl: undefined, flags: { ...this.state.flags, protecting: false } };
    this.commit();
    this.deps.onProtectionFrame(null);
    this.deps.onProgress(ok ? 'idle' : 'error', ok ? undefined : 'That address could not be loaded');
    return ok;
  }

  stop(): void {
    this.revision += 1;
    this.state = {
      ...this.state,
      presentation: { kind: 'holding', label: this.state.holdingText || 'Ready when you are' },
      flags: { ...this.state.flags, protecting: false, frozen: false },
      freezeUrl: undefined,
      protectionUrl: undefined,
      revision: this.revision,
    };
    this.deps.onFrozenFrame(null);
    this.deps.onProtectionFrame(null);
    this.commit();
    this.deps.onProgress('idle');
  }

  /* ------------------------------------------------------------------ *
   * Audience effects
   * ------------------------------------------------------------------ */

  setPrivacy(on: boolean): void {
    if (this.state.flags.privacy === on) return;
    this.patch({ flags: { ...this.state.flags, privacy: on } });
    this.deps.muteAudience(on);
  }

  /** Freeze: exactly one snapshot, held until unfrozen. */
  async setFreeze(on: boolean): Promise<void> {
    if (on) {
      const snapshot = await this.deps.captureSnapshot();
      this.deps.onFrozenFrame(snapshot);
      this.patch({ flags: { ...this.state.flags, frozen: true }, freezeUrl: snapshot ?? undefined });
    } else {
      this.deps.onFrozenFrame(null);
      this.patch({ flags: { ...this.state.flags, frozen: false }, freezeUrl: undefined });
    }
  }

  setSpotlight(patch: Partial<SpotlightState>): void {
    this.patch({ spotlight: { ...this.state.spotlight, ...patch } });
  }

  setMasks(masks: MaskRect[]): void {
    this.patch({ masks });
  }

  /**
   * True when the audience can see an effect that PREP also has to draw on top
   * of the native page (the card overlay is the only layer that can).
   */
  effectsVisible(): boolean {
    return this.state.spotlight.on || this.state.masks.length > 0;
  }

  setCamera(camera: CameraConfig): void {
    this.patch({ camera });
  }

  setHoldingText(text: string): void {
    const label = this.state.presentation.kind === 'holding' ? text || 'Ready when you are' : this.state.presentation.label;
    this.patch({ holdingText: text, presentation: { ...this.state.presentation, label } });
  }

  /** Settings/scene changes that must reach the audience surface. */
  applyVisuals(partial: Partial<LiveState>): void {
    const next: Partial<LiveState> = {};
    const keys: (keyof LiveState)[] = ['layout', 'sizePreset', 'customScale', 'card', 'zoom', 'liveBackground', 'holdingBackground', 'privacyBackground', 'privacyTitle', 'privacySubtitle'];
    for (const key of keys) if (key in partial) (next as Record<string, unknown>)[key] = partial[key];
    this.patch(next);
  }

  /* ------------------------------------------------------------------ *
   * PREP live preview (≤5 fps, stops when disabled or hidden)
   * ------------------------------------------------------------------ */

  setPreview(enabled: boolean, onFrame: ((dataUrl: string) => void) | null): void {
    if (this.previewTimer) {
      clearInterval(this.previewTimer);
      this.previewTimer = null;
    }
    if (!enabled || !onFrame || this.deps.isSingleMode()) {
      this.deps.onPreviewFrame?.('');
      return;
    }
    this.deps.onPreviewFrame = onFrame;
    this.previewTimer = setInterval(() => {
      if (this.previewBusy) return;
      const wc = this.deps.surfaceWebContents() ?? undefined;
      if (!wc || wc.isDestroyed()) return;
      this.previewBusy = true;
      wc.capturePage()
        .then((image) => {
          const size = image.getSize();
          const width = Math.min(640, Math.max(320, size.width));
          const scaled = image.resize({ width });
          this.deps.onPreviewFrame?.(scaled.toDataURL());
        })
        .catch(() => undefined)
        .finally(() => {
          this.previewBusy = false;
        });
    }, PREVIEW_INTERVAL_MS);
  }

  dispose(): void {
    if (this.previewTimer) clearInterval(this.previewTimer);
    this.previewTimer = null;
  }
}
