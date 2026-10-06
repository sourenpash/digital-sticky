import { useState } from 'react';
import { Check, ChevronRight, CornerDownRight, ListTree, Plus, Reply, X } from 'lucide-react';
import { relatedTo } from '../../../shared/board.ts';
import type { Note } from '../../../shared/types.ts';
import { chipFor } from '../components/chip.ts';

/** "Part of: NSF CAREER proposal", under the title of a related task. */
export function PartOf({ parent, onOpen, onUnlink }: { parent: Note; onOpen: (id: string) => void; onUnlink: () => void }) {
  return (
    <div className="rel-parent">
      <CornerDownRight aria-hidden="true" />
      <span className="rel-parent-label">Part of</span>
      <button type="button" className="rel-open" onClick={() => onOpen(parent.id)}>
        <span className="rel-title">{parent.title || 'Untitled note'}</span>
        <ChevronRight aria-hidden="true" />
      </button>
      <button type="button" className="icon-btn icon-btn-sm" aria-label={`Unlink from “${parent.title}”`} title="Unlink" onClick={onUnlink}>
        <X />
      </button>
    </div>
  );
}

interface Props {
  note: Note;
  notes: Note[];
  now: Date;
  onOpen: (id: string) => void;
  onAdd: (title: string) => void;
  onSetDone: (id: string, done: boolean) => void;
}

/** Tasks spun off a sticky: each is its own sticky on the wall, linked back to this one. */
export function RelatedField({ note, notes, now, onOpen, onAdd, onSetDone }: Props) {
  const [text, setText] = useState('');
  const { children } = relatedTo(notes, note);
  const done = children.filter(child => child.done).length;
  const add = () => {
    const title = text.trim();
    if (!title) return;
    onAdd(title);
    setText('');
  };

  return (
    <fieldset className="ne-section">
      <legend className="ne-label">
        <ListTree aria-hidden="true" /> Related tasks
        {children.length > 0 && (
          <span className="ne-count">
            {done}/{children.length}
          </span>
        )}
      </legend>
      {children.length > 0 && (
        <ul className="ne-list">
          {children.map(child => {
            const chip = chipFor(child, now, { compact: true });
            return (
              <li key={child.id} className={`ne-check rel-child${child.done ? ' is-done' : ''}`}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={child.done}
                  aria-label={`${child.title}: ${child.done ? 'done' : 'not done'}`}
                  className="checkbox"
                  onClick={() => onSetDone(child.id, !child.done)}
                >
                  {child.done && <Check aria-hidden="true" />}
                </button>
                <button type="button" className="rel-open" onClick={() => onOpen(child.id)}>
                  <span className="rel-title">{child.title || 'Untitled note'}</span>
                  {chip && (
                    <span className={`chip chip-${chip.tone} rel-chip`}>
                      {chip.icon === 'reply' && <Reply aria-hidden="true" />}
                      {chip.label}
                    </span>
                  )}
                  <ChevronRight aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="ne-add">
        <input
          aria-label="New related task"
          value={text}
          placeholder="Add a related task"
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="btn btn-sm" onClick={add} disabled={!text.trim()}>
          <Plus aria-hidden="true" /> Add
        </button>
      </div>
      <p className="ne-hint">Each related task is its own sticky on the wall, linked to this one.</p>
    </fieldset>
  );
}
