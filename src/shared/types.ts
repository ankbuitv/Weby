/**
 * Juzt — shared contracts between the main process, the preload bridge and the
 * two renderers (PREP = private teacher workspace, LIVE = audience output).
 *
 * Nothing in here may contain private data: `LiveState` is the *public*
 * projection that LIVE receives, and it must never carry tab URLs, history,
 * favorites or prep notes.
 */

import type { UserAgentMode } from './engine';

/* ------------------------------------------------------------------ *
 * Basics
 * ------------------------------------------------------------------ */

export const APP_NAME = 'Juzt';
export const PREP_WINDOW_TITLE = 'Juzt Prep';
export const LIVE_WINDOW_TITLE = 'Juzt Live';
export const SCHEMA_VERSION = 1;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Size {
  width: number;
  height: number;
}

/* ------------------------------------------------------------------ *
 * Backgrounds
 * ------------------------------------------------------------------ */

export type BackgroundKind = 'none' | 'color' | 'gradient' | 'image' | 'video';
export type FitMode = 'cover' | 'contain' | 'stretch';

export interface BackgroundSpec {
  kind: BackgroundKind;
  /** Solid colour (`#rrggbb`) for `color`, base colour for `gradient`. */
  color?: string;
  /** Full CSS gradient, e.g. `linear-gradient(160deg,#0b1020,#1b2a4a)`. */
  gradient?: string;
  /** Absolute path of a local image/video file. Never a remote URL. */
  path?: string;
  fit?: FitMode;
  loop?: boolean;
  muted?: boolean;
  /** 0..1 */
  volume?: number;
  /** 0.25..4 */
  rate?: number;
  /** 0..0.85 darkening overlay for readability. */
  dim?: number;
}

export interface BackgroundPreset {
  id: string;
  name: string;
  spec: BackgroundSpec;
  /** Small data-URL preview for the library grid (never a full-size copy). */
  thumb?: string;
  addedAt: number;
}

export const DEFAULT_LIVE_BACKGROUND: BackgroundSpec = {
  kind: 'gradient',
  // V2 presentation background: a calm dark blue → violet field that fills the
  // whole window and never competes with the lesson.
  gradient: 'radial-gradient(125% 120% at 18% 6%, #26325e 0%, #171d3a 38%, #0b0e1a 70%, #06070d 100%)',
  dim: 0,
};

export const DEFAULT_HOLDING_BACKGROUND: BackgroundSpec = {
  kind: 'gradient',
  gradient: 'radial-gradient(120% 120% at 50% 0%, #17203a 0%, #0a0d14 60%, #05060a 100%)',
  dim: 0,
};

export const DEFAULT_PRIVACY_BACKGROUND: BackgroundSpec = {
  kind: 'gradient',
  gradient: 'linear-gradient(160deg, #0a2a3a 0%, #071a26 60%, #04101a 100%)',
  dim: 0,
};

/* ------------------------------------------------------------------ *
 * Presentation / layout
 * ------------------------------------------------------------------ */

export type PresentationMode = 'single' | 'dual';
export type LayoutId = 'focus' | 'classroom' | 'tutor' | 'whiteboard' | 'custom';
export type SizePreset = 'comfortable' | 'large' | 'full' | '16:9' | '4:3' | 'portrait' | 'custom';
export type CardBorder = 'off' | 'subtle';
export type CardShadow = 'off' | 'soft' | 'medium';
export type CardMargin = 'compact' | 'comfortable' | 'spacious';

export const CARD_RADII = [0, 8, 12, 16, 18, 24, 32] as const;
export type CardRadius = (typeof CARD_RADII)[number];
export const DEFAULT_CARD_RADIUS: CardRadius = 18;

export interface CardAppearance {
  /** Corner radius in CSS px (validated against CARD_RADII). */
  radius: CardRadius;
  border: 'off' | 'subtle';
  shadow: 'off' | 'soft' | 'medium';
  margin: 'compact' | 'comfortable' | 'spacious';
}

export interface DisplayInfo {
  id: number;
  label: string;
  width: number;
  height: number;
  scaleFactor: number;
  primary: boolean;
  internal: boolean;
}

export type PresentationKind = 'holding' | 'tab' | 'board';

export interface LiveFlagState {
  privacy: boolean;
  frozen: boolean;
  /** Audience is being protected while the newest content loads. */
  protecting: boolean;
}

export const NO_FLAGS: LiveFlagState = { privacy: false, frozen: false, protecting: false };

