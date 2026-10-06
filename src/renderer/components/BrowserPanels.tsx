import React from 'react';
import { store, useSel } from '../state/store';
import { actions } from '../state/actions';
import { hostOf } from '../../shared/url';
import { ENGINE_FEATURES } from '../../shared/engine';
import type { UserAgentMode } from '../../shared/engine';

/* ------------------------------------------------------------------ *
 * Browser: engine, website identity, feature reality
 *
 * This whole panel is PREP-only. It is rendered inside the settings sheet,
 * which only exists in the private workspace, and none of it is ever put into
 * `LiveState` — so nothing here can reach the audience output.
 * ------------------------------------------------------------------ */

interface CompatInfo {
  app: string;
  electron: string;
  chromium: string;
  v8: string;
  node: string;
  userAgent: string;
  loadedExtensions: number;
  approvedExtensions: number;
  safeMode: boolean;
  unsupported: { id: string; label: string; proprietary?: boolean; note?: string }[];
}

const MODE_LABEL: Record<UserAgentMode, { title: string; hint: string }> = {
  clean: {
    title: 'Chrome-compatible (recommended)',
    hint: 'Reports the real Chromium build Juzt ships, with no application token. Sites see a current, honest browser.',
  },
  app: { title: 'Juzt default', hint: 'The same identity plus “Juzt/<version>”, so a site can tell it is running inside Juzt.' },
  electron: { title: 'Electron', hint: 'The stock Electron identity. Only useful for a site whose detection is satisfied by the Electron token.' },
};

