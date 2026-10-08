import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { ExternalLink, Play, Sparkles } from 'lucide-react';
import { aiDue, defaultAiTask, nextAiRun, whenLabel } from '../../../shared/ai.ts';
import type { AiOverview } from '../../../shared/api.ts';
import { timeLabel } from '../../../shared/dates.ts';
import { AI_SCHEDULES, type AiSchedule, type AiSettings, type AiTask, type Note } from '../../../shared/types.ts';
import { useAi } from '../store/ai.ts';
import { useBoard } from '../store/board.ts';
import { hostOf } from './NoteEditor.tsx';

// Handing a sticky to the AI helper: what to do, how often, and which AI does it. The
// AI connects to the board (Wall → AI helper) and reports back here.

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

/** What the AI helper is doing with this sticky, in a sentence, and the run to open if there is one. */
export function aiStatus(note: Note, now: Date, settings: AiSettings, overview: AiOverview | null, mode: 'edit' | 'new'): { text: string; url?: string } {
  const ai = note.ai;
  if (!ai) return { text: '' };
  const state = note.aiState;
  const by = state?.by ?? 'The AI';
  if (state?.status === 'running') return { text: `${by} is working on it now.`, url: state.url };
  if (state?.status === 'queued') return { text: `Asked ${by} ${whenLabel(parseISO(state.since), now)}. Waiting for its report.`, url: state.url };
  if (state?.status === 'needs-setup') return { text: state.message ?? 'No AI is connected to the board yet. Add one in Wall → AI helper.' };
  if (state?.status === 'error') return { text: state.message ?? 'The last check didn’t work.', url: state.url };
  if (mode === 'new') return { text: 'It starts once the sticky is on the board.' };
  if (!settings.connect) return { text: 'Saved. To have an AI do it, turn on Let an AI connect in Wall → AI helper.' };
  const connection = overview ? (overview.connections.find(c => c.id === ai.by) ?? overview.connections.find(c => c.isDefault) ?? null) : undefined;
  if (connection === null) return { text: 'Saved. No AI is set up to do it yet: add one in Wall → AI helper.' };
  const who = connection ? ` · ${connection.name}` : '';
  if (aiDue(note, now)) {
    if (connection?.kind === 'self') return { text: `Due now. Waiting for ${connection.name} to check in.` };
    if (overview && overview.wakesToday >= settings.dailyCap) return { text: `Due now, but today’s ${settings.dailyCap} wake-ups are used up. It’s asked tomorrow.` };
    if (connection?.problem) return { text: `Due now, but ${connection.name} needs fixing: ${connection.problem}` };
    return { text: `Due now. Asking ${connection?.name ?? 'the AI'}…` };
  }
  const next = nextAiRun(ai, note.aiLog?.[0]?.at, now);
  return { text: next ? `Next check: ${dayAndTime(next, now)}${who}` : 'Done. Tap Run now to check again.' };
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
  const settings = useBoard().settings.ai;
  const overview = useAi();
  const status = aiStatus(note, now, settings, overview, mode);
  const connections = overview?.connections ?? [];
  const fallback = connections.find(c => c.isDefault);

  return (
    <fieldset className="ne-section ai">
      <legend className="ne-label">
        <Sparkles aria-hidden="true" /> AI helper
      </legend>
      {!ai ? (
        <>
          <button type="button" className="btn ai-give" onClick={() => onChange({ ai: defaultAiTask(note, now) })}>
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
          {(connections.length > 1 || (ai.by && !connections.some(c => c.id === ai.by) && connections.length > 0)) && (
            <label className="field" htmlFor={`ai-by-${note.id}`}>
              <span className="field-label">Who does it</span>
              <select id={`ai-by-${note.id}`} value={connections.some(c => c.id === ai.by) ? ai.by : ''} onChange={e => set({ by: e.target.value || undefined })}>
                <option value="">The default{fallback ? ` (${fallback.name})` : ''}</option>
                {connections.map(connection => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="ai-status" role="status">
            {status.text}
            {status.url && (
              <>
                {' '}
                <a href={status.url} target="_blank" rel="noopener noreferrer">
                  Open the run <ExternalLink aria-hidden="true" className="inline-icon" />
                </a>
              </>
            )}
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
