import type { Board, Lane, Settings } from './types.ts';

/** The columns a new board starts with. */
export const DEFAULT_LANES: Lane[] = [
  { id: 'apps', title: 'Applications', color: 'yellow', order: 0, kind: 'application' },
  { id: 'check', title: 'Double-check', color: 'blue', order: 1, kind: 'source' },
  { id: 'todo', title: 'To-do', color: 'green', order: 2, kind: 'task' },
  { id: 'routine', title: 'Recurring', color: 'orange', order: 3, kind: 'routine' },
  { id: 'remind', title: 'Reminders', color: 'pink', order: 4, kind: 'reminder' },
];

export const DEFAULT_SETTINGS: Settings = {
  night: { mode: 'auto', start: '22:00', end: '07:00', style: 'dim' },
  // A new board shows the "Connect your phone" code until it's switched off.
  wall: { showConnect: true, chime: true, alertMinutes: 60 },
  ticker: { show: true, crypto: ['BTC', 'ETH'], stocks: ['AAPL', 'NVDA', 'MSFT', 'GOOGL'], news: ['hn', 'verge'] },
  // No AI can connect until it's switched on in the Wall tab.
  ai: { connect: false, dailyCap: 12 },
  notify: { quietAtNight: true },
};

/** A fresh board: the default columns, nothing on them yet. */
export function makeEmptyBoard(): Board {
  return {
    lanes: DEFAULT_LANES.map(lane => ({ ...lane })),
    notes: [],
    goals: [],
    settings: structuredClone(DEFAULT_SETTINGS),
    alerts: [],
  };
}