export const BrowserPanel: React.FC = () => {
  const info = useSel((s) => s.compatInfo);
  const settings = useSel((s) => s.settings);
  const activeTab = useSel((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
  const [busy, setBusy] = React.useState(false);

  const origin = React.useMemo(() => {
    if (!activeTab || activeTab.kind !== 'web' || !activeTab.url) return null;
    try {
      const u = new URL(activeTab.url);
      return `${u.protocol}//${u.host}`;
    } catch {
      return null;
    }
  }, [activeTab]);

  const currentMode: UserAgentMode = (origin ? settings.siteCompat[origin] : undefined) ?? settings.webUserAgent;
  const override = origin ? settings.siteCompat[origin] : undefined;

  const setMode = (mode: UserAgentMode, siteOnly: boolean) => {
    if (siteOnly && origin) void actions.setSiteCompat(origin, mode);
    else void actions.setWebUserAgent(mode);
  };

  const clearSiteData = async () => {
    if (!origin) return;
    setBusy(true);
    const result = await actions.clearSiteData(origin);
    setBusy(false);
    actions.toast(result.ok ? `Cleared stored data for ${hostOf(origin)}` : `Could not clear data: ${result.error ?? 'unknown'}`, result.ok ? 'info' : 'error');
  };

  return (
    <section className="jz-section">
      <h3>Browser</h3>
      <p className="jz-note">
        Private diagnostics for this computer. Juzt is honest about its engine: it ships a current Chromium and reports exactly that
        version to websites — it never claims to be a newer Chrome than the one it bundles.
      </p>

      <div className="jz-kv">
        <span>Juzt</span>
        <b>{info ? `v${info.app === 'Juzt' ? '' : ''}${''}` : '—'}</b>
      </div>
      <div className="jz-kv">
        <span>Electron</span>
        <b>{info?.electron ?? '—'}</b>
      </div>
      <div className="jz-kv">
        <span>Chromium</span>
        <b>{info?.chromium ?? '—'}</b>
      </div>
      <div className="jz-kv">
        <span>V8</span>
        <b>{info?.v8 ?? '—'}</b>
      </div>
      <div className="jz-kv">
        <span>Node.js</span>
        <b>{info?.node ?? '—'}</b>
      </div>
      <div className="jz-kv">
        <span>Website User-Agent</span>
        <b className="jz-kv__mono">{info?.userAgent || '—'}</b>
      </div>

      <h4>Website identity</h4>
      <p className="jz-note">
        {origin ? (
          <>
            Currently open: <b>{hostOf(origin)}</b>. The override below applies to this site only; everything else uses the global
            setting.
          </>
        ) : (
          <>Open a website tab to give one site its own identity.</>
        )}
      </p>
      <div className="jz-seg jz-seg--wrap">
        {(Object.keys(MODE_LABEL) as UserAgentMode[]).map((mode) => (
          <button key={mode} className={currentMode === mode ? 'is-active' : ''} onClick={() => setMode(mode, !!origin && !!override)} title={MODE_LABEL[mode].hint}>
            {MODE_LABEL[mode].title}
          </button>
        ))}
      </div>
      <p className="jz-note">{MODE_LABEL[currentMode].hint}</p>
      {override && origin ? (
        <div className="jz-seg">
          <button onClick={() => void actions.resetSiteCompat(origin)}>Reset compatibility settings for {hostOf(origin)}</button>
        </div>
      ) : null}
      {info?.safeMode ? <p className="jz-note">Safe Mode is on: identity is the default and site overrides are ignored.</p> : null}

      <h4>Client hints</h4>
      <p className="jz-note">
        Juzt rewrites the <code>Sec-CH-UA</code> family of headers in its own network stack to match the User-Agent above, so the two
        can never disagree. It reports a <code>Chromium</code> brand — because Juzt really is Chromium — with the accurate version.
        Electron has no supported way to emit a <code>&quot;Google Chrome&quot;</code> brand hint, and Juzt will not fake one: a site
        that gates on the brand rather than the version is mis-detecting, and spoofing it would be a lie that breaks the moment the
        engine advances.
      </p>

      <h4>What this engine provides</h4>
      <ul className="jz-flist">
        {ENGINE_FEATURES.map((f) => {
          const missing = info?.unsupported?.some((u) => u.id === f.id) ?? false;
          return (
            <li key={f.id} className={missing ? 'is-off' : ''}>
              <span className="jz-flist__dot" aria-hidden />
              <span>
                {f.label}
                {f.note ? <em> — {f.note}</em> : null}
              </span>
            </li>
          );
        })}
      </ul>
      {info && info.unsupported.length > 0 ? (
        <p className="jz-note">
          Not available in this build: {info.unsupported.map((u) => u.label).join(', ')}. Juzt reports this instead of pretending
          they work.
        </p>
      ) : null}

      <h4>Site compatibility troubleshooting</h4>
      <p className="jz-note">
        These actions are private and never shown to the audience. Juzt does not claim a site is broken — it just gives you the
        levers a teacher actually needs.
      </p>
      <div className="jz-seg jz-seg--wrap">
        <button onClick={() => origin && void actions.reload()} disabled={!origin}>
          Reload
        </button>
        <button onClick={() => origin && void actions.reload()} disabled={!origin}>
          Hard reload
        </button>
        <button onClick={() => void clearSiteData()} disabled={!origin || busy}>
          Clear this site&rsquo;s cache &amp; data
        </button>
        <button onClick={() => origin && void actions.setSiteCompat(origin, 'clean')} disabled={!origin}>
          Reset compatibility override
        </button>
        <button onClick={() => actions.openSettings('extensions')}>Disable extensions for this session</button>
        <button onClick={() => actions.openSettings('browser')}>Show browser engine information</button>
      </div>

      <h4>Safe Mode</h4>
      <p className="jz-note">
        Safe Mode opens website tabs with extensions paused, the default identity and normal Juzt security. Your extension list and
        per-site settings are kept, not deleted.
      </p>
      <div className="jz-seg">
        <button className={info?.safeMode ? 'is-active' : ''} onClick={() => void actions.setSafeMode(!info?.safeMode)}>
          {info?.safeMode ? 'Safe Mode is on — turn off' : 'Turn on Safe Mode'}
        </button>
      </div>
    </section>
  );
};

/* ------------------------------------------------------------------ *
 * Extensions
 * ------------------------------------------------------------------ */

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  loaded: { text: 'Loaded', cls: 'is-ok' },
  disabled: { text: 'Disabled', cls: 'is-off' },
  failed: { text: 'Failed', cls: 'is-bad' },
  unknown: { text: 'Not loaded', cls: 'is-off' },
};

export const ExtensionsPanel: React.FC = () => {
  const list = useSel((s) => s.extensions);
  const settings = useSel((s) => s.settings);
  const info = useSel((s) => s.compatInfo);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [pathDraft, setPathDraft] = React.useState('');

  const withBusy = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id);
    try {
      await fn();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="jz-section">
      <h3>Extensions</h3>
      <p className="jz-note">
        Juzt loads extensions through Chromium&rsquo;s own <code>session.loadExtension</code>. Officially supported path is{' '}
        <b>Load Unpacked</b> — point Juzt at a folder you already have on disk. There is no built-in store, and Juzt will not download
        extensions from one, so nothing is installed that you did not deliberately choose.
      </p>
      <p className="jz-note">
        <b>Not every Chrome extension works.</b> An extension runs only if the Chromium APIs it calls exist in this build. Juzt tells
        you plainly which ones failed and why, rather than pretending everything loaded.
      </p>

      <div className="jz-seg jz-seg--wrap">
        <button onClick={() => void actions.pickExtension()}>Load Unpacked…</button>
        <button onClick={() => void actions.disableAllExtensions()}>Disable all extensions temporarily</button>
      </div>

      <form
        className="jz-inline"
        onSubmit={(e) => {
          e.preventDefault();
          const value = pathDraft.trim();
          if (value.length === 0) return;
          setPathDraft('');
          void actions.addExtension(value);
        }}
      >
        <input
          type="text"
          value={pathDraft}
          placeholder="…/my-extension (folder containing manifest.json)"
          onChange={(e) => setPathDraft(e.target.value)}
        />
        <button type="submit">Load</button>
      </form>

      <Row label="Developer Mode" hint="Show the extension ID, manifest version and the real load error.">
        <button className={settings.extensionDevMode ? 'is-active' : ''} onClick={() => void actions.setExtensionDevMode(!settings.extensionDevMode)}>
          {settings.extensionDevMode ? 'On' : 'Off'}
        </button>
      </Row>

      <Row label="Safe Mode" hint="Website tabs run without extensions. Your list is kept.">
        <button className={settings.safeMode ? 'is-active' : ''} onClick={() => void actions.setSafeMode(!settings.safeMode)}>
          {settings.safeMode ? 'On' : 'Off'}
        </button>
      </Row>

      <p className="jz-note">
        {list.length === 0
          ? 'No extensions yet. Use “Load Unpacked…” to add one.'
          : `${list.filter((e) => e.status === 'loaded').length} of ${list.length} loaded · ${info?.loadedExtensions ?? 0} active in the website session.`}
      </p>

      <ul className="jz-extlist">
        {list.map((ext) => {
          const status = STATUS_LABEL[ext.status] ?? STATUS_LABEL.unknown;
          return (
            <li key={ext.id} className={ext.enabled ? '' : 'is-off'}>
              <div className="jz-extlist__head">
                <span className="jz-extlist__icon" aria-hidden>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M6 1.5h4l.6 2.1 1.9 1.1 2.1-.6 2 3.4-1.6 1.4v2.2l1.6 1.4-2 3.4-2.1-.6-1.9 1.1L10 14.5H6l-.6-2.1-1.9-1.1-2.1.6-2-3.4L1 6.9V4.7L-.6 3.3l2-3.4 2.1.6L5.4 3.6 6 1.5Z"
                      transform="translate(1)"
                      stroke="currentColor"
                      strokeWidth="1.1"
                    />
                    <circle cx="8" cy="8" r="1.7" stroke="currentColor" strokeWidth="1.1" />
                  </svg>
                </span>
                <span className="jz-extlist__title">
                  <b>{ext.name}</b>
                  <em>
                    v{ext.version} · Manifest V{ext.manifestVersion || '?'}
                  </em>
                </span>
                <span className={`jz-pill ${status.cls}`}>{status.text}</span>
              </div>
              {ext.description ? <p className="jz-note">{ext.description}</p> : null}
              {settings.extensionDevMode ? (
                <p className="jz-note jz-note--mono">
                  {ext.id} · {ext.path}
                  {ext.error ? ` · ${ext.error}` : ''}
                </p>
              ) : null}
              <div className="jz-seg jz-seg--wrap">
                {ext.enabled ? (
                  <button onClick={() => withBusy(ext.id, () => actions.disableExtension(ext.id))} disabled={busyId === ext.id}>
                    Disable
                  </button>
                ) : (
                  <button onClick={() => withBusy(ext.id, () => actions.enableExtension(ext.id))} disabled={busyId === ext.id}>
                    Enable
                  </button>
                )}
                <button onClick={() => withBusy(ext.id, () => actions.reloadExtension(ext.id))} disabled={busyId === ext.id}>
                  Reload
                </button>
                <button onClick={() => void actions.removeExtension(ext.id)}>Remove</button>
              </div>
            </li>
          );
        })}
      </ul>

      <h4>Where extensions run</h4>
      <p className="jz-note">
        Extensions load into the same persistent session as your website tabs, so their storage and content scripts work. Juzt&rsquo;s
        own pages, the preload bridge and the LIVE controls stay in a separate session: an extension cannot reach Juzt&rsquo;s
        privileged APIs or anything you type in the private workspace.
      </p>
    </section>
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

/* ------------------------------------------------------------------ *
 * Small PREP-only extensions menu (puzzle piece). Never in LIVE.
 * ------------------------------------------------------------------ */

export const ExtensionsMenu: React.FC = () => {
  const open = useSel((s) => s.extensionsOpen);
  const list = useSel((s) => s.extensions);
  if (!open) return null;
  const loaded = list.filter((e) => e.status === 'loaded');

  return (
    <div className="jz-menu jz-menu--ext" role="menu" onMouseDown={(e) => e.stopPropagation()}>
      <div className="jz-menu__head">Extensions</div>
      {loaded.length === 0 ? <p className="jz-note">No extensions are running.</p> : null}
      {loaded.map((ext) => (
        <button key={ext.id} className="jz-menu__item" onClick={() => void actions.disableExtension(ext.id)} title="Click to disable">
          <span className="jz-extlist__icon" aria-hidden>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 1.6l4.6 2.6v5.2L8 12 3.4 9.4V4.2L8 1.6Z" stroke="currentColor" strokeWidth="1.2" />
              <circle cx="8" cy="7.6" r="1.4" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </span>
          {ext.name}
        </button>
      ))}
      <div className="jz-menu__sep" />
      <button className="jz-menu__item" onClick={() => actions.openSettings('extensions')}>
        Manage Extensions…
      </button>
    </div>
  );
};

/** Keeps the store selector type honest without importing Settings here. */
void store;
