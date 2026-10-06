/**
 * Palette command catalogue and the fuzzy matcher behind `>` autocomplete.
 *
 * The catalogue is data only — execution lives in the PREP renderer
 * (`actions.runCommand`) so main never runs strings coming from the UI.
 */

export interface CommandArg {
  /** Single-word options used for completion. */
  options?: string[];
  /** Free-form argument (a name, a number…). */
  free?: boolean;
  placeholder?: string;
}

export interface CommandSpec {
  name: string;
  hint: string;
  arg?: CommandArg;
  /** Command touches the audience output — shown in the palette result row. */
  audience?: boolean;
}

export const COMMANDS: CommandSpec[] = [
  { name: 'present', hint: 'Present the active prep tab', audience: true },
  { name: 'stop', hint: 'Stop presenting and show the holding screen', audience: true },
  { name: 'privacy', hint: 'Toggle the privacy screen', audience: true, arg: { free: true, placeholder: 'on|off' } },
  { name: 'freeze', hint: 'Freeze / unfreeze the audience frame', audience: true, arg: { free: true, placeholder: 'on|off' } },
  { name: 'spotlight', hint: 'Toggle the spotlight', audience: true, arg: { free: true, placeholder: 'on|off' } },
  { name: 'holding', hint: 'Show the holding screen', audience: true, arg: { free: true, placeholder: 'on|off' } },
  { name: 'clean', hint: 'Toggle clean mode (hide teacher controls)', arg: { free: true, placeholder: 'on|off' } },
  { name: 'layout', hint: 'Change the audience layout', audience: true, arg: { options: ['focus', 'classroom', 'tutor', 'whiteboard', 'custom'] } },
  { name: 'size', hint: 'Card size preset', audience: true, arg: { options: ['comfortable', 'large', 'full', '16:9', '4:3', 'portrait', 'custom'] } },
  { name: 'radius', hint: 'Card corner radius', audience: true, arg: { options: ['0', '8', '12', '16', '18', '24', '32'] } },
  { name: 'theme', hint: 'Whiteboard theme', audience: true, arg: { options: ['white', 'dark', 'blackboard', 'grid', 'dots', 'sepia'] } },
  { name: 'background', hint: 'Set a background', audience: true, arg: { options: ['live', 'holding', 'privacy', 'library'] } },
  { name: 'board', hint: 'New whiteboard', arg: { free: true, placeholder: 'name' } },
  { name: 'scene', hint: 'Apply or save a scene', arg: { options: ['save', 'list'] } },
  { name: 'export', hint: 'Export the whiteboard as PNG', arg: { options: ['view', 'all'] } },
  { name: 'zoom', hint: 'Website zoom', arg: { options: ['50', '75', '100', '125', '150', '200'] } },
  { name: 'fullscreen', hint: 'Toggle fullscreen' },
  { name: 'notes', hint: 'Open notes and timer' },
  { name: 'camera', hint: 'Teacher camera settings' },
  { name: 'settings', hint: 'Open settings' },
  { name: 'diagnostics', hint: 'Developer diagnostics overlay' },
  { name: 'about', hint: 'About Juzt' },
  { name: 'quit', hint: 'Quit Juzt' },
];

export interface CommandMatch extends CommandSpec {
  /** 0-based match positions inside `name`, for lightweight highlighting. */
  positions: number[];
}

/** Subsequence match with a score: prefix > word-start > subsequence. */
function score(name: string, query: string): { score: number; positions: number[] } | null {
  if (!query) return { score: 0, positions: [] };
  const n = name.toLowerCase();
  if (n.startsWith(query)) return { score: 100 - name.length, positions: [...query].map((_, i) => i) };
  const positions: number[] = [];
  let qi = 0;
  for (let i = 0; i < n.length && qi < query.length; i += 1) {
    if (n[i] === query[qi]) {
      positions.push(i);
      qi += 1;
    }
  }
  if (qi === query.length) return { score: 40 - name.length + query.length, positions };
  return null;
}

export function matchCommands(input: string, limit = 8): CommandMatch[] {
  const raw = input.startsWith('>') ? input.slice(1) : input;
  const query = raw.trim().toLowerCase();
  const scored: { spec: CommandSpec; score: number; positions: number[] }[] = [];
  for (const spec of COMMANDS) {
    const hit = score(spec.name, query);
    if (hit) scored.push({ spec, ...hit });
  }
  scored.sort((a, b) => b.score - a.score || a.spec.name.localeCompare(b.spec.name));
  return scored.slice(0, limit).map((s) => ({ ...s.spec, positions: s.positions }));
}

/** Fill the first argument of a command from the typed text (for Tab completion). */
export function completeArg(spec: CommandSpec, typed: string): string | null {
  const options = spec.arg?.options ?? [];
  if (options.length === 0) return null;
  const t = typed.trim().toLowerCase();
  if (!t) return null;
  const hit = options.find((o) => o.startsWith(t));
  return hit ?? null;
}
