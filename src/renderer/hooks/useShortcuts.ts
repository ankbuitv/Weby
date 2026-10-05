import { useEffect, useRef } from 'react';

export type ShortcutHandler = (e: KeyboardEvent) => unknown;
// Handlers can return any value; we always preventDefault for matched combos.

export interface ShortcutMap {
  [combo: string]: ShortcutHandler;
}

function comboFor(e: KeyboardEvent): string | null {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  // F-keys and named
  const key = e.key;
  if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') return null;
  let k = key;
  if (k.length === 1) k = k.toLowerCase();
  // normalize "=" key and "+"
  if (k === '=' || k === '+') k = '=';
  if (k === '-') k = '-';
  parts.push(k.length === 1 ? k : k);
  return parts.join('+');
}

function isTypingTarget(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  if (!target) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  // Annotation text editor
  if (target.closest('[data-text-editor="true"]')) return true;
  // Palette
  if (target.closest('[data-palette="true"]')) return true;
  // Settings
  if (target.closest('[data-settings="true"]')) return true;
  return false;
}

/**
 * Centralized keyboard handling. Global shortcuts that should ALWAYS fire
 * (like Ctrl+L, Ctrl+Shift+Q, F8, F9, F10) are handled first and bypass
 * typing-target gating. Tool/character shortcuts (V, P, H, E, L, [, ]) only
 * fire when focus is on the body / presentation area (not inputs, not palette,
 * not text editors).
 */
export function useShortcuts(handlers: {
  global?: ShortcutMap; // always fire even when typing
  normal?: ShortcutMap; // fire only when NOT typing
}) {
  const globalRef = useRef(handlers.global);
  const normalRef = useRef(handlers.normal);
  globalRef.current = handlers.global;
  normalRef.current = handlers.normal;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const combo = comboFor(e);
      if (!combo) return;

      if (globalRef.current && combo in globalRef.current) {
        const result = globalRef.current[combo](e);
        if (result !== false) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }

      if (isTypingTarget(e)) return;

      if (normalRef.current && combo in normalRef.current) {
        const result = normalRef.current[combo](e);
        if (result !== false) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);
}
