import fs from 'node:fs';
import path from 'node:path';
import { applyOp, createDoc, metaOf, migrateDoc, serialize } from '../shared/whiteboard';
import type { WbOp, WhiteboardDoc, WhiteboardMeta, WhiteboardThemeId } from '../shared/types';
import { loadState, setState } from './persistence';
import { userDataDir } from './paths';

/**
 * Whiteboard documents.
 *
 * The document is the vector state, never a bitmap. Every edit is applied in
 * main first, then broadcast as ops so PREP and LIVE converge without shipping
 * a screenshot per frame. Disk writes are debounced by `persistence.setState`,
 * so dragging a stroke costs nothing until the gesture ends.
 *
 * Undo/redo is op-based: each applied op pushes an inverse op, so memory stays
 * proportional to the editing history, not to the document size.
 */

export interface BoardEvents {
  onOps(boardId: string, ops: WbOp[], rev: number, hint: { canUndo: boolean; canRedo: boolean }): void;
  onDoc(doc: WhiteboardDoc): void;
  onList(list: WhiteboardMeta[]): void;
}

const MAX_HISTORY = 200;

export class BoardStore {
  private docs = new Map<string, WhiteboardDoc>();
  private undoStack = new Map<string, WbOp[]>();
  private redoStack = new Map<string, WbOp[]>();
  private index: WhiteboardMeta[] = [];
  private events: BoardEvents;

  constructor(events: BoardEvents) {
    this.events = events;
  }

  load(): void {
    this.index = loadState<WhiteboardMeta[]>('boards', []);
    for (const meta of this.index) {
      const doc = this.read(meta.id);
      if (doc) this.docs.set(doc.id, doc);
    }
    // A first run has no boards: create one so the whiteboard tool is never a
    // dead end.
    if (!this.index.length) {
      const doc = this.createDoc('Whiteboard 1', 'dark');
      this.docs.set(doc.id, doc);
      this.flushIndex();
    }
  }

  list(): WhiteboardMeta[] {
    return this.index;
  }

  get(id: string): WhiteboardDoc | null {
    const cached = this.docs.get(id);
    if (cached) return cached;
    const doc = this.read(id);
    if (doc) this.docs.set(id, doc);
    return doc;
  }

  create(name?: string, theme: WhiteboardThemeId = 'dark'): WhiteboardDoc {
    const doc = this.createDoc(name || `Whiteboard ${this.index.length + 1}`, theme);
    this.docs.set(doc.id, doc);
    this.flushIndex();
    this.events.onDoc(doc);
    this.events.onList(this.index);
    return doc;
  }

  /**
   * Make sure a document exists under an *already chosen* id.
   *
   * A whiteboard tab is created with its board id up front (the tab record is
   * the handle the UI holds), so opening `+ → New Whiteboard` or Ctrl+Shift+N
   * must materialise that exact document — otherwise every stroke lands in a
   * board the store has never heard of and the lesson is silently lost.
   */
  ensure(id: string, name?: string): WhiteboardDoc {
    const existing = this.get(id);
    if (existing) {
      if (name && existing.name !== name) return this.rename(id, name) ?? existing;
      return existing;
    }
    const theme = (this.index.length ? this.index[0].theme : 'dark') as WhiteboardThemeId;
    const doc: WhiteboardDoc = { ...createDoc(name || 'Whiteboard', theme), id };
    this.docs.set(doc.id, doc);
    this.flushIndex();
    this.events.onDoc(doc);
    this.events.onList(this.index);
    return doc;
  }

  rename(id: string, name: string): WhiteboardDoc | null {
    const doc = this.get(id);
    if (!doc) return null;
    const next: WhiteboardDoc = { ...doc, name: name.slice(0, 80) || doc.name, updatedAt: Date.now(), rev: doc.rev + 1 };
    this.store(next);
    this.events.onDoc(next);
    this.flushIndex();
    this.events.onList(this.index);
    return next;
  }

  remove(id: string): boolean {
    if (!this.docs.delete(id)) return false;
    this.undoStack.delete(id);
    this.redoStack.delete(id);
    try {
      fs.rmSync(this.fileFor(id), { force: true });
    } catch {
      /* the index is the source of truth; a stray file is harmless */
    }
    this.flushIndex();
    this.events.onList(this.index);
    return true;
  }

  /** Apply ops from PREP (or a LIVE-safe source): mutate, persist, broadcast. */
  apply(boardId: string, ops: WbOp[]): { ok: boolean; rev: number; canUndo: boolean; canRedo: boolean } {
    const doc = this.get(boardId);
    if (!doc || !ops.length) {
      return { ok: false, rev: doc?.rev ?? 0, canUndo: this.canUndo(boardId), canRedo: this.canRedo(boardId) };
    }
    let next = doc;
    const inverses: WbOp[] = [];
    for (const op of ops) {
      const inverse = invert(next, op);
      next = applyOp(next, op);
      if (inverse) inverses.push(inverse);
    }
    next = { ...next, rev: doc.rev + 1, updatedAt: Date.now() };
    this.store(next);
    if (inverses.length) {
      const stack = this.undoStack.get(boardId) ?? [];
      stack.push(...inverses);
      if (stack.length > MAX_HISTORY) stack.splice(0, stack.length - MAX_HISTORY);
      this.undoStack.set(boardId, stack);
      this.redoStack.set(boardId, []);
    }
    const hint = { canUndo: this.canUndo(boardId), canRedo: this.canRedo(boardId) };
    this.events.onOps(boardId, ops, next.rev, hint);
    return { ok: true, rev: next.rev, ...hint };
  }

