import { useState } from 'react';
import { addMonths, endOfMonth, endOfYear, format } from 'date-fns';
import { CalendarClock, Gauge, Minus, Plus, Target, Trash2, X } from 'lucide-react';
import { goalProgress } from '../../../shared/goals.ts';
import type { Goal, GoalMeasure, Note } from '../../../shared/types.ts';
import { GOAL_COLOR, GoalBar } from '../components/GoalBar.tsx';
import { TitleInput } from './NoteEditor.tsx';

const MEASURES: Array<{ value: GoalMeasure; title: string; hint: string; placeholder: string }> = [
  {
    value: 'submitted',
    title: 'Applications submitted',
    hint: 'Counts applications that are submitted or further along',
    placeholder: 'Submit 5 applications',
  },
  { value: 'won', title: 'Money won', hint: 'Adds up the amounts of awarded grants and fellowships', placeholder: 'Win $10,000 in funding' },
  { value: 'count', title: 'I’ll count it myself', hint: 'Tap + whenever you make progress', placeholder: 'Talk to 10 program officers' },
];

const DEFAULT_TARGET: Record<GoalMeasure, number> = { submitted: 5, won: 10_000, count: 10 };

interface Props {
  goal: Goal;
  notes: Note[];
  now: Date;
  mode: 'new' | 'edit';
  onChange: (patch: Partial<Goal>) => void;
  onClose: () => void;
  onAdd?: () => void;
  onDelete?: () => void;
}

export function GoalEditor({ goal, notes, now, mode, onChange, onClose, onAdd, onDelete }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const progress = goalProgress(goal, notes, now);
  const measure = MEASURES.find(m => m.value === goal.measure) ?? MEASURES[0]!;
  const dateOnly = (d: Date) => format(d, 'yyyy-MM-dd');
  const quick = [
    { label: 'End of this month', value: dateOnly(endOfMonth(now)) },
    { label: 'In 3 months', value: dateOnly(addMonths(now, 3)) },
    { label: 'End of the year', value: dateOnly(endOfYear(now)) },
  ];

  const pickMeasure = (value: GoalMeasure) => {
    // Money and counts live on very different scales, so switching resets the target.
    const scaleChanged = (value === 'won') !== (goal.measure === 'won');
    onChange({ measure: value, ...(scaleChanged ? { target: DEFAULT_TARGET[value] } : {}) });
  };

  return (
    <form
      className="ne"
      onSubmit={e => {
        e.preventDefault();
        if (mode === 'new' && goal.title.trim()) onAdd?.();
      }}
    >
      <header className="ne-head">
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <X />
        </button>
        <span className="ne-head-title">
          <Target aria-hidden="true" /> {mode === 'new' ? 'New goal' : 'Goal'}
        </span>
      </header>

      <div className="ne-scroll">
        <div className={`ne-paper paper-${GOAL_COLOR[goal.measure]}`}>
          <TitleInput id={`goal-title-${goal.id}`} value={goal.title} placeholder={measure.placeholder} onChange={title => onChange({ title })} />
          <div className="goal-paper-progress">
            <GoalBar ratio={progress.ratio} pace={progress.pace} />
            <span className="goal-paper-label">{progress.complete ? `${progress.label} · reached!` : progress.label}</span>
          </div>
        </div>

        <fieldset className="ne-section">
          <legend className="ne-label">
            <Gauge aria-hidden="true" /> What moves the bar
          </legend>
          <div className="radio-cards radio-cards-stack" role="radiogroup" aria-label="What moves the bar">
            {MEASURES.map(m => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={goal.measure === m.value}
                className={`radio-card${goal.measure === m.value ? ' is-on' : ''}`}
                onClick={() => pickMeasure(m.value)}
              >
                <span className="radio-card-title">{m.title}</span>
                <span className="radio-card-hint">{m.hint}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="ne-section">
          <legend className="ne-label">
            <Target aria-hidden="true" /> Target
          </legend>
          <div className="goal-target">
            {goal.measure === 'won' && <span className="goal-target-affix">$</span>}
            <input
              id={`goal-target-${goal.id}`}
              type="number"
              inputMode="numeric"
              min={1}
              aria-label="Target"
              value={goal.target || ''}
              onChange={e => onChange({ target: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
            />
            {goal.measure === 'submitted' && <span className="goal-target-affix">applications</span>}
          </div>
        </fieldset>

        {goal.measure === 'count' && (
          <fieldset className="ne-section">
            <legend className="ne-label">Progress so far</legend>
            <div className="goal-count">
              <button type="button" className="icon-btn icon-btn-lg" aria-label="Take one off" disabled={goal.count <= 0} onClick={() => onChange({ count: goal.count - 1 })}>
                <Minus />
              </button>
              <span className="goal-count-value" aria-live="polite">
                {goal.count}
                <small> of {goal.target}</small>
              </span>
              <button type="button" className="icon-btn icon-btn-lg icon-btn-accent" aria-label="Add one" onClick={() => onChange({ count: goal.count + 1 })}>
                <Plus />
              </button>
            </div>
          </fieldset>
        )}

        <fieldset className="ne-section">
          <legend className="ne-label">
            <CalendarClock aria-hidden="true" /> Finish by <span className="ne-optional">optional</span>
          </legend>
          <div className="ne-when ne-when-date">
            <input
              id={`goal-by-${goal.id}`}
              type="date"
              aria-label="Finish by"
              value={goal.by ?? ''}
              onChange={e => onChange({ by: e.target.value || undefined })}
            />
            {goal.by && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange({ by: undefined })}>
                Clear
              </button>
            )}
          </div>
          <div className="ne-quick">
            {quick.map(pick => (
              <button key={pick.label} type="button" className="chip-btn" onClick={() => onChange({ by: pick.value })}>
                {pick.label}
              </button>
            ))}
          </div>
          <p className="ne-hint">
            {goal.by
              ? 'The thin line on the bar shows where an even pace would put you today.'
              : 'With a date, the bar also shows whether you’re on pace.'}
          </p>
        </fieldset>
      </div>

      <footer className="ne-foot">
        {mode === 'new' ? (
          <>
            <button type="submit" className="btn btn-primary" disabled={!goal.title.trim() || goal.target < 1}>
              Add goal
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
          </>
        ) : confirmDelete ? (
          <>
            <span className="ne-confirm">Delete this goal?</span>
            <button type="button" className="btn btn-danger" onClick={onDelete}>
              Delete
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
              Keep
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => setConfirmDelete(true)}>
              <Trash2 aria-hidden="true" /> Delete goal
            </button>
            <span className="ne-saved">Changes show on the wall right away</span>
          </>
        )}
      </footer>
    </form>
  );
}
