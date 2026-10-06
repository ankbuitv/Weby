/**
 * The functional state model.
 *
 * This module exists so the "what is on screen" question has exactly one
 * answer, computed the same way in main (which native view to show) and in the
 * PREP renderer (which DOM surface to draw). It is deliberately pure so the
 * render invariants can be unit-tested without Electron:
 *
 *   NORMAL / SINGLE WINDOW
 *     the active workspace is exactly ONE of NEW_TAB | WEB | WHITEBOARD,
 *     optionally overlaid by PRIVACY or FROZE. Nothing else is ever layered.
 *
 *   PRESENTATION MODE
 *     PREP  → NEW_TAB | WEB | WHITEBOARD   (the teacher's private workspace)
 *     LIVE  → HOLDING | WEB | WHITEBOARD | PRIVACY | FROZEN
 *     PREP and LIVE are separate render targets; neither ever renders the
 *     other's states.
 */

import type { PresentationKind, PresentationMode, TabState } from './types';

/**
 * The presentation kind as the two layers spell it.
 *
 * `LiveState` (main's internal model) says `tab`/`board`; the public
 * `LivePayload` the renderers see says `web`/`whiteboard`. Both mean exactly
 * the same three audience states, so the resolver accepts either spelling
 * rather than forcing a lossy translation at every call site.
 */
export type PresentationState = PresentationKind | 'holding' | 'web' | 'whiteboard';

/** The one primary content surface of a single window. */
export type WorkspaceKind = 'newtab' | 'web' | 'whiteboard';

/** What the audience (LIVE) surface is showing. */
export type AudienceKind = 'holding' | 'web' | 'whiteboard' | 'privacy' | 'frozen';

/** Overlays that may intentionally sit on top of the active content. */
export type ContentOverlay = 'none' | 'privacy' | 'freeze';

export interface WorkspaceInput {
  mode: PresentationMode;
  /** The active tab of the window being described (null = nothing open). */
  active: TabState | null;
  /** Audience privacy screen is up. */
  privacy: boolean;
  /** Audience view is frozen on one snapshot. */
  frozen: boolean;
  /** Presentation state the audience is on (only meaningful in dual mode). */
  presentation: PresentationState;
}

export interface WorkspaceState {
  /** Exactly one primary content surface. Never more. */
  kind: WorkspaceKind;
  /** At most one intentional overlay; everything else is 'none'. */
  overlay: ContentOverlay;
}

/**
 * Resolve the single-window workspace.
 *
 * A whiteboard tab is a tab type, not a dashboard: it swaps the *card* content
 * and leaves the rest of the V2 composition (background, card, toolbar) alone.
 */
export function resolveWorkspace(input: WorkspaceInput): WorkspaceState {
  const tab = input.active;
  let kind: WorkspaceKind = 'newtab';
  if (tab) {
    if (tab.kind === 'whiteboard') kind = 'whiteboard';
    else if (!tab.url.startsWith('juzt://')) kind = 'web';
  }
  // Privacy and freeze are the ONLY things allowed to cover the content, and
  // they never change which surface is active underneath.
  const overlay: ContentOverlay = input.privacy ? 'privacy' : input.frozen ? 'freeze' : 'none';
  return { kind, overlay };
}

/**
 * Resolve the audience surface (the LIVE window only).
 *
 * `mode === 'single'` has no separate audience render target at all: the
 * teacher's own window is the output, so this returns null and the caller must
 * use `resolveWorkspace` instead. That is the rule that keeps a holding screen
 * from ever appearing over normal browsing.
 */
export function resolveAudience(input: WorkspaceInput): AudienceKind | null {
  if (input.mode !== 'dual') return null;
  if (input.privacy) return 'privacy';
  if (input.frozen) return 'frozen';
  if (input.presentation === 'holding') return 'holding';
  if (input.presentation === 'tab' || input.presentation === 'web') return 'web';
  if (input.presentation === 'board' || input.presentation === 'whiteboard') return 'whiteboard';
  return 'web';
}

/** True when the native website view of a tab should be on screen. */
export function webViewVisible(input: WorkspaceInput, tabId: string): boolean {
  if (input.privacy) return false;
  return resolveWorkspace(input).kind === 'web' && !!input.active && input.active.id === tabId;
}

/**
 * The card overlay (transparent WebContentsView above the page) must be mapped
 * only when it has work to do — Electron 31 has no per-view click-through, so
 * an idle overlay would swallow every click meant for the website.
 */
export function overlayNeeded(input: WorkspaceInput & { drawing: boolean; committedInk: boolean; cameraDrag: boolean; effects: boolean }): boolean {
  return input.drawing || input.committedInk || input.cameraDrag || input.effects || input.privacy || input.frozen;
}