export interface LaserPoint {
  x: number;
  y: number;
}

export interface PrivacyMask {
  id: string;
  /** Normalised 0..1 inside the card. */
  x: number;
  y: number;
  w: number;
  h: number;
  mode: 'solid' | 'blur';
}

export interface LiveSurfaceConfig {
  liveBackground: BackgroundSpec;
  holdingBackground: BackgroundSpec;
  privacyBackground: BackgroundSpec;
  holdingText: string;
  privacyTitle: string;
  privacySubtitle: string;
  card: CardAppearance;
  layout: LayoutId;
  sizePreset: SizePreset;
}

export interface LiveFlags {
  privacy: boolean;
  frozen: boolean;
  protecting: boolean;
  spotlight: boolean;
  clean: boolean;
}

/** What the audience output knows. No URLs, no titles of private tabs. */
export interface LivePayload {
  revision: number;
  mode: PresentationMode;
  appName: string;
  version: string;
  /** What the audience is looking at right now. */
  presentation: { kind: 'holding' | 'web' | 'whiteboard'; label: string; boardId?: string | null };
  flags: LiveFlags;
  surface: LiveSurfaceConfig;
  camera: CameraConfig;
  spotlight: SpotlightState;
  masks: PrivacyMask[];
  zoom: number;
}

export interface SpotlightState {
  on: boolean;
  /** Normalised 0..1 position inside the card. */
  x: number;
  y: number;
  /** Normalised radius (fraction of card width). */
  r: number;
  dim: number;
  shape: 'circle' | 'rect';
}

export interface MaskRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  mode: 'solid' | 'blur';
}

export interface CameraConfig {
  enabled: boolean;
  deviceId?: string;
  deviceLabel?: string;
  mirror: boolean;
  /** Where the camera preview is visible. */
  exposure: 'prep' | 'live' | 'both';
  shape: 'rounded' | 'circle';
  /** Normalised rect inside the card. */
  rect: { x: number; y: number; w: number; h: number };
  radius: number;
}


/**
 * The audience-safe state. LIVE gets exactly this and nothing else: no URLs,
 * no titles of prep-only content, no history, no favorites.
 */
export interface LiveState {
  revision: number;
  /** Brand string for the holding/privacy screens (never a URL). */
  appName: string;
  presentation: { kind: PresentationKind; label: string; boardId?: string };
  flags: LiveFlagState;
  layout: LayoutId;
  sizePreset: SizePreset;
  customScale: number;
  card: CardAppearance;
  zoom: number;
  liveBackground: BackgroundSpec;
  holdingBackground: BackgroundSpec;
  privacyBackground: BackgroundSpec;
  holdingText: string;
  privacyTitle: string;
  privacySubtitle: string;
  spotlight: SpotlightState;
  masks: MaskRect[];
  camera: CameraConfig;
  /** Set while the freeze snapshot is displayed. */
  freezeUrl?: string;
  /** Previous frame shown while the audience is protected during a transfer. */
  protectionUrl?: string;
  /** Live indicator mirror for the LIVE window's own chrome (hidden by default). */
  cleanMode: boolean;
  /** True when the PREP window itself is the audience output. */
  singleMode: boolean;
  /** App version string shown on the holding screen footer. */
  version: string;
}

/* ------------------------------------------------------------------ *
 * Tabs
 * ------------------------------------------------------------------ */

/**
 * Website-annotation tools (PREP overlay). Kept as a named type because the
 * toolbar, the shortcuts map and the ink model all key off it.
 */
export type ToolId =
  | 'cursor'
  | 'pen'
  | 'marker'
  | 'highlighter'
  | 'eraser'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'number'
  | 'laser'
  | 'spotlight';

export type TabKind = 'web' | 'whiteboard';

export interface WebTab {
  id: string;
  kind: 'web';
  title: string;
  url: string;
  favicon?: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  muted: boolean;
  audible: boolean;
  pinned: boolean;
  discarded: boolean;
  /** Private tabs may not be presented (never leak into LIVE). */
  private?: boolean;
  error?: string;
}

export interface WhiteboardTab {
  id: string;
  kind: 'whiteboard';
  boardId: string;
  name: string;
  pinned: boolean;
}

export type TabState = WebTab | WhiteboardTab;

export function isWebTab(tab: TabState | undefined | null): tab is WebTab {
  return !!tab && tab.kind === 'web';
}
export function isBoardTab(tab: TabState | undefined | null): tab is WhiteboardTab {
  return !!tab && tab.kind === 'whiteboard';
}

