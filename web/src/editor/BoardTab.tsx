import { useState } from 'react';
import { Search, X } from 'lucide-react';
import { compareNotes, lanesInOrder } from '../../../shared/board.ts';
import type { Board, Lane, Note } from '../../../shared/types.ts';
import { StickyNote } from '../components/StickyNote.tsx';

function matches(note: Note, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return [note.title, note.body, note.funder, note.amount, ...note.links.map(l => l.label ?? l.url)]
    .filter(Boolean)
    .some(text => text!.toLowerCase().includes(q));
}

interface Props {
  board: Board;
  now: Date;
  desktop: boolean;
  selectedId?: string;
  onOpen: (id: string) => void;
}

export function BoardTab({ board, now, desktop, selectedId, onOpen }: Props) {
  const [query, setQuery] = useState('');
  const [laneFilter, setLaneFilter] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const lanes = lanesInOrder(board.lanes);
  const notesIn = (lane: Lane) =>
    board.notes
      .filter(n => n.laneId === lane.id && (showDone || !n.done) && matches(n, query))
      .sort(compareNotes);
  const visibleLanes = desktop || !laneFilter ? lanes : lanes.filter(l => l.id === laneFilter);
  const openCount = (lane: Lane) => board.notes.filter(n => n.laneId === lane.id && !n.done).length;

  return (
    <div className={`board-tab${desktop ? ' is-desktop' : ''}`}>
      <div className="board-tools">
        <label className="search">
          <Search aria-hidden="true" />
          <span className="visually-hidden">Search notes</span>
          <input id="board-search" type="search" value={query} placeholder="Search notes" onChange={e => setQuery(e.target.value)} />
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
      </div>

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
                <div className="note-grid">
                  {notes.map(note => (
                    <div key={note.id} className="note-cell">
                      <StickyNote note={note} lane={lane} now={now} selected={note.id === selectedId} onOpen={() => onOpen(note.id)} />
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
