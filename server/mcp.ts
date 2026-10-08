import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CLIENT_INFO_META_KEY, createMcpHandler, McpServer, type CallToolResult, type McpHttpHandler, type ServerContext } from '@modelcontextprotocol/server';
import { format } from 'date-fns';
import { z } from 'zod';
import { AI_AGENT_PROMPT, aiDue, describeAiSchedule } from '../shared/ai.ts';
import { lanesInOrder } from '../shared/board.ts';
import type { Board, Note } from '../shared/types.ts';
import type { AiConnections } from './aiConnections.ts';
import { aiReportInput, AiReportError, buildAiReport } from './aiReport.ts';
import type { BoardStore } from './store.ts';

// The board's MCP server: any AI that speaks MCP (a Claude routine through a custom
// connector, Claude Code, Claude Desktop, OpenClaw…) connects to /mcp/<secret> to read
// the stickies handed to it and report back. It can read the board and report on its
// own stickies, nothing else: it can't delete or change other stickies.
//
// The address is the sign-in: a long random secret, kept in <data>/mcp-secret and
// changed with "Make a new link". It only works while "Let an AI connect" is on.

const SECRET_FILE = 'mcp-secret';
const SECRET = /^[A-Za-z0-9_-]{43}$/;
/** Most stickies list_stickies sends back. */
const MAX_LISTED = 100;
/** Largest MCP request the board reads. */
export const MCP_BODY_LIMIT = 256 * 1024;
/** Set by the board (never taken from outside): the name the AI gave when it connected. */
export const MCP_CLIENT_HEADER = 'x-sticky-mcp-client';

/** The secret in the board's MCP address. */
export class McpSecret {
  private value: string;
  private readonly path: string;

  private constructor(path: string, value: string) {
    this.path = path;
    this.value = value;
  }