export function tabLabel(tab: TabState): string {
  if (tab.kind === 'whiteboard') return tab.name || 'Whiteboard';
  return tab.title || hostOf(tab.url) || 'New Tab';
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export interface ReopenRecord {
  kind: TabKind;
  url?: string;
  boardId?: string;
  pinned: boolean;
  index: number;
  title: string;
}

/* ------------------------------------------------------------------ *
 * Whiteboard
 * ------------------------------------------------------------------ */

export type WhiteboardThemeId = 'white' | 'dark' | 'blackboard' | 'grid' | 'dots' | 'sepia';

export interface WhiteboardTheme {
  id: WhiteboardThemeId;
  label: string;
  /** Background fill (or base colour for patterns). */
  background: string;
  pattern: 'none' | 'grid' | 'dots' | 'lines';
  patternColor: string;
  patternSize: number;
  /** Default ink colour for new objects. */
  ink: string;
  /** Contrast used by the UI for previews. */
  dark: boolean;
}

export const WHITEBOARD_THEMES: WhiteboardTheme[] = [
  { id: 'white', label: 'White', background: '#ffffff', pattern: 'none', patternColor: '#dfe3ea', patternSize: 40, ink: '#111318', dark: false },
  { id: 'dark', label: 'Dark', background: '#0e1116', pattern: 'none', patternColor: '#232a36', patternSize: 40, ink: '#f2f5fa', dark: true },
  { id: 'blackboard', label: 'Blackboard', background: '#101b16', pattern: 'none', patternColor: '#1d2c25', patternSize: 40, ink: '#f6f8f4', dark: true },
  { id: 'grid', label: 'Grid', background: '#fbfcfe', pattern: 'grid', patternColor: '#dde3ec', patternSize: 48, ink: '#111318', dark: false },
  { id: 'dots', label: 'Dots', background: '#f7f8fb', pattern: 'dots', patternColor: '#c9d1de', patternSize: 32, ink: '#111318', dark: false },
  { id: 'sepia', label: 'Sepia', background: '#f6efe3', pattern: 'none', patternColor: '#ddd0ba', patternSize: 40, ink: '#3a3226', dark: false },
];

export type WbTool =
  | 'select'
  | 'hand'
  | 'pen'
  | 'marker'
  | 'highlighter'
  | 'eraser'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'number'
  | 'laser'
  | 'image';

export interface WbStyle {
  color: string;
  width: number;
  opacity: number;
  fill?: string;
  fontSize?: number;
}

export interface WbObjectBase {
  id: string;
  /** Creation order, used as the stable z-order. */
  z: number;
}

export interface WbStroke extends WbObjectBase {
  kind: 'stroke';
  tool: 'pen' | 'marker' | 'highlighter';
  /** Flat [x0,y0,x1,y1,…] in board coordinates. */
  points: number[];
  /** Optional per-point pressure (0..1), same length as points/2. */
  pressure?: number[];
  style: WbStyle;
}

export interface WbShape extends WbObjectBase {
  kind: 'line' | 'arrow' | 'rect' | 'ellipse';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  style: WbStyle;
}

export interface WbText extends WbObjectBase {
  kind: 'text';
  x: number;
  y: number;
  text: string;
  style: WbStyle;
}

export interface WbImage extends WbObjectBase {
  kind: 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  /** `file://`-style local path or data URL (imported copies only). */
  src: string;
  naturalW: number;
  naturalH: number;
}

export interface WbNumber extends WbObjectBase {
  kind: 'number';
  x: number;
  y: number;
  n: number;
  radius: number;
  style: WbStyle;
}

export type WbObject = WbStroke | WbShape | WbText | WbImage | WbNumber;
export type WbObjectKind = WbObject['kind'];

export interface WbView {
  x: number;
  y: number;
  zoom: number;
}

export interface WhiteboardDoc {
  schemaVersion: number;
  id: string;
  name: string;
  theme: WhiteboardThemeId;
  objects: WbObject[];
  view: WbView;
  updatedAt: number;
  /** Monotonic op counter for cheap divergence checks. */
  rev: number;
}

export interface WhiteboardMeta {
  id: string;
  name: string;
  theme: WhiteboardThemeId;
  updatedAt: number;
  objectCount: number;
}

export type WbOp =
  | { type: 'add'; objects: WbObject[] }
  | { type: 'delete'; ids: string[] }
  | { type: 'move'; ids: string[]; dx: number; dy: number }
  | { type: 'replace'; id: string; object: WbObject }
  | { type: 'clear' }
  | { type: 'theme'; theme: WhiteboardThemeId }
  | { type: 'name'; name: string }
  | { type: 'view'; view: WbView };

export interface PrepUiState {
  /** Tool the teacher is drawing with on website content. */
  tool: string;
  /** True while the ink layer must be visible in PREP. */
  inkLayer: boolean;
  /** The holding screen covers the card (single mode). */
  cover: boolean;
  /** Ink style forwarded to the overlay renderer. */
  style?: { color: string; size: number; opacity: number; fontSize: number };
  /** Next number stamp. */
  number?: number;
  /**
   * The teacher is repositioning the camera preview on the card.
   *
   * While this is on, the overlay keeps the mouse so the camera can be dragged
   * over a live page; the moment it turns off, clicks fall through to the
   * website again.
   */
  cameraDrag?: boolean;
}

export interface PrepBootstrap {
  appName: string;
  version: string;
  dev: boolean;
  settings: Settings;
  scenes: Scene[];
  activeSceneId?: string;
  tabs: TabState[];
  activeTabId: string | null;
  boards: WhiteboardMeta[];
  favorites: Favorite[];
  history: HistoryEntry[];
  displays: DisplayInfo[];
  live: LivePayload;
  ui: PrepUiState;
  diagnosticsEnabled: boolean;
}

/* ------------------------------------------------------------------ *
 * Scenes
 * ------------------------------------------------------------------ */

export interface Scene {
  id: string;
  name: string;
  liveBackground: BackgroundSpec;
  holdingBackground: BackgroundSpec;
  privacyBackground: BackgroundSpec;
  holdingText: string;
  privacyTitle: string;
  privacySubtitle: string;
  card: CardAppearance;
  sizePreset: SizePreset;
  customScale: number;
  layout: LayoutId;
  zoom: number;
  spotlight: SpotlightState;
  masks: MaskRect[];
  outputDisplayId?: number;
  /** Optional page to open when the scene is applied (PREP only, never auto-presented). */
  startUrl?: string;
}

/* ------------------------------------------------------------------ *
 * Favorites / history
 * ------------------------------------------------------------------ */

export interface Favorite {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  addedAt: number;
}

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  visitedAt: number;
}

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

