import { createHmac } from 'node:crypto';
import { AI_AGENT_PROMPT, AI_KIND_LABEL, AI_REPORT_WAIT_MS, aiDue, describeAiSchedule, wakeText } from '../shared/ai.ts';
import type { AiTestResult } from '../shared/api.ts';
import type { AiState, Note } from '../shared/types.ts';
import type { AiConnection, AiConnections } from './aiConnections.ts';
import type { BoardStore } from './store.ts';

// Waking an AI when a sticky handed to it is due. MCP only lets the AI start the
// conversation, so the board knocks first: it fires a Claude routine, calls OpenClaw's
// hook, or posts to a webhook, saying which stickies are due. The AI then connects over
// MCP, does them and reports back. ("Checks in on its own" connections are never woken:
// the AI runs on its own schedule and asks what's due.)
//
// Every minute (and soon after any change, so Run now is quick):
// - stickies waiting longer than 45 minutes for a report are given up on;
// - due stickies are grouped by the connection that does them, and each connection is
//   woken at most once a minute, within the day's limit (settings.ai.dailyCap);
// - a wrong token or address stops wake-ups for that connection until it's fixed, a busy
//   one is left alone for as long as it asks, and one that can't be reached is tried
//   again later, waiting longer each time (up to an hour).

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** Most stickies named in one wake-up (a routine's message can be at most 64 KB). */
const MAX_TASKS_PER_WAKE = 20;
const WAKE_TIMEOUT_MS = 15_000;
const MINUTE_MS = 60_000;
const MAX_BACKOFF_MS = 60 * MINUTE_MS;
const USER_AGENT = 'DigitalSticky/1 (sticky wall)';

export interface WakeRequest {
  url: string;
  init: { method: 'POST'; headers: Record<string, string>; body: string };
}

/** What a wake-up says when it's only a test (from the Wall tab). */
export const TEST_TEXT =
  'Sticky Wall: this is a test from the board’s AI helper settings, to check that the board can wake you. Don’t do any tasks now. If you can, call list_ai_tasks with dueOnly set to false to check that you can reach the board, then stop.';

/** OpenClaw's address may be given with or without its hook path. */
function openClawHook(url: string): string {
  const parsed = new URL(url);
  if (!/\/hooks\/agent\/?$/.test(parsed.pathname)) parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/hooks/agent`;
  return parsed.toString();
}

/** The request that wakes a connection, for these stickies (none: a test). */
export function wakeRequest(connection: AiConnection, tasks: Note[], mcpUrl: string | null, now: Date): WakeRequest {
  const named = tasks.slice(0, MAX_TASKS_PER_WAKE);
  const json: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT };
  const bearer: Record<string, string> = connection.token ? { Authorization: `Bearer ${connection.token}` } : {};
  switch (connection.kind) {
    case 'routine':
      // The routine's own prompt says what to do (AI_AGENT_PROMPT); this says what's due.
      return {
        url: connection.url!,
        init: {
          method: 'POST',
          headers: { ...json, ...bearer, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ text: named.length ? wakeText(named, false) : TEST_TEXT }),
        },
      };
    case 'openclaw':
      return {
        url: openClawHook(connection.url!),
        init: {
          method: 'POST',
          headers: { ...json, ...bearer },
          body: JSON.stringify({ message: named.length ? wakeText(named, true) : TEST_TEXT, name: 'Sticky Wall' }),
        },
      };
    default: {
      const body = JSON.stringify({
        event: named.length ? 'ai.tasks_due' : 'ai.test',
        sentAt: now.toISOString(),
        tasks: named.map(note => ({ id: note.id, title: note.title, instructions: note.ai?.instructions ?? '', schedule: note.ai ? describeAiSchedule(note.ai) : '' })),
        mcpUrl,
        prompt: AI_AGENT_PROMPT,
      });
      const signature: Record<string, string> = connection.token
        ? { 'X-Sticky-Signature': `sha256=${createHmac('sha256', connection.token).update(body).digest('hex')}` }
        : {};
      return { url: connection.url!, init: { method: 'POST', headers: { ...json, ...signature }, body } };
    }
  }
}

export interface WakeResult {
  ok: boolean;
  message: string;
  /** Where to watch the run, when the AI says. */
  url?: string;
  /** Needs fixing before trying again (a wrong token, a paused routine). */
  problem?: string;
  /** Busy: when to try again. */
  retryAfterMs?: number;
}

function webAddress(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:' ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Sends a wake-up and says how it went, in words for the Wall tab. */
export async function sendWake(fetcher: Fetch, connection: AiConnection, request: WakeRequest): Promise<WakeResult> {
  const label = AI_KIND_LABEL[connection.kind];
  let response: Response;
  try {
    response = await fetcher(request.url, { ...request.init, signal: AbortSignal.timeout(WAKE_TIMEOUT_MS), redirect: 'error' });
  } catch (error) {
    const timedOut = (error as Error).name === 'TimeoutError';
    return { ok: false, message: timedOut ? `${label} didn’t answer in time.` : `Couldn’t reach ${label} at that address.` };
  }
  const text = await response.text().catch(() => '');
  if (response.ok) {
    let url: string | undefined;
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      url = webAddress(json.claude_code_session_url) ?? webAddress(json.session_url) ?? webAddress(json.url);
    } catch {
      // No JSON answer is fine.
    }
    return { ok: true, message: 'Woken up.', ...(url ? { url } : {}) };
  }
  const status = response.status;
  if (status === 429) {
    const seconds = Number(response.headers.get('Retry-After'));
    const retryAfterMs = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 24 * 60 * MINUTE_MS) : MINUTE_MS;
    return { ok: false, message: `${label} is busy (too many runs). Trying again in ${Math.ceil(retryAfterMs / MINUTE_MS)} min.`, retryAfterMs };
  }
  if (status === 401 || status === 403) {
    const fix = connection.kind === 'routine' ? 'Make a new token in the routine’s API trigger and paste it here.' : 'Check the token and paste it again.';
    return { ok: false, message: `${label} didn’t accept the token (${status}).`, problem: `It didn’t accept the token. ${fix}` };
  }
  if (status === 404) {
    return { ok: false, message: `Nothing was found at that address (404).`, problem: 'Nothing was found at its address. Check the address and paste it again.' };
  }
  if (status >= 400 && status < 500 && status !== 408) {
    if (/paused|disabled|inactive/i.test(text)) {
      return { ok: false, message: `The routine is paused (${status}).`, problem: 'The routine is paused. Turn it back on in Claude, then send a test.' };
    }
    return { ok: false, message: `${label} said no (${status}).`, problem: `It refused the wake-up (${status}). Check its settings, then send a test.` };
  }
  return { ok: false, message: `${label} had a problem (${status}).` };
}

export interface AiRunnerOptions {
  store: BoardStore;
  connections: AiConnections;
  /** The board's MCP link (with its secret) for webhooks to pass on, or null. */
  mcpUrl: () => string | null;
  fetch?: Fetch;
  log?: (message: string) => void;
  tickMs?: number;
}

export class AiRunner {
  private readonly store: BoardStore;
  private readonly connections: AiConnections;
  private readonly mcpUrl: () => string | null;
  private readonly fetcher: Fetch;
  private readonly log: (message: string) => void;
  private readonly tickMs: number;
  /** Per connection: busy or unreachable until then. */
  private readonly blockedUntil = new Map<string, number>();
  private readonly failures = new Map<string, number>();
  private readonly lastWakeAt = new Map<string, number>();
  private running: Promise<void> | null = null;
  private again = false;
  private pokeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: AiRunnerOptions) {
    this.store = options.store;
    this.connections = options.connections;
    this.mcpUrl = options.mcpUrl;
    this.fetcher = options.fetch ?? ((url, init) => fetch(url, init));
    this.log = options.log ?? (() => {});
    this.tickMs = options.tickMs ?? MINUTE_MS;
  }

  /** Checks now, every minute, and soon after any change. Returns stop. */
  start(): () => void {
    const timer = setInterval(() => void this.tick(), this.tickMs);
    timer.unref();
    const offStore = this.store.subscribe(() => this.poke());
    const offConnections = this.connections.subscribe(() => this.poke());
    void this.tick();
    return () => {
      clearInterval(timer);
      if (this.pokeTimer) clearTimeout(this.pokeTimer);
      offStore();
      offConnections();
    };
  }

  /** Checks again in a moment (several changes in a row make one check). */
  poke(): void {
    if (this.pokeTimer) return;
    this.pokeTimer = setTimeout(() => {
      this.pokeTimer = null;
      void this.tick();
    }, 1000);
    this.pokeTimer.unref?.();
  }

  /** One check. Overlapping calls wait for the one running, then check again once. */
  async tick(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        try {
          await this.check();
        } catch (error) {
          this.log(`AI helper: ${error instanceof Error ? error.message : String(error)}`);
        }
      } while (this.again);
    })();
    try {
      await this.running;
    } finally {
      this.running = null;
    }
  }

  /** "Send a test" in the Wall tab: wakes the connection with nothing due. */
  async test(id: string): Promise<AiTestResult> {
    const connection = this.connections.get(id);
    if (!connection) return { ok: false, message: 'That connection was removed.' };
    if (connection.kind === 'self') return { ok: true, message: 'This one isn’t woken up: it checks in on its own.' };
    const now = this.store.now();
    const result = await sendWake(this.fetcher, connection, wakeRequest(connection, [], this.mcpUrl(), now));
    if (result.ok) await this.connections.countWake(now);
    await this.connections.noteWake(id, this.lastWake(now, result), result.ok ? null : (result.problem ?? null));
    return { ok: result.ok, message: result.ok ? `${AI_KIND_LABEL[connection.kind]} was woken up.` : result.message, ...(result.url ? { url: result.url } : {}) };
  }

  private lastWake(now: Date, result: WakeResult) {
    return { at: now.toISOString(), ok: result.ok, message: result.message, ...(result.url ? { url: result.url } : {}) };
  }

  /** Sets what the AI is doing on these stickies, leaving ones that already say so. */
  private setState(notes: Note[], state: AiState | null): void {
    const ids = notes
      .filter(note => (state ? note.aiState?.status !== state.status || note.aiState.message !== state.message : note.aiState !== undefined))
      .map(note => note.id);
    if (ids.length) this.store.apply({ type: 'ai.state', ids, state });
  }

  /** Due, and not already waiting for a report (or given up on since its last due time). */
  private wanted(note: Note, now: Date): boolean {
    if (!aiDue(note, now)) return false;
    const state = note.aiState;
    if (!state || state.status === 'needs-setup') return true;
    if (state.status === 'error') return aiDue({ ...note, aiLog: [{ id: '', at: state.since, status: 'error', summary: '', links: [], added: [] }] }, now);
    return false;
  }

  private async check(): Promise<void> {
    const now = this.store.now();
    const time = now.getTime();
    const board = this.store.board;

    // Waited too long for a report: given up on, until Run now or the next due time.
    for (const note of board.notes) {
      const state = note.aiState;
      if ((state?.status === 'queued' || state?.status === 'running') && time - Date.parse(state.since) >= AI_REPORT_WAIT_MS) {
        this.setState([note], {
          status: 'error',
          message: `No report came back from ${state.by ?? 'the AI'}. Tap Run now to try again.`,
          since: now.toISOString(),
          ...(state.by ? { by: state.by } : {}),
          ...(state.url ? { url: state.url } : {}),
        });
      }
    }

    const due = this.store.board.notes.filter(note => this.wanted(note, now));
    if (!due.length) return;
    const needsSetup = (notes: Note[], message: string) => this.setState(notes, { status: 'needs-setup', message, since: now.toISOString() });
    if (!board.settings.ai.connect) {
      needsSetup(due, 'The AI connection is off. Turn it on in Wall → AI helper.');
      return;
    }

    const groups = new Map<string, { connection: AiConnection; notes: Note[] }>();
    for (const note of due) {
      const connection = this.connections.forSticky(note.ai?.by);
      if (!connection) needsSetup([note], 'No AI is connected to the board yet. Add one in Wall → AI helper.');
      else if (connection.problem) needsSetup([note], `${connection.name}: ${connection.problem}`);
      else if (connection.kind === 'self') {
        // It asks what's due when it checks in.
        if (note.aiState?.status === 'needs-setup') this.setState([note], null);
      } else {
        const group = groups.get(connection.id) ?? { connection, notes: [] };
        group.notes.push(note);
        groups.set(connection.id, group);
      }
    }

    for (const { connection, notes } of groups.values()) {
      this.setState(
        notes.filter(note => note.aiState?.status === 'needs-setup'),
        null,
      );
      if ((this.blockedUntil.get(connection.id) ?? 0) > time) continue;
      if (time - (this.lastWakeAt.get(connection.id) ?? -Infinity) < MINUTE_MS) continue;
      if (this.connections.wakesOn(now) >= board.settings.ai.dailyCap) continue;
      await this.wake(connection, notes, now);
    }
  }

  private async wake(connection: AiConnection, notes: Note[], now: Date): Promise<void> {
    const time = now.getTime();
    this.lastWakeAt.set(connection.id, time);
    const result = await sendWake(this.fetcher, connection, wakeRequest(connection, notes, this.mcpUrl(), now));
    // The board may have moved on while waiting for the answer.
    const ids = new Set(notes.map(note => note.id));
    const current = this.store.board.notes.filter(note => ids.has(note.id));
    if (result.ok) {
      this.failures.delete(connection.id);
      this.blockedUntil.delete(connection.id);
      await this.connections.countWake(now);
      await this.connections.noteWake(connection.id, this.lastWake(now, result), null);
      this.setState(current, {
        status: 'queued',
        message: `Asked ${connection.name}. Waiting for its report.`,
        since: now.toISOString(),
        by: connection.name,
        ...(result.url ? { url: result.url } : {}),
      });
      this.log(`AI helper: woke ${connection.name} for ${notes.length} ${notes.length === 1 ? 'sticky' : 'stickies'}.`);
      return;
    }
    await this.connections.noteWake(connection.id, this.lastWake(now, result), result.problem ?? null);
    if (result.problem) {
      this.setState(current, { status: 'needs-setup', message: `${connection.name}: ${result.problem}`, since: now.toISOString() });
    } else if (result.retryAfterMs) {
      this.blockedUntil.set(connection.id, time + result.retryAfterMs);
    } else {
      const failures = (this.failures.get(connection.id) ?? 0) + 1;
      this.failures.set(connection.id, failures);
      this.blockedUntil.set(connection.id, time + Math.min(MAX_BACKOFF_MS, MINUTE_MS * 2 ** (failures - 1)));
    }
    this.log(`AI helper: couldn’t wake ${connection.name}: ${result.message}`);
  }
}
