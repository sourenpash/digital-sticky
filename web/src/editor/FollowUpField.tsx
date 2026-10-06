import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Reply } from 'lucide-react';
import { stageLabel } from '../../../shared/applications.ts';
import { daysUntil, parseWhen, timeLabel } from '../../../shared/dates.ts';
import { defaultFollowUpDays, everyLabel, followUpChoices, followUpDue, startFollowUp } from '../../../shared/followups.ts';
import { CHANNEL_INFO } from '../../../shared/messages.ts';
import type { Note, Stage } from '../../../shared/types.ts';

/** Where an application can go once you hear back. */
const ANSWERS: Stage[] = ['Interview', 'Awarded', 'Declined'];

interface Props {
  note: Note;
  now: Date;
  /** Just submitted or sent: ask when to follow up. */
  asking: boolean;
  onAsked: () => void;
  onChange: (patch: Partial<Note>) => void;
  /** "Heard back": the application's new stage, or (for a message) none. */
  onHeardBack?: (stage?: Stage) => void;
  onFollowedUp?: () => void;
}

/** "Sent Oct 6", "Submitted Oct 6". */
export function sentLabel(note: Note): string | null {
  if (!note.sentAt) return null;
  const word = note.channel ? CHANNEL_INFO[note.channel].sentWord : 'Submitted';
  return `${word} ${format(parseISO(note.sentAt), 'MMM d')}`;
}

/** "in 2 weeks", "tomorrow", "in 3 days". */
function inDays(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days % 7 === 0 && days <= 28) return days === 7 ? 'in a week' : `in ${days / 7} weeks`;
  return `in ${days} days`;
}

/**
 * Following up once an application is in or a message is sent: asks how long to wait,
 * then nudges (on the wall and phones) until you hear back.
 */
export function FollowUpField({ note, now, asking, onAsked, onChange, onHeardBack, onFollowedUp }: Props) {
  const [changing, setChanging] = useState(false);
  const [answering, setAnswering] = useState(false);
  const followUp = note.followUp;
  const choices = followUpChoices(note);
  const suggested = defaultFollowUpDays(note);
  const sent = sentLabel(note);
  const pick = (days: number | null) => {
    onChange({ followUp: days ? startFollowUp(days, now) : undefined });
    setChanging(false);
    onAsked();
  };

  let body;
  if (asking || changing) {
    body = (
      <div className="fu-ask" role="group" aria-labelledby={`fu-ask-${note.id}`}>
        <p id={`fu-ask-${note.id}`} className="fu-question">
          {changing ? 'Follow up after how long?' : 'Remind you to follow up if you don’t hear back?'}
        </p>
        <div className="fu-choices">
          {choices.map(choice => (
            <button key={choice.days} type="button" className={`btn btn-sm${choice.days === suggested ? ' btn-primary' : ''}`} onClick={() => pick(choice.days)}>
              {choice.label}
            </button>
          ))}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => (changing ? setChanging(false) : pick(null))}>
            {changing ? 'Cancel' : 'No thanks'}
          </button>
        </div>
        <p className="ne-hint">It nudges you on the wall and here, then again after the same wait until you hear back.</p>
      </div>
    );
  } else if (followUp) {
    const when = parseWhen(followUp.at);
    const due = followUpDue(note, now);
    const every = everyLabel(followUp.everyDays);
    const repeats = followUp.everyDays > 0 ? (due ? `It nudges again ${every} until you hear back` : `Then ${every} until you hear back`) : 'Just this once';
    body = (
      <>
        <p className={`fu-status${due ? ' is-due' : ''}`}>
          {due ? (
            <strong>Time to follow up</strong>
          ) : (
            <>
              Next nudge: <strong>{when ? `${format(when.date, 'EEE, MMM d')}, ${timeLabel(when.date)}` : 'soon'}</strong>
              {when && ` (${inDays(daysUntil(when, now))})`}
            </>
          )}
        </p>
        {/* A message shows when it was sent just above; an application shows it here. */}
        <p className="ne-hint">{[note.channel ? null : sent, repeats].filter(Boolean).join(' · ')}</p>
        <div className="fu-actions">
          {due && onFollowedUp && (
            <button type="button" className="btn btn-sm btn-primary" onClick={onFollowedUp}>
              Followed up
            </button>
          )}
          {onHeardBack && (
            <button type="button" className="btn btn-sm" aria-expanded={note.channel ? undefined : answering} onClick={() => (note.channel ? onHeardBack() : setAnswering(a => !a))}>
              Heard back
            </button>
          )}
        </div>
        {answering && onHeardBack && !note.channel && (
          <div className="fu-answers" role="group" aria-label="What did they say?">
            {ANSWERS.map(stage => (
              <button key={stage} type="button" className="chip-btn" onClick={() => onHeardBack(stage)}>
                {stageLabel(stage, note.appType)}
              </button>
            ))}
          </div>
        )}
        <div className="fu-links">
          <button type="button" className="link-btn" onClick={() => setChanging(true)}>
            Change the wait
          </button>
          <button type="button" className="link-btn" onClick={() => onChange({ followUp: undefined })}>
            Stop the reminders
          </button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <p className="fu-status">{sent && !note.channel ? `${sent}. No follow-up reminder.` : 'No follow-up reminder.'}</p>
        <div className="fu-actions">
          <button type="button" className="btn btn-sm" onClick={() => setChanging(true)}>
            Remind me to follow up
          </button>
        </div>
      </>
    );
  }

  return (
    <fieldset className="ne-section fu">
      <legend className="ne-label">
        <Reply aria-hidden="true" /> Follow up
      </legend>
      {body}
    </fieldset>
  );
}