export const DEFAULT_CARD: CardAppearance = { radius: DEFAULT_CARD_RADIUS, border: 'subtle', shadow: 'soft', margin: 'comfortable' };

export const DEFAULT_CAMERA_CONFIG: CameraConfig = {
  enabled: false,
  mirror: true,
  exposure: 'prep',
  shape: 'rounded',
  rect: { x: 0.72, y: 0.68, w: 0.24, h: 0.24 },
  radius: 16,
};

export interface Settings {
  schemaVersion: number;
  presentationMode: PresentationMode;
  outputDisplayId?: number;
  layout: LayoutId;
  sizePreset: SizePreset;
  customScale: number;
  card: CardAppearance;
  /** Website zoom factor applied to prep views and the presented view. */
  zoom: number;
  /** Protect the audience while a newly presented page loads. */
  safeNavigation: boolean;

  liveBackground: BackgroundSpec;
  holdingBackground: BackgroundSpec;
  privacyBackground: BackgroundSpec;
  holdingText: string;
  privacyTitle: string;
  privacySubtitle: string;
  privacyMuteAudio: boolean;
  backgroundLibrary: BackgroundPreset[];

  boardTheme: WhiteboardThemeId;
  defaultPenColor: string;
  defaultPenSize: number;
  defaultMarkerColor: string;
  defaultMarkerSize: number;
  defaultHighlighterColor: string;
  defaultHighlighterOpacity: number;
  defaultEraserSize: number;
  defaultTextSize: number;
  numberStampStart: number;

  camera: CameraConfig;

  /** Website identity Juzt presents to websites. Engine-accurate by default. */
  webUserAgent: UserAgentMode;
  /**
   * Per-origin compatibility overrides, keyed by scheme://host[:port].
   *
   * `clean`     — Chrome-compatible UA derived from the real Chromium build.
   * `app`       — the same UA plus the `Juzt/<version>` token.
   * `electron`  — the stock Electron identity.
   * There is deliberately no "pretend to be a newer Chrome" option: the engine
   * is already modern, and a fake version is a spoofing trap.
   */
  siteCompat: Record<string, UserAgentMode>;
  /** Extensions the teacher has approved (directory references only). */
  extensions: ExtensionRecord[];
  /** Developer mode unlocks Load Unpacked / reload / raw errors. Off by default. */
  extensionDevMode: boolean;
  /** Safe mode: launch website tabs with extensions off and default compat. */
  safeMode: boolean;