  undo(boardId: string): { ok: boolean; rev: number; canUndo: boolean; canRedo: boolean } {
    const doc = this.get(boardId);
    const stack = this.undoStack.get(boardId) ?? [];
    if (!doc || !stack.length) return { ok: false, rev: doc?.rev ?? 0, canUndo: false, canRedo: this.canRedo(boardId) };
    const op = stack.pop() as WbOp;
    this.undoStack.set(boardId, stack);
    let next = applyOp(doc, op);
    next = { ...next, rev: doc.rev + 1, updatedAt: Date.now() };
    this.store(next);
    const redo = this.redoStack.get(boardId) ?? [];
    const reverse = invert(doc, op);
    if (reverse) redo.push(reverse);
    this.redoStack.set(boardId, redo);
    this.events.onOps(boardId, [op], next.rev, { canUndo: this.canUndo(boardId), canRedo: this.canRedo(boardId) });
    return { ok: true, rev: next.rev, canUndo: this.canUndo(boardId), canRedo: this.canRedo(boardId) };
  }

  redo(boardId: string): { ok: boolean; rev: number; canUndo: boolean; canRedo: boolean } {
    const doc = this.get(boardId);
    const stack = this.redoStack.get(boardId) ?? [];
    if (!doc || !stack.length) return { ok: false, rev: doc?.rev ?? 0, canUndo: this.canUndo(boardId), canRedo: false };
    const op = stack.pop() as WbOp;
    this.redoStack.set(boardId, stack);
    let next = applyOp(doc, op);
    next = { ...next, rev: doc.rev + 1, updatedAt: Date.now() };
    this.store(next);
    const undo = this.undoStack.get(boardId) ?? [];
    const reverse = invert(doc, op);
    if (reverse) undo.push(reverse);
    this.undoStack.set(boardId, undo);
    this.events.onOps(boardId, [op], next.rev, { canUndo: this.canUndo(boardId), canRedo: this.canRedo(boardId) });
    return { ok: true, rev: next.rev, canUndo: this.canUndo(boardId), canRedo: this.canRedo(boardId) };
  }

  hint(boardId: string): { canUndo: boolean; canRedo: boolean } {
    return { canUndo: this.canUndo(boardId), canRedo: this.canRedo(boardId) };
  }

  private canUndo(boardId: string): boolean {
    return (this.undoStack.get(boardId)?.length ?? 0) > 0;
  }

  private canRedo(boardId: string): boolean {
    return (this.redoStack.get(boardId)?.length ?? 0) > 0;
  }

  setName(boardId: string, name: string): void {
    const doc = this.get(boardId);
    if (!doc || doc.name === name) return;
    const next = { ...doc, name, rev: doc.rev + 1, updatedAt: Date.now() };
    this.store(next);
  }

  private store(doc: WhiteboardDoc): void {
    this.docs.set(doc.id, doc);
    setState(`board_${doc.id}`, doc);
    if (!this.index.some((m) => m.id === doc.id)) this.flushIndex();
    else this.flushIndex();
  }

  private flushIndex(): void {
    this.index = [...this.docs.values()].map(metaOf).sort((a, b) => b.updatedAt - a.updatedAt);
    setState('boards', this.index);
  }

  private read(id: string): WhiteboardDoc | null {
    try {
      const raw = fs.readFileSync(this.fileFor(id), 'utf8');
      return migrateDoc(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  private fileFor(id: string): string {
    return path.join(userDataDir(), 'boards', `${id.replace(/[^a-z0-9_-]/gi, '')}.json`);
  }

  private createDoc(name: string, theme: WhiteboardThemeId): WhiteboardDoc {
    const doc = createDoc(name, theme);
    // Write immediately so a crash right after creation still leaves a board.
    setState(`board_${doc.id}`, doc, { immediate: true });
    return doc;
  }

  /** Serialize for export/debug (never used for autosave). */
  dump(id: string): string | null {
    const doc = this.get(id);
    return doc ? serialize(doc) : null;
  }
}

/* ------------------------------------------------------------------ *
 * Inverse ops (undo without snapshots)
 * ------------------------------------------------------------------ */

function invert(doc: WhiteboardDoc, op: WbOp): WbOp | null {
  switch (op.type) {
    case 'add':
      return { type: 'delete', ids: op.objects.map((o) => o.id) };
    case 'delete': {
      const ids = new Set(op.ids);
      const objects = doc.objects.filter((o) => ids.has(o.id));
      return objects.length ? { type: 'add', objects } : null;
    }
    case 'move':
      return { type: 'move', ids: op.ids, dx: -op.dx, dy: -op.dy };
    case 'replace': {
      const previous = doc.objects.find((o) => o.id === op.id);
      return previous ? { type: 'replace', id: op.id, object: previous } : null;
    }
    case 'clear':
      return doc.objects.length ? { type: 'add', objects: doc.objects } : null;
    case 'theme':
      return { type: 'theme', theme: doc.theme };
    case 'name':
      return { type: 'name', name: doc.name };
    case 'view':
      return { type: 'view', view: doc.view };
    default:
      return null;
  }
}
