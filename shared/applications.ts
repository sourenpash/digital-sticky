import type { AppType, ChecklistItem, Note, Stage } from './types.ts';

// Applications aren't only grants. Each type starts with its own checklist and uses
// its own words for who it goes to, the money involved and a good outcome.

export interface AppTypeInfo {
  /** In the "What kind?" picker. */
  label: string;
  /** On squares: "JOB · INTERVIEW". */
  tag: string;
  titlePlaceholder: string;
  /** The `funder` field: who the application goes to. */
  org: string;
  orgPlaceholder: string;
  amount: string;
  amountPlaceholder: string;
  checklist: string[];
}

export const APP_TYPE_INFO: Record<AppType, AppTypeInfo> = {
  grant: {
    label: 'Grant / funding',
    tag: 'Grant',
    titlePlaceholder: 'Name of the grant or fund',
    org: 'Funder',
    orgPlaceholder: 'e.g. NSF',
    amount: 'Amount',
    amountPlaceholder: 'e.g. $50,000',
    checklist: ['Confirm eligibility', 'Budget', 'Narrative / statement', 'Letters of support', 'Submit'],
  },
  job: {
    label: 'Job',
    tag: 'Job',
    titlePlaceholder: 'The role, e.g. Research Scientist',
    org: 'Company',
    orgPlaceholder: 'e.g. Allen Institute',
    amount: 'Salary',
    amountPlaceholder: 'e.g. $95k',
    checklist: ['Tailor CV / résumé', 'Cover letter', 'References', 'Submit', 'Follow up'],
  },
  school: {
    label: 'School / program',
    tag: 'School',
    titlePlaceholder: 'The program, e.g. MPH 2027',
    org: 'School',
    orgPlaceholder: 'e.g. Johns Hopkins',
    amount: 'Cost or aid',
    amountPlaceholder: 'e.g. Full tuition',
    checklist: ['Check requirements', 'Personal statement', 'Transcripts / test scores', 'Recommendation letters', 'Submit and pay the fee'],
  },
  fellowship: {
    label: 'Fellowship / residency',
    tag: 'Fellowship',
    titlePlaceholder: 'Name of the fellowship or residency',
    org: 'Organization',
    orgPlaceholder: 'e.g. Sloan Foundation',
    amount: 'Stipend',
    amountPlaceholder: 'e.g. $75,000',
    checklist: ['Confirm eligibility', 'Research statement / proposal', 'CV', 'Letters of recommendation', 'Submit'],
  },
  other: {
    label: 'Other',
    tag: 'Other',
    titlePlaceholder: 'What are you applying for?',
    org: 'Organization',
    orgPlaceholder: 'Who it goes to',
    amount: 'Amount',
    amountPlaceholder: 'Optional',
    checklist: ['Check requirements', 'Gather documents', 'Submit'],
  },
};

/** Applications from before types existed read as "Other". */
export function appTypeOf(note: Pick<Note, 'appType'>): AppType {
  return note.appType ?? 'other';
}

/** A stage in the application's own words: a job's "Awarded" is an offer. */
export function stageLabel(stage: Stage, type: AppType | undefined): string {
  const t = type ?? 'other';
  if (stage === 'Awarded') return t === 'grant' ? 'Awarded' : t === 'job' ? 'Offer' : 'Accepted';
  if (stage === 'Interview') return t === 'grant' || t === 'other' ? 'Shortlisted' : 'Interview';
  return stage;
}

/**
 * The small print at the top of a square: "JOB · INTERVIEW". Grants are most of the
 * board, so they show just the stage and the other kinds stand out.
 */
export function applicationKicker(note: Pick<Note, 'appType' | 'stage'>): string | undefined {
  const stage = note.stage ? stageLabel(note.stage, note.appType) : undefined;
  if (!note.appType || note.appType === 'grant') return stage;
  return [APP_TYPE_INFO[note.appType].tag, stage].filter(Boolean).join(' · ');
}

/** "Money won" adds up awarded grants and fellowships; a job's salary isn't winnings. */
export function countsAsWinnings(note: Note): boolean {
  return note.stage === 'Awarded' && (note.appType === undefined || note.appType === 'grant' || note.appType === 'fellowship');
}

export function templateChecklist(type: AppType, makeId: () => string): ChecklistItem[] {
  return APP_TYPE_INFO[type].checklist.map(text => ({ id: makeId(), text, done: false }));
}

/** Still the untouched starting checklist of `type`, so switching type can swap it. */
export function isTemplateChecklist(items: ChecklistItem[], type: AppType | undefined): boolean {
  const template = APP_TYPE_INFO[type ?? 'grant'].checklist;
  return items.length === template.length && items.every((item, i) => !item.done && item.text === template[i]);
}
