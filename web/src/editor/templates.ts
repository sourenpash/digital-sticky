import { Bell, Landmark, ListTodo, Repeat, SearchCheck, StickyNote as StickyNoteIcon, type LucideIcon } from 'lucide-react';
import type { LaneKind, NoteColor } from '../../../shared/types.ts';

export interface Template {
  kind: LaneKind;
  title: string;
  /** Used in "New …" headers. */
  short: string;
  hint: string;
  titlePlaceholder: string;
  icon: LucideIcon;
  color: NoteColor;
}

export const TEMPLATES: Template[] = [
  {
    kind: 'application',
    short: 'application',
    title: 'Funding application',
    hint: 'Funder, amount, deadline and a checklist',
    titlePlaceholder: 'Name of the grant or fund',
    icon: Landmark,
    color: 'yellow',
  },
  {
    kind: 'source',
    short: 'source to check',
    title: 'Source to double-check',
    hint: 'A link or fact you need to verify',
    titlePlaceholder: 'What do you need to check?',
    icon: SearchCheck,
    color: 'blue',
  },
  {
    kind: 'task',
    short: 'to-do',
    title: 'To-do',
    hint: 'Something to get done, with an optional due date',
    titlePlaceholder: 'What needs doing?',
    icon: ListTodo,
    color: 'green',
  },
  {
    kind: 'routine',
    short: 'recurring task',
    title: 'Recurring task',
    hint: 'No deadline. Comes back every day, week or month',
    titlePlaceholder: 'What do you do regularly?',
    icon: Repeat,
    color: 'orange',
  },
  {
    kind: 'reminder',
    short: 'reminder',
    title: 'Reminder',
    hint: 'Pops up on the wall at the time you pick',
    titlePlaceholder: 'Remind me to…',
    icon: Bell,
    color: 'pink',
  },
  {
    kind: 'note',
    short: 'note',
    title: 'Sticky note',
    hint: 'Anything else you want on the wall',
    titlePlaceholder: 'Write anything',
    icon: StickyNoteIcon,
    color: 'white',
  },
];

export function templateFor(kind: LaneKind | undefined): Template {
  return TEMPLATES.find(t => t.kind === kind) ?? (TEMPLATES[TEMPLATES.length - 1] as Template);
}
