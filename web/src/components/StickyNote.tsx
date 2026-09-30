import type { CSSProperties } from 'react';
import { Bell, Check, Link2, ListChecks, Pin } from 'lucide-react';
import { checklistProgress, noteColor, unverifiedCount } from '../../../shared/board.ts';
import type { Lane, Note } from '../../../shared/types.ts';
import { chipFor, tiltFor } from './chip.ts';

interface Props {
  note: Note;
  lane?: Lane;
  now: Date;
  /** Square size in px; the note's text scales with it. */
  size?: number;
  onOpen?: () => void;
  selected?: boolean;
}

/** Shorter titles get bigger writing; long ones shrink and get more lines. */
function titleClass(title: string): string {
  if (title.length <= 16) return 'title-short';
  if (title.length <= 30) return '';
  if (title.length <= 48) return 'title-long';
  return 'title-xlong';
}

export function StickyNote({ note, lane, now, size, onOpen, selected }: Props) {
  const color = noteColor(note, lane);
  const chip = chipFor(note, now);
  const progress = checklistProgress(note);
  const toCheck = unverifiedCount(note);
  const meta = [note.amount, note.funder].filter(Boolean).join(' · ');
  const style = {
    '--tilt': `${tiltFor(note.id)}deg`,
    ...(size ? { '--s': `${Math.floor(size)}px` } : {}),
  } as CSSProperties;
  const className = [
    'note',
    `paper-${color}`,
    note.done ? 'is-done' : '',
    selected ? 'is-selected' : '',
    titleClass(note.title),
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      <span className="note-top">
        {note.stage && !note.done ? <span className="note-stage">{note.stage}</span> : <span />}
        {note.pinned && <Pin className="note-pin" aria-label="Pinned" />}
      </span>
      <span className="note-title">{note.title || 'Untitled note'}</span>
      {meta && <span className="note-meta">{meta}</span>}
      <span className="note-foot">
        {(progress.total > 0 || toCheck > 0) && (
          <span className="note-flags">
            {progress.total > 0 && (
              <span className="flag">
                <ListChecks aria-hidden="true" />
                {progress.done}/{progress.total}
              </span>
            )}
            {toCheck > 0 && (
              <span className="flag flag-warn">
                <Link2 aria-hidden="true" />
                {toCheck} to check
              </span>
            )}
          </span>
        )}
        {chip && (
          <span className={`chip chip-${chip.tone}`}>
            {chip.icon === 'bell' && <Bell aria-hidden="true" />}
            {chip.icon === 'check' && <Check aria-hidden="true" />}
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
