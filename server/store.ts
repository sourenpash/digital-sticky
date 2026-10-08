import { closeSync, existsSync, fsyncSync, openSync, renameSync, writeSync } from 'node:fs';
import { copyFile, mkdir, open, readdir, readFile, rename, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { format } from 'date-fns';
import { lanesInOrder } from '../shared/board.ts';
import { applyOp, type ServerOp } from '../shared/ops.ts';
import { boardSchema, describeIssues, MAX_SCREENS, savedFileSchema, type SavedFile, type ScreenEntry, type Trash } from '../shared/schema.ts';
import type { Board, Goal, Lane, Note } from '../shared/types.ts';

// The board lives in memory and is written to <dir>/board.json shortly after each
// change: first to a temp file, which is synced to disk and then renamed over the old
// file, so a power cut leaves either the old board or the new one, never half of one.
// The first save of each day copies yesterday's file to backups/.

const DAY_MS = 24 * 60 * 60 * 1000;
/** A wall screen's "last seen" time is saved at most this often (it checks in every minute). */
const SEEN_SAVE_MS = 10 * 60_000;
const BACKUP_NAME = /^board-\d{4}-\d{2}-\d{2}\.json$/;

export class StoreError extends Error {
  readonly status: 400 | 404 | 409;
  constructor(status: 400 | 404 | 409, message: string) {
    super(message);
    this.status = status;
  }
}

export interface StoreOptions {
  /** Folder for board.json and backups/. */
  dir: string;
  /** The board to start with when there's no saved one. */
  seed: (now: Date) => Board;
  /** Start from the seed even when a saved board exists (demo mode). */
  reset?: boolean;
  now?: () => Date;
  saveDelayMs?: number;
  keepBackups?: number;
  trashDays?: number;
  log?: (message: string) => void;
}

export interface Snapshot {
  epoch: string;
  rev: number;
  board: Board;
}

const emptyTrash = (): Trash => ({ notes: [], lanes: [], goals: [] });

export function newId(): string {
  return randomBytes(9).toString('base64url');
}

type Parsed = { ok: true; file: SavedFile } | { ok: false; error: string };

function parseSaved(raw: string): Parsed {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'not valid JSON' };
  }
  const result = savedFileSchema.safeParse(json);
  return result.success ? { ok: true, file: result.data } : { ok: false, error: describeIssues(result.error) };
}

export class BoardStore {
  /** Random per start, so phones know to reload everything after a restart or restore. */
  readonly epoch = newId();
  readonly now: () => Date;
  private file: SavedFile;
  private readonly dir: string;
  private readonly options: Required<Pick<StoreOptions, 'saveDelayMs' | 'keepBackups' | 'trashDays'>>;
  private readonly log: (message: string) => void;
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> | null = null;
  private lastBackupDay = '';
  private readonly listeners = new Set<(rev: number) => void>();

  private constructor(file: SavedFile, options: StoreOptions) {
    this.file = file;
    this.dir = options.dir;
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? (() => {});
    this.options = {
      saveDelayMs: options.saveDelayMs ?? 250,
      keepBackups: options.keepBackups ?? 30,
      trashDays: options.trashDays ?? 30,
    };
  }

  static async open(options: StoreOptions): Promise<BoardStore> {
    await mkdir(join(options.dir, 'backups'), { recursive: true });
    const log = options.log ?? (() => {});
    const loaded = options.reset ? null : await loadSaved(options.dir, log);
    const now = (options.now ?? (() => new Date()))();
    const file: SavedFile = loaded?.file ?? {
      version: 1,
      rev: 0,
      savedAt: now.toISOString(),
      board: options.seed(now),
      trash: emptyTrash(),
      screens: [],
    };
    const store = new BoardStore(file, options);
    store.purgeTrash();
    if (!loaded || loaded.fromBackup) {
      store.dirty = true;
      await store.flush();
    }
    return store;
  }

  get rev(): number {
    return this.file.rev;
  }

