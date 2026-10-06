import React from 'react';
import type { ToolId, WbTool } from '../../shared/types';
import { WHITEBOARD_THEMES } from '../../shared/types';
import { actions } from '../state/actions';
import { sel, store, useSel } from '../state/store';
import { Icon } from './Icons';

/**
 * The floating toolbar.
 *
 * Design rule from the V2 direction: stay out of the way. One 44px column, one
 * flyout at a time, big colour grids and sliders live behind "…" so the default
 * surface stays minimal.
 */

const WEB_TOOLS: { id: ToolId; label: string; key: string }[] = [
  { id: 'cursor', label: 'Cursor', key: 'V' },
  { id: 'pen', label: 'Pen', key: 'P' },
  { id: 'marker', label: 'Marker', key: 'M' },
  { id: 'highlighter', label: 'Highlighter', key: 'H' },
  { id: 'eraser', label: 'Eraser', key: 'E' },
  { id: 'laser', label: 'Laser', key: 'L' },
  { id: 'text', label: 'Text', key: 'T' },
  { id: 'number', label: 'Number stamp', key: 'N' },
  { id: 'spotlight', label: 'Spotlight', key: 'S' },
];

const BOARD_TOOLS: { id: WbTool; label: string; key: string }[] = [
  { id: 'select', label: 'Select', key: 'V' },
  { id: 'hand', label: 'Hand', key: 'H' },
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

export const Toolbar: React.FC = () => {
  const onBoard = useSel((s) => !!sel.activeBoardId(s));
  return <div className="jz-toolbar">{onBoard ? <BoardTools /> : <WebTools />}</div>;
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
      masks: s.masks.length,
    }),
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const canUndo = useSel((s) => s.canUndoInk);
  const canRedo = useSel((s) => s.canRedoInk);
  const [flyout, setFlyout] = React.useState<'none' | 'ink' | 'more'>('none');
  const [advanced, setAdvanced] = React.useState(false);

  return (
    <>
      <div className="jz-toolbar__group">
        {WEB_TOOLS.map((t) => (
          <button
            key={t.id}
            className={`jz-tool ${tool === t.id ? 'is-active' : ''}`}
            title={`${t.label} (${t.key})`}
            aria-pressed={tool === t.id}
            onClick={() => {
              actions.setTool(t.id);
              setFlyout(t.id === 'pen' || t.id === 'marker' || t.id === 'highlighter' || t.id === 'text' || t.id === 'number' ? 'ink' : 'none');
            }}
          >
            {React.createElement(Icon[t.id] ?? Icon.pen, { size: 20 })}
          </button>
        ))}
      </div>

      <div className="jz-toolbar__group">
        <button className={`jz-tool ${flyout === 'ink' ? 'is-open' : ''}`} title="Ink style" onClick={() => setFlyout(flyout === 'ink' ? 'none' : 'ink')}>
          <span className="jz-swatch" style={{ background: ink.color }} />
        </button>
        <button className={`jz-tool ${canUndo ? '' : 'is-disabled'}`} title="Undo annotation (Ctrl+Z)" onClick={() => actions.inkCommand('undo')} disabled={!canUndo}>
          {React.createElement(Icon.undo, { size: 20 })}
        </button>
        <button className={`jz-tool ${canRedo ? '' : 'is-disabled'}`} title="Redo annotation (Ctrl+Shift+Z)" onClick={() => actions.inkCommand('redo')} disabled={!canRedo}>
          {React.createElement(Icon.redo, { size: 20 })}
        </button>
        <button className="jz-tool" title="Clear annotations" onClick={() => actions.inkCommand('clear')}>
          {React.createElement(Icon.trash, { size: 20 })}
        </button>
      </div>

      <div className="jz-toolbar__group">
        <button
          className={`jz-tool ${flags.privacy ? 'is-active is-danger' : ''}`}
          title="Privacy screen (F8)"
          onClick={() => void actions.togglePrivacy()}
        >
          {React.createElement(Icon.eyeOff, { size: 20 })}
        </button>
        <button className={`jz-tool ${flags.frozen ? 'is-active' : ''}`} title="Freeze the audience view (F9)" onClick={() => void actions.toggleFreeze()}>
          {React.createElement(Icon.snowflake, { size: 20 })}
        </button>
        <button className={`jz-tool ${flags.spotlight ? 'is-active' : ''}`} title="Spotlight (F10)" onClick={() => void actions.toggleSpotlight()}>
          {React.createElement(Icon.spotlight, { size: 20 })}
        </button>
        <button className={`jz-tool ${flags.masks ? 'is-active' : ''}`} title="Privacy masks" onClick={() => void actions.addMask('solid')}>
          {React.createElement(Icon.mask, { size: 20 })}
        </button>
      </div>

      <div className="jz-toolbar__group">
        <button className={`jz-tool ${flyout === 'more' ? 'is-open' : ''}`} title="More" onClick={() => setFlyout(flyout === 'more' ? 'none' : 'more')}>
          {React.createElement(Icon.menu, { size: 20 })}
        </button>
      </div>

      {flyout === 'ink' ? (
        <div className="jz-flyout jz-flyout--ink">
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
            <input
              type="range"
              min={1}
              max={40}
              value={ink.size}
              onChange={(e) => actions.setInk({ size: Number(e.target.value) })}
            />
            <em>{ink.size}</em>
          </label>
          {advanced ? (
            <>
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
                <input type="color" value={ink.color} onChange={(e) => actions.setInk({ color: e.target.value })} />
              </div>
            </>
          ) : (
            <button className="jz-flyout__more" onClick={() => setAdvanced(true)}>
              More options…
            </button>
          )}
        </div>
      ) : null}

      {flyout === 'more' ? (
        <div className="jz-flyout jz-flyout--more">
          <button onClick={() => void actions.setHolding(true)}>
            <Icon.broadcast size={16} /> Holding screen
          </button>
          <button onClick={() => store.set({ scenesOpen: true })}>
            <Icon.layers size={16} /> Scenes
          </button>
          <button onClick={() => store.set({ notesOpen: true })}>
            <Icon.notes size={16} /> Notes &amp; timer
          </button>
          <button onClick={() => store.set({ cameraOpen: true })}>
            <Icon.camera size={16} /> Camera
          </button>
          <button onClick={() => actions.openSettings('backgrounds')}>
            <Icon.image size={16} /> Backgrounds
          </button>
          <button onClick={() => actions.openSettings('presentation')}>
            <Icon.settings size={16} /> Settings
          </button>
          <button className={flags.clean ? 'is-active' : ''} onClick={() => actions.toggleClean()}>
            <Icon.eyeOff size={16} /> Clean mode (Ctrl+Shift+H)
          </button>
          <button
            onClick={() => {
              void actions.setPreview(!store.getState().previewEnabled);
            }}
          >
            <Icon.monitor size={16} /> Live preview
          </button>
        </div>
      ) : null}
    </>
  );
};

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
  const [flyout, setFlyout] = React.useState<'none' | 'ink' | 'more'>('none');

  return (
    <>
      <div className="jz-toolbar__group">
        {BOARD_TOOLS.map((t) => (
          <button key={t.id} className={`jz-tool ${tool === t.id ? 'is-active' : ''}`} title={`${t.label} (${t.key})`} onClick={() => actions.setWbTool(t.id)}>
            {React.createElement(Icon[t.id] ?? Icon.pen, { size: 20 })}
          </button>
        ))}
      </div>

      <div className="jz-toolbar__group">
        <button className={`jz-tool ${flyout === 'ink' ? 'is-open' : ''}`} title="Colour & size" onClick={() => setFlyout(flyout === 'ink' ? 'none' : 'ink')}>
          <span className="jz-swatch" style={{ background: style.color }} />
        </button>
        <button className={`jz-tool ${canUndo ? '' : 'is-disabled'}`} title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => void actions.wbUndo(boardId)}>
          {React.createElement(Icon.undo, { size: 20 })}
        </button>
        <button className={`jz-tool ${canRedo ? '' : 'is-disabled'}`} title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => void actions.wbRedo(boardId)}>
          {React.createElement(Icon.redo, { size: 20 })}
        </button>
        <button className={`jz-tool ${flyout === 'more' ? 'is-open' : ''}`} title="More" onClick={() => setFlyout(flyout === 'more' ? 'none' : 'more')}>
          {React.createElement(Icon.menu, { size: 20 })}
        </button>
      </div>

      {flyout === 'ink' ? (
        <div className="jz-flyout jz-flyout--ink">
          <div className="jz-flyout__row">
            {SWATCHES.map((c) => (
              <button
                key={c}
                className={`jz-swatch-btn ${style.color.toLowerCase() === c.toLowerCase() ? 'is-active' : ''}`}
                style={{ background: c }}
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
        </div>
      ) : null}

      {flyout === 'more' ? (
        <div className="jz-flyout jz-flyout--more">
          <button onClick={() => boardId && void actions.wbInsertImage(boardId)}>
            <Icon.image size={16} /> Insert image
          </button>
          <button onClick={() => boardId && void actions.wbExport(boardId, 'all')}>
            <Icon.expand size={16} /> Export PNG
          </button>
          <button onClick={() => boardId && void actions.wbExport(boardId, 'view')}>
            <Icon.image size={16} /> Export current view
          </button>
          <button onClick={() => boardId && void actions.presentBoard(boardId)}>
            <Icon.broadcast size={16} /> Present this board (Ctrl+Enter)
          </button>
          <button className="is-danger" onClick={() => boardId && void actions.wbClear(boardId)}>
            <Icon.trash size={16} /> Clear board
          </button>
        </div>
      ) : null}
    </>
  );
};
