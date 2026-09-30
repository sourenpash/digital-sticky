import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { addDays, format, set } from 'date-fns';
import {
  AlignLeft,
  Bell,
  CalendarClock,
  Check,
  ChevronDown,
  ExternalLink,
  Landmark,
  Link2,
  ListChecks,
  Pin,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { lanesInOrder } from '../../../shared/board.ts';
import { composeWhen, parseWhen, splitWhen } from '../../../shared/dates.ts';
import {
  NOTE_COLORS,
  STAGES,
  type ChecklistItem,
  type Lane,
  type LaneKind,
  type Note,
  type NoteColor,
  type SourceLink,
} from '../../../shared/types.ts';
import { currentTime } from '../lib/now.ts';
import { uid } from '../lib/uid.ts';
import { templateFor } from './templates.ts';

type Section = 'application' | 'due' | 'remind' | 'checklist' | 'links' | 'body';

/** Which fields each kind of column shows first. The rest sit behind "More fields". */
const PRIMARY: Record<LaneKind, Section[]> = {
  application: ['application', 'due', 'checklist', 'links', 'body'],
  source: ['links', 'due', 'body'],
  task: ['due', 'checklist', 'body'],
  reminder: ['remind', 'body'],
  note: ['body'],
};
const ALL: Section[] = ['application', 'due', 'remind', 'checklist', 'links', 'body'];
const SECTION_LABEL: Record<Section, string> = {
  application: 'funder & stage',
  due: 'deadline',
  remind: 'reminder',
  checklist: 'checklist',
  links: 'sources',
  body: 'notes',
};

function hasContent(note: Note, section: Section): boolean {
  switch (section) {
    case 'application':
      return Boolean(note.stage || note.funder || note.amount);
    case 'due':
      return Boolean(note.due);
    case 'remind':
      return Boolean(note.remindAt);
    case 'checklist':
      return note.checklist.length > 0;
    case 'links':
      return note.links.length > 0;
    case 'body':
      return note.body.trim().length > 0;
  }
}

interface Props {
  note: Note;
  lanes: Lane[];
  mode: 'edit' | 'new';
  onChange: (patch: Partial<Note>) => void;
  onClose: () => void;
  onAdd?: () => void;
  onDelete?: () => void;
  onToggleDone?: () => void;
}

export function NoteEditor({ note, lanes, mode, onChange, onClose, onAdd, onDelete, onToggleDone }: Props) {
  const lane = lanes.find(l => l.id === note.laneId);
  const kind = lane?.kind ?? 'note';
  const template = templateFor(kind);
  const [showAll, setShowAll] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const primary = PRIMARY[kind];
  const shown = (s: Section) => primary.includes(s) || showAll || hasContent(note, s);
  const sections = [...primary, ...ALL.filter(s => !primary.includes(s))].filter(shown);
  const hidden = ALL.filter(s => !shown(s));

  const renderSection = (section: Section): ReactNode => {
    switch (section) {
      case 'application':
        return <ApplicationFields key={section} note={note} onChange={onChange} />;
      case 'due':
        return (
          <WhenField
            key={section}
            id={`due-${note.id}`}
            label="Deadline"
            hint="Leave the time empty for an all-day deadline."
            icon={<CalendarClock aria-hidden="true" />}
            value={note.due}
            onChange={due => onChange({ due })}
            quick={dueQuickPicks()}
          />
        );
      case 'remind':
        return (
          <WhenField
            key={section}
            id={`remind-${note.id}`}
            label="Reminder"
            hint="Pops up on the wall at this time."
            icon={<Bell aria-hidden="true" />}
            value={note.remindAt}
            onChange={remindAt =>
              // A reminder needs a time; a bare date means 9 AM.
              onChange({ remindAt: remindAt && /^\d{4}-\d{2}-\d{2}$/.test(remindAt) ? composeWhen(remindAt, '09:00') : remindAt })
            }
            quick={remindQuickPicks(note)}
          />
        );
      case 'checklist':
        return <ChecklistField key={section} items={note.checklist} onChange={checklist => onChange({ checklist })} />;
      case 'links':
        return <LinksField key={section} links={note.links} onChange={links => onChange({ links })} />;
      case 'body':
        return (
          <fieldset key={section} className="ne-section">
            <legend className="ne-label">
              <AlignLeft aria-hidden="true" /> Notes
            </legend>
            <textarea
              id={`body-${note.id}`}
              className="ne-textarea"
              rows={4}
              value={note.body}
              placeholder="Details, what's left, who to ask…"
              onChange={e => onChange({ body: e.target.value })}
            />
          </fieldset>
        );
    }
  };

  return (
    <form
      className="ne"
      onSubmit={e => {
        e.preventDefault();
        if (mode === 'new' && note.title.trim()) onAdd?.();
      }}
    >
      <header className="ne-head">
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <X />
        </button>
        <LanePicker lanes={lanes} value={note.laneId} onChange={laneId => onChange({ laneId })} />
        {mode === 'edit' ? (
          <button
            type="button"
            className={`icon-btn${note.pinned ? ' is-on' : ''}`}
            aria-pressed={note.pinned}
            aria-label={note.pinned ? 'Unpin from the top' : 'Pin to the top'}
            title={note.pinned ? 'Pinned to the top' : 'Pin to the top'}
            onClick={() => onChange({ pinned: !note.pinned })}
          >
            <Pin />
          </button>
        ) : (
          <span className="ne-head-kind">New {template.short}</span>
        )}
      </header>

      <div className="ne-scroll">
        <div className={`ne-paper paper-${note.color ?? lane?.color ?? 'yellow'}`}>
          <TitleInput
            id={`title-${note.id}`}
            value={note.title}
            placeholder={template.titlePlaceholder}
            onChange={title => onChange({ title })}
          />
          <ColorPicker value={note.color} laneColor={lane?.color} onChange={color => onChange({ color })} />
        </div>

        {sections.map(renderSection)}

        {hidden.length > 0 && (
          <button type="button" className="ne-more" onClick={() => setShowAll(true)}>
            <Plus aria-hidden="true" /> Add {hidden.map(s => SECTION_LABEL[s]).join(', ')}
          </button>
        )}
      </div>

      <footer className="ne-foot">
        {mode === 'new' ? (
          <>
            <button type="submit" className="btn btn-primary" disabled={!note.title.trim()}>
              Add to board
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
          </>
        ) : confirmDelete ? (
          <>
            <span className="ne-confirm">Delete this note?</span>
            <button type="button" className="btn btn-danger" onClick={onDelete}>
              Delete
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
              Keep
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-primary" onClick={onToggleDone}>
              <Check aria-hidden="true" /> {note.done ? 'Mark not done' : 'Mark done'}
            </button>
            <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => setConfirmDelete(true)}>
              <Trash2 aria-hidden="true" /> Delete
            </button>
            <span className="ne-saved">Changes show on the wall right away</span>
          </>
        )}
      </footer>
    </form>
  );
}

