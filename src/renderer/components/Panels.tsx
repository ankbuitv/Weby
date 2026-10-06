import React from 'react';
import {
  CARD_RADII,
  DEFAULT_SETTINGS,
  WHITEBOARD_THEMES,
  tabLabel,
  type BackgroundSpec,
  type DisplayInfo,
  type Settings,
  type SpotlightState,
  type TabState,
} from '../../shared/types';
import { hostOf } from '../../shared/url';
import { MARGINS, SIZE_PRESETS } from '../../shared/layout';
import { actions } from '../state/actions';
import { store, useSel, type SettingsTab } from '../state/store';
import { listCameras } from '../live/effects';
import { Icon } from './Icons';
import { Logo } from './Logo';

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'presentation', label: 'Presentation' },
  { id: 'backgrounds', label: 'Backgrounds' },
  { id: 'whiteboard', label: 'Whiteboard' },
  { id: 'tabs', label: 'Tabs' },
  { id: 'camera', label: 'Camera' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'about', label: 'About' },
];

export const SettingsPanel: React.FC = () => {
  const open = useSel((s) => s.settingsOpen);
  const tab = useSel((s) => s.settingsTab);
  if (!open) return null;

  return (
    <div className="jz-modal" onMouseDown={(e) => e.target === e.currentTarget && actions.closeSettings()}>
      <div className="jz-sheet jz-sheet--settings" role="dialog" aria-label="Settings">
        <aside className="jz-sheet__nav">
          <h2>Settings</h2>
          {SETTINGS_TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'is-active' : ''} onClick={() => actions.setSettingsTab(t.id)}>
              {t.label}
            </button>
          ))}
        </aside>
        <div className="jz-sheet__body">
          <button className="jz-sheet__close" title="Close" onClick={() => actions.closeSettings()}>
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 1l10 10M11 1l-10 10" stroke="currentColor" strokeWidth="1.4" /></svg>
          </button>
          {tab === 'presentation' ? <PresentationSettings /> : null}
          {tab === 'backgrounds' ? <BackgroundsPanel /> : null}
          {tab === 'whiteboard' ? <WhiteboardSettings /> : null}
          {tab === 'tabs' ? <TabSettings /> : null}
          {tab === 'camera' ? <CameraPanel /> : null}
          {tab === 'permissions' ? <PermissionInfo /> : null}
          {tab === 'about' ? <AboutPanel /> : null}
        </div>
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div className="jz-row">
    <div className="jz-row__label">
      <span>{label}</span>
      {hint ? <em>{hint}</em> : null}
    </div>
    <div className="jz-row__control">{children}</div>
  </div>
);

