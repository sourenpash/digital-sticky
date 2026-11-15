import { describe, expect, it } from 'vitest';
import { makeEmptyBoard } from './defaults.ts';
import { upcomingNotices } from './notify.ts';
import type { Board, Note } from './types.ts';

const now = new Date('2026-10-01T10:00:00');

function note(fields: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    laneId: 'remind',
    title: 'Call the financial office',
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

function boardWith(notes: Note[], quietAtNight = false): Board {
  const board = makeEmptyBoard();
  return {
    ...board,
    notes,
    settings: {
      ...board.settings,
      notify: { ...board.settings.notify, quietAtNight },
      night: {
        ...board.settings.night,
        mode: 'auto',
        start: '22:00',
        end: '07:00',
      },
    },
  };
}

describe('upcomingNotices', () => {
  it('lists reminders still to come, soonest first, and nothing for done or past ones', () => {
    const notices = upcomingNotices(
      boardWith([
        note({
          id: 'late',
          remindAt: new Date('2026-10-03T15:00:00').toISOString(),
        }),
        note({
          id: 'soon',
          title: 'Pay rent',
          remindAt: new Date('2026-10-01T14:00:00').toISOString(),
        }),
        note({
          id: 'past',
          remindAt: new Date('2026-10-01T09:00:00').toISOString(),
        }),
        note({
          id: 'done',
          done: true,
          remindAt: new Date('2026-10-02T09:00:00').toISOString(),
        }),
        note({
          id: 'far',
          remindAt: new Date('2026-11-30T09:00:00').toISOString(),
        }),
      ]),
      now,
    );
    expect(notices.map(n => n.url)).toEqual(['#note-soon', '#note-late']);
    expect(notices[0]).toMatchObject({
      title: 'Reminder · 2 PM',
      body: 'Pay rent',
      at: new Date('2026-10-01T14:00:00').toISOString(),
    });
  });

  it('repeats follow-up nudges until they are dealt with', () => {
    const notices = upcomingNotices(
      boardWith([
        note({
          followUp: {
            at: new Date('2026-09-28T09:00:00').toISOString(),
            everyDays: 7,
          },
        }),
      ]),
      now,
    );
    expect(notices.map(n => n.at)).toEqual([new Date('2026-10-05T09:00:00').toISOString(), new Date('2026-10-12T09:00:00').toISOString()]);
    expect(notices[0]!.title).toBe('Time to follow up');
    expect(new Set(notices.map(n => n.tag)).size).toBe(2);
  });

  it('leaves out night mode while notifications are quiet then', () => {
    const board = boardWith([note({ remindAt: new Date('2026-10-01T23:00:00').toISOString() })], true);
    expect(upcomingNotices(board, now)).toEqual([]);
    expect(
      upcomingNotices(
        {
          ...board,
          settings: {
            ...board.settings,
            notify: { ...board.settings.notify, quietAtNight: false },
          },
        },
        now,
      ),
    ).toHaveLength(1);
  });

  it('keeps to the limit', () => {
    const notes = Array.from({ length: 10 }, (_, i) =>
      note({
        id: `n${i}`,
        remindAt: new Date(now.getTime() + (i + 1) * 3_600_000).toISOString(),
      }),
    );
    expect(upcomingNotices(boardWith(notes), now, { max: 3 }).map(n => n.url)).toEqual(['#note-n0', '#note-n1', '#note-n2']);
  });
});