  tabMemoryPolicy: 'keep' | 'autoDiscard';
  /** Single-monitor private pane (Ctrl+Shift+P). */
  prepPaneOpen: boolean;
  /** Keep the compact tab shelf on screen even with a single tab. */
  tabShelfAlways: boolean;
  /** Development diagnostics are opt-in. */
  diagnostics: boolean;
  firstRunDone: boolean;

  /** Tabs restored on the previous quit (URLs are private, prep-only). */
  lastSession?: {
    tabs: { kind: TabKind; url?: string; boardId?: string; pinned: boolean }[];
    activeIndex: number;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: SCHEMA_VERSION,
  // V2 default: one calm window — background + website card + left toolbar.
  // Dual monitor output is opt-in ("Start Presentation"), never the default.
  presentationMode: 'single',
  layout: 'focus',
  sizePreset: 'comfortable',
  customScale: 0.8,
  card: { ...DEFAULT_CARD },
  zoom: 1,
  safeNavigation: true,

  /** Compact tab shelf: hidden while a single tab is open unless forced on. */
  tabShelfAlways: false,

  liveBackground: { ...DEFAULT_LIVE_BACKGROUND },
  holdingBackground: { ...DEFAULT_HOLDING_BACKGROUND },
  privacyBackground: { ...DEFAULT_PRIVACY_BACKGROUND },
  holdingText: 'Ready when you are',
  privacyTitle: 'Không được xem 👀',
  privacySubtitle: 'Đang chuẩn bị nội dung...',
  privacyMuteAudio: true,
  backgroundLibrary: [],

  boardTheme: 'dark',
  defaultPenColor: '#4aa3ff',
  defaultPenSize: 4,
  defaultMarkerColor: '#ffd166',
  defaultMarkerSize: 10,
  defaultHighlighterColor: '#ffe066',
  defaultHighlighterOpacity: 0.4,
  defaultEraserSize: 24,
  defaultTextSize: 32,
  numberStampStart: 1,

  camera: { ...DEFAULT_CAMERA_CONFIG },

  webUserAgent: 'clean',
  siteCompat: {},
  extensions: [],
  extensionDevMode: false,
  safeMode: false,

  tabMemoryPolicy: 'keep',
  prepPaneOpen: false,
  diagnostics: false,
  firstRunDone: false,
};

/* ------------------------------------------------------------------ *
 * Permission prompts (PREP-only UI)
 * ------------------------------------------------------------------ */

export interface PermissionRequest {
  id: string;
  origin: string;
  host: string;
  kinds: string[];
  rememberable: boolean;
  mediaKinds?: string[];
}

export interface ScreenSource {
  id: string;
  name: string;
  thumbnail: string | undefined;
  displayId?: string;
}

/* ------------------------------------------------------------------ *
 * Website identity / extensions
 * ------------------------------------------------------------------ */

/** How an extension is currently doing. Reported privately, never to LIVE. */
export type ExtensionStatus = 'loaded' | 'disabled' | 'failed' | 'unknown';

/** An approved extension directory reference (persisted; reloaded on start). */
export interface ExtensionRecord {
  /** Stable id: the extension id Electron reports once loaded. */
  id: string;
  /** Absolute path of the unpacked extension directory. */
  path: string;
  name: string;
  version: string;
  /** `2` or `3`, read from the manifest. */
  manifestVersion: number;
  description?: string;
  enabled: boolean;
  status: ExtensionStatus;
  /** Last load error, shown only in PREP developer mode. */
  error?: string;
  addedAt: number;
}

/* ------------------------------------------------------------------ *
 * Diagnostics
 * ------------------------------------------------------------------ */

export interface ToastMessage {
  id: string;
  message: string;
  tone: 'info' | 'error';
  at: number;
}

export interface DiagStats {
  /** Frames rendered in the last sampling window and their budget. */
  fps: number;
  worstFrameMs: number;
  longTasks: number;
  longestTaskMs: number;
  /** IPC coalescing: how many `setBounds` calls were avoided. */
  boundsApplied: number;
  boundsSkipped: number;
  focusRestoreMs?: number;
  presentedWebContents: number;
  liveWebContents: number;
  activeTabKind?: string;
  /** Bytes of renderer heap, when available. */
  heapMb?: number;
  backgroundViews: number;
}

