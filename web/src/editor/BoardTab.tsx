import { useState } from 'react';
import { Grid2x2, Grid3x3, Plus, Search, Target, X } from 'lucide-react';
import { compareNotes, lanesInOrder } from '../../../shared/board.ts';
import type { Board, Lane, Note } from '../../../shared/types.ts';
import { StickyNote } from '../components/StickyNote.tsx';
import { GoalCard } from './GoalCard.tsx';

function matches(note: Note, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return [note.title, note.body, note.funder, note.amount, ...note.links.map(l => l.label ?? l.url)]
    .filter(Boolean)
    .some(text => text!.toLowerCase().includes(q));
}

type SquareSize = 'small' | 'large';
const SIZE_KEY = 'digital-sticky:square-size';

/** Remembered per device; falls back to small squares when storage is unavailable. */
function readSize(): SquareSize {
  try {
    return window.localStorage.getItem(SIZE_KEY) === 'large' ? 'large' : 'small';
  } catch {
    return 'small';
  }
}

function saveSize(size: SquareSize): void {
  try {
    window.localStorage.setItem(SIZE_KEY, size);
  } catch {
    // Private mode or blocked storage: the choice just isn't remembered.
  }
}

interface Props {
  board: Board;
  now: Date;
  desktop: boolean;
  selectedId?: string;
  selectedGoalId?: string;
  onOpen: (id: string) => void;
  onOpenGoal: (id: string) => void;
  onNewGoal: () => void;
}

export function BoardTab({ board, now, desktop, selectedId, selectedGoalId, onOpen, onOpenGoal, onNewGoal }: Props) {
  const [query, setQuery] = useState('');
  const [laneFilter, setLaneFilter] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [size, setSize] = useState<SquareSize>(readSize);
  const lanes = lanesInOrder(board.lanes);
  const notesIn = (lane: Lane) =>
    board.notes
      .filter(n => n.laneId === lane.id && (showDone || !n.done) && matches(n, query))
      .sort((a, b) => compareNotes(a, b, now));
  const visibleLanes = desktop || !laneFilter ? lanes : lanes.filter(l => l.id === laneFilter);
  const openCount = (lane: Lane) => board.notes.filter(n => n.laneId === lane.id && !n.done).length;
  const pickSize = (next: SquareSize) => {
    setSize(next);
    saveSize(next);
  };

  return (
    <div className={`board-tab${desktop ? ' is-desktop' : ''}`}>
      <div className="board-tools">
        <label className="search">
          <Search aria-hidden="true" />
          <span className="visually-hidden">Search notes</span>
          <input id="board-search" type="search" value={query} placeholder="Search" onChange={e => setQuery(e.target.value)} />
          {query && (
            <button type="button" className="icon-btn icon-btn-sm" aria-label="Clear search" onClick={() => setQuery('')}>
              <X />
            </button>
          )}
        </label>
        <label className="toggle">
          <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} />
          <span>Show done</span>
        </label>
        <div className="size-toggle" role="radiogroup" aria-label="Square size">
          <button type="button" role="radio" aria-checked={size === 'small'} aria-label="Small squares" title="Small squares" className={size === 'small' ? 'is-on' : ''} onClick={() => pickSize('small')}>
            <Grid3x3 aria-hidden="true" />
          </button>
          <button type="button" role="radio" aria-checked={size === 'large'} aria-label="Big squares" title="Big squares" className={size === 'large' ? 'is-on' : ''} onClick={() => pickSize('large')}>
            <Grid2x2 aria-hidden="true" />
          </button>
        </div>
      </div>

      {!query && (
        <section className="goals" aria-label="Goals">
          <header className="goals-head">
            <h2>
              <Target aria-hidden="true" /> Goals
            </h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onNewGoal}>
              <Plus aria-hidden="true" /> Add goal
            </button>
          </header>
          <div className="goals-row">
            {board.goals.map(goal => (
              <GoalCard key={goal.id} goal={goal} notes={board.notes} now={now} selected={goal.id === selectedGoalId} onOpen={() => onOpenGoal(goal.id)} />
            ))}
            {board.goals.length === 0 && (
              <button type="button" className="goal-card goal-card-empty" onClick={onNewGoal}>
                <span className="goal-card-title">Set a goal</span>
                <span className="goal-card-sub">Like “Submit 5 applications by December”. It gets a progress bar on the wall.</span>
              </button>
            )}
          </div>
        </section>
      )}

      {!desktop && (
        <div className="lane-chips" role="tablist" aria-label="Columns">
          <button type="button" role="tab" aria-selected={!laneFilter} className={`lane-chip${!laneFilter ? ' is-on' : ''}`} onClick={() => setLaneFilter(null)}>
            All
          </button>
          {lanes.map(lane => (
            <button
              key={lane.id}
              type="button"
              role="tab"
              aria-selected={laneFilter === lane.id}
              className={`lane-chip paper-${lane.color}${laneFilter === lane.id ? ' is-on' : ''}`}
              onClick={() => setLaneFilter(lane.id)}
            >
              <span className="lane-chip-dot" aria-hidden="true" />
              {lane.title}
              <span className="lane-chip-count">{openCount(lane)}</span>
            </button>
          ))}
        </div>
      )}

      <div className={desktop ? 'board-columns' : 'board-sections'}>
        {visibleLanes.map(lane => {
          const notes = notesIn(lane);
          return (
            <section key={lane.id} className="board-lane" aria-label={lane.title}>
              <header className="board-lane-head">
                <span className={`swatch paper-${lane.color}`} aria-hidden="true" />
                <h2>{lane.title}</h2>
                <span className="board-lane-count">{openCount(lane)}</span>
              </header>
              {notes.length === 0 ? (
                <p className="board-empty">{query ? 'No matches' : 'Nothing here yet'}</p>
              ) : (
                <div className={`note-grid is-${size}`}>
                  {notes.map(note => (
                    <div key={note.id} className="note-cell">
                      <StickyNote
                        note={note}
                        lane={lane}
                        now={now}
                        compact={size === 'small'}
                        selected={note.id === selectedId}
                        onOpen={() => onOpen(note.id)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
