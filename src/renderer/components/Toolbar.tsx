import React, { useState } from 'react';
import type { ToolId } from '../../shared/types';

interface Props {
  visible: boolean;
  tool: ToolId;
  setTool: (t: ToolId) => void;
  color: string;
  onColorChosen: (c: string) => void;
  size: number;
  onSizeChange: (n: number) => void;
  opacity: number;
  onOpacityChange: (n: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onToggleCollapsed: () => void;
}

const colors = ['#ff5d67', '#ff9f43', '#ffd166', '#42d392', '#48cae4', '#6c7cff', '#b38cff', '#ffffff'];
const paths: Record<string, React.ReactNode> = {
  cursor: <><path d="m5 3 14 8-6 1-3 7z"/><path d="m13 13 4 6"/></>,
  pen: <><path d="m4 16 10-10 4 4L8 20H4z"/><path d="m12 8 4 4"/></>,
  highlighter: <><path d="m4 16 10-10 5 5L9 21H4z"/><path d="m13 7 5 5"/></>,
  eraser: <><path d="m4 15 9-10 7 7-8 8H8z"/><path d="M12 20h8"/></>,
  shapes: <><rect x="3.5" y="4" width="10" height="8" rx="1.5"/><circle cx="17" cy="16" r="4"/><path d="m4 20 6-5"/></>,
  text: <><path d="M4 6h16M12 6v13M8 19h8"/></>,
  laser: <><circle cx="12" cy="12" r="2.5"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/></>,
  spotlight: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2"/></>,
  undo: <><path d="M9 14 4 9l5-5"/><path d="M4 9h9a6 6 0 0 1 0 12h-2"/></>,
  redo: <><path d="m15 14 5-5-5-5"/><path d="M20 9h-9a6 6 0 0 0 0 12h2"/></>,
  more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
};

const Icon: React.FC<{ name: string }> = ({ name }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
);

export const Toolbar: React.FC<Props> = ({ visible, tool, setTool, color, onColorChosen, size, onSizeChange, onUndo, onRedo, canUndo, canRedo, onToggleCollapsed, opacity, onOpacityChange }) => {
  const [popover, setPopover] = useState<'pen' | 'highlighter' | 'shapes' | 'more' | null>(null);
  if (!visible) return null;
  const button = (name: string, label: string, active: boolean, action: () => void, shortcut?: string, disabled = false) => (
    <button key={name} className={`tool-button${active ? ' active' : ''}`} title={shortcut ? `${label} · ${shortcut}` : label} aria-label={label} onClick={action} disabled={disabled}>
      <Icon name={name}/>
    </button>
  );
  const selectInk = (t: 'pen' | 'highlighter') => {
    if (tool === t) setPopover(popover === t ? null : t);
    else { setTool(t); setPopover(null); }
  };
  const shapeActive = ['line', 'arrow', 'rect', 'ellipse'].includes(tool);
  return (
    <div data-ui-region="true" className="floating-toolbar" onContextMenu={(e) => e.preventDefault()}>
      {button('cursor', 'Cursor', tool === 'cursor', () => { setTool('cursor'); setPopover(null); }, 'V')}
      {button('pen', 'Pen · click again for settings', tool === 'pen', () => selectInk('pen'), 'P')}
      {button('highlighter', 'Highlighter · click again for settings', tool === 'highlighter', () => selectInk('highlighter'), 'H')}
      {button('eraser', 'Eraser', tool === 'eraser', () => { setTool('eraser'); setPopover(null); }, 'E')}
      {button('shapes', 'Shapes', shapeActive, () => setPopover(popover === 'shapes' ? null : 'shapes'))}
      {button('text', 'Text', tool === 'text', () => { setTool('text'); setPopover(null); })}
      {button('laser', 'Laser pointer', tool === 'laser', () => { setTool('laser'); setPopover(null); }, 'L')}
      {button('spotlight', 'Spotlight', tool === 'spotlight', () => { setTool('spotlight'); setPopover(null); })}
      <div className="toolbar-separator"/>
      {button('undo', 'Undo', false, onUndo, 'Ctrl+Z', !canUndo)}
      {button('redo', 'Redo', false, onRedo, 'Ctrl+Shift+Z', !canRedo)}
      {button('more', 'Settings & presentation options', false, onToggleCollapsed)}

      {popover && <div className="tool-popover" data-ui-region="true" onClick={(e) => e.stopPropagation()}>
        {popover === 'shapes' ? <>
          <div className="popover-title">Shapes</div>
          <div className="shape-options">
            {(['line', 'arrow', 'rect', 'ellipse'] as const).map((shape) => <button key={shape} className={tool === shape ? 'selected' : ''} title={shape} onClick={() => { setTool(shape); setPopover(null); }}>
              {shape === 'line' ? '╱' : shape === 'arrow' ? '↗' : shape === 'rect' ? '□' : '◯'}
            </button>)}
          </div>
        </> : <>
          <div className="popover-title">{popover === 'pen' ? 'Pen' : 'Highlighter'}</div>
          <div className="color-options">{colors.map((c) => <button key={c} title={c} className={color === c ? 'selected' : ''} style={{ background: c }} onClick={() => onColorChosen(c)}/>)}<input type="color" title="Custom color" value={color} onChange={(e) => onColorChosen(e.target.value)}/></div>
          <label className="size-control"><span>Size</span><input type="range" min="1" max={popover === 'pen' ? 40 : 60} value={size} onChange={(e) => onSizeChange(Number(e.target.value))}/><b>{size}px</b></label>
          {popover === 'highlighter' && <label className="size-control opacity-control"><span>Opacity</span><input type="range" min="0.15" max="0.8" step="0.05" value={opacity} onChange={(e) => onOpacityChange(Number(e.target.value))}/><b>{Math.round(opacity * 100)}%</b></label>}
        </>}
        <button className="popover-close" onClick={() => setPopover(null)}>Done</button>
      </div>}
    </div>
  );
};