  get board(): Board {
    return this.file.board;
  }

  snapshot(): Snapshot {
    return { epoch: this.epoch, rev: this.file.rev, board: this.file.board };
  }

  /** The devices set up as wall screens. */
  get screens(): ScreenEntry[] {
    return this.file.screens;
  }

  /** Sets up a wall screen (or returns the one with this id). Not a board change: no new revision. */
  addScreen(name: string, id: string = newId()): ScreenEntry {
    const existing = this.file.screens.find(screen => screen.id === id);
    if (existing) return existing;
    if (this.file.screens.length >= MAX_SCREENS) throw new StoreError(409, `There can be at most ${MAX_SCREENS} wall screens`);
    const screen: ScreenEntry = { id, name, addedAt: this.now().toISOString() };
    this.file = { ...this.file, screens: [...this.file.screens, screen] };
    this.scheduleSave();
    return screen;
  }

  renameScreen(id: string, name: string): ScreenEntry {
    const screen = this.file.screens.find(entry => entry.id === id);
    if (!screen) throw new StoreError(404, 'That wall screen was removed');
    const renamed = { ...screen, name };
    this.file = { ...this.file, screens: this.file.screens.map(entry => (entry === screen ? renamed : entry)) };
    this.scheduleSave();
    return renamed;
  }

  removeScreen(id: string): void {
    if (!this.file.screens.some(entry => entry.id === id)) return;
    this.file = { ...this.file, screens: this.file.screens.filter(entry => entry.id !== id) };
    this.scheduleSave();
  }

  /** Notes when a wall screen last showed the wall (saved now and then, not on every check-in). */
  markScreenSeen(id: string, at: Date): void {
    const screen = this.file.screens.find(entry => entry.id === id);
    if (!screen) return;
    if (screen.lastSeenAt && at.getTime() - Date.parse(screen.lastSeenAt) < SEEN_SAVE_MS) return;
    const seen = { ...screen, lastSeenAt: at.toISOString() };
    this.file = { ...this.file, screens: this.file.screens.map(entry => (entry === screen ? seen : entry)) };
    this.scheduleSave();
  }

  /** Everything, including the trash, for a backup download. */
  exportFile(): SavedFile {
    return { ...this.file, savedAt: this.now().toISOString() };
  }

