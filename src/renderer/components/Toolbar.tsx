import React from 'react';
import type { ToolId, WbTool } from '../../shared/types';
import { WHITEBOARD_THEMES } from '../../shared/types';
import { actions } from '../state/actions';
import { sel, store, useSel } from '../state/store';
import { Icon } from './Icons';

/**
 * The floating teaching toolbar — V2 shape.
 *
 * Design rules taken straight from the approved reference:
 *   • one compact vertical column, 54–60px wide, 16–20px radius;
 *   • Cursor, Pen, Marker, Eraser, Shapes, Text, Number, Laser;
 *   • separator, then Undo / Redo, then More;
 *   • colour / size / opacity / shape options appear ONLY in a small popover
 *     when the teacher asks for them — the toolbar is never a control panel.
 */

/** Website annotation tools. Shapes/Text/Number open their own popover. */
const WEB_TOOLS: { id: ToolId; label: string; key: string; popover?: 'ink' | 'shapes' | 'text' }[] = [
  { id: 'cursor', label: 'Cursor', key: 'V' },
  { id: 'pen', label: 'Pen', key: 'P', popover: 'ink' },
  { id: 'marker', label: 'Marker', key: 'M', popover: 'ink' },
  { id: 'highlighter', label: 'Highlighter', key: 'H', popover: 'ink' },
  { id: 'eraser', label: 'Eraser', key: 'E' },
  { id: 'line', label: 'Shapes', key: 'I', popover: 'shapes' },
  { id: 'text', label: 'Text', key: 'T', popover: 'text' },
  { id: 'number', label: 'Number stamp', key: 'N', popover: 'text' },
  { id: 'laser', label: 'Laser', key: 'L' },
  { id: 'spotlight', label: 'Spotlight', key: 'S' },
];

const SHAPE_TOOLS: { id: ToolId; label: string }[] = [
  { id: 'line', label: 'Line' },
  { id: 'arrow', label: 'Arrow' },
  { id: 'rect', label: 'Rectangle' },
  { id: 'ellipse', label: 'Ellipse' },
];

const BOARD_TOOLS: { id: WbTool; label: string; key: string }[] = [
  { id: 'select', label: 'Select', key: 'V' },
  { id: 'pen', label: 'Pen', key: 'P' },
  { id: 'marker', label: 'Marker', key: 'M' },
  { id: 'highlighter', label: 'Highlighter', key: 'G' },
  { id: 'eraser', label: 'Eraser', key: 'E' },
  { id: 'line', label: 'Line', key: 'L' },
  { id: 'arrow', label: 'Arrow', key: 'A' },
  { id: 'rect', label: 'Rectangle', key: 'R' },
  { id: 'ellipse', label: 'Ellipse', key: 'O' },
  { id: 'text', label: 'Text', key: 'T' },
  { id: 'number', label: 'Number', key: 'N' },
  { id: 'laser', label: 'Laser', key: 'X' },
];

const SWATCHES = ['#ff5c5c', '#ffd166', '#5bd67e', '#4aa3ff', '#c084fc', '#ffffff', '#0b0e14'];

type Popover = 'none' | 'ink' | 'shapes' | 'text' | 'more';

