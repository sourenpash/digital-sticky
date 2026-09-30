import type { CSSProperties } from 'react';
import { Bell, Check, Link2, Pin, Repeat } from 'lucide-react';
import { applicationKicker } from '../../../shared/applications.ts';
import { checklistProgress, noteColor, unverifiedCount } from '../../../shared/board.ts';
import { describeRepeat, repeatStatus, weekDots } from '../../../shared/recurring.ts';
import type { Lane, Note } from '../../../shared/types.ts';
import { chipFor, tiltFor } from './chip.ts';

interface Props {
  note: Note;
  lane?: Lane;
  now: Date;
  /** Square size in px; the note's text scales with it. */
  size?: number;
  /** Small squares drop the small print (stage, funder) so the title and badge stay readable. */
  compact?: boolean;
  onOpen?: () => void;
  selected?: boolean;
}

type Tier = 'short' | 'normal' | 'long' | 'xlong';

/** Shorter titles get bigger writing; long ones shrink and get more lines. */
function tierOf(title: string): Tier {
  if (title.length <= 16) return 'short';
  if (title.length <= 30) return 'normal';
  if (title.length <= 48) return 'long';
  return 'xlong';
}

const TITLE_CLASS: Record<Tier, string> = { short: 'title-short', normal: '', long: 'title-long', xlong: 'title-xlong' };
const MAX_LINES: Record<Tier, number> = { short: 3, normal: 3, long: 4, xlong: 5 };
// Title font sizes as a fraction of the square (see note.css); lines are 1.12 × that.
const TITLE_SIZE: Record<'full' | 'compact', Record<Tier, number>> = {
  full: { short: 0.135, normal: 0.118, long: 0.1, xlong: 0.088 },
  compact: { short: 0.15, normal: 0.122, long: 0.11, xlong: 0.1 },
};

/**
 * How many title lines fit above the badges. Everything on a note scales with its
 * size, so this is plain arithmetic on the fractions used in note.css; clamping to
 * whole lines ends a long title with "…" instead of slicing a line in half.
 */
function titleLines(tier: Tier, compact: boolean, has: { meta: boolean; dots: boolean; flags: boolean; chip: boolean }): number {
  let used = compact ? 0.16 : 0.165 + 0.09 + 0.025; // padding (+ top row and gap)
  if (!compact && has.meta) used += 0.03 + 0.068 * 1.25;
  const foot = [
    has.dots ? (compact ? 0.07 : 0.052) : 0,
    has.flags ? (compact ? 0.086 : 0.066) * 1.25 : 0,
    has.chip ? (compact ? 0.094 : 0.074) * 1.66 : 0,
  ].filter(Boolean);
  if (foot.length) used += 0.03 + foot.reduce((a, b) => a + b, 0) + 0.035 * (foot.length - 1);
  const line = TITLE_SIZE[compact ? 'compact' : 'full'][tier] * 1.12;
  return Math.max(1, Math.min(MAX_LINES[tier], Math.floor((1 - used - 0.01) / line)));
}

export function StickyNote({ note, lane, now, size, compact, onOpen, selected }: Props) {
  const color = noteColor(note, lane);
  const chip = chipFor(note, now, { compact });
  const routine = repeatStatus(note, now);
  const checklist = checklistProgress(note);
  // The bar shows checklist steps, or this week's/month's count for recurring tasks.
  const bar = routine
    ? routine.target > 1
      ? { done: routine.done, total: routine.target }
      : null
    : checklist.total > 0
      ? checklist
      : null;
  const dots = routine?.every === 'day' ? weekDots(note, now) : null;
  const toCheck = unverifiedCount(note);
  const kicker = note.done ? undefined : note.repeat ? describeRepeat(note.repeat) : applicationKicker(note);
  const meta = [note.amount, note.funder].filter(Boolean).join(' · ');
  const tier = tierOf(note.title);
  const lines = titleLines(tier, Boolean(compact), { meta: Boolean(meta), dots: Boolean(dots), flags: Boolean(bar) || toCheck > 0, chip: Boolean(chip) });
  const style = {
    '--tilt': `${tiltFor(note.id)}deg`,
    '--lines': lines,
    ...(size ? { '--s': `${Math.floor(size)}px` } : {}),
  } as CSSProperties;
  const className = [
    'note',
    `paper-${color}`,
    note.done ? 'is-done' : '',
    routine?.complete ? 'is-rested' : '',
    compact ? 'is-compact' : '',
    note.pinned ? 'is-pinned' : '',
    selected ? 'is-selected' : '',
    TITLE_CLASS[tier],
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      <span className="note-top">
        {kicker ? <span className="note-stage">{kicker}</span> : <span />}
        {note.pinned && <Pin className="note-pin" aria-label="Pinned" />}
      </span>
      <span className="note-title">{note.title || 'Untitled note'}</span>
      {meta && <span className="note-meta">{meta}</span>}
      <span className="note-foot">
        {dots && (
          <span className="note-dots" aria-hidden="true">
            {dots.map(dot => (
              <i key={dot.date.getDay()} className={[dot.done ? 'is-done' : '', dot.isToday ? 'is-today' : '', dot.isFuture ? 'is-future' : ''].filter(Boolean).join(' ')} />
            ))}
          </span>
        )}
        {(bar || toCheck > 0) && (
          <span className={`note-flags${bar ? ' has-bar' : ''}`}>
            {bar && (
              <span className="note-progress">
                <span className="note-bar" aria-hidden="true">
                  <span className="note-bar-fill" style={{ width: `${Math.round((bar.done / bar.total) * 100)}%` }} />
                </span>
                <span className="note-bar-label">
                  {bar.done}/{bar.total}
                </span>
              </span>
            )}
            {toCheck > 0 && (
              <span className="flag flag-warn">
                <Link2 aria-hidden="true" />
                {toCheck}
                <span className="flag-text">&nbsp;to check</span>
              </span>
            )}
          </span>
        )}
        {chip && (
          <span className={`chip chip-${chip.tone}`}>
            {chip.icon === 'bell' && <Bell aria-hidden="true" />}
            {chip.icon === 'check' && <Check aria-hidden="true" />}
            {chip.icon === 'repeat' && <Repeat aria-hidden="true" />}
            {chip.label}
          </span>
        )}
      </span>
      {note.done && (
        <span className="note-stamp" aria-label="Done today">
          <Check />
        </span>
      )}
    </>
  );

  return onOpen ? (
    <button type="button" className={className} style={style} onClick={onOpen}>
      {content}
    </button>
  ) : (
    <div className={className} style={style}>
      {content}
    </div>
  );
}