  subscribe(listener: (rev: number) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Checks and applies one change, and returns the new revision. Throws a StoreError
   * (400 / 404 / 409) when the change can't be made.
   */
  apply(op: ServerOp): number {
    const now = this.now();
    const stamp = now.toISOString();
    const { board, trash } = this.file;
    let change: ServerOp = op;
    let nextTrash: Trash = trash;

    switch (op.type) {
      case 'note.add': {
        if (board.notes.some(note => note.id === op.note.id)) throw new StoreError(409, 'That note is already on the board');
        this.lane(op.note.laneId);
        const { parentId, ...rest } = op.note;
        // A note can't be a related task of itself.
        change = { ...op, note: { ...(parentId === op.note.id ? rest : op.note), updatedAt: stamp } };
        nextTrash = { ...trash, notes: trash.notes.filter(entry => entry.note.id !== op.note.id) };
        break;
      }

      case 'note.patch':
        this.note(op.id);
        if (op.patch.laneId !== undefined) this.lane(op.patch.laneId);
        if (op.patch.parentId === op.id) throw new StoreError(400, 'A note can’t be a related task of itself');
        break;

      case 'note.delete': {
        const note = this.note(op.id);
        nextTrash = { ...trash, notes: [...trash.notes.filter(entry => entry.note.id !== note.id), { note, deletedAt: stamp }] };
        break;
      }

      case 'note.restore': {
        if (board.notes.some(note => note.id === op.id)) return this.rev;
        const entry = trash.notes.find(item => item.note.id === op.id);
        if (!entry) throw new StoreError(404, 'That note is no longer in the trash');
        // If its column was deleted since, it goes back into the first column.
        const laneId = board.lanes.some(lane => lane.id === entry.note.laneId) ? entry.note.laneId : lanesInOrder(board.lanes)[0]!.id;
        change = { type: 'note.restore', id: op.id, note: { ...entry.note, laneId, updatedAt: stamp } };
        nextTrash = { ...trash, notes: trash.notes.filter(item => item !== entry) };
        break;
      }

      case 'note.completions': {
        this.note(op.id);
        const latest = now.getTime() + DAY_MS;
        if ((op.add ?? []).some(iso => Date.parse(iso) > latest)) throw new StoreError(400, 'That time is in the future');
        break;
      }

      case 'lane.add':
        if (board.lanes.some(lane => lane.id === op.lane.id)) throw new StoreError(409, 'That column already exists');
        break;

      case 'lane.patch':
        this.lane(op.id);
        break;

      case 'lane.delete': {
        const lane = this.lane(op.id);
        if (board.lanes.length <= 1) throw new StoreError(409, 'The board needs at least one column');
        const notes = board.notes.filter(note => note.laneId === lane.id);
        nextTrash = { ...trash, lanes: [...trash.lanes.filter(entry => entry.lane.id !== lane.id), { lane, notes, deletedAt: stamp }] };
        break;
      }

      case 'lane.restore': {
        if (board.lanes.some(lane => lane.id === op.id)) return this.rev;
        const entry = trash.lanes.find(item => item.lane.id === op.id);
        if (!entry) throw new StoreError(404, 'That column is no longer in the trash');
        change = { type: 'lane.restore', id: op.id, lane: entry.lane, notes: entry.notes };
        nextTrash = { ...trash, lanes: trash.lanes.filter(item => item !== entry) };
        break;
      }

      case 'lane.order':
        break;

      case 'goal.add':
        if (board.goals.some(goal => goal.id === op.goal.id)) throw new StoreError(409, 'That goal already exists');
        break;

      case 'goal.patch':
        this.goal(op.id);
        break;

      case 'goal.delete': {
        const goal = this.goal(op.id);
        nextTrash = { ...trash, goals: [...trash.goals.filter(entry => entry.goal.id !== goal.id), { goal, deletedAt: stamp }] };
        break;
      }

      case 'goal.restore': {
        if (board.goals.some(goal => goal.id === op.id)) return this.rev;
        const entry = trash.goals.find(item => item.goal.id === op.id);
        if (!entry) throw new StoreError(404, 'That goal is no longer in the trash');
        change = { type: 'goal.restore', id: op.id, goal: entry.goal };
        nextTrash = { ...trash, goals: trash.goals.filter(item => item !== entry) };
        break;
      }

      case 'settings.patch':
        break;

      case 'alert.fire':
        this.note(op.noteId);
        if (board.alerts.some(alert => alert.id === op.id)) throw new StoreError(409, 'That reminder is already showing');
        break;

      case 'alert.dismiss': // already gone (it timed out, or another phone got there first) is fine
      case 'reminders.tick':
      case 'ai.state':
        break;

      case 'ai.report':
        this.note(op.noteId);
        break;
    }

    const next = applyOp(board, change, now);
    if (next === board && nextTrash === trash) return this.rev; // nothing to change
    // Belt and braces: never keep (or save) a board that doesn't pass the schema.
    const checked = boardSchema.safeParse(next);
    if (!checked.success) throw new StoreError(400, describeIssues(checked.error));

    this.file = { ...this.file, rev: this.file.rev + 1, board: next, trash: nextTrash };
    this.scheduleSave();
    for (const listener of this.listeners) listener(this.file.rev);
    return this.file.rev;
  }

  private note(id: string): Note {
    const note = this.file.board.notes.find(n => n.id === id);
    if (!note) throw new StoreError(404, 'That note is not on the board');
    return note;
  }

  private lane(id: string): Lane {
    const lane = this.file.board.lanes.find(l => l.id === id);
    if (!lane) throw new StoreError(400, 'That column does not exist');
    return lane;
  }

  private goal(id: string): Goal {
    const goal = this.file.board.goals.find(g => g.id === id);
    if (!goal) throw new StoreError(404, 'That goal is not on the board');
    return goal;
  }

  private purgeTrash(): void {
    const cutoff = this.now().getTime() - this.options.trashDays * DAY_MS;
    const keep = (entry: { deletedAt: string }) => Date.parse(entry.deletedAt) >= cutoff;
    const { trash } = this.file;
    this.file = {
      ...this.file,
      trash: { notes: trash.notes.filter(keep), lanes: trash.lanes.filter(keep), goals: trash.goals.filter(keep) },
    };
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush().catch(error => this.log(`Could not save the board: ${String(error)}`));
    }, this.options.saveDelayMs);
  }

  private serialize(): string {
    this.purgeTrash();
    this.file = { ...this.file, savedAt: this.now().toISOString() };
    return `${JSON.stringify(this.file, null, 2)}\n`;
  }

  /** Writes any unsaved change now. */
  async flush(): Promise<void> {
    while (this.saving) await this.saving.catch(() => {});
    if (!this.dirty) return;
    this.dirty = false;
    const data = this.serialize();
    this.saving = this.write(data);
    try {
      await this.saving;
    } catch (error) {
      this.dirty = true;
      throw error;
    } finally {
      this.saving = null;
    }
  }

  private async write(data: string): Promise<void> {
    await this.backupIfDue();
    const target = join(this.dir, 'board.json');
    const temp = `${target}.tmp`;
    const handle = await open(temp, 'w');
    try {
      await handle.writeFile(data, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, target);
  }

  /** On shutdown: save synchronously, even if an async save was still running. */
  flushSync(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.dirty && !this.saving) return;
    const target = join(this.dir, 'board.json');
    const temp = `${target}.tmp-exit`;
    const fd = openSync(temp, 'w');
    try {
      writeSync(fd, this.serialize());
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, target);
    this.dirty = false;
  }

  async close(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    await this.flush();
    this.listeners.clear();
  }

  /** The first save of each day keeps a copy of the file as it was, in backups/. */
  private async backupIfDue(): Promise<void> {
    const today = format(this.now(), 'yyyy-MM-dd');
    if (this.lastBackupDay === today) return;
    const current = join(this.dir, 'board.json');
    const backup = join(this.dir, 'backups', `board-${today}.json`);
    if (existsSync(current) && !existsSync(backup)) await copyFile(current, backup);
    this.lastBackupDay = today;
    const names = (await readdir(join(this.dir, 'backups'))).filter(name => BACKUP_NAME.test(name)).sort();
    const extra = names.slice(0, Math.max(0, names.length - this.options.keepBackups));
    await Promise.all(extra.map(name => unlink(join(this.dir, 'backups', name))));
  }
}

/** Reads board.json. A damaged file is set aside and the newest good backup is used. */
async function loadSaved(dir: string, log: (message: string) => void): Promise<{ file: SavedFile; fromBackup: boolean } | null> {
  const path = join(dir, 'board.json');
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const parsed = parseSaved(raw);
  if (parsed.ok) return { file: parsed.file, fromBackup: false };

  const aside = `board.damaged-${format(new Date(), 'yyyyMMdd-HHmmss')}.json`;
  await rename(path, join(dir, aside));
  log(`board.json could not be read (${parsed.error}). It was moved to ${aside}.`);
  const backups = (await readdir(join(dir, 'backups'))).filter(name => BACKUP_NAME.test(name)).sort().reverse();
  for (const name of backups) {
    const backup = parseSaved(await readFile(join(dir, 'backups', name), 'utf8'));
    if (backup.ok) {
      log(`Restored the board from backups/${name}.`);
      return { file: backup.file, fromBackup: true };
    }
  }
  log('No usable backup was found, so the board starts empty.');
  return null;
}
