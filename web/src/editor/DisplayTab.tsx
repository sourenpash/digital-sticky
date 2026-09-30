import { useState } from 'react';
import { Bell, ChevronDown, ChevronUp, Columns3, Download, Lock, Monitor, Moon, Plus, QrCode, RotateCw, Trash2 } from 'lucide-react';
import { lanesInOrder } from '../../../shared/board.ts';
import { LANE_KINDS, NOTE_COLORS, type Board, type Lane, type LaneKind, type NightMode, type NightStyle, type Settings } from '../../../shared/types.ts';
import { board as store, reloadWall, useSync } from '../store/board.ts';
import { showToast } from '../store/toasts.ts';
import { Wall } from '../wall/Wall.tsx';

function Switch({ id, checked, label, onChange }: { id: string; checked: boolean; label: string; onChange: (value: boolean) => void }) {
  return (
    <div className="switch-row">
      <label htmlFor={id}>{label}</label>
      <button id={id} type="button" role="switch" aria-checked={checked} className="switch" onClick={() => onChange(!checked)}>
        <span className="switch-knob" />
      </button>
    </div>
  );
}

const NIGHT_MODES: Array<{ value: NightMode; label: string }> = [
  { value: 'auto', label: 'On a schedule' },
  { value: 'on', label: 'Always' },
  { value: 'off', label: 'Never' },
];

const NIGHT_STYLES: Array<{ value: NightStyle; label: string; hint: string }> = [
  { value: 'dim', label: 'Dim the board', hint: 'Everything stays, much darker' },
  { value: 'clock', label: 'Clock only', hint: 'Just the time and next deadline' },
];

/** What a new column is for, in the words the Add menu uses. */
const KIND_LABEL: Record<LaneKind, string> = {
  application: 'Funding applications',
  source: 'Sources to double-check',
  task: 'To-dos',
  routine: 'Recurring tasks',
  reminder: 'Reminders',
  note: 'Sticky notes',
};

