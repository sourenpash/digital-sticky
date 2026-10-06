import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Bell, Check, Reply, X } from 'lucide-react';
import { stageLabel } from '../../../shared/applications.ts';
import { parseWhen, timeLabel } from '../../../shared/dates.ts';
import { CHANNEL_INFO } from '../../../shared/messages.ts';
import type { Alert, Board, Note, Stage } from '../../../shared/types.ts';
import { board as store } from '../store/board.ts';
import { showToast } from '../store/toasts.ts';

/** Where an application can go once you hear back. */
const ANSWERS: Stage[] = ['Interview', 'Awarded', 'Declined'];

/** "Submitted Oct 6", "Sent Oct 6". */
function sentLine(note: Note | undefined): string | null {
  if (!note?.sentAt) return null;
  return `${note.channel ? CHANNEL_INFO[note.channel].sentWord : 'Submitted'} ${format(parseISO(note.sentAt), 'MMM d')}`;
}

/** A nudge to follow up: Heard back (with the new stage, for an application), I followed up, or not now. */
function FollowUpReminder({ alert, note, onOpen }: { alert: Alert; note: Note | undefined; onOpen: (noteId: string) => void }) {
  const [answering, setAnswering] = useState(false);
  const title = note?.title ?? alert.title;
  const heardBack = (stage?: Stage) => {
    if (!note) return store.dismissAlert(alert.id);
    const undo = store.heardBack(note.id, stage);
    store.dismissAlert(alert.id);
    if (undo) showToast({ text: stage ? `“${title}” moved to ${stageLabel(stage, note.appType)}` : `Marked “${title}” done`, actionLabel: 'Undo', action: undo });
  };
  const followedUp = () => {
    if (!note?.followUp) return store.dismissAlert(alert.id);
    const every = note.followUp.everyDays;
    const undo = store.followedUp(note.id);
    store.dismissAlert(alert.id);
    if (undo) showToast({ text: every ? `Next nudge in ${every} days if you don’t hear back` : 'No more nudges for this one', actionLabel: 'Undo', action: undo });
  };
  const sent = sentLine(note);

  return (
    <div className="reminder is-follow">
      <div className="reminder-row">
        <Reply className="reminder-bell" aria-hidden="true" />
        <button type="button" className="reminder-title" onClick={() => note && onOpen(note.id)}>
          <span className="reminder-kicker">Follow up</span>
          {title || 'Untitled note'}
          {sent && <span className="reminder-time">{sent}</span>}
        </button>
        <button type="button" className="icon-btn reminder-dismiss" aria-label={`Not now: “${title}”`} onClick={() => store.dismissAlert(alert.id)}>
          <X />
        </button>
      </div>
      <div className="reminder-actions">
        <button
          type="button"
          className="btn btn-sm"
          aria-expanded={note?.channel || !note ? undefined : answering}
          onClick={() => (note && !note.channel ? setAnswering(a => !a) : heardBack())}
        >
          <Check aria-hidden="true" /> Heard back
        </button>
        <button type="button" className="btn btn-sm" onClick={followedUp}>
          <Reply aria-hidden="true" /> Followed up
        </button>
      </div>
      {answering && note && (
        <div className="reminder-answers" role="group" aria-label="What did they say?">
          {ANSWERS.map(stage => (
            <button key={stage} type="button" className="chip-btn" onClick={() => heardBack(stage)}>
              {stageLabel(stage, note.appType)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Reminders going off on the wall right now, at the top of every screen, with Done and Dismiss. */
export function ActiveReminders({ board, onOpen }: { board: Board; onOpen: (noteId: string) => void }) {
  if (board.alerts.length === 0) return null;

  const done = (alertId: string, noteId: string) => {
    const note = board.notes.find(n => n.id === noteId);
    if (!note) {
      store.dismissAlert(alertId);
      return;
    }
    if (note.repeat) {
      // Marking a recurring task done would end it; log this time instead.
      const at = store.logRoutine(note.id);
      store.dismissAlert(alertId);
      if (at) showToast({ text: `Logged “${note.title}”`, action: () => store.undoRoutine(note.id, at) });
      return;
    }
    store.setDone(note.id, true);
    showToast({ text: `Marked “${note.title}” done`, action: () => store.setDone(note.id, false) });
  };

  return (
    <section className="reminders" aria-label="Reminders going off">
      {board.alerts.map(alert => {
        const note = board.notes.find(n => n.id === alert.noteId);
        if (alert.kind === 'follow') return <FollowUpReminder key={alert.id} alert={alert} note={note} onOpen={onOpen} />;
        const when = parseWhen(note?.remindAt) ?? parseWhen(alert.firedAt);
        return (
          <div key={alert.id} className="reminder">
            <div className="reminder-row">
              <Bell className="reminder-bell" aria-hidden="true" />
              <button type="button" className="reminder-title" onClick={() => note && onOpen(note.id)}>
                {alert.title || 'Reminder'}
                {when && <span className="reminder-time">{timeLabel(when.date)}</span>}
              </button>
              <button type="button" className="btn btn-sm reminder-done" onClick={() => done(alert.id, alert.noteId)}>
                <Check aria-hidden="true" /> Done
              </button>
              <button type="button" className="icon-btn reminder-dismiss" aria-label={`Dismiss “${alert.title}”`} onClick={() => store.dismissAlert(alert.id)}>
                <X />
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
