import { useEffect, useSyncExternalStore } from 'react';
import type { AiConnectionInfo, AiOverview, AiTestResult } from '../../../shared/api.ts';
import type { AiConnectionInput } from '../../../shared/schema.ts';
import { sampleAiOverview } from '../../../shared/sample.ts';
import { currentTime } from '../lib/now.ts';
import { onServerEvent } from './serverEvents.ts';

// The AI helper's connections, for the Wall tab and the stickies handed to it: the
// board's MCP links, and the AIs it wakes up. Shared by every part of the app that
// shows them, kept up to date while one is on screen.

const REFRESH_MS = 60_000;

let overview: AiOverview | null = __DEMO_BUILD__ ? sampleAiOverview(currentTime()) : null;
const listeners = new Set<() => void>();
let users = 0;

function set(next: AiOverview): void {
  overview = next;
  listeners.forEach(listener => listener());
}

function call(path: string, method = 'GET', body?: unknown): Promise<Response> {
  return fetch(new URL(path, document.baseURI), {
    method,
    cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

async function readError(response: Response): Promise<string> {
  try {
    return ((await response.json()) as { error?: string }).error ?? 'That didn’t work. Try again.';
  } catch {
    return 'That didn’t work. Try again.';
  }
}

export async function loadAi(): Promise<void> {
  if (__DEMO_BUILD__) return;
  try {
    const response = await call('api/ai');
    if (response.ok) set((await response.json()) as AiOverview);
  } catch {
    // Offline: keep what's showing.
  }
}

/** The MCP links and AI connections (null until loaded). */
export function useAi(): AiOverview | null {
  const value = useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => overview,
  );
  useEffect(() => {
    if (__DEMO_BUILD__) return;
    users += 1;
    if (users === 1 || !overview) void loadAi();
    const off = onServerEvent('ai', () => void loadAi());
    // "Last used" and today's count change without an event.
    const timer = window.setInterval(() => void loadAi(), REFRESH_MS);
    return () => {
      users -= 1;
      off();
      window.clearInterval(timer);
    };
  }, []);
  return value;
}

/** Saves a connection (new or changed). Answers with an error to show, or null. */
export async function saveConnection(id: string, input: AiConnectionInput, tokenEnd?: string): Promise<string | null> {
  if (__DEMO_BUILD__) {
    const current = overview!;
    const existing = current.connections.find(c => c.id === id);
    const token = input.token ?? '';
    const entry: AiConnectionInfo = {
      id,
      kind: input.kind,
      name: input.name,
      url: input.url || null,
      tokenEnd: token ? token.slice(-4) : (existing?.tokenEnd ?? tokenEnd ?? null),
      isDefault: Boolean(input.makeDefault) || current.connections.length === 0 || (existing?.isDefault ?? false),
      problem: null,
      lastWake: existing?.lastWake ?? null,
    };
    const connections = existing ? current.connections.map(c => (c.id === id ? entry : c)) : [...current.connections, entry];
    set({ ...current, connections: entry.isDefault ? connections.map(c => ({ ...c, isDefault: c.id === id })) : connections });
    return null;
  }
  try {
    const response = await call(`api/ai/connections/${encodeURIComponent(id)}`, 'PUT', input);
    if (!response.ok) return await readError(response);
    set((await response.json()) as AiOverview);
    return null;
  } catch {
    return 'Couldn’t reach the wall. Check your connection and try again.';
  }
}

export async function removeConnection(id: string): Promise<boolean> {
  if (__DEMO_BUILD__) {
    const connections = overview!.connections.filter(c => c.id !== id);
    if (connections.length && !connections.some(c => c.isDefault)) connections[0] = { ...connections[0]!, isDefault: true };
    set({ ...overview!, connections });
    return true;
  }
  try {
    const response = await call(`api/ai/connections/${encodeURIComponent(id)}`, 'DELETE');
    if (response.ok) set((await response.json()) as AiOverview);
    return response.ok;
  } catch {
    return false;
  }
}

/** "Send a test": wakes it with nothing due. */
export async function testConnection(id: string): Promise<AiTestResult> {
  if (__DEMO_BUILD__) return { ok: true, message: 'In this preview nothing is sent. On the wall computer, this wakes the AI up once.' };
  try {
    const response = await call(`api/ai/connections/${encodeURIComponent(id)}/test`, 'POST', {});
    if (!response.ok) return { ok: false, message: await readError(response) };
    const result = (await response.json()) as AiTestResult;
    void loadAi();
    return result;
  } catch {
    return { ok: false, message: 'Couldn’t reach the wall. Check your connection and try again.' };
  }
}

/** "Make a new link": AIs using the old one stop getting in. */
export async function newMcpLink(): Promise<boolean> {
  if (__DEMO_BUILD__) {
    const secret = Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'[byte % 57]).join('');
    const swap = (link: string | null) => (link ? link.replace(/\/mcp\/.*$/, `/mcp/${secret}`) : null);
    set({ ...overview!, mcp: { anywhere: swap(overview!.mcp.anywhere), home: swap(overview!.mcp.home), path: `/mcp/${secret}` }, lastUsed: null });
    return true;
  }
  try {
    const response = await call('api/ai/mcp/rotate', 'POST', {});
    if (response.ok) set((await response.json()) as AiOverview);
    return response.ok;
  } catch {
    return false;
  }
}
