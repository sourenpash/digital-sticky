import { describe, expect, it } from 'vitest';
import { messageKicker } from '../../../shared/messages.ts';
import type { Note } from '../../../shared/types.ts';
import { chipFor } from './chip.ts';

const now = new Date('2026-09-30T19:42:00'); // a Wednesday evening

function note(fields: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    laneId: 'todo',
    title: 'x',
    body: '',
    checklist: [],
    links: [],
    pinned: false,
    done: false,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
    ...fields,
  };
}

const followUp = (iso: string) => ({ at: new Date(iso).toISOString(), everyDays: 14 });

describe('chips for follow-ups and messages', () => {
  it('says when to follow up, and turns orange once it is time', () => {
    const submitted = { stage: 'Submitted' as const, due: '2026-09-25' };
    expect(chipFor(note({ ...submitted, followUp: followUp('2026-10-14T09:00:00') }), now)).toEqual({ label: 'Follow up Oct 14', tone: 'follow', icon: 'reply' });
    expect(chipFor(note({ ...submitted, followUp: followUp('2026-10-02T09:00:00') }), now)).toMatchObject({ label: 'Follow up Fri' });
    expect(chipFor(note({ ...submitted, followUp: followUp('2026-10-01T09:00:00') }), now, { compact: true })).toMatchObject({ label: 'Tomorrow' });
    expect(chipFor(note({ ...submitted, followUp: followUp('2026-09-30T09:00:00') }), now)).toEqual({ label: 'Follow up now', tone: 'follow-now', icon: 'reply' });
    expect(chipFor(note({ ...submitted, followUp: followUp('2026-09-30T09:00:00') }), now, { compact: true })).toMatchObject({ label: 'Follow up' });
    // Without a follow-up, a submitted application still just says so.
    expect(chipFor(note(submitted), now)).toEqual({ label: 'Submitted', tone: 'good', icon: 'check' });
  });

  it('shows when a message went out, instead of its old deadline', () => {
    const email = note({ channel: 'email', due: '2026-09-28' });
    expect(chipFor(email, now)).toMatchObject({ tone: 'overdue' });
    expect(chipFor({ ...email, sentAt: '2026-09-29T15:00:00.000Z' }, now)).toEqual({ label: 'Sent Sep 29', tone: 'good', icon: 'check' });
    expect(chipFor({ ...email, channel: 'call', sentAt: '2026-09-29T15:00:00.000Z' }, now, { compact: true })).toMatchObject({ label: 'Called' });
    expect(messageKicker(email)).toBe('Email · to send');
    expect(messageKicker({ channel: 'text', sentAt: now.toISOString() })).toBe('Text · sent');
    expect(messageKicker({ channel: 'call', sentAt: now.toISOString() })).toBe('Called');
    expect(messageKicker({})).toBeUndefined();
  });
});