function ColumnsSection({ board }: { board: Board }) {
  const [newColumn, setNewColumn] = useState('');
  const [newKind, setNewKind] = useState<LaneKind>('note');
  const [confirming, setConfirming] = useState<string | null>(null);
  const lanes = lanesInOrder(board.lanes);

  const remove = (lane: Lane) => {
    setConfirming(null);
    const removed = store.deleteLane(lane.id);
    if (!removed) return;
    const count = removed.notes.length;
    showToast({
      text: `Deleted “${lane.title || 'Untitled'}”${count ? ` and its ${count} note${count === 1 ? '' : 's'}` : ''}`,
      actionLabel: 'Undo',
      action: () => store.restoreLane(removed),
    });
  };

  return (
    <section className="set-group">
      <h3>
        <Columns3 aria-hidden="true" /> Columns
      </h3>
      <ul className="lane-list">
        {lanes.map((lane, i) => {
          const count = board.notes.filter(n => n.laneId === lane.id).length;
          return (
            <li key={lane.id} className="lane-item">
              <div className="lane-row">
                <button
                  type="button"
                  className={`swatch-btn paper-${lane.color}`}
                  aria-label={`Change color of ${lane.title} (now ${lane.color})`}
                  onClick={() => {
                    const next = NOTE_COLORS[(NOTE_COLORS.indexOf(lane.color) + 1) % NOTE_COLORS.length] ?? 'yellow';
                    store.updateLane(lane.id, { color: next });
                  }}
                />
                <input aria-label="Column name" value={lane.title} placeholder="Untitled" onChange={e => store.updateLane(lane.id, { title: e.target.value })} />
                <button type="button" className="icon-btn icon-btn-sm" aria-label={`Move ${lane.title} left on the wall`} disabled={i === 0} onClick={() => store.moveLane(lane.id, -1)}>
                  <ChevronUp />
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn-sm"
                  aria-label={`Move ${lane.title} right on the wall`}
                  disabled={i === lanes.length - 1}
                  onClick={() => store.moveLane(lane.id, 1)}
                >
                  <ChevronDown />
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn-sm"
                  aria-label={`Delete ${lane.title}`}
                  disabled={lanes.length <= 1}
                  onClick={() => setConfirming(confirming === lane.id ? null : lane.id)}
                >
                  <Trash2 />
                </button>
              </div>
              {confirming === lane.id && (
                <div className="lane-confirm" role="alert">
                  <span>
                    Delete “{lane.title || 'Untitled'}”{count ? ` and its ${count} note${count === 1 ? '' : 's'}` : ''}?
                  </span>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(lane)}>
                    Delete
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirming(null)}>
                    Keep
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="set-note">Top to bottom here is left to right on the wall.</p>
      <form
        className="lane-add"
        onSubmit={e => {
          e.preventDefault();
          if (!newColumn.trim()) return;
          store.addLane(newColumn.trim(), newKind);
          setNewColumn('');
        }}
      >
        <input aria-label="New column name" value={newColumn} placeholder="New column" onChange={e => setNewColumn(e.target.value)} />
        <select aria-label="What goes in it" value={newKind} onChange={e => setNewKind(e.target.value as LaneKind)}>
          {LANE_KINDS.map(kind => (
            <option key={kind} value={kind}>
              {KIND_LABEL[kind]}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-sm" disabled={!newColumn.trim()}>
          <Plus aria-hidden="true" /> Add
        </button>
      </form>
    </section>
  );
}

export function DisplayTab({ board, now, desktop, go }: { board: Board; now: Date; desktop: boolean; go: (token: string) => void }) {
  const { night, wall } = board.settings;
  const { connectUrl } = useSync();
  const setNight = (patch: Partial<Settings['night']>) => store.updateSettings(s => ({ ...s, night: { ...s.night, ...patch } }));
  const setWall = (patch: Partial<Settings['wall']>) => store.updateSettings(s => ({ ...s, wall: { ...s.wall, ...patch } }));
  const nextReminder = board.notes.find(n => n.remindAt && !n.done && !board.alerts.some(a => a.noteId === n.id));

  return (
    <div className={`display-tab${desktop ? ' is-desktop' : ''}`}>
      <section className="display-preview" aria-label="Wall preview">
        <div className="preview-frame">
          <Wall board={board} now={now} connectUrl={connectUrl} />
        </div>
        <p className="preview-caption">Live preview of the wall. Changes here show there instantly.</p>
      </section>

      <div className="settings">
        <section className="set-group">
          <h3>
            <Moon aria-hidden="true" /> Night mode
          </h3>
          <div className="seg-group" role="radiogroup" aria-label="When to switch to night mode">
            {NIGHT_MODES.map(m => (
              <button key={m.value} type="button" role="radio" aria-checked={night.mode === m.value} className={`seg${night.mode === m.value ? ' is-on' : ''}`} onClick={() => setNight({ mode: m.value })}>
                {m.label}
              </button>
            ))}
          </div>
          {night.mode === 'auto' && (
            <div className="set-row time-range">
              <label htmlFor="night-start">From</label>
              <input id="night-start" type="time" value={night.start} onChange={e => e.target.value && setNight({ start: e.target.value })} />
              <label htmlFor="night-end">to</label>
              <input id="night-end" type="time" value={night.end} onChange={e => e.target.value && setNight({ end: e.target.value })} />
            </div>
          )}
          <div className="radio-cards" role="radiogroup" aria-label="Night look">
            {NIGHT_STYLES.map(style => (
              <button key={style.value} type="button" role="radio" aria-checked={night.style === style.value} className={`radio-card${night.style === style.value ? ' is-on' : ''}`} onClick={() => setNight({ style: style.value })}>
                <span className="radio-card-title">{style.label}</span>
                <span className="radio-card-hint">{style.hint}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="set-group">
          <h3>
            <Bell aria-hidden="true" /> Reminders
          </h3>
          {board.alerts.length === 0 ? (
            <p className="set-note">No reminders showing on the wall right now.</p>
          ) : (
            <ul className="alert-list">
              {board.alerts.map(alert => (
                <li key={alert.id} className="alert-row">
                  <Bell aria-hidden="true" />
                  <span className="alert-title">{alert.title}</span>
                  <button type="button" className="btn btn-sm" onClick={() => store.dismissAlert(alert.id)}>
                    Dismiss
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Switch id="chime" checked={wall.chime} label="Chime when a reminder pops up (never at night)" onChange={chime => setWall({ chime })} />
          {nextReminder && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => store.fireReminder(nextReminder.id)}>
              Try it: pop up “{nextReminder.title}” on the wall
            </button>
          )}
        </section>

        <section className="set-group">
          <h3>
            <QrCode aria-hidden="true" /> Connect a phone
          </h3>
          <Switch id="show-qr" checked={wall.showConnect} label="Show the “Connect your phone” code on the wall" onChange={showConnect => setWall({ showConnect })} />
          <p className="set-note">
            {connectUrl ? (
              <>
                Wall address: <strong>{connectUrl.replace(/^https?:\/\//, '')}</strong>
              </>
            ) : (
              'The wall computer didn’t find its Wi-Fi address, so the code is hidden.'
            )}
          </p>
        </section>

        <ColumnsSection board={board} />

        <section className="set-group">
          <h3>
            <Monitor aria-hidden="true" /> Wall screen
          </h3>
          <button type="button" className="btn btn-sm" onClick={() => void reloadWall()}>
            <RotateCw aria-hidden="true" /> Reload the wall
          </button>
          <p className="set-note">Use this if the wall ever looks stuck.</p>
          {!__DEMO_BUILD__ && (
            <>
              <a className="btn btn-sm" href="api/export" download>
                <Download aria-hidden="true" /> Download a backup
              </a>
              <p className="set-note">The wall computer also keeps a copy of each day for 30 days.</p>
            </>
          )}
        </section>

        <section className="set-group">
          <h3>
            <Lock aria-hidden="true" /> PIN
          </h3>
          {__DEMO_BUILD__ ? (
            <>
              <p className="set-note">A PIN is set. Each phone or computer asks for it once.</p>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => go('login')}>
                See the PIN screen
              </button>
            </>
          ) : (
            <p className="set-note">Coming in the next step: a PIN, so only your phones and computers can change the board.</p>
          )}
        </section>
      </div>
    </div>
  );
}
