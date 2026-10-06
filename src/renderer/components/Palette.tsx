import React from 'react';
import { matchCommands, type CommandMatch } from '../../shared/commands';
import { hostOf } from '../../shared/url';
import { actions } from '../state/actions';
import { sel, store, useSel } from '../state/store';
import { Icon } from './Icons';

/**
 * The Ctrl+L palette.
 *
 * One input, no permanent help text, no URL disclosure. Results are pages from
 * history, saved sites, then an inline "go" row; `>` switches to commands with
 * argument completion. `query` starts empty on purpose — main never hands the
 * renderer the current URL for prefill.
 */

interface Row {
  key: string;
  kind: 'go' | 'history' | 'fav' | 'command' | 'board';
  label: string;
  sub?: string;
  favicon?: string;
  positions?: number[];
  run: () => void;
}

export const Palette: React.FC = () => {
  const open = useSel((s) => s.paletteOpen);
  const [query, setQuery] = React.useState('');
  const [index, setIndex] = React.useState(0);
  const [closing, setClosing] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const history = useSel(sel.historyPreview, (a, b) => JSON.stringify(a) === JSON.stringify(b));
  const favorites = useSel(sel.favorites, (a, b) => JSON.stringify(a) === JSON.stringify(b));
  const tabs = useSel(sel.tabTitles, (a, b) => JSON.stringify(a) === JSON.stringify(b));

  const commandMode = query.startsWith('>');

  React.useEffect(() => {
    if (!open) return;
    setQuery('');
    setIndex(0);
    setClosing(false);
    const t = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => window.clearTimeout(t);
  }, [open]);

  const close = React.useCallback((commit?: () => void) => {
    setClosing(true);
    window.setTimeout(() => {
      commit?.();
      store.set({ paletteOpen: false });
    }, 120);
  }, []);

  const rows = React.useMemo<Row[]>(() => {
    const q = query.trim();
    if (commandMode) {
      const parts = q.slice(1).trim().split(/\s+/);
      const matches = matchCommands(parts[0] ?? '', 8);
      const args = parts.slice(1).join(' ');
      return matches.map((m: CommandMatch) => ({
        key: `cmd:${m.name}`,
        kind: 'command' as const,
        label: `>${m.name}`,
        sub: m.hint,
        positions: m.positions,
        run: () => void actions.runCommand(m.name, args),
      }));
    }

    const out: Row[] = [];
    const needle = q.toLowerCase();
    // A pasted or typed URL/domain always wins the first row.
    if (q && !/\s/.test(q)) {
      out.push({
        key: 'go',
        kind: 'go',
        label: q,
        sub: looksLikeAddress(q) ? 'Open in a new tab' : 'Search or open',
        run: () => void actions.openFromPalette(q),
      });
    } else if (!q) {
      out.push({ key: 'go-empty', kind: 'go', label: 'Search or enter address', run: () => undefined });
    }

    const scoreRow = (label: string, sub: string | undefined, needleText: string): number => {
      if (!needle) return 1;
      const l = label.toLowerCase();
      if (l.includes(needle)) return l.startsWith(needle) ? 3 : 2;
      return needleText.includes(needle) ? 1 : 0;
    };

    for (const tab of tabs) {
      const url = tab.url;
      if (tab.kind === 'whiteboard' || !url || url.startsWith('juzt://')) continue;
      const score = scoreRow(tab.label, url, url.toLowerCase());
      if (!score) continue;
      out.push({
        key: `tab:${tab.id}`,
        kind: 'board' as const,
        label: tab.label,
        sub: 'Open tab',
        favicon: tab.favicon,
        run: () => void actions.activateTab(tab.id),
      });
    }

    for (const site of favorites) {
      const label = site.title || hostOf(site.url);
      const score = scoreRow(label, site.url, site.url.toLowerCase());
      if (!score) continue;
      out.push({
        key: `fav:${site.url}`,
        kind: 'fav' as const,
        label,
        sub: hostOf(site.url),
        favicon: site.favicon,
        run: () => void actions.openFromPalette(site.url),
      });
    }

    for (const entry of history) {
      if (favorites.some((f) => f.url === entry.url)) continue;
      const s = scoreRow(entry.title || hostOf(entry.url), entry.url, entry.url.toLowerCase());
      if (!s) continue;
      out.push({
        key: `hist:${entry.url}:${entry.visitedAt}`,
        kind: 'history',
        label: entry.title || hostOf(entry.url),
        sub: hostOf(entry.url),
        run: () => void actions.openFromPalette(entry.url),
      });
    }

    return out.slice(0, 9);
  }, [query, commandMode, history, favorites, tabs]);

  React.useEffect(() => {
    setIndex((i) => Math.max(0, Math.min(i, rows.length - 1)));
  }, [rows.length]);

  if (!open) return null;

  const commit = (row?: Row) => {
    const chosen = row ?? rows[index];
    if (!chosen) {
      if (query.trim()) close(() => void actions.openFromPalette(query.trim()));
      else close();
      return;
    }
    close(chosen.run);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      setIndex((i) => (rows.length ? (i + 1) % rows.length : 0));
    } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      setIndex((i) => (rows.length ? (i - 1 + rows.length) % rows.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && query === '>') {
      e.preventDefault();
      setQuery('');
    }
  };

  return (
    <div className={`jz-palette ${closing ? 'is-closing' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="jz-palette__box" role="dialog" aria-label="Search or command palette">
        <div className="jz-palette__field">
          <span className="jz-palette__icon">{commandMode ? <Icon.menu size={18} /> : <Icon.globe size={18} />}</span>
          <input
            ref={inputRef}
            className="jz-palette__input"
            value={query}
            spellCheck={false}
            autoComplete="off"
            placeholder="Search or enter address"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>

        {rows.length ? (
          <ul className="jz-palette__list" role="listbox">
            {rows.map((row, i) => (
              <li key={row.key}>
                <button
                  className={`jz-palette__row ${i === index ? 'is-active' : ''}`}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => commit(row)}
                >
                  <span className="jz-palette__row-icon">
                    {row.kind === 'go' ? <Icon.search size={16} /> : row.kind === 'command' ? <Icon.menu size={16} /> : row.favicon ? <img src={row.favicon} alt="" width={16} height={16} /> : <Icon.clock size={16} />}
                  </span>
                  <span className="jz-palette__row-main">
                    <span className="jz-palette__row-label">{highlight(row.label, row.positions)}</span>
                    {row.sub ? <span className="jz-palette__row-sub">{row.sub}</span> : null}
                  </span>
                  {row.kind === 'command' && commandMode ? <span className="jz-palette__row-tag">command</span> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
};

function highlight(label: string, positions?: number[]): React.ReactNode {
  if (!positions || !positions.length) return label;
  const set = new Set(positions);
  return (
    <>
      {[...label].map((ch, i) => (
        <span key={i} className={set.has(i) ? 'is-match' : undefined}>
          {ch}
        </span>
      ))}
    </>
  );
}

/** Cheap check used only for the "Open in a new tab" wording. */
function looksLikeAddress(input: string): boolean {
  return /^(https?:\/\/|localhost|[\w-]+\.[a-z]{2,})/i.test(input.trim());
}