function LanePicker({ lanes, value, onChange }: { lanes: Lane[]; value: string; onChange: (id: string) => void }) {
  const lane = lanes.find(l => l.id === value);
  return (
    <label className={`lane-pick paper-${lane?.color ?? 'white'}`}>
      <span className="lane-pick-dot" aria-hidden="true" />
      <span className="lane-pick-name">{lane?.title ?? 'Column'}</span>
      <select aria-label="Column" value={value} onChange={e => onChange(e.target.value)}>
        {lanesInOrder(lanes).map(l => (
          <option key={l.id} value={l.id}>
            {l.title}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden="true" />
    </label>
  );
}

function TitleInput({
  id,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      id={id}
      className="ne-title"
      rows={1}
      value={value}
      placeholder={placeholder}
      aria-label="Title"
      onChange={e => onChange(e.target.value.replace(/\n/g, ' '))}
    />
  );
}

function ColorPicker({
  value,
  laneColor,
  onChange,
}: {
  value: NoteColor | undefined;
  laneColor: NoteColor | undefined;
  onChange: (color: NoteColor | undefined) => void;
}) {
  const current = value ?? laneColor;
  return (
    <div className="ne-colors" role="radiogroup" aria-label="Paper color">
      {NOTE_COLORS.map(color => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={current === color}
          aria-label={color === laneColor ? `${color} (column color)` : color}
          className={`swatch-btn paper-${color}${current === color ? ' is-on' : ''}`}
          onClick={() => onChange(color === laneColor ? undefined : color)}
        />
      ))}
    </div>
  );
}

function ApplicationFields({ note, onChange }: { note: Note; onChange: (patch: Partial<Note>) => void }) {
  return (
    <fieldset className="ne-section">
      <legend className="ne-label">
        <Landmark aria-hidden="true" /> Application
      </legend>
      <div className="seg-group" role="radiogroup" aria-label="Stage">
        {STAGES.map(stage => (
          <button
            key={stage}
            type="button"
            role="radio"
            aria-checked={note.stage === stage}
            className={`seg${note.stage === stage ? ' is-on' : ''}`}
            onClick={() => onChange({ stage: note.stage === stage ? undefined : stage })}
          >
            {stage}
          </button>
        ))}
      </div>
      <div className="ne-row">
        <label className="field" htmlFor={`funder-${note.id}`}>
          <span className="field-label">Funder</span>
          <input
            id={`funder-${note.id}`}
            value={note.funder ?? ''}
            placeholder="e.g. NSF"
            onChange={e => onChange({ funder: e.target.value || undefined })}
          />
        </label>
        <label className="field" htmlFor={`amount-${note.id}`}>
          <span className="field-label">Amount</span>
          <input
            id={`amount-${note.id}`}
            value={note.amount ?? ''}
            placeholder="e.g. $50,000"
            onChange={e => onChange({ amount: e.target.value || undefined })}
          />
        </label>
      </div>
    </fieldset>
  );
}

interface QuickPick {
  label: string;
  value: string;
}

function dueQuickPicks(): QuickPick[] {
  const today = currentTime();
  const d = (offset: number) => format(addDays(today, offset), 'yyyy-MM-dd');
  return [
    { label: 'Today', value: d(0) },
    { label: 'Tomorrow', value: d(1) },
    { label: 'In a week', value: d(7) },
  ];
}

function remindQuickPicks(note: Note): QuickPick[] {
  const nine = (day: Date) => set(day, { hours: 9, minutes: 0, seconds: 0, milliseconds: 0 }).toISOString();
  const picks: QuickPick[] = [{ label: 'Tomorrow 9 AM', value: nine(addDays(currentTime(), 1)) }];
  const due = parseWhen(note.due);
  if (due) {
    picks.push({ label: 'Day before deadline', value: nine(addDays(due.date, -1)) });
    picks.push({ label: 'Morning of deadline', value: nine(due.date) });
  }
  return picks;
}

function WhenField({
  id,
  label,
  hint,
  icon,
  value,
  onChange,
  quick,
}: {
  id: string;
  label: string;
  hint: string;
  icon: ReactNode;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  quick: QuickPick[];
}) {
  const { date, time } = splitWhen(value);
  return (
    <fieldset className="ne-section">
      <legend className="ne-label">
        {icon} {label}
      </legend>
      <div className="ne-when">
        <input
          id={`${id}-date`}
          type="date"
          aria-label={`${label} date`}
          value={date}
          onChange={e => onChange(composeWhen(e.target.value, time))}
        />
        <input
          id={`${id}-time`}
          type="time"
          aria-label={`${label} time`}
          value={time}
          disabled={!date}
          onChange={e => onChange(composeWhen(date, e.target.value))}
        />
        {value && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(undefined)}>
            Clear
          </button>
        )}
      </div>
      <div className="ne-quick">
        {quick.map(pick => (
          <button key={pick.label} type="button" className="chip-btn" onClick={() => onChange(pick.value)}>
            {pick.label}
          </button>
        ))}
      </div>
      <p className="ne-hint">{hint}</p>
    </fieldset>
  );
}