export const Toolbar: React.FC = () => {
  const onBoard = useSel((s) => !!sel.activeBoardId(s));
  return (
    <div className="jz-toolbar" role="toolbar" aria-label="Teaching tools">
      {onBoard ? <BoardTools /> : <WebTools />}
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * Website annotation tools
 * ------------------------------------------------------------------ */

const WebTools: React.FC = () => {
  const tool = useSel((s) => s.tool);
  const ink = useSel((s) => s.ink);
  const flags = useSel(
    (s) => ({
      privacy: !!s.live?.flags.privacy,
      frozen: !!s.live?.flags.frozen,
      spotlight: !!s.live?.flags.spotlight,
      clean: s.cleanMode,
    }),
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const canUndo = useSel((s) => s.canUndoInk);
  const canRedo = useSel((s) => s.canRedoInk);
  const [popover, setPopover] = React.useState<Popover>('none');

  const close = () => setPopover('none');

  return (
    <>
      <div className="jz-toolbar__group">
        {WEB_TOOLS.map((t) => (
          <button
            key={t.id}
            className={`jz-tool ${tool === t.id ? 'is-active' : ''}`}
            title={`${t.label} (${t.key})`}
            aria-pressed={tool === t.id}
            aria-label={t.label}
            onClick={() => {
              actions.setTool(t.id);
              setPopover(t.popover && t.popover !== 'ink' ? t.popover : t.popover === 'ink' ? 'ink' : 'none');
            }}
          >
            {React.createElement(Icon[t.id] ?? Icon.pen, { size: 19 })}
          </button>
        ))}
      </div>

      <div className="jz-toolbar__group">
        <button
          className={`jz-tool ${popover === 'ink' ? 'is-open' : ''}`}
          title="Colour & size"
          aria-label="Colour and size"
          onClick={() => setPopover(popover === 'ink' ? 'none' : 'ink')}
        >
          <span className="jz-swatch" style={{ background: ink.color }} />
        </button>
        <button className={`jz-tool ${canUndo ? '' : 'is-disabled'}`} title="Undo annotation (Ctrl+Z)" aria-label="Undo" onClick={() => actions.inkCommand('undo')} disabled={!canUndo}>
          {React.createElement(Icon.undo, { size: 19 })}
        </button>
        <button className={`jz-tool ${canRedo ? '' : 'is-disabled'}`} title="Redo annotation (Ctrl+Shift+Z)" aria-label="Redo" onClick={() => actions.inkCommand('redo')} disabled={!canRedo}>
          {React.createElement(Icon.redo, { size: 19 })}
        </button>
      </div>

      <div className="jz-toolbar__group">
        <button
          className={`jz-tool ${popover === 'more' ? 'is-open' : ''}`}
          title="More"
          aria-label="More"
          onClick={() => setPopover(popover === 'more' ? 'none' : 'more')}
        >
          {React.createElement(Icon.menu, { size: 19 })}
        </button>
      </div>

      {popover === 'ink' ? <InkPopover ink={ink} onClose={close} /> : null}
      {popover === 'shapes' ? <ShapesPopover onPick={close} /> : null}
      {popover === 'text' ? <TextPopover ink={ink} onClose={close} /> : null}
      {popover === 'more' ? <MorePopover flags={flags} onClose={close} /> : null}
    </>
  );
};

/* ------------------------------------------------------------------ *
 * Popovers — only ever open on demand
 * ------------------------------------------------------------------ */

const InkPopover: React.FC<{ ink: { color: string; size: number; opacity: number; fontSize: number }; onClose: () => void }> = ({ ink, onClose }) => (
  <PopoverShell title="Ink" onClose={onClose}>
    <div className="jz-flyout__row">
      {SWATCHES.map((c) => (
        <button
          key={c}
          className={`jz-swatch-btn ${ink.color.toLowerCase() === c.toLowerCase() ? 'is-active' : ''}`}
          style={{ background: c }}
          title={c}
          onClick={() => actions.setInk({ color: c })}
        />
      ))}
    </div>
    <label className="jz-flyout__slider">
      <span>Size</span>
      <input type="range" min={1} max={40} value={ink.size} onChange={(e) => actions.setInk({ size: Number(e.target.value) })} />
      <em>{ink.size}</em>
    </label>
    <details className="jz-flyout__details">
      <summary>More options…</summary>
      <label className="jz-flyout__slider">
        <span>Opacity</span>
        <input type="range" min={0.15} max={1} step={0.05} value={ink.opacity} onChange={(e) => actions.setInk({ opacity: Number(e.target.value) })} />
        <em>{Math.round(ink.opacity * 100)}%</em>
      </label>
      <label className="jz-flyout__slider">
        <span>Text</span>
        <input type="range" min={14} max={120} step={2} value={ink.fontSize} onChange={(e) => actions.setInk({ fontSize: Number(e.target.value) })} />
        <em>{ink.fontSize}</em>
      </label>
      <div className="jz-flyout__row">
        <input type="color" value={ink.color} onChange={(e) => actions.setInk({ color: e.target.value })} aria-label="Custom colour" />
      </div>
    </details>
  </PopoverShell>
);

const ShapesPopover: React.FC<{ onPick: () => void }> = ({ onPick }) => (
  <PopoverShell title="Shapes">
    <div className="jz-flyout__grid">
      {SHAPE_TOOLS.map((s) => (
        <button key={s.id} className="jz-flyout__tile" title={s.label} onClick={() => { actions.setTool(s.id); onPick(); }}>
          {React.createElement(Icon[s.id], { size: 20 })}
          <em>{s.label}</em>
        </button>
      ))}
    </div>
  </PopoverShell>
);

const TextPopover: React.FC<{ ink: { color: string; fontSize: number }; onClose: () => void }> = ({ ink, onClose }) => (
  <PopoverShell title="Text" onClose={onClose}>
    <div className="jz-flyout__row">
      {SWATCHES.slice(0, 6).map((c) => (
        <button
          key={c}
          className={`jz-swatch-btn ${ink.color.toLowerCase() === c.toLowerCase() ? 'is-active' : ''}`}
          style={{ background: c }}
          title={c}
          onClick={() => actions.setInk({ color: c })}
        />
      ))}
    </div>
    <label className="jz-flyout__slider">
      <span>Size</span>
      <input type="range" min={14} max={120} step={2} value={ink.fontSize} onChange={(e) => actions.setInk({ fontSize: Number(e.target.value) })} />
      <em>{ink.fontSize}</em>
    </label>
  </PopoverShell>
);

const MorePopover: React.FC<{ flags: { privacy: boolean; frozen: boolean; spotlight: boolean; clean: boolean }; onClose: () => void }> = ({ flags, onClose }) => (
  <PopoverShell title="More" onClose={onClose}>
    <button onClick={() => { void actions.setHolding(true); onClose(); }}>
      <Icon.broadcast size={15} /> Holding screen
    </button>
    <button onClick={() => { store.set({ scenesOpen: true }); onClose(); }}>
      <Icon.layers size={15} /> Scenes
    </button>
    <button onClick={() => { store.set({ notesOpen: true }); onClose(); }}>
      <Icon.notes size={15} /> Notes &amp; timer
    </button>
    <button onClick={() => { store.set({ cameraOpen: true }); onClose(); }}>
      <Icon.camera size={15} /> Camera
    </button>
    <button onClick={() => { actions.openSettings('backgrounds'); onClose(); }}>
      <Icon.image size={15} /> Background
    </button>
    <button onClick={() => { actions.openSettings('presentation'); onClose(); }}>
      <Icon.settings size={15} /> Settings
    </button>
    <button className={flags.clean ? 'is-active' : ''} onClick={() => { actions.toggleClean(); onClose(); }}>
      <Icon.eyeOff size={15} /> Clean mode
    </button>
  </PopoverShell>
);

const PopoverShell: React.FC<{ title: string; onClose?: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div className="jz-flyout" role="dialog" aria-label={title}>
    <div className="jz-flyout__head">
      <strong>{title}</strong>
      {onClose ? (
        <button className="jz-flyout__x" title="Close" aria-label="Close" onClick={onClose}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </button>
      ) : null}
    </div>
    {children}
  </div>
);

/* ------------------------------------------------------------------ *
 * Whiteboard tools
 * ------------------------------------------------------------------ */

const BoardTools: React.FC = () => {
  const boardId = useSel(sel.activeBoardId);
  const doc = useSel(sel.activeBoard);
  const tool = useSel((s) => s.wbTool);
  const style = useSel((s) => s.wbStyle);
  const canUndo = useSel((s) => s.wbCanUndo);
  const canRedo = useSel((s) => s.wbCanRedo);
  const [popover, setPopover] = React.useState<Popover>('none');

  return (
    <>
      <div className="jz-toolbar__group">
        {BOARD_TOOLS.map((t) => (
          <button key={t.id} className={`jz-tool ${tool === t.id ? 'is-active' : ''}`} title={`${t.label} (${t.key})`} aria-label={t.label} onClick={() => actions.setWbTool(t.id)}>
            {React.createElement(Icon[t.id] ?? Icon.pen, { size: 19 })}
          </button>
        ))}
      </div>

      <div className="jz-toolbar__group">
        <button
          className={`jz-tool ${popover === 'ink' ? 'is-open' : ''}`}
          title="Colour & size"
          aria-label="Colour and size"
          onClick={() => setPopover(popover === 'ink' ? 'none' : 'ink')}
        >
          <span className="jz-swatch" style={{ background: style.color }} />
        </button>
        <button className={`jz-tool ${canUndo ? '' : 'is-disabled'}`} title="Undo (Ctrl+Z)" aria-label="Undo" onClick={() => void actions.wbUndo()} disabled={!canUndo}>
          {React.createElement(Icon.undo, { size: 19 })}
        </button>
        <button className={`jz-tool ${canRedo ? '' : 'is-disabled'}`} title="Redo (Ctrl+Shift+Z)" aria-label="Redo" onClick={() => void actions.wbRedo()} disabled={!canRedo}>
          {React.createElement(Icon.redo, { size: 19 })}
        </button>
      </div>

      <div className="jz-toolbar__group">
        <button
          className={`jz-tool ${popover === 'more' ? 'is-open' : ''}`}
          title="More"
          aria-label="More"
          onClick={() => setPopover(popover === 'more' ? 'none' : 'more')}
        >
          {React.createElement(Icon.menu, { size: 19 })}
        </button>
      </div>

      {popover === 'ink' ? (
        <PopoverShell title="Ink" onClose={() => setPopover('none')}>
          <div className="jz-flyout__row">
            {SWATCHES.map((c) => (
              <button
                key={c}
                className={`jz-swatch-btn ${style.color.toLowerCase() === c.toLowerCase() ? 'is-active' : ''}`}
                style={{ background: c }}
                title={c}
                onClick={() => actions.setWbStyle({ color: c })}
              />
            ))}
          </div>
          <label className="jz-flyout__slider">
            <span>Size</span>
            <input type="range" min={1} max={40} value={style.width ?? style.size} onChange={(e) => actions.setWbStyle({ width: Number(e.target.value), size: Number(e.target.value) })} />
            <em>{style.width ?? style.size}</em>
          </label>
          <div className="jz-flyout__row jz-flyout__row--themes">
            {WHITEBOARD_THEMES.map((t) => (
              <button
                key={t.id}
                className={`jz-theme ${doc?.theme === t.id ? 'is-active' : ''}`}
                style={{ background: t.background, color: t.ink }}
                title={t.label}
                onClick={() => boardId && void actions.wbSetTheme(boardId, t.id)}
              >
                Aa
              </button>
            ))}
          </div>
        </PopoverShell>
      ) : null}

      {popover === 'more' ? (
        <PopoverShell title="More" onClose={() => setPopover('none')}>
          <button onClick={() => boardId && void actions.wbInsertImage(boardId)}>
            <Icon.image size={15} /> Insert image
          </button>
          <button onClick={() => boardId && void actions.wbExport(boardId, 'all')}>
            <Icon.expand size={15} /> Export PNG
          </button>
          <button onClick={() => boardId && void actions.presentBoard(boardId)}>
            <Icon.broadcast size={15} /> Present this board
          </button>
          <button className="is-danger" onClick={() => boardId && void actions.wbClear(boardId)}>
            <Icon.trash size={15} /> Clear board
          </button>
        </PopoverShell>
      ) : null}
    </>
  );
};
