import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { format } from 'date-fns';
import { z } from 'zod';
import { AI_CONNECTION_KINDS, AI_KIND_LABEL, type AiConnectionKind } from '../shared/ai.ts';
import type { AiConnectionInfo } from '../shared/api.ts';
import { MAX_AI_CONNECTIONS, type AiConnectionInput } from '../shared/schema.ts';
import { newId, StoreError } from './store.ts';

// The AIs the board can wake up when a task is due, kept in <data>/ai-connections.json
// (readable only by you: it holds their tokens). Tokens never go back to browsers;
// the Wall tab shows their last 4 characters.

const FILE = 'ai-connections.json';
/** "Last used" over MCP is saved at most this often (an AI makes several calls a run). */
const USED_SAVE_MS = 10 * 60_000;

const lastWakeSchema = z.object({ at: z.string(), ok: z.boolean(), message: z.string(), url: z.string().optional() });

const connectionSchema = z.object({
  id: z.string(),
  kind: z.enum(AI_CONNECTION_KINDS),
  name: z.string(),
  url: z.string().optional(),
  token: z.string().optional(),
  createdAt: z.string(),
  /** Wake-ups stop until this is fixed: it's edited, or a test works. */
  problem: z.string().optional(),
  lastWake: lastWakeSchema.optional(),
});

const fileSchema = z.object({
  version: z.literal(1),
  defaultId: z.string().nullable(),
  connections: z.array(connectionSchema),
  /** Wake-ups on one day (yyyy-MM-dd, the wall computer's time), for the daily limit. */
  wakes: z.object({ day: z.string(), count: z.number().int().min(0) }),
  lastUsed: z.object({ at: z.string(), client: z.string() }).nullable(),
});

export type AiConnection = z.infer<typeof connectionSchema>;
type AiFile = z.infer<typeof fileSchema>;
export type LastWake = z.infer<typeof lastWakeSchema>;

const emptyFile = (): AiFile => ({ version: 1, defaultId: null, connections: [], wakes: { day: '', count: 0 }, lastUsed: null });

/** What each kind needs. */
const NEEDS: Record<AiConnectionKind, { url: boolean; token: boolean }> = {
  routine: { url: true, token: true },
  openclaw: { url: true, token: true },
  webhook: { url: true, token: false },
  self: { url: false, token: false },
};

export class AiConnections {
  private file: AiFile;
  private readonly path: string;
  private writing: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  private constructor(path: string, file: AiFile) {
    this.path = path;
    this.file = file;
  }

