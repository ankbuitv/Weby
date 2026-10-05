import React, { useState, useEffect } from 'react';
import type { Settings } from '../../shared/types';

interface Props {
  open: boolean;
  settings: Settings;
  onClose: () => void;
  onSave: (patch: Partial<Settings>) => void;
  onPickBackground: () => void;
  onClearBackground: () => void;
}

export const SettingsPanel: React.FC<Props> = ({
  open,
  settings,
  onClose,
  onSave,
  onPickBackground,
  onClearBackground,
}) => {
  const [draft, setDraft] = useState<Settings>(settings);
  useEffect(() => {
    setDraft(settings);
  }, [settings, open]);

  if (!open) return null;

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
  };

  return (
    <div
      data-settings="true"
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onSave(draft);
          onClose();
        }
      }}
    >
      <div
        data-settings="true"
        style={{
          width: 560,
          maxWidth: '92vw',
          maxHeight: '80vh',
          overflow: 'auto',
          background: '#1a1d27',
          color: '#eaeaea',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 14,
          padding: 20,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <h2 style={{ marginTop: 0 }}>Settings</h2>

        <Row label="Default pen color">
          <input type="color" value={draft.defaultPenColor} onChange={(e) => set('defaultPenColor', e.target.value)} />
        </Row>
        <Row label="Default pen size">
          <input
            type="range" min={1} max={40} value={draft.defaultPenSize}
            onChange={(e) => set('defaultPenSize', Number(e.target.value))}
          />
          <span style={{ marginLeft: 8 }}>{draft.defaultPenSize}px</span>
        </Row>
        <Row label="Highlighter color">
          <input type="color" value={draft.defaultHighlighterColor} onChange={(e) => set('defaultHighlighterColor', e.target.value)} />
        </Row>
        <Row label="Highlighter opacity">
          <input
            type="range" min={0.05} max={1} step={0.05} value={draft.defaultHighlighterOpacity}
            onChange={(e) => set('defaultHighlighterOpacity', Number(e.target.value))}
          />
          <span style={{ marginLeft: 8 }}>{Math.round(draft.defaultHighlighterOpacity * 100)}%</span>
        </Row>

        <Row label="Background color">
          <input type="color" value={draft.backgroundColor} onChange={(e) => set('backgroundColor', e.target.value)} />
        </Row>
        <Row label="Background image">
          <button onClick={onPickBackground}>Choose…</button>
          <button onClick={onClearBackground} style={{ marginLeft: 8 }}>Clear</button>
          {draft.backgroundImage && (
            <span style={{ marginLeft: 8, fontSize: 11, color: 'rgba(255,255,255,0.5)', wordBreak: 'break-all', maxWidth: 240, overflow: 'hidden' }}>
              {draft.backgroundImage}
            </span>
          )}
        </Row>
        <Row label="Background mode">
          <select value={draft.backgroundMode} onChange={(e) => set('backgroundMode', e.target.value as Settings['backgroundMode'])}>
            <option value="cover">Cover</option>
            <option value="contain">Contain</option>
            <option value="center">Center</option>
          </select>
        </Row>
        <Row label="Background dim">
          <input
            type="range" min={0} max={1} step={0.05} value={draft.backgroundDim}
            onChange={(e) => set('backgroundDim', Number(e.target.value))}
          />
          <span style={{ marginLeft: 8 }}>{Math.round(draft.backgroundDim * 100)}%</span>
        </Row>

        <Row label="Viewport ratio">
          <select value={draft.viewportRatio} onChange={(e) => set('viewportRatio', e.target.value as Settings['viewportRatio'])}>
            <option value="full">Full</option>
            <option value="16:9">16:9</option>
            <option value="4:3">4:3</option>
            <option value="portrait">Portrait</option>
          </select>
        </Row>

        <Row label="Default zoom">
          <input
            type="range" min={0.5} max={2} step={0.05} value={draft.zoom}
            onChange={(e) => set('zoom', Number(e.target.value))}
          />
          <span style={{ marginLeft: 8 }}>{Math.round(draft.zoom * 100)}%</span>
        </Row>

        <Row label="Privacy mode mutes audio">
          <input type="checkbox" checked={draft.privacyMuteAudio} onChange={(e) => set('privacyMuteAudio', e.target.checked)} />
        </Row>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={() => { onSave(draft); onClose(); }}
            style={{
              background: '#3b82f6', color: '#fff', border: 'none', padding: '8px 18px',
              borderRadius: 8, cursor: 'pointer', fontSize: 14,
            }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', fontSize: 13 }}>
    <div style={{ width: 180 }}>{label}</div>
    <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>{children}</div>
  </div>
);