function ChecklistField({ items, onChange }: { items: ChecklistItem[]; onChange: (items: ChecklistItem[]) => void }) {
  const [text, setText] = useState('');
  const done = items.filter(i => i.done).length;
  const add = () => {
    const value = text.trim();
    if (!value) return;
    onChange([...items, { id: uid(), text: value, done: false }]);
    setText('');
  };
  return (
    <fieldset className="ne-section">
      <legend className="ne-label">
        <ListChecks aria-hidden="true" /> Checklist
        {items.length > 0 && (
          <span className="ne-count">
            {done}/{items.length}
          </span>
        )}
      </legend>
      {items.length > 0 && (
        <ul className="ne-list">
          {items.map(item => (
            <li key={item.id} className={`ne-check${item.done ? ' is-done' : ''}`}>
              <button
                type="button"
                role="checkbox"
                aria-checked={item.done}
                aria-label={item.text}
                className="checkbox"
                onClick={() => onChange(items.map(i => (i.id === item.id ? { ...i, done: !i.done } : i)))}
              >
                {item.done && <Check aria-hidden="true" />}
              </button>
              <input
                className="ne-inline"
                aria-label="Checklist item"
                value={item.text}
                onChange={e => onChange(items.map(i => (i.id === item.id ? { ...i, text: e.target.value } : i)))}
              />
              <button
                type="button"
                className="icon-btn icon-btn-sm"
                aria-label={`Remove "${item.text}"`}
                onClick={() => onChange(items.filter(i => i.id !== item.id))}
              >
                <X />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="ne-add">
        <input
          aria-label="New checklist item"
          value={text}
          placeholder="Add a step"
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
    </fieldset>
  );
}

function normalizeUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function LinksField({ links, onChange }: { links: SourceLink[]; onChange: (links: SourceLink[]) => void }) {
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const toCheck = links.filter(l => !l.verified).length;

  const add = () => {
    const normalized = normalizeUrl(url);
    if (!normalized) {
      setError('Enter a web address, like nsf.gov/career');
      return;
    }
    onChange([...links, { id: uid(), url: normalized, label: label.trim() || undefined, verified: false }]);
    setUrl('');
    setLabel('');
    setError('');
  };

  return (
    <fieldset className="ne-section">
      <legend className="ne-label">
        <Link2 aria-hidden="true" /> Sources to double-check
        {links.length > 0 && <span className={`ne-count${toCheck ? ' is-warn' : ''}`}>{toCheck ? `${toCheck} to check` : 'all verified'}</span>}
      </legend>
      {links.length > 0 && (
        <ul className="ne-list">
          {links.map(link => (
            <li key={link.id} className="ne-link">
              <button
                type="button"
                className={`verify${link.verified ? ' is-on' : ''}`}
                aria-pressed={link.verified}
                onClick={() => onChange(links.map(l => (l.id === link.id ? { ...l, verified: !l.verified } : l)))}
              >
                {link.verified ? (
                  <>
                    <Check aria-hidden="true" /> Verified
                  </>
                ) : (
                  'Not checked'
                )}
              </button>
              <span className="ne-link-text">
                <span className="ne-link-label">{link.label ?? hostOf(link.url)}</span>
                <span className="ne-link-host">{hostOf(link.url)}</span>
              </span>
              <a className="icon-btn icon-btn-sm" href={link.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${hostOf(link.url)}`}>
                <ExternalLink />
              </a>
              <button
                type="button"
                className="icon-btn icon-btn-sm"
                aria-label={`Remove ${link.label ?? hostOf(link.url)}`}
                onClick={() => onChange(links.filter(l => l.id !== link.id))}
              >
                <X />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="ne-add ne-add-link">
        <input
          type="url"
          inputMode="url"
          aria-label="Link"
          value={url}
          placeholder="Paste a link"
          onChange={e => {
            setUrl(e.target.value);
            setError('');
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <input aria-label="Label (optional)" value={label} placeholder="Label (optional)" onChange={e => setLabel(e.target.value)} />
        <button type="button" className="btn btn-sm" onClick={add} disabled={!url.trim()}>
          <Plus aria-hidden="true" /> Add
        </button>
      </div>
      {error && <p className="ne-error">{error}</p>}
    </fieldset>
  );
}