  /** Reads the saved connections (none yet is fine; a damaged file is replaced, with a note in the log). */
  static async open(dataDir: string, log: (message: string) => void = () => {}): Promise<AiConnections> {
    const path = join(dataDir, FILE);
    let file = emptyFile();
    try {
      const parsed = fileSchema.safeParse(JSON.parse(await readFile(path, 'utf8')));
      if (parsed.success) file = parsed.data;
      else log(`${FILE} could not be read, so the AI connections start empty.`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') log(`${FILE} could not be read (${String(error)}), so the AI connections start empty.`);
    }
    return new AiConnections(path, file);
  }

  /** Called when connections change (the app tells open screens). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get all(): readonly AiConnection[] {
    return this.file.connections;
  }

  get(id: string): AiConnection | undefined {
    return this.file.connections.find(connection => connection.id === id);
  }

  /** The connection that does a sticky: the one it names, or the default. */
  forSticky(by: string | undefined): AiConnection | null {
    return (by && this.get(by)) || (this.file.defaultId ? (this.get(this.file.defaultId) ?? null) : null);
  }

  /** What browsers may see. */
  info(): AiConnectionInfo[] {
    return this.file.connections.map(connection => ({
      id: connection.id,
      kind: connection.kind,
      name: connection.name,
      url: connection.url ?? null,
      tokenEnd: connection.token ? connection.token.slice(-4) : null,
      isDefault: connection.id === this.file.defaultId,
      problem: connection.problem ?? null,
      lastWake: connection.lastWake ?? null,
    }));
  }

  /** Adds or changes a connection. A token left out keeps the saved one. */
  async put(id: string, input: AiConnectionInput, now: Date): Promise<AiConnection> {
    const existing = this.get(id);
    if (!existing && this.file.connections.length >= MAX_AI_CONNECTIONS) throw new StoreError(409, `There can be at most ${MAX_AI_CONNECTIONS} AI connections`);
    const needs = NEEDS[input.kind];
    const url = needs.url ? input.url || undefined : undefined;
    const token = input.token === undefined ? (existing?.kind === input.kind ? existing.token : undefined) : input.token || undefined;
    const label = AI_KIND_LABEL[input.kind];
    if (needs.url && !url) throw new StoreError(400, `${label}: paste its address`);
    if (needs.token && !token) throw new StoreError(400, `${label}: paste its token`);
    const connection: AiConnection = {
      id,
      kind: input.kind,
      name: input.name,
      ...(url ? { url } : {}),
      ...(token && input.kind !== 'self' ? { token } : {}),
      createdAt: existing?.createdAt ?? now.toISOString(),
      // Any problem is left behind: changed, it gets another go.
      ...(existing?.lastWake ? { lastWake: existing.lastWake } : {}),
    };
    const connections = existing ? this.file.connections.map(c => (c === existing ? connection : c)) : [...this.file.connections, connection];
    const makeDefault = input.makeDefault || !this.file.defaultId || !connections.some(c => c.id === this.file.defaultId);
    this.file = { ...this.file, connections, defaultId: makeDefault ? id : this.file.defaultId };
    await this.save();
    return connection;
  }

  async remove(id: string): Promise<void> {
    if (!this.get(id)) return;
    const connections = this.file.connections.filter(connection => connection.id !== id);
    const defaultId = this.file.defaultId === id ? (connections[0]?.id ?? null) : this.file.defaultId;
    this.file = { ...this.file, connections, defaultId };
    await this.save();
  }

  /** Notes how waking it went; `problem` stops wake-ups until it's fixed (and a success clears it). */
  async noteWake(id: string, lastWake: LastWake, problem: string | null): Promise<void> {
    const connection = this.get(id);
    if (!connection) return;
    const { problem: _old, ...rest } = connection;
    const next: AiConnection = { ...rest, lastWake, ...(problem ? { problem } : {}) };
    this.file = { ...this.file, connections: this.file.connections.map(c => (c === connection ? next : c)) };
    await this.save();
  }

  /** Wake-ups so far on `now`'s day. */
  wakesOn(now: Date): number {
    return this.file.wakes.day === format(now, 'yyyy-MM-dd') ? this.file.wakes.count : 0;
  }

  async countWake(now: Date): Promise<void> {
    this.file = { ...this.file, wakes: { day: format(now, 'yyyy-MM-dd'), count: this.wakesOn(now) + 1 } };
    await this.save();
  }

  get lastUsed(): { at: string; client: string } | null {
    return this.file.lastUsed;
  }

  /** An AI used the board over MCP (saved now and then, not on every call). */
  used(client: string, now: Date): void {
    const last = this.file.lastUsed;
    const quiet = last && last.client === client && now.getTime() - Date.parse(last.at) < USED_SAVE_MS;
    this.file = { ...this.file, lastUsed: { at: now.toISOString(), client } };
    if (!quiet) void this.save().catch(() => {});
  }

  /** Waits for any write in progress (tests, and shutting down). */
  flush(): Promise<void> {
    return this.writing;
  }

  private save(): Promise<void> {
    const data = `${JSON.stringify(this.file, null, 2)}\n`;
    this.writing = this.writing
      .catch(() => {})
      .then(async () => {
        const temp = `${this.path}.${process.pid}.${newId()}.tmp`;
        await writeFile(temp, data, { mode: 0o600 });
        await rename(temp, this.path);
      });
    for (const listener of this.listeners) listener();
    return this.writing;
  }
}
