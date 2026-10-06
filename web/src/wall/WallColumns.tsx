import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { compareNotes, lanesInOrder, linksByNote, visibleOnWall } from '../../../shared/board.ts';
import type { Lane, Note } from '../../../shared/types.ts';
import { StickyNote } from '../components/StickyNote.tsx';
import { COMPACT_BELOW_U, layoutBoard } from './fit.ts';

/** Watches an element's size. */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, size };
}

export function WallColumns({ lanes, notes, now, u }: { lanes: Lane[]; notes: Note[]; now: Date; u: number }) {
  const ordered = lanesInOrder(lanes);
  const columns = ordered.map(lane => ({
    lane,
    notes: notes.filter(note => note.laneId === lane.id && visibleOnWall(note, now)).sort((a, b) => compareNotes(a, b, now)),
  }));

  // Width comes from the whole row of columns; height from one column's note area
  // (every column is the same height).
  const row = useSize<HTMLDivElement>();
  const area = useSize<HTMLDivElement>();
  const counts = columns.map(c => c.notes.length);
  const countsKey = counts.join(',');
  const layout = useMemo(
    () => layoutBoard(row.size.w, area.size.h, counts, u),
    [row.size.w, area.size.h, countsKey, u],
  );
  const compact = layout.size < COMPACT_BELOW_U * u;
  const links = useMemo(() => linksByNote(notes, lanes), [notes, lanes]);

  return (
    <div
      ref={row.ref}
      className="wall-cols"
      style={{ gridTemplateColumns: layout.columns.map(c => `${c.width}px`).join(' ') || '1fr' }}
    >
      {columns.map(({ lane, notes: laneNotes }, i) => {
        const fit = layout.columns[i];
        const open = laneNotes.filter(note => !note.done).length;
        return (
          <section key={lane.id} className="wall-col">
            <header className="wall-col-head">
              <span className={`swatch paper-${lane.color}`} aria-hidden="true" />
              <span className="wall-col-title">{lane.title}</span>
              <span className="wall-col-count">{open}</span>
            </header>
            <div ref={i === 0 ? area.ref : undefined} className="wall-col-notes">
              {laneNotes.length === 0 ? (
                <p className="wall-col-empty">Nothing here</p>
              ) : (
                fit && (
                  <div
                    className="wall-col-grid"
                    style={{ gridTemplateColumns: `repeat(${fit.cols}, ${layout.size}px)`, gridAutoRows: `${layout.size}px` }}
                  >
                    {laneNotes.slice(0, fit.shown).map(note => (
                      <StickyNote key={note.id} note={note} lane={lane} now={now} size={layout.size} compact={compact} links={links.get(note.id)} />
                    ))}
                    {fit.overflow > 0 && (
                      <div className="note-more" style={{ '--s': `${layout.size}px` } as CSSProperties}>
                        +{fit.overflow} more
                      </div>
                    )}
                  </div>
                )
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
