import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { addDays, format, isSameDay, parseISO, set } from 'date-fns';
import {
  AlignLeft,
  Award,
  Bell,
  BriefcaseBusiness,
  CalendarClock,
  Check,
  ChevronDown,
  ExternalLink,
  FileText,
  GraduationCap,
  Landmark,
  Link2,
  ListChecks,
  Minus,
  Pin,
  Plus,
  Repeat as RepeatIcon,
  StickyNote as StickyNoteIcon,
  Trash2,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { APP_TYPE_INFO, appTypeOf, isTemplateChecklist, stageLabel, templateChecklist } from '../../../shared/applications.ts';
import { isFinishedStage, lanesInOrder } from '../../../shared/board.ts';
import { composeWhen, parseWhen, splitWhen } from '../../../shared/dates.ts';
import { awaitingReply } from '../../../shared/followups.ts';
import { CHANNEL_INFO } from '../../../shared/messages.ts';
import { describeRepeat, pruneCompletions, repeatStatus, weekDots } from '../../../shared/recurring.ts';
import {
  APP_TYPES,
  NOTE_COLORS,
  STAGES,
  type AppType,
  type ChecklistItem,
  type Lane,
  type LaneKind,
  type Note,
  type NoteColor,
  type Repeat,
  type RepeatEvery,
  type SourceLink,
  type Stage,
} from '../../../shared/types.ts';
import { currentTime } from '../lib/now.ts';
import { uid } from '../lib/uid.ts';
import { AiField } from './AiField.tsx';
import { FollowUpField } from './FollowUpField.tsx';
import { MessageField } from './MessageField.tsx';
import { PartOf, RelatedField } from './RelatedField.tsx';
import { templateFor } from './templates.ts';

type Section = 'application' | 'message' | 'follow' | 'due' | 'repeat' | 'remind' | 'checklist' | 'links' | 'related' | 'body' | 'ai';

/** Which fields each kind of column shows first. The rest sit behind "Add …". */
const PRIMARY: Record<LaneKind, Section[]> = {
  application: ['application', 'follow', 'due', 'checklist', 'links', 'related', 'body', 'ai'],
  source: ['links', 'due', 'body', 'ai'],
  task: ['message', 'follow', 'due', 'checklist', 'related', 'body', 'ai'],
  routine: ['repeat', 'body', 'ai'],
  reminder: ['remind', 'body'],
  note: ['body'],
};
const ALL: Section[] = ['application', 'message', 'follow', 'due', 'repeat', 'remind', 'checklist', 'links', 'related', 'body', 'ai'];
/** Recurring tasks have no deadline, only recurring tasks repeat, and only to-dos are messages. */
const NOT_OFFERED: Record<LaneKind, Section[]> = {
  application: ['repeat', 'message'],
  source: ['repeat', 'message'],
  task: ['repeat'],
  routine: ['application', 'due', 'remind', 'message'],
  reminder: ['repeat', 'message'],
  note: ['repeat', 'message'],
};
const SECTION_LABEL: Record<Section, string> = {
  application: 'application details',
  message: 'email or text',
  follow: 'follow-up',
  due: 'deadline',
  repeat: 'repeat',
  remind: 'reminder',
  checklist: 'checklist',
  links: 'sources',
  related: 'related tasks',
  body: 'notes',
  ai: 'AI helper',
};

function hasContent(note: Note, section: Section, notes: Note[]): boolean {
  switch (section) {
    case 'application':
      return Boolean(note.appType || note.stage || note.funder || note.amount);
    case 'message':
      return Boolean(note.channel);
    case 'follow':
      return Boolean(note.followUp);
    case 'related':
      return notes.some(n => n.parentId === note.id);
    case 'ai':
      return Boolean(note.ai || note.aiLog?.length);
    case 'due':
      return Boolean(note.due);
    case 'repeat':
      return Boolean(note.repeat);
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
  /** Everything on the board, for related tasks. */
  notes?: Note[];
  mode: 'edit' | 'new';
  now: Date;
  onChange: (patch: Partial<Note>) => void;
  onClose: () => void;
  onAdd?: () => void;
  onDelete?: () => void;
  onToggleDone?: () => void;
  /** Recurring tasks: log a "Did it", or take the last one back. */
  onLog?: () => void;
  onUndoLog?: () => void;
  /** Opens another sticky (a related one). */
  onOpenNote?: (id: string) => void;
  /** Related tasks: a new linked to-do, a checklist line made into one, ticking one off. */
  onAddRelated?: (title: string) => void;
  onPromote?: (item: ChecklistItem) => void;
  onSetDone?: (id: string, done: boolean) => void;
  /** Follow-ups: heard back (the application's new stage, or none for a message), or followed up. */
  onHeardBack?: (stage?: Stage) => void;
  onFollowedUp?: () => void;
  onRunAi?: () => void;
}

export function NoteEditor({
  note,
  lanes,
  notes = [],
  mode,
  now,
  onChange,
  onClose,
  onAdd,
  onDelete,
  onToggleDone,
  onLog,
  onUndoLog,
  onOpenNote,
  onAddRelated,
  onPromote,
  onSetDone,
  onHeardBack,
  onFollowedUp,
  onRunAi,
}: Props) {
  const lane = lanes.find(l => l.id === note.laneId);
  const kind = lane?.kind ?? 'note';
  const template = templateFor(kind);
  const [showAll, setShowAll] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Just submitted or sent: the Follow up section asks how long to wait. */
  const [asking, setAsking] = useState(false);
  const parent = mode === 'edit' && note.parentId && note.parentId !== note.id ? notes.find(n => n.id === note.parentId) : undefined;
  const routine = repeatStatus(note, now);

  // Some sections only make sense at times: following up once it's in or sent, related tasks once it's on the board.
  const fits = (s: Section) => (s === 'follow' ? asking || awaitingReply(note) || Boolean(note.followUp) : s === 'related' ? mode === 'edit' && Boolean(onAddRelated) : true);
  const primary = PRIMARY[kind];
  const offered = (s: Section) => fits(s) && s !== 'follow' && (!NOT_OFFERED[kind].includes(s) || hasContent(note, s, notes));
  const shown = (s: Section) => fits(s) && (primary.includes(s) || hasContent(note, s, notes) || (showAll && offered(s)));
  const sections = [...primary, ...ALL.filter(s => !primary.includes(s))].filter(shown);
  const hidden = ALL.filter(s => !shown(s) && offered(s));

  /** Submitting asks about following up; going back to before Submitted drops the follow-up and the date it went in. */
  const pickStage = (stage: Stage | undefined) => {
    const patch: Partial<Note> = { stage };
    const submitted = stage !== undefined && isFinishedStage({ ...note, stage });
    if (stage === 'Submitted' && note.stage !== 'Submitted') {
      patch.sentAt = note.sentAt ?? now.toISOString();
      setAsking(true);
    } else if (stage !== 'Submitted') {
      if (note.followUp) patch.followUp = undefined;
      if (!submitted && note.sentAt) patch.sentAt = undefined;
      setAsking(false);
    }
    onChange(patch);
  };

  const renderSection = (section: Section): ReactNode => {
    switch (section) {
      case 'application':
        return <ApplicationFields key={section} note={note} withType={mode === 'edit'} onChange={onChange} onStage={pickStage} />;
      case 'message':
        return <MessageField key={section} note={note} now={now} quiet={mode === 'new'} onChange={onChange} onSent={() => setAsking(true)} />;
      case 'follow':
        return (
          <FollowUpField
            key={section}
            note={note}
            now={now}
            asking={asking}
            onAsked={() => setAsking(false)}
            onChange={onChange}
            onHeardBack={onHeardBack}
            onFollowedUp={onFollowedUp}
          />
        );
      case 'related':
        return (
          <RelatedField
            key={section}
            note={note}
            notes={notes}
            now={now}
            onOpen={id => onOpenNote?.(id)}
            onAdd={title => onAddRelated?.(title)}
            onSetDone={(id, done) => onSetDone?.(id, done)}
          />
        );
      case 'ai':
        return <AiField key={section} note={note} notes={notes} now={now} mode={mode} onChange={onChange} onOpen={onOpenNote} onRunNow={onRunAi} />;
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
      case 'repeat':
        return <RepeatField key={section} note={note} now={now} onChange={onChange} />;
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
        return <ChecklistField key={section} items={note.checklist} onChange={checklist => onChange({ checklist })} onPromote={mode === 'edit' ? onPromote : undefined} />;
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
          <span className="ne-head-kind">New {note.channel ? CHANNEL_INFO[note.channel].label.toLowerCase() : template.short}</span>
        )}
      </header>

      <div className="ne-scroll">
        {mode === 'new' && kind === 'application' && (
          <fieldset className="ne-section ne-kind">
            <legend className="ne-label">What kind of application?</legend>
            <TypePicker note={note} onChange={onChange} />
          </fieldset>
        )}
        <div className={`ne-paper paper-${note.color ?? lane?.color ?? 'yellow'}`}>
          <TitleInput
            id={`title-${note.id}`}
            value={note.title}
            placeholder={
              kind === 'application'
                ? APP_TYPE_INFO[appTypeOf(note)].titlePlaceholder
                : note.channel
                  ? CHANNEL_INFO[note.channel].titlePlaceholder
                  : template.titlePlaceholder
            }
            onChange={title => onChange({ title })}
          />
          <ColorPicker value={note.color} laneColor={lane?.color} onChange={color => onChange({ color })} />
        </div>
        {parent && <PartOf parent={parent} onOpen={id => onOpenNote?.(id)} onUnlink={() => onChange({ parentId: undefined })} />}

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
            {routine ? (
              <>
                <button type="button" className={`btn ${routine.complete ? 'btn-done' : 'btn-primary'}`} disabled={routine.complete} onClick={onLog}>
                  <Check aria-hidden="true" /> {routine.complete ? doneLabel(routine.every) : 'Did it'}
                </button>
                {routine.every === 'month' && routine.done > 0 && (
                  <button type="button" className="btn btn-ghost" onClick={onUndoLog}>
                    <Undo2 aria-hidden="true" /> Undo
                  </button>
                )}
              </>
            ) : (
              <button type="button" className="btn btn-primary" onClick={onToggleDone}>
                <Check aria-hidden="true" /> {note.done ? 'Mark not done' : 'Mark done'}
              </button>
            )}
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

export function TitleInput({
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

const APP_ICON: Record<AppType, LucideIcon> = {
  grant: Landmark,
  job: BriefcaseBusiness,
  school: GraduationCap,
  fellowship: Award,
  other: FileText,
};

/** Grant, job, school… Switching swaps the starting checklist if it hasn't been touched. */
function TypePicker({ note, onChange }: { note: Note; onChange: (patch: Partial<Note>) => void }) {
  const pick = (appType: AppType) => {
    if (appType === note.appType) return;
    const swap = isTemplateChecklist(note.checklist, note.appType);
    onChange(swap ? { appType, checklist: templateChecklist(appType, uid) } : { appType });
  };
  return (
    <div className="seg-group type-group" role="radiogroup" aria-label="Kind of application">
      {APP_TYPES.map(type => {
        const Icon = APP_ICON[type];
        const on = note.appType === type;
        return (
          <button key={type} type="button" role="radio" aria-checked={on} className={`seg${on ? ' is-on' : ''}`} onClick={() => pick(type)}>
            <Icon aria-hidden="true" /> {APP_TYPE_INFO[type].label}
          </button>
        );
      })}
    </div>
  );
}

function ApplicationFields({
  note,
  withType,
  onChange,
  onStage,
}: {
  note: Note;
  withType: boolean;
  onChange: (patch: Partial<Note>) => void;
  onStage: (stage: Stage | undefined) => void;
}) {
  const info = APP_TYPE_INFO[appTypeOf(note)];
  const Icon = APP_ICON[appTypeOf(note)];
  return (
    <fieldset className="ne-section">
      <legend className="ne-label">
        <Icon aria-hidden="true" /> Application
      </legend>
      {withType && <TypePicker note={note} onChange={onChange} />}
      <div className="seg-group" role="radiogroup" aria-label="Stage">
        {STAGES.map(stage => (
          <button
            key={stage}
            type="button"
            role="radio"
            aria-checked={note.stage === stage}
            className={`seg${note.stage === stage ? ' is-on' : ''}`}
            onClick={() => onStage(note.stage === stage ? undefined : stage)}
          >
            {stageLabel(stage, note.appType)}
          </button>
        ))}
      </div>
      <div className="ne-row">
        <label className="field" htmlFor={`funder-${note.id}`}>
          <span className="field-label">{info.org}</span>
          <input
            id={`funder-${note.id}`}
            value={note.funder ?? ''}
            placeholder={info.orgPlaceholder}
            onChange={e => onChange({ funder: e.target.value || undefined })}
          />
        </label>
        <label className="field" htmlFor={`amount-${note.id}`}>
          <span className="field-label">{info.amount}</span>
          <input
            id={`amount-${note.id}`}
            value={note.amount ?? ''}
            placeholder={info.amountPlaceholder}
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

const doneLabel = (every: RepeatEvery) =>
  every === 'day' ? 'Done for today' : every === 'week' ? 'Done for this week' : 'Done for this month';

const EVERY: Array<{ value: RepeatEvery; label: string }> = [
  { value: 'day', label: 'Every day' },
  { value: 'week', label: 'Every week' },
  { value: 'month', label: 'Every month' },
];
const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <div className="stepper">
      <span className="stepper-label">{label}</span>
      <button type="button" className="icon-btn" aria-label={`Fewer: ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
        <Minus />
      </button>
      <span className="stepper-value" aria-live="polite">
        {value}
      </span>
      <button type="button" className="icon-btn" aria-label={`More: ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        <Plus />
      </button>
    </div>
  );
}

/** Tapping a day in the week strip marks it done, or takes that day's "Did it" back. */
function toggleDay(completions: string[], day: Date, now: Date): string[] {
  const onDay = completions
    .map((iso, index) => ({ iso, index }))
    .filter(({ iso }) => isSameDay(parseISO(iso), day))
    .sort((a, b) => a.iso.localeCompare(b.iso));
  const latest = onDay[onDay.length - 1];
  if (latest) return completions.filter((_, index) => index !== latest.index);
  const at = isSameDay(day, now) ? now : set(day, { hours: 12, minutes: 0, seconds: 0, milliseconds: 0 });
  return pruneCompletions([...completions, at.toISOString()], now);
}

function RepeatField({ note, now, onChange }: { note: Note; now: Date; onChange: (patch: Partial<Note>) => void }) {
  const repeat = note.repeat;
  const days = repeat?.every === 'week' ? (repeat.days ?? []) : [];
  const status = repeatStatus(note, now);
  const dots = repeat ? weekDots(note, now) : [];
  const period = repeat?.every === 'day' ? 'Today' : repeat?.every === 'week' ? 'This week' : 'This month';
  const setRepeat = (next: Repeat) => onChange({ repeat: next });

  const pickDay = (day: number) => {
    if (!repeat) return;
    const next = days.includes(day) ? days.filter(d => d !== day) : [...days, day].sort((a, b) => a - b);
    setRepeat({ ...repeat, days: next.length ? next : undefined });
  };

  const reset = repeat?.every === 'day' ? 'each morning' : repeat?.every === 'week' ? 'each Sunday' : 'on the 1st of the month';
  const anyDays = repeat?.every === 'week' && days.length === 0 ? ', any days' : '';

  return (
    <fieldset className="ne-section">
      <legend className="ne-label">
        <RepeatIcon aria-hidden="true" /> Repeats
      </legend>
      <div className="seg-group" role="radiogroup" aria-label="How often">
        {EVERY.map(option => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={repeat?.every === option.value}
            className={`seg${repeat?.every === option.value ? ' is-on' : ''}`}
            onClick={() => setRepeat({ every: option.value, times: 1 })}
          >
            {option.label}
          </button>
        ))}
      </div>
      {repeat?.every === 'week' && (
        <>
          <span className="field-label">
            Only on set days <span className="ne-optional">(optional)</span>
          </span>
          <div className="day-picks" role="group" aria-label="Only on these days">
            {WEEKDAY_LETTERS.map((letter, day) => (
              <button
                key={day}
                type="button"
                aria-pressed={days.includes(day)}
                aria-label={WEEKDAY_NAMES[day]}
                className={`day-pick${days.includes(day) ? ' is-on' : ''}`}
                onClick={() => pickDay(day)}
              >
                {letter}
              </button>
            ))}
          </div>
          {days.length === 0 && (
            <Stepper label="Times a week" value={repeat.times} min={1} max={7} onChange={times => setRepeat({ ...repeat, times })} />
          )}
        </>
      )}
      {repeat?.every === 'month' && (
        <Stepper label="Times a month" value={repeat.times} min={1} max={20} onChange={times => setRepeat({ ...repeat, times })} />
      )}
      {repeat && (
        <p className="ne-hint">
          {describeRepeat(repeat)}
          {anyDays}. No deadline; the count starts over {reset}.
        </p>
      )}
      {repeat && status && (
        <div className="repeat-progress">
          <div className="repeat-progress-head">
            <span>{period}</span>
            <strong>{status.complete ? 'Done' : `${status.done} of ${status.target}`}</strong>
          </div>
          {status.target > 1 && (
            <span className="repeat-bar" aria-hidden="true">
              <span style={{ width: `${Math.round((Math.min(status.done, status.target) / status.target) * 100)}%` }} />
            </span>
          )}
          {repeat.every !== 'month' && (
            <>
              <ol className="week-strip" aria-label="This week">
                {dots.map((dot, i) => (
                  <li
                    key={i}
                    className={[dot.done ? 'is-done' : '', dot.isToday ? 'is-today' : '', dot.isFuture ? 'is-future' : '', dot.scheduled ? 'is-set' : '']
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <span className="week-strip-day" aria-hidden="true">
                      {WEEKDAY_LETTERS[i]}
                    </span>
                    <button
                      type="button"
                      className="week-strip-mark"
                      aria-pressed={dot.done}
                      aria-label={`${WEEKDAY_NAMES[i]}${dot.isToday ? ' (today)' : ''}: ${dot.done ? 'done' : 'not done'}`}
                      disabled={dot.isFuture}
                      onClick={() => onChange({ completions: toggleDay(note.completions ?? [], dot.date, now) })}
                    >
                      {dot.done && <Check aria-hidden="true" />}
                    </button>
                  </li>
                ))}
              </ol>
              <p className="ne-hint repeat-tip">Tap a day to mark it done, or tap again to undo.</p>
            </>
          )}
        </div>
      )}
    </fieldset>
  );
}

function ChecklistField({
  items,
  onChange,
  onPromote,
}: {
  items: ChecklistItem[];
  onChange: (items: ChecklistItem[]) => void;
  /** Makes a line into its own sticky, linked to this one. */
  onPromote?: (item: ChecklistItem) => void;
}) {
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
              {onPromote && item.text.trim() && (
                <button
                  type="button"
                  className="icon-btn icon-btn-sm"
                  aria-label={`Make “${item.text}” its own sticky`}
                  title="Make it its own sticky"
                  onClick={() => onPromote(item)}
                >
                  <StickyNoteIcon />
                </button>
              )}
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

export function normalizeUrl(raw: string): string | null {
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