const PresentationSettings: React.FC = () => {
  const settings = useSel((s) => s.settings);
  const displays = useSel((s) => s.displays);
  const set = (patch: Partial<Settings>) => void actions.setSettings(patch);

  return (
    <section className="jz-section">
      <h3>Audience output</h3>
      <Row label="Mode" hint="Dual keeps the audience window separate — best for OBS and a projector.">
        <div className="jz-seg">
          <button className={settings.presentationMode === 'dual' ? 'is-active' : ''} onClick={() => set({ presentationMode: 'dual' })}>
            Dual
          </button>
          <button className={settings.presentationMode === 'single' ? 'is-active' : ''} onClick={() => set({ presentationMode: 'single' })}>
            Single window
          </button>
        </div>
      </Row>
      <Row label="Output monitor" hint="Remembered; falls back to the primary display when unplugged.">
        <select value={settings.outputDisplayId ?? ''} onChange={(e) => void actions.setOutputDisplay(e.target.value === '' ? null : Number(e.target.value))}>
          <option value="">Automatic</option>
          {displays.map((d: DisplayInfo) => (
            <option key={d.id} value={d.id}>
              {d.label} · {d.width}×{d.height}
            </option>
          ))}
        </select>
      </Row>

      <h3>Layout &amp; card</h3>
      <Row label="Layout">
        <div className="jz-seg">
          {(['focus', 'classroom', 'tutor', 'whiteboard', 'custom'] as const).map((l) => (
            <button key={l} className={settings.layout === l ? 'is-active' : ''} onClick={() => set({ layout: l })}>
              {l}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Size">
        <div className="jz-seg jz-seg--wrap">
          {SIZE_PRESETS.map((p) => (
            <button key={p.id} className={settings.sizePreset === p.id ? 'is-active' : ''} onClick={() => set({ sizePreset: p.id })}>
              {p.label}
            </button>
          ))}
        </div>
      </Row>
      {settings.sizePreset === 'custom' ? (
        <Row label="Scale">
          <input type="range" min={0.35} max={1} step={0.01} value={settings.customScale} onChange={(e) => set({ customScale: Number(e.target.value) })} />
        </Row>
      ) : null}
      <Row label="Corner radius" hint="Applied to the real site view, not a placeholder.">
        <div className="jz-seg">
          {CARD_RADII.map((r) => (
            <button key={r} className={settings.card.radius === r ? 'is-active' : ''} onClick={() => set({ card: { ...settings.card, radius: r } })}>
              {r}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Border">
        <div className="jz-seg">
          {(['off', 'subtle'] as const).map((b) => (
            <button key={b} className={settings.card.border === b ? 'is-active' : ''} onClick={() => set({ card: { ...settings.card, border: b } })}>
              {b}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Shadow">
        <div className="jz-seg">
          {(['off', 'soft', 'medium'] as const).map((s) => (
            <button key={s} className={settings.card.shadow === s ? 'is-active' : ''} onClick={() => set({ card: { ...settings.card, shadow: s } })}>
              {s}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Margin" hint="Keeps the frame clear of the camera and the toolbar.">
        <div className="jz-seg">
          {(Object.keys(MARGINS) as (keyof typeof MARGINS)[]).map((m) => (
            <button key={m} className={settings.card.margin === m ? 'is-active' : ''} onClick={() => set({ card: { ...settings.card, margin: m } })}>
              {m}
            </button>
          ))}
        </div>
      </Row>

      <h3>Behaviour</h3>
      <Row label="Safe live navigation" hint="The audience keeps the previous frame until the new page has really painted.">
        <Toggle on={settings.safeNavigation} onChange={(v) => set({ safeNavigation: v })} />
      </Row>
      <Row label="Website zoom">
        <select value={settings.zoom} onChange={(e) => void actions.setZoom(Number(e.target.value))}>
          {[0.5, 0.75, 1, 1.25, 1.5, 2].map((z) => (
            <option key={z} value={z}>
              {Math.round(z * 100)}%
            </option>
          ))}
        </select>
      </Row>
      <Row label="Private pane" hint="Single-window mode: keep a private pane next to the audience card (Ctrl+Shift+P).">
        <Toggle on={settings.prepPaneOpen} onChange={(v) => set({ prepPaneOpen: v })} />
      </Row>
      <Row label="Diagnostics" hint="Development only: FPS and IPC counters, never telemetry.">
        <Toggle on={settings.diagnostics} onChange={(v) => set({ diagnostics: v })} />
      </Row>
      <Row label="Live preview" hint="Optional 1–5 fps preview in PREP; stops while hidden.">
        <Toggle on={useSel((s) => s.previewEnabled)} onChange={(v) => void actions.setPreview(v)} />
      </Row>
    </section>
  );
};

const Toggle: React.FC<{ on: boolean; onChange: (v: boolean) => void }> = ({ on, onChange }) => (
  <button className={`jz-toggle ${on ? 'is-on' : ''}`} role="switch" aria-checked={on} onClick={() => onChange(!on)}>
    <span />
  </button>
);

const WhiteboardSettings: React.FC = () => {
  const settings = useSel((s) => s.settings);
  const set = (patch: Partial<Settings>) => void actions.setSettings(patch);
  return (
    <section className="jz-section">
      <h3>Default board</h3>
      <Row label="Theme">
        <div className="jz-seg jz-seg--wrap">
          {WHITEBOARD_THEMES.map((t) => (
            <button key={t.id} className={settings.boardTheme === t.id ? 'is-active' : ''} style={{ background: t.background, color: t.ink }} onClick={() => set({ boardTheme: t.id })}>
              {t.label}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Pen">
        <input type="color" value={settings.defaultPenColor} onChange={(e) => set({ defaultPenColor: e.target.value })} />
        <input type="range" min={1} max={24} value={settings.defaultPenSize} onChange={(e) => set({ defaultPenSize: Number(e.target.value) })} />
      </Row>
      <Row label="Marker">
        <input type="color" value={settings.defaultMarkerColor} onChange={(e) => set({ defaultMarkerColor: e.target.value })} />
        <input type="range" min={6} max={48} value={settings.defaultMarkerSize} onChange={(e) => set({ defaultMarkerSize: Number(e.target.value) })} />
      </Row>
      <Row label="Highlighter opacity">
        <input type="range" min={0.1} max={0.7} step={0.05} value={settings.defaultHighlighterOpacity} onChange={(e) => set({ defaultHighlighterOpacity: Number(e.target.value) })} />
      </Row>
      <Row label="Text size">
        <input type="range" min={12} max={160} value={settings.defaultTextSize} onChange={(e) => set({ defaultTextSize: Number(e.target.value) })} />
      </Row>
      <Row label="Number stamp starts at">
        <input
          type="number"
          min={1}
          value={settings.numberStampStart}
          onChange={(e) => set({ numberStampStart: Math.max(1, Number(e.target.value) || 1) })}
        />
      </Row>
      <p className="jz-note">Boards autosave to your user data folder; closing Juzt never loses a stroke.</p>
    </section>
  );
};

const TabSettings: React.FC = () => {
  const settings = useSel((s) => s.settings);
  return (
    <section className="jz-section">
      <h3>Tabs</h3>
      <Row label="Background tabs" hint="Keeps memory in check on long lessons.">
        <div className="jz-seg">
          <button className={settings.tabMemoryPolicy === 'keep' ? 'is-active' : ''} onClick={() => void actions.setSettings({ tabMemoryPolicy: 'keep' })}>
            Keep loaded
          </button>
          <button className={settings.tabMemoryPolicy === 'autoDiscard' ? 'is-active' : ''} onClick={() => void actions.setSettings({ tabMemoryPolicy: 'autoDiscard' })}>
            Relax when idle
          </button>
        </div>
      </Row>
      <Row label="Reopen closed tabs" hint="Ctrl+Shift+T restores the last closed tab, including its history.">
        <span className="jz-note">On</span>
      </Row>
    </section>
  );
};

const PermissionInfo: React.FC = () => {
  const settings = useSel((s) => s.settings);
  return (
    <section className="jz-section">
      <h3>Permissions</h3>
      <p className="jz-note">
        Websites can never take a camera, microphone or screen without a PREP prompt — and that prompt is never shown to the audience. Juzt
        does not auto-grant anything, does not weaken TLS and does not install a global certificate override.
      </p>
      {settings.camera.enabled ? (
        <p className="jz-note">Your teacher camera is currently enabled and exposed to {settings.camera.exposure === 'live' ? 'the audience' : settings.camera.exposure === 'both' ? 'you and the audience' : 'you only'}.</p>
      ) : (
        <p className="jz-note">The teacher camera is off. Enable it in the Camera tab when you want to appear.</p>
      )}
    </section>
  );
};

const AboutPanel: React.FC = () => {
  const appName = useSel((s) => s.appName);
  const version = useSel((s) => s.version);
  return (
    <section className="jz-section jz-section--about">
      <Logo size={56} />
      <h3>
        {appName} <span className="jz-note">v{version}</span>
      </h3>
      <p className="jz-note">A calm teaching browser: private prep on one side, a clean audience output on the other.</p>
      <div className="jz-seg">
        <button onClick={() => void window.juzt.openExternal('https://github.com/ankbuitv/Weby')}>Project page</button>
        <button onClick={() => store.set({ onboardOpen: true })}>Show the setup again</button>
      </div>
    </section>
  );
};

/* ------------------------------------------------------------------ *
 * Backgrounds
 * ------------------------------------------------------------------ */

const TARGETS: { id: 'live' | 'holding' | 'privacy'; label: string }[] = [
  { id: 'live', label: 'Live' },
  { id: 'holding', label: 'Holding' },
  { id: 'privacy', label: 'Privacy' },
];

export const BackgroundsPanel: React.FC = () => {
  const open = useSel((s) => s.settingsOpen && s.settingsTab === 'backgrounds');
  const [target, setTarget] = React.useState<'live' | 'holding' | 'privacy'>('live');
  const settings = useSel((s) => s.settings);
  if (!open) return null;
  const spec = target === 'live' ? settings.liveBackground : target === 'holding' ? settings.holdingBackground : settings.privacyBackground;
  const apply = (patch: Partial<BackgroundSpec>) => void actions.applyBackground(target, { ...spec, ...patch });

  return (
    <section className="jz-section">
      <div className="jz-seg">
        {TARGETS.map((t) => (
          <button key={t.id} className={target === t.id ? 'is-active' : ''} onClick={() => setTarget(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <Row label="Kind">
        <div className="jz-seg jz-seg--wrap">
          {(['none', 'color', 'gradient', 'image', 'video'] as const).map((k) => (
            <button key={k} className={spec.kind === k ? 'is-active' : ''} onClick={() => (k === 'image' || k === 'video' ? void actions.pickBackground(target) : apply({ kind: k }))}>
              {k}
            </button>
          ))}
        </div>
      </Row>

      {spec.kind === 'color' ? (
        <Row label="Colour">
          <input type="color" value={spec.color ?? '#0b0e14'} onChange={(e) => apply({ color: e.target.value })} />
        </Row>
      ) : null}
      {spec.kind === 'gradient' ? (
        <Row label="Gradient" hint="Any CSS gradient string.">
          <input
            className="jz-input"
            defaultValue={spec.gradient ?? 'linear-gradient(160deg,#0b1020,#1b2a4a)'}
            onBlur={(e) => apply({ gradient: e.target.value })}
          />
        </Row>
      ) : null}

      {spec.kind === 'video' ? (
        <>
          <Row label="Fit">
            <div className="jz-seg">
              {(['cover', 'contain', 'stretch'] as const).map((f) => (
                <button key={f} className={spec.fit === f ? 'is-active' : ''} onClick={() => apply({ fit: f })}>
                  {f}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Loop">
            <Toggle on={spec.loop !== false} onChange={(v) => apply({ loop: v })} />
          </Row>
          <Row label="Muted">
            <Toggle on={!!spec.muted} onChange={(v) => apply({ muted: v })} />
          </Row>
          <Row label="Volume">
            <input type="range" min={0} max={1} step={0.05} value={spec.volume ?? 0} onChange={(e) => apply({ volume: Number(e.target.value) })} />
          </Row>
          <Row label="Speed">
            <input type="range" min={0.25} max={2} step={0.05} value={spec.rate ?? 1} onChange={(e) => apply({ rate: Number(e.target.value) })} />
          </Row>
          <p className="jz-note">Video backgrounds play without controls and never take the mouse — click-through stays with the card.</p>
        </>
      ) : null}

      {spec.kind !== 'none' ? (
        <Row label="Dim" hint="Darkens the background so text stays readable.">
          <input type="range" min={0} max={0.85} step={0.05} value={spec.dim ?? 0} onChange={(e) => apply({ dim: Number(e.target.value) })} />
        </Row>
      ) : null}

      {target === 'holding' ? (
        <Row label="Holding text">
          <input className="jz-input" defaultValue={settings.holdingText} onBlur={(e) => void actions.setHoldingText(e.target.value)} />
        </Row>
      ) : null}

      {target === 'privacy' ? (
        <>
          <Row label="Title">
            <input className="jz-input" defaultValue={settings.privacyTitle} onBlur={(e) => void actions.setSettings({ privacyTitle: e.target.value })} />
          </Row>
          <Row label="Subtitle">
            <input className="jz-input" defaultValue={settings.privacySubtitle} onBlur={(e) => void actions.setSettings({ privacySubtitle: e.target.value })} />
          </Row>
          <Row label="Mute the site while private">
            <Toggle on={settings.privacyMuteAudio} onChange={(v) => void actions.setSettings({ privacyMuteAudio: v })} />
          </Row>
        </>
      ) : null}

      <h4>Library</h4>
      <div className="jz-library">
        {settings.backgroundLibrary.map((preset) => (
          <div key={preset.id} className="jz-library__item">
            <button className="jz-library__thumb" title={preset.name} onClick={() => void actions.applyBackground(target, preset.spec)}>
              {preset.thumb ? <img src={preset.thumb} alt="" /> : <span>{preset.spec.kind === 'color' ? <i style={{ background: preset.spec.color }} /> : null}</span>}
            </button>
            <div className="jz-library__row">
              <span>{preset.name}</span>
              <button title="Remove" onClick={() => void actions.removePreset(preset.id)}>
                <Icon.trash size={14} />
              </button>
            </div>
          </div>
        ))}
        <button className="jz-library__add" onClick={() => void actions.addPreset(`Preset ${settings.backgroundLibrary.length + 1}`, spec)}>
          <Icon.plus size={18} />
          <span>Add current</span>
        </button>
      </div>
    </section>
  );
};

/* ------------------------------------------------------------------ *
 * Scenes
 * ------------------------------------------------------------------ */

export const ScenesPanel: React.FC = () => {
  const open = useSel((s) => s.scenesOpen);
  const scenes = useSel((s) => s.scenes);
  const active = useSel((s) => s.activeSceneId);
  const [name, setName] = React.useState('');
  if (!open) return null;
  return (
    <div className="jz-modal jz-modal--right" onMouseDown={(e) => e.target === e.currentTarget && store.set({ scenesOpen: false })}>
      <div className="jz-sheet jz-sheet--side">
        <header>
          <h2>Scenes</h2>
          <button onClick={() => store.set({ scenesOpen: false })}>Close</button>
        </header>
        <div className="jz-sheet__list">
          {scenes.length === 0 ? <p className="jz-note">Scenes save the whole look — background, layout, size and card. Make one for each class.</p> : null}
          {scenes.map((scene, i) => (
            <div key={scene.id} className={`jz-scene ${active === scene.id ? 'is-active' : ''}`}>
              <button className="jz-scene__main" onClick={() => void actions.applyScene(scene.id)}>
                <span className="jz-scene__key">Alt+{i + 1 <= 9 ? i + 1 : ''}</span>
                <span className="jz-scene__name">{scene.name}</span>
              </button>
              <button title="Delete" onClick={() => void actions.deleteScene(scene.id)}>
                <Icon.trash size={15} />
              </button>
            </div>
          ))}
        </div>
        <footer>
          <input className="jz-input" placeholder="Scene name" value={name} onChange={(e) => setName(e.target.value)} />
          <button
            className="jz-chip jz-chip--primary"
            onClick={() => {
              void actions.saveScene(name);
              setName('');
            }}
          >
            Save current
          </button>
        </footer>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * Notes + timer
 * ------------------------------------------------------------------ */

export const NotesPanel: React.FC = () => {
  const open = useSel((s) => s.notesOpen);
  const notes = useSel((s) => s.notes);
  const timer = useSel((s) => s.timer);
  const [, tick] = React.useState(0);

  React.useEffect(() => {
    if (!open || !timer.running) return;
    const id = window.setInterval(() => tick((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, [open, timer.running]);

  if (!open) return null;
  const elapsed = timer.base + (timer.running ? performance.now() - timer.since : 0);

  return (
    <div className="jz-modal jz-modal--right" onMouseDown={(e) => e.target === e.currentTarget && store.set({ notesOpen: false })}>
      <div className="jz-sheet jz-sheet--side">
        <header>
          <h2>Notes &amp; timer</h2>
          <button onClick={() => store.set({ notesOpen: false })}>Close</button>
        </header>
        <div className="jz-timer">
          <strong>{formatClock(timer.mode === 'countdown' ? Math.max(0, timer.targetMs - elapsed) : elapsed)}</strong>
          <div className="jz-seg">
            {(['off', 'stopwatch', 'countdown'] as const).map((m) => (
              <button key={m} className={timer.mode === m ? 'is-active' : ''} onClick={() => actions.setTimerMode(m)}>
                {m}
              </button>
            ))}
          </div>
          {timer.mode === 'countdown' ? (
            <input
              type="range"
              min={1}
              max={45}
              value={Math.round(timer.targetMs / 60000)}
              onChange={(e) => store.set((s) => ({ timer: { ...s.timer, targetMs: Number(e.target.value) * 60000 } }))}
            />
          ) : null}
          <div className="jz-seg">
            <button onClick={() => actions.toggleTimer()}>{timer.running ? 'Pause' : 'Start'}</button>
            <button onClick={() => actions.resetTimer()}>Reset</button>
          </div>
        </div>
        <textarea
          className="jz-notes"
          value={notes}
          placeholder="Private notes for this lesson — the audience never sees them."
          onChange={(e) => actions.setNotes(e.target.value)}
        />
      </div>
    </div>
  );
};

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ *
 * Camera
 * ------------------------------------------------------------------ */

export const CameraPanel: React.FC = () => {
  const open = useSel((s) => s.cameraOpen);
  const camera = useSel((s) => s.settings.camera);
  const cameraDrag = useSel((s) => s.cameraDrag);
  const [devices, setDevices] = React.useState<{ id: string; label: string }[]>([]);

  React.useEffect(() => {
    if (!open) return;
    void listCameras().then(setDevices);
  }, [open]);

  if (!open) return null;
  const patch = (p: Partial<typeof camera>) => void actions.setCamera(p);

  return (
    <div className="jz-modal jz-modal--right" onMouseDown={(e) => e.target === e.currentTarget && store.set({ cameraOpen: false })}>
      <div className="jz-sheet jz-sheet--side">
        <header>
          <h2>Teacher camera</h2>
          <button onClick={() => store.set({ cameraOpen: false })}>Close</button>
        </header>
        <section className="jz-section">
          <Row label="Show my camera">
            <Toggle on={camera.enabled} onChange={(v) => patch({ enabled: v })} />
          </Row>
          <Row label="Device">
            <select value={camera.deviceId ?? ''} onChange={(e) => patch({ deviceId: e.target.value || undefined })}>
              <option value="">Default camera</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label || d.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Visible on" hint="The audience only sees it when you choose Live or Both.">
            <div className="jz-seg">
              {(['prep', 'live', 'both'] as const).map((x) => (
                <button key={x} className={camera.exposure === x ? 'is-active' : ''} onClick={() => patch({ exposure: x })}>
                  {x}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Shape">
            <div className="jz-seg">
              {(['rounded', 'circle'] as const).map((x) => (
                <button key={x} className={camera.shape === x ? 'is-active' : ''} onClick={() => patch({ shape: x })}>
                  {x}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Mirror">
            <Toggle on={camera.mirror} onChange={(v) => patch({ mirror: v })} />
          </Row>
          <Row label="Corner radius">
            <input type="range" min={0} max={64} value={camera.radius} onChange={(e) => patch({ radius: Number(e.target.value) })} />
          </Row>
          <Row
            label="Position"
            hint="Juzt has no per-view click-through, so moving the camera on the card is an explicit mode: turn it on, drag, then hand the mouse back to the page."
          >
            <button className={`jz-chip ${cameraDrag ? 'jz-chip--primary' : ''}`} disabled={!camera.enabled} onClick={() => actions.setCameraDrag(!cameraDrag)}>
              {cameraDrag ? 'Done' : 'Reposition'}
            </button>
            <button className="jz-chip" onClick={() => patch({ rect: { x: 0.72, y: 0.68, w: 0.24, h: 0.24 } })}>
              Reset
            </button>
          </Row>
        </section>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * Permission prompts + screen picker
 * ------------------------------------------------------------------ */

export const PermissionDialogs: React.FC = () => {
  const request = useSel((s) => s.permission);
  const sources = useSel((s) => s.screenSources);
  const [remember, setRemember] = React.useState(false);

  if (sources && sources.length) {
    return (
      <div className="jz-modal">
        <div className="jz-sheet jz-sheet--dialog">
          <h2>Share a screen</h2>
          <div className="jz-sources">
            {sources.map((src) => (
              <button key={src.id} className="jz-source" onClick={() => void actions.pickScreenSource(src.id)}>
                {src.thumbnail ? <img src={src.thumbnail} alt="" /> : <span className="jz-source__ph" />}
                <span>{src.name}</span>
              </button>
            ))}
          </div>
          <footer>
            <button className="jz-chip danger" onClick={() => void actions.pickScreenSource(null)}>
              Cancel
            </button>
          </footer>
        </div>
      </div>
    );
  }

  if (!request) return null;
  const wants = request.kinds.join(', ').replace(/(Camera|Microphone)/g, (m) => m.toLowerCase());

  return (
    <div className="jz-modal">
      <div className="jz-sheet jz-sheet--dialog">
        <h2>{hostOf(request.origin)} wants {wants}</h2>
        <p className="jz-note">This prompt is private to Juzt Prep — the audience never sees it.</p>
        {request.rememberable ? (
          <label className="jz-check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Remember for {request.host}
          </label>
        ) : null}
        <footer>
          <button className="jz-chip" onClick={() => void actions.respondPermission(request.id, false, false)}>
            Block
          </button>
          <button className="jz-chip jz-chip--primary" onClick={() => void actions.respondPermission(request.id, true, remember)}>
            Allow
          </button>
        </footer>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * Tab context menu
 * ------------------------------------------------------------------ */

export const ContextMenu: React.FC = () => {
  const menu = useSel((s) => s.contextMenu);
  const tabs = useSel((s) => s.tabs, (a, b) => JSON.stringify(a) === JSON.stringify(b));
  const live = useSel((s) => s.live?.presentation.label ?? null);

  React.useEffect(() => {
    if (!menu) return;
    const close = () => store.set({ contextMenu: undefined });
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  if (!menu || menu.kind !== 'tab' || !menu.tabId) return null;
  const tab = tabs.find((t) => t.id === menu.tabId);
  if (!tab) return null;
  const run = (fn: () => void) => () => {
    store.set({ contextMenu: undefined });
    fn();
  };

  return (
    <div className="jz-menu jz-menu--context" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
      <button
        onClick={run(() => (tab.kind === 'whiteboard' ? void actions.presentBoard(tab.boardId) : void actions.presentTab(tab.id)))}
        disabled={live === tabLabel(tab)}
      >
        <Icon.broadcast size={15} /> Present
      </button>
      <button onClick={run(() => void actions.duplicateTab(menu.tabId!))}>
        <Icon.copy size={15} /> Duplicate
      </button>
      {tab.kind === 'web' ? (
        <button onClick={run(() => void window.juzt.tabs.reload(tab.id))}>
          <Icon.refresh size={15} /> Reload
        </button>
      ) : null}
      <button onClick={run(() => void actions.pinTab(menu.tabId!, !tab.pinned))}>
        <Icon.pin size={15} /> {tab.pinned ? 'Unpin' : 'Pin'}
      </button>
      {tab.kind === 'web' ? (
        <button onClick={run(() => void window.juzt.tabs.mute(tab.id, !tab.muted))}>
          <Icon.sound size={15} /> {tab.muted ? 'Unmute' : 'Mute'}
        </button>
      ) : null}
      <hr />
      <button onClick={run(() => void actions.closeTab(menu.tabId!))}>
        <Icon.trash size={15} /> Close
      </button>
      <button onClick={run(() => void actions.closeOthers(menu.tabId!))}>Close others</button>
      <button onClick={run(() => void actions.closeToRight(menu.tabId!))}>Close to the right</button>
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * Diagnostics (development only)
 * ------------------------------------------------------------------ */

export const DiagPanel: React.FC = () => {
  const open = useSel((s) => s.diagOpen);
  const stats = useSel((s) => s.diagStats, (a, b) => JSON.stringify(a) === JSON.stringify(b));
  if (!open) return null;
  return (
    <div className="jz-diag">
      <header>
        <span>Diagnostics</span>
        <button onClick={() => actions.toggleDiagnostics()}>Close</button>
      </header>
      <table>
        <tbody>
          {Object.entries(stats).map(([key, value]) => (
            <tr key={key}>
              <td>{key}</td>
              <td>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * Toasts
 * ------------------------------------------------------------------ */

export const Toasts: React.FC = () => {
  const toasts = useSel((s) => s.toasts, (a, b) => JSON.stringify(a) === JSON.stringify(b));
  return (
    <div className="jz-toasts">
      {toasts.map((t) => (
        <ToastRow key={t.id} id={t.id} message={t.message} tone={t.tone} />
      ))}
    </div>
  );
};

const ToastRow: React.FC<{ id: string; message: string; tone: 'info' | 'error' }> = ({ id, message, tone }) => {
  React.useEffect(() => {
    const timer = window.setTimeout(() => actions.dismissToast(id), 3600);
    return () => window.clearTimeout(timer);
  }, [id]);
  return (
    <button className={`jz-toast ${tone === 'error' ? 'is-error' : ''}`} onClick={() => actions.dismissToast(id)}>
      {message}
    </button>
  );
};

/* ------------------------------------------------------------------ *
 * First-run setup
 * ------------------------------------------------------------------ */

export const Onboarding: React.FC = () => {
  const open = useSel((s) => s.onboardOpen);
  const settings = useSel((s) => s.settings);
  const displays = useSel((s) => s.displays);
  const [step, setStep] = React.useState(0);
  if (!open) return null;

  const finish = () => actions.finishOnboarding();

  return (
    <div className="jz-modal jz-modal--onboard">
      <div className="jz-sheet jz-sheet--onboard">
        <Logo size={44} />
        {step === 0 ? (
          <>
            <h1>Welcome to Juzt</h1>
            <p className="jz-note">
              Juzt keeps your work private while the audience only ever sees the finished card. Nothing here is uploaded, and there is no
              telemetry of any kind.
            </p>
            <div className="jz-seg">
              <button className="jz-chip jz-chip--primary" onClick={() => setStep(1)}>
                Start
              </button>
              <button className="jz-chip" onClick={() => setStep(1)}>
                Presentation setup
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>Presentation setup</h2>
            <Row label="Mode">
              <div className="jz-seg">
                <button className={settings.presentationMode === 'dual' ? 'is-active' : ''} onClick={() => void actions.setSettings({ presentationMode: 'dual' })}>
                  Dual window
                </button>
                <button className={settings.presentationMode === 'single' ? 'is-active' : ''} onClick={() => void actions.setSettings({ presentationMode: 'single' })}>
                  Single window
                </button>
              </div>
            </Row>
            <Row label="Output monitor">
              <select value={settings.outputDisplayId ?? ''} onChange={(e) => void actions.setOutputDisplay(e.target.value === '' ? null : Number(e.target.value))}>
                <option value="">Automatic</option>
                {displays.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Card size">
              <div className="jz-seg jz-seg--wrap">
                {SIZE_PRESETS.map((p) => (
                  <button key={p.id} className={settings.sizePreset === p.id ? 'is-active' : ''} onClick={() => void actions.setSettings({ sizePreset: p.id })}>
                    {p.label}
                  </button>
                ))}
              </div>
            </Row>
            <p className="jz-note">You can change all of this later in Settings. Press Ctrl+Enter when you are ready to show the audience something.</p>
            <div className="jz-seg">
              <button className="jz-chip jz-chip--primary" onClick={finish}>
                Start teaching
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * Internal pages
 * ------------------------------------------------------------------ */

export const InternalPage: React.FC<{ url: string }> = ({ url }) => {
  const page = url.replace('juzt://', '');
  if (page === 'favorites') return <FavoritesPage />;
  if (page === 'history') return <HistoryPage />;
  if (page === 'boards') return <BoardsPage />;
  if (page === 'about') return <AboutPage />;
  return <NewTabPage />;
};

const NewTabPage: React.FC = () => {
  const favorites = useSel((s) => s.favorites);
  const history = useSel((s) => s.history);
  const boards = useSel((s) => s.boards);
  const scenes = useSel((s) => s.scenes);
  const appName = useSel((s) => s.appName);
  const [value, setValue] = React.useState('');
  const pinned = favorites.slice(0, 8);
  const recent = history.slice(0, 6);

  return (
    <div className="jz-internal">
      <div className="jz-internal__hero">
        <Logo size={54} />
        <h1>{appName}</h1>
        <form
          className="jz-internal__search"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) void actions.navigateActive(value.trim());
          }}
        >
          <Icon.search size={18} />
          <input value={value} placeholder="Search or enter address" onChange={(e) => setValue(e.target.value)} autoFocus />
        </form>
      </div>

      {pinned.length ? (
        <section className="jz-internal__section">
          <h3>Pinned</h3>
          <div className="jz-site-grid">
            {pinned.map((f) => (
              <button key={f.id} className="jz-site-card" onClick={() => void actions.navigateActive(f.url)} title={f.url}>
                {f.favicon ? <img src={f.favicon} alt="" /> : <Icon.globe size={18} />}
                <span>{f.title || hostOf(f.url)}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {recent.length ? (
        <section className="jz-internal__section">
          <h3>Recent</h3>
          <div className="jz-site-grid">
            {recent.map((h) => (
              <button key={h.id} className="jz-site-card" onClick={() => void actions.navigateActive(h.url)} title={h.url}>
                <Icon.clock size={18} />
                <span>{h.title || hostOf(h.url)}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div className="jz-internal__cols">
        {boards.length ? (
          <section className="jz-internal__section">
            <h3>Whiteboards</h3>
            {boards.slice(0, 6).map((b) => (
              <button key={b.id} className="jz-internal__line" onClick={() => void actions.openBoard(b.id)}>
                <Icon.board size={16} />
                <span>{b.name}</span>
                <em>{new Date(b.updatedAt).toLocaleDateString()}</em>
              </button>
            ))}
          </section>
        ) : null}
        {scenes.length ? (
          <section className="jz-internal__section">
            <h3>Scenes</h3>
            {scenes.slice(0, 6).map((s2) => (
              <button key={s2.id} className="jz-internal__line" onClick={() => void actions.applyScene(s2.id)}>
                <Icon.layers size={16} />
                <span>{s2.name}</span>
              </button>
            ))}
          </section>
        ) : null}
      </div>
    </div>
  );
};

const FavoritesPage: React.FC = () => {
  const favorites = useSel((s) => s.favorites);
  return (
    <div className="jz-internal">
      <h1>Favorites</h1>
      <p className="jz-note">Ctrl+D saves the page you are on. Favorites stay on this machine and never appear in the audience output.</p>
      <div className="jz-site-grid">
        {favorites.map((f) => (
          <div key={f.id} className="jz-site-card">
            <button className="jz-site-card__open" onClick={() => void actions.navigateActive(f.url)}>
              {f.favicon ? <img src={f.favicon} alt="" /> : <Icon.globe size={18} />}
              <span>{f.title || hostOf(f.url)}</span>
            </button>
            <button className="jz-site-card__x" title="Remove" onClick={() => void actions.removeFavorite(f.id)}>
              <Icon.trash size={14} />
            </button>
          </div>
        ))}
      </div>
      {!favorites.length ? <p className="jz-note">No favorites yet.</p> : null}
    </div>
  );
};

const HistoryPage: React.FC = () => {
  const history = useSel((s) => s.history);
  return (
    <div className="jz-internal">
      <div className="jz-internal__head">
        <h1>History</h1>
        <button className="jz-chip" onClick={() => void actions.clearHistory()}>
          Clear all
        </button>
      </div>
      <div className="jz-history">
        {history.map((h) => (
          <div key={h.id} className="jz-history__row">
            <button className="jz-history__open" onClick={() => void actions.navigateActive(h.url)}>
              <span>{h.title || hostOf(h.url)}</span>
              <em>{hostOf(h.url)}</em>
            </button>
            <time>{new Date(h.visitedAt).toLocaleString()}</time>
            <button title="Remove" onClick={() => void actions.removeHistory(h.id)}>
              <Icon.trash size={14} />
            </button>
          </div>
        ))}
      </div>
      {!history.length ? <p className="jz-note">Nothing here yet.</p> : null}
    </div>
  );
};

const BoardsPage: React.FC = () => {
  const boards = useSel((s) => s.boards);
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const [name, setName] = React.useState('');
  return (
    <div className="jz-internal">
      <div className="jz-internal__head">
        <h1>Whiteboards</h1>
        <button className="jz-chip jz-chip--primary" onClick={() => void actions.newWhiteboardTab()}>
          New board
        </button>
      </div>
      <div className="jz-history">
        {boards.map((b) => (
          <div key={b.id} className="jz-history__row">
            {renaming === b.id ? (
              <>
                <input className="jz-input" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
                <button
                  className="jz-chip"
                  onClick={() => {
                    void actions.wbRename(b.id, name.trim() || b.name);
                    setRenaming(null);
                  }}
                >
                  Save
                </button>
              </>
            ) : (
              <>
                <button className="jz-history__open" onClick={() => void actions.openBoard(b.id)}>
                  <span>{b.name}</span>
                  <em>
                    {b.objectCount} objects · {new Date(b.updatedAt).toLocaleString()}
                  </em>
                </button>
                <button
                  title="Rename"
                  onClick={() => {
                    setRenaming(b.id);
                    setName(b.name);
                  }}
                >
                  <Icon.pen size={14} />
                </button>
                <button title="Delete" onClick={() => void actions.deleteBoard(b.id)}>
                  <Icon.trash size={14} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      {!boards.length ? <p className="jz-note">No boards yet — press Ctrl+Shift+N.</p> : null}
    </div>
  );
};

const AboutPage: React.FC = () => {
  const appName = useSel((s) => s.appName);
  const version = useSel((s) => s.version);
  return (
    <div className="jz-internal jz-internal--about">
      <Logo size={64} />
      <h1>{appName}</h1>
      <p className="jz-note">Version {version} · local-only teaching browser</p>
      <p className="jz-note">
        The audience output shows one thing at a time: a page you chose, a whiteboard, a holding screen or your privacy screen. Nothing else
        from this window is ever mirrored.
      </p>
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * Small helpers kept for the settings panel above
 * ------------------------------------------------------------------ */

export const DEFAULT_CARD_RADIUS = DEFAULT_SETTINGS.card.radius;
export type { SpotlightState, TabState };
