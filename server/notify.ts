import { isNightTime, reminderNotice } from '../shared/notify.ts';
import type { ReminderFire } from '../shared/ops.ts';
import type { IMessage } from './imessage.ts';
import type { PushService } from './push.ts';
import type { BoardStore } from './store.ts';

// Reminders away from the wall: when one goes off (or a nudge to follow up comes due),
// phones that get notifications get one, and the people on the texts list get a text.
// While the wall is in night mode they stay quiet, unless that's switched off. Once a
// day, at its time, the texts list can also get a morning summary.

export interface NotifierOptions {
  store: BoardStore;
  push: PushService | null;
  imessage: IMessage | null;
  log?: (message: string) => void;
  tickMs?: number;
}

export class Notifier {
  private readonly options: NotifierOptions;

  constructor(options: NotifierOptions) {
    this.options = options;
  }

  /** Reminders that just went off on the wall. */
  async reminders(fires: ReminderFire[]): Promise<void> {
    const { store, push, imessage, log = () => {} } = this.options;
    const board = store.board;
    const now = store.now();
    if (board.settings.notify.quietAtNight && isNightTime(board.settings, now)) return;
    for (const fire of fires) {
      if (!fire.show) continue;
      const note = board.notes.find(n => n.id === fire.noteId);
      if (!note || note.done) continue;
      const notice = reminderNotice(note, fire.kind, fire.alertId, now);
      const sends = await Promise.allSettled([push?.send(notice, now), imessage?.reminder(note.id, fire.kind, notice, now)]);
      for (const sent of sends) if (sent.status === 'rejected') log(`Couldn’t send a reminder: ${String(sent.reason)}`);
    }
  }

  /** Checks for the morning summary now and every minute. Returns stop. */
  start(): () => void {
    const { store, imessage, log = () => {}, tickMs = 60_000 } = this.options;
    const tick = () => void imessage?.morningIfDue(store).catch(error => log(`Couldn’t send the morning summary: ${String(error)}`));
    tick();
    const timer = setInterval(tick, tickMs);
    timer.unref();
    return () => clearInterval(timer);
  }
}
