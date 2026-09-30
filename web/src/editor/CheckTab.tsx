import { Check, ExternalLink } from 'lucide-react';
import { compareNotes, unverifiedCount } from '../../../shared/board.ts';
import type { Board, Note } from '../../../shared/types.ts';
import { chipFor } from '../components/chip.ts';
import { board as store } from '../store/board.ts';
import { hostOf } from './NoteEditor.tsx';

function CheckCard({ note, data, now, onOpen }: { note: Note; data: Board; now: Date; onOpen: (id: string) => void }) {
  const lane = data.lanes.find(l => l.id === note.laneId);
  const chip = chipFor(note, now);
  return (
    <article className="check-card">
      <button type="button" className="check-card-head" onClick={() => onOpen(note.id)}>
        <span className={`dot-sm paper-${note.color ?? lane?.color ?? 'yellow'}`} aria-hidden="true" />
        <span className="check-card-title">{note.title}</span>
        {chip && <span className={`chip chip-${chip.tone} chip-ui`}>{chip.label}</span>}
      </button>
      <ul className="check-links">
        {note.links.map(link => (
          <li key={link.id} className="check-link">
            <button
              type="button"
              className={`verify${link.verified ? ' is-on' : ''}`}
              aria-pressed={link.verified}
              onClick={() => store.toggleLinkVerified(note.id, link.id)}
            >
              {link.verified ? (
                <>
                  <Check aria-hidden="true" /> Verified
                </>
              ) : (
                'Not checked'
              )}
            </button>
            <a className="check-link-text" href={link.url} target="_blank" rel="noopener noreferrer">
              <span className="ne-link-label">{link.label ?? hostOf(link.url)}</span>
              <span className="ne-link-host">
                {hostOf(link.url)} <ExternalLink aria-hidden="true" />
              </span>
            </a>
          </li>
        ))}
      </ul>
    </article>
  );
}

export function CheckTab({ board, now, onOpen }: { board: Board; now: Date; onOpen: (id: string) => void }) {
  const open = board.notes.filter(n => !n.done);
  const pending = open.filter(n => unverifiedCount(n) > 0).sort(compareNotes);
  const verified = open.filter(n => n.links.length > 0 && unverifiedCount(n) === 0).sort(compareNotes);
  const sourceLanes = new Set(board.lanes.filter(l => l.kind === 'source').map(l => l.id));
  const noLink = open.filter(n => n.links.length === 0 && sourceLanes.has(n.laneId));
  const total = pending.reduce((sum, n) => sum + unverifiedCount(n), 0);

  return (
    <div className="check-tab">
      <header className="tab-intro">
        <h2>Sources to double-check</h2>
        <p>
          {total === 0
            ? 'Everything with a link has been verified.'
            : `${total} ${total === 1 ? 'link' : 'links'} not verified yet, across ${pending.length} ${pending.length === 1 ? 'note' : 'notes'}.`}
        </p>
      </header>
      {pending.map(note => (
        <CheckCard key={note.id} note={note} data={board} now={now} onOpen={onOpen} />
      ))}
      {noLink.length > 0 && (
        <section>
          <h3 className="section-title">To look into (no link yet)</h3>
          <ul className="plain-list">
            {noLink.map(note => (
              <li key={note.id}>
                <button type="button" className="plain-row" onClick={() => onOpen(note.id)}>
                  {note.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {verified.length > 0 && (
        <details className="check-verified">
          <summary>Verified ({verified.length})</summary>
          {verified.map(note => (
            <CheckCard key={note.id} note={note} data={board} now={now} onOpen={onOpen} />
          ))}
        </details>
      )}
    </div>
  );
}
