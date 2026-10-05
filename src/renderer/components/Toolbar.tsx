import React from 'react';
import type { ToolId } from '../../shared/types';

interface ToolDef {
  id: ToolId;
  label: string;
  shortcut?: string;
  icon: React.ReactNode;
}

const TOOLS: ToolDef[] = [
  {
    id: 'cursor',
    label: 'Cursor',
    shortcut: 'V',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 3l14 7-6 2-2 6z" />
      </svg>
    ),
  },
  {
    id: 'pen',
    label: 'Pen',
    shortcut: 'P',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 19l7-7 3 3-7 7-3-3z" />
        <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
        <path d="M2 2l7.586 7.586" />
        <circle cx="11" cy="11" r="2" />
      </svg>
    ),
  },
  {
    id: 'marker',
    label: 'Marker',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 11l-6 6v3h3l6-6" />
        <path d="M14 6l4 4-8 8-4-4z" />
      </svg>
    ),
  },
  {
    id: 'highlighter',
    label: 'Highlighter',
    shortcut: 'H',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 21l4-1 12-12-3-3L4 17l-1 4z" />
        <path d="M14 6l4 4" />
      </svg>
    ),
  },
  {
    id: 'eraser',
    label: 'Eraser',
    shortcut: 'E',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 20H8l-5-5 10-10 7 7-6 6" />
        <path d="M10 14l5-5" />
      </svg>
    ),
  },
  { id: 'line', label: 'Line', icon: <svg viewBox="0 0 24 24" width="22" height="22"><line x1="4" y1="20" x2="20" y2="4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg> },
  {
    id: 'arrow',
    label: 'Arrow',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="5" y1="19" x2="19" y2="5" />
        <polyline points="9 5 19 5 19 15" />
      </svg>
    ),
  },
  {
    id: 'rect',
    label: 'Rectangle',
    icon: <svg viewBox="0 0 24 24" width="22" height="22"><rect x="4" y="5" width="16" height="14" fill="none" stroke="currentColor" strokeWidth="2" rx="1" /></svg>,
  },
  {
    id: 'ellipse',
    label: 'Ellipse',
    icon: <svg viewBox="0 0 24 24" width="22" height="22"><ellipse cx="12" cy="12" rx="9" ry="6" fill="none" stroke="currentColor" strokeWidth="2" /></svg>,
  },
  {
    id: 'text',
    label: 'Text',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 5h14" />
        <path d="M12 5v14" />
        <path d="M9 19h6" />
      </svg>
    ),
  },
  {
    id: 'laser',
    label: 'Laser',
    shortcut: 'L',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="2" fill="currentColor" />
        <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
      </svg>
    ),
  },
  {
    id: 'spotlight',
    label: 'Spotlight',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 10a4 4 0 118 0l-2 8h-4z" />
        <path d="M6 21h12" />
      </svg>
    ),
  },
];

interface Props {
  visible: boolean;
  tool: ToolId;
  setTool: (t: ToolId) => void;
  color: string;
  onColorChosen: (c: string) => void;
  size: number;
  onSizeChange: (n: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  canUndo: boolean;
  canRedo: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

const COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#007aff', '#af52de', '#ff2d55', '#ffffff', '#000000'];

export const Toolbar: React.FC<Props> = ({
  visible,
  tool,
  setTool,
  color,
  onColorChosen,
  size,
  onSizeChange,
  onUndo,
  onRedo,
  onClear,
  canUndo,
  canRedo,
  collapsed,
  onToggleCollapsed,
}) => {
  if (!visible) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        zIndex: 10,
        background: 'rgba(20,22,30,0.78)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 14,
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        transition: 'opacity 0.2s',
        maxHeight: 'calc(100vh - 40px)',
        overflowY: 'auto',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        title={collapsed ? 'Expand toolbar' : 'Collapse toolbar'}
        onClick={onToggleCollapsed}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'rgba(255,255,255,0.6)',
          cursor: 'pointer',
          padding: 6,
          borderRadius: 8,
        }}
      >
        {collapsed ? '»' : '«'}
      </button>
      {!collapsed && (
        <>
          {TOOLS.map((t) => (
            <button
              key={t.id}
              title={t.shortcut ? `${t.label} (${t.shortcut})` : t.label}
              onClick={() => setTool(t.id)}
              style={{
                background: tool === t.id ? 'rgba(255,255,255,0.16)' : 'transparent',
                border: 'none',
                color: tool === t.id ? '#fff' : 'rgba(255,255,255,0.75)',
                width: 40,
                height: 40,
                borderRadius: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseDown={(e) => e.preventDefault()}
            >
              {t.icon}
            </button>
          ))}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '4px 0' }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 4, padding: 4 }}>
            {COLORS.map((c) => (
              <button
                key={c}
                title={c}
                onClick={() => onColorChosen(c)}
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  background: c,
                  border: color === c ? '2px solid #fff' : '1px solid rgba(255,255,255,0.2)',
                  cursor: 'pointer',
                  padding: 0,
                }}
              />
            ))}
            <input
              type="color"
              value={color}
              onChange={(e) => onColorChosen(e.target.value)}
              title="Custom color"
              style={{ width: 20, height: 20, border: 'none', padding: 0, background: 'transparent', cursor: 'pointer' }}
            />
          </div>
          <div style={{ padding: '4px 6px', color: 'rgba(255,255,255,0.7)', fontSize: 11 }}>
            Size: {size}px
          </div>
          <input
            type="range"
            min={1}
            max={60}
            value={size}
            onChange={(e) => onSizeChange(Number(e.target.value))}
            style={{ width: 40, margin: '0 auto' }}
          />
          <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '4px 0' }} />
          <button title="Undo (Ctrl+Z)" onClick={onUndo} disabled={!canUndo}
            style={toolBtnStyle(!canUndo)}>↶</button>
          <button title="Redo (Ctrl+Shift+Z)" onClick={onRedo} disabled={!canRedo}
            style={toolBtnStyle(!canRedo)}>↷</button>
          <button title="Clear (Ctrl+Shift+C)" onClick={onClear} style={toolBtnStyle(false)}>✕</button>
        </>
      )}
    </div>
  );
};

function toolBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    background: 'transparent',
    border: 'none',
    color: disabled ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.85)',
    width: 40,
    height: 36,
    borderRadius: 8,
    cursor: disabled ? 'default' : 'pointer',
    fontSize: 18,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
}