  static async open(dataDir: string): Promise<McpSecret> {
    const path = join(dataDir, SECRET_FILE);
    try {
      const value = (await readFile(path, 'utf8')).trim();
      if (SECRET.test(value)) return new McpSecret(path, value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const secret = new McpSecret(path, '');
    await secret.rotate();
    return secret;
  }

  get current(): string {
    return this.value;
  }

  matches(candidate: string): boolean {
    const a = Buffer.from(candidate);
    const b = Buffer.from(this.value);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** A new secret: AIs using the old address stop getting in. */
  async rotate(): Promise<string> {
    const value = randomBytes(32).toString('base64url');
    const temp = `${this.path}.${process.pid}.tmp`;
    await writeFile(temp, `${value}\n`, { mode: 0o600 });
    await rename(temp, this.path);
    this.value = value;
    return value;
  }
}

const KNOWN_CLIENTS: Record<string, string> = {
  'claude-code': 'Claude Code',
  'claude-ai': 'Claude',
  claude: 'Claude',
  openclaw: 'OpenClaw',
};

/** Who's calling, for "Last used by Claude Code at 8:02 AM" (what the client says about itself). */
function clientName(ctx: ServerContext, server: McpServer): string {
  const envelope = ctx.mcpReq.envelope as Record<string, unknown> | undefined;
  const info = (envelope?.[CLIENT_INFO_META_KEY] as { name?: unknown; title?: unknown } | undefined) ?? server.server.getClientVersion();
  const raw = typeof info?.title === 'string' ? info.title : typeof info?.name === 'string' ? info.name : '';
  const headers = ctx.http?.req?.headers;
  const agent = headers?.get('user-agent')?.split(/[ /]/)[0] ?? '';
  const name = (raw || headers?.get(MCP_CLIENT_HEADER) || agent).trim().slice(0, 60);
  return KNOWN_CLIENTS[name.toLowerCase()] ?? (name || 'An AI');
}

const text = (value: unknown): CallToolResult => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const refuse = (message: string): CallToolResult => ({ content: [{ type: 'text', text: message }], isError: true });

function laneTitle(board: Board, id: string): string {
  return board.lanes.find(lane => lane.id === id)?.title ?? '';
}

/** A sticky for an AI to read. */
function describeSticky(board: Board, note: Note) {
  const related = board.notes.filter(n => n.parentId === note.id);
  const parent = note.parentId ? board.notes.find(n => n.id === note.parentId) : undefined;
  return {
    stickyId: note.id,
    title: note.title,
    column: laneTitle(board, note.laneId),
    ...(note.body ? { notes: note.body } : {}),
    ...(note.due ? { deadline: note.due } : {}),
    ...(note.remindAt ? { reminder: note.remindAt } : {}),
    ...(note.stage ? { stage: note.stage } : {}),
    ...(note.funder ? { to: note.funder } : {}),
    ...(note.amount ? { amount: note.amount } : {}),
    done: note.done,
    checklist: note.checklist.map(item => ({ id: item.id, text: item.text, done: item.done })),
    sources: note.links.map(link => ({ url: link.url, ...(link.label ? { label: link.label } : {}), checked: link.verified })),
    ...(parent ? { partOf: { stickyId: parent.id, title: parent.title } } : {}),
    relatedStickies: related.map(n => ({ stickyId: n.id, title: n.title, done: n.done })),
  };
}

export interface McpOptions {
  store: BoardStore;
  connections: AiConnections;
}

/** Builds the MCP server's tools over the board. */
function buildServer({ store, connections }: McpOptions): McpServer {
  const server = new McpServer({ name: 'sticky-wall', title: 'Sticky Wall', version: '1.0.0' }, { instructions: AI_AGENT_PROMPT });
  const used = (ctx: ServerContext) => {
    const name = clientName(ctx, server);
    connections.used(name, store.now());
    return name;
  };

  server.registerTool(
    'list_ai_tasks',
    {
      title: 'List AI tasks',
      description:
        'The stickies handed to the AI helper: what to do (instructions), how often, what you may change, the sticky’s checklist and sources, its related stickies (so you don’t add them again) and your last report. By default only the ones due now.',
      inputSchema: z.object({ dueOnly: z.boolean().default(true).describe('Only the tasks that are due now (default). False lists them all.') }),
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async ({ dueOnly }, ctx) => {
      const name = used(ctx);
      const now = store.now();
      const board = store.board;
      const handed = board.notes.filter(note => note.ai && !note.done && (!dueOnly || aiDue(note, now)));
      // Picked up: the wall says it's being worked on, until the report comes in.
      for (const note of handed.filter(n => dueOnly && n.aiState?.status !== 'running')) {
        store.apply({
          type: 'ai.state',
          ids: [note.id],
          state: { status: 'running', message: `${name} is working on it.`, since: now.toISOString(), by: name, ...(note.aiState?.url ? { url: note.aiState.url } : {}) },
        });
      }
      return text({
        now: format(now, "EEEE, MMMM d, yyyy, h:mm a"),
        tasks: handed.map(note => {
          const ai = note.ai!;
          const last = note.aiLog?.[0];
          return {
            ...describeSticky(board, note),
            instructions: ai.instructions || note.title,
            schedule: describeAiSchedule(ai),
            due: aiDue(note, now),
            mayAddStickies: ai.mayAdd,
            mayEditChecklistAndSources: ai.mayEdit,
            lastReport: last ? { at: last.at, summary: last.summary } : null,
          };
        }),
        next: handed.length ? 'Do each task, then call report_ai_run once for each sticky.' : 'Nothing is due. You can stop here.',
      });
    },
  );

  server.registerTool(
    'get_sticky',
    {
      title: 'Get a sticky',
      description: 'One sticky in full: its notes, deadline, checklist, sources and related stickies.',
      inputSchema: z.object({ stickyId: z.string().max(64) }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ stickyId }, ctx) => {
      used(ctx);
      const board = store.board;
      const note = board.notes.find(n => n.id === stickyId);
      return note ? text(describeSticky(board, note)) : refuse('There’s no sticky with that id.');
    },
  );

  server.registerTool(
    'list_stickies',
    {
      title: 'List stickies',
      description: `The stickies on the board (at most ${MAX_LISTED}), to find related ones or avoid adding the same thing twice.`,
      inputSchema: z.object({
        column: z.string().max(80).optional().describe('Only this column, by name (like "To-do")'),
        query: z.string().max(200).optional().describe('Only stickies whose title or notes contain this'),
        includeDone: z.boolean().default(false),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ column, query, includeDone }, ctx) => {
      used(ctx);
      const board = store.board;
      const lanes = lanesInOrder(board.lanes);
      const lane = column ? lanes.find(l => l.title.toLowerCase() === column.trim().toLowerCase() || l.id === column) : undefined;
      if (column && !lane) return refuse(`There’s no column called "${column}". The columns are: ${lanes.map(l => l.title).join(', ')}.`);
      const words = query?.trim().toLowerCase();
      const order = new Map(lanes.map((l, i) => [l.id, i]));
      const found = board.notes
        .filter(note => (includeDone || !note.done) && (!lane || note.laneId === lane.id))
        .filter(note => !words || `${note.title}\n${note.body}`.toLowerCase().includes(words))
        .sort((a, b) => (order.get(a.laneId) ?? 0) - (order.get(b.laneId) ?? 0));
      return text({
        stickies: found.slice(0, MAX_LISTED).map(note => ({
          stickyId: note.id,
          title: note.title,
          column: laneTitle(board, note.laneId),
          ...(note.due ? { deadline: note.due } : {}),
          done: note.done,
        })),
        ...(found.length > MAX_LISTED ? { more: found.length - MAX_LISTED } : {}),
      });
    },
  );

  server.registerTool(
    'report_ai_run',
    {
      title: 'Report on a task',
      description:
        'Reports what you did for one sticky from list_ai_tasks. It shows on the sticky on the wall. New stickies are added only if the sticky allows adding (mayAddStickies), checklist and source changes only if it allows editing (mayEditChecklistAndSources).',
      inputSchema: aiReportInput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input, ctx) => {
      used(ctx);
      let built;
      try {
        built = buildAiReport(store.board, input, store.now());
      } catch (error) {
        if (error instanceof AiReportError) return refuse(error.message);
        throw error;
      }
      store.apply({ type: 'ai.report', ...built.report });
      const title = store.board.notes.find(n => n.id === input.stickyId)?.title ?? '';
      const parts = [`Saved on "${title}".`];
      if (built.added.length) parts.push(`Added ${built.added.length === 1 ? 'a sticky' : `${built.added.length} stickies`}: ${built.added.map(t => `"${t}"`).join(', ')}.`);
      if (built.skipped.length) parts.push(`Left out: ${built.skipped.join('; ')}.`);
      return text(parts.join(' '));
    },
  );

  return server;
}

/** The MCP endpoint (web-standard: a Request in, a Response out). */
export function createMcp(options: McpOptions): McpHttpHandler {
  return createMcpHandler(() => buildServer(options), { keepAliveMs: 0, maxRequestBodySize: MCP_BODY_LIMIT });
}
