// Live events from the board server that parts of the app listen for, besides board
// changes: a device signed in with a code ("pair"), the wall screens changed ("screens"),
// or the AI connections did ("ai").

export type ServerEvent = 'pair' | 'screens' | 'ai';

const handlers = new Map<ServerEvent, Set<() => void>>();

export function onServerEvent(event: ServerEvent, handler: () => void): () => void {
  let set = handlers.get(event);
  if (!set) handlers.set(event, (set = new Set()));
  set.add(handler);
  return () => set.delete(handler);
}

export function emitServerEvent(event: ServerEvent): void {
  handlers.get(event)?.forEach(handler => handler());
}
