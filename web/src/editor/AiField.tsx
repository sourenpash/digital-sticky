import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { ExternalLink, Play, Sparkles } from 'lucide-react';
import { defaultAiTask, nextAiRun } from '../../../shared/ai.ts';
import { timeLabel } from '../../../shared/dates.ts';
import { AI_SCHEDULES, type AiSchedule, type AiTask, type Note } from '../../../shared/types.ts';
import { hostOf } from './NoteEditor.tsx';

// Handing a sticky to the AI helper. For now this is the settings and the reports;
// connecting an AI to do the work (over MCP) arrives in the next update.

/** Becomes a real check of the wall computer once the AI helper is set up there. */
const ENGINE_READY = false;

const SCHEDULE_LABEL: Record<AiSchedule, string> = { once: 'Once', daily: 'Every day', weekly: 'Every week' };
const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Today 8 AM", "Yesterday 8 AM", "Mon 8 AM", "Oct 1". */
function dayAndTime(date: Date, now: Date): string {
  const days = differenceInCalendarDays(date, now);
  if (days === 0) return `Today ${timeLabel(date)}`;
  if (days === -1) return `Yesterday ${timeLabel(date)}`;
  if (days === 1) return `Tomorrow ${timeLabel(date)}`;
  if (Math.abs(days) < 7) return `${format(date, 'EEE')} ${timeLabel(date)}`;
  return format(date, 'MMM d');
}

interface Props {
  note: Note;
  notes: Note[];
  now: Date;
  mode: 'edit' | 'new';
  onChange: (patch: Partial<Note>) => void;
  onOpen?: (id: string) => void;
  onRunNow?: () => void;
}

export function AiField({ note, notes, now, mode, onChange, onOpen, onRunNow }: Props) {
  const ai = note.ai;
  const log = note.aiLog ?? [];
  const set = (patch: Partial<AiTask>) => ai && onChange({ ai: { ...ai, ...patch } });

  let status: string;
  if (!ai) status = '';
  else if (note.aiState?.status === 'running') status = 'Checking now…';
  else if (note.aiState?.status === 'needs-setup') status = 'No AI is connected to the board yet.';
  else if (note.aiState?.status === 'error') status = `The last check didn’t work${note.aiState.message ? `: ${note.aiState.message}` : '.'}`;
  else if (mode === 'new') status = 'It starts once the sticky is on the board.';
  else if (!ENGINE_READY && !__DEMO_BUILD__) status = 'Saved. The AI helper starts working in the next update.';
  else {
    const next = nextAiRun(ai, log[0]?.at, now);
    status = next ? `Next check: ${dayAndTime(next, now)}` : 'Done. Tap Run now to check again.';
  }

  return (
    <fieldset className="ne-section ai">
      <legend className="ne-label">
        <Sparkles aria-hidden="true" /> AI helper
      </legend>
      {!ai ? (
        <>
          <button type="button" className="btn ai-give" onClick={() => onChange({ ai: defaultAiTask(note) })}>
            <Sparkles aria-hidden="true" /> Give this to AI
          </button>
          <p className="ne-hint">
            It can look things up on the web for you, on a schedule, and report back on this sticky. Like “Check government websites for new funding calls”.
          </p>
        </>
      ) : (
        <>
          <label className="field" htmlFor={`ai-do-${note.id}`}>
            <span className="field-label">What should it do?</span>
            <textarea
              id={`ai-do-${note.id}`}
              className="ne-textarea"
              rows={3}
              value={ai.instructions}
              placeholder="e.g. Check grants.gov and nsf.gov for new early-career funding calls and tell me what’s new, with deadlines and links."
              onChange={e => set({ instructions: e.target.value })}
            />
          </label>
          <span className="field-label" id={`ai-when-${note.id}`}>
            How often
          </span>
          <div className="ai-when">
            <div className="seg-group" role="radiogroup" aria-labelledby={`ai-when-${note.id}`}>
              {AI_SCHEDULES.map(schedule => (
                <button
                  key={schedule}
                  type="button"
                  role="radio"
                  aria-checked={ai.schedule === schedule}
                  className={`seg${ai.schedule === schedule ? ' is-on' : ''}`}
                  onClick={() => set(schedule === 'weekly' ? { schedule, weekday: ai.weekday ?? 1 } : { schedule, weekday: undefined })}
                >
                  {SCHEDULE_LABEL[schedule]}
                </button>
              ))}
            </div>
            <label className="ai-time">
              <span>at</span>
              <input type="time" aria-label="Time of day" value={ai.time} onChange={e => e.target.value && set({ time: e.target.value })} />
            </label>
          </div>
          {ai.schedule === 'weekly' && (
            <div className="day-picks" role="radiogroup" aria-label="On">
              {WEEKDAY_LETTERS.map((letter, day) => (
                <button
                  key={day}
                  type="button"
                  role="radio"
                  aria-checked={ai.weekday === day}
                  aria-label={WEEKDAY_NAMES[day]}
                  className={`day-pick${ai.weekday === day ? ' is-on' : ''}`}
                  onClick={() => set({ weekday: day })}
                >
                  {letter}
                </button>
              ))}
            </div>
          )}
          <span className="field-label">It may also</span>
          <label className="check-row">
            <input type="checkbox" checked={ai.mayAdd} onChange={e => set({ mayAdd: e.target.checked })} />
            <span>Add stickies for new things it finds (as related tasks of this one)</span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={ai.mayEdit} onChange={e => set({ mayEdit: e.target.checked })} />
            <span>Tick off and add to this sticky’s checklist and sources</span>
          </label>
          <p className="ai-status" role="status">
            {status}
          </p>
          <div className="ai-actions">
            {mode === 'edit' && onRunNow && (
              <button type="button" className="btn btn-sm" onClick={onRunNow}>
                <Play aria-hidden="true" /> Run now
              </button>
            )}
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange({ ai: undefined })}>
              {mode === 'new' ? 'Remove' : 'Stop'}
            </button>
          </div>
        </>
      )}
      {log.length > 0 && (
        <div className="ai-log">
          <h4 className="field-label">AI updates</h4>
          <ol>
            {log.map(run => (
              <li key={run.id} className={`ai-run${run.status === 'error' ? ' is-error' : ''}`}>
                <span className="ai-run-time">{dayAndTime(parseISO(run.at), now)}</span>
                <p className="ai-run-summary">{run.summary}</p>
                {run.links.length > 0 && (
                  <ul className="ai-run-links">
                    {run.links.map(link => (
                      <li key={link.url}>
                        <a href={link.url} target="_blank" rel="noopener noreferrer">
                          {link.label ?? hostOf(link.url)} <ExternalLink aria-hidden="true" />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                {run.added.length > 0 && (
                  <div className="ai-run-added">
                    <span>Added:</span>
                    {run.added.map(id => {
                      const added = notes.find(n => n.id === id);
                      return added ? (
                        <button key={id} type="button" className="chip-btn" onClick={() => onOpen?.(id)}>
                          {added.title || 'Untitled note'}
                        </button>
                      ) : (
                        <span key={id} className="ai-run-gone">
                          a sticky that’s since been deleted
                        </span>
                      );
                    })}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </fieldset>
  );
}
