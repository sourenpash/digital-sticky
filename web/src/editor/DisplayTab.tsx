import { useState } from 'react';
import { Bell, Columns3, Lock, Monitor, Moon, Plus, QrCode, RotateCw } from 'lucide-react';
import { lanesInOrder } from '../../../shared/board.ts';
import { NOTE_COLORS, type Board, type NightMode, type NightStyle, type Settings } from '../../../shared/types.ts';
import { SAMPLE_CONNECT_URL } from '../data/sample.ts';
import { board as store } from '../store/board.ts';
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

export function DisplayTab({ board, now, desktop, go }: { board: Board; now: Date; desktop: boolean; go: (token: string) => void }) {
  const { night, wall } = board.settings;
  const [newColumn, setNewColumn] = useState('');
  const setNight = (patch: Partial<Settings['night']>) => store.updateSettings(s => ({ ...s, night: { ...s.night, ...patch } }));
  const setWall = (patch: Partial<Settings['wall']>) => store.updateSettings(s => ({ ...s, wall: { ...s.wall, ...patch } }));
  const nextReminder = board.notes.find(n => n.remindAt && !n.done && !board.alerts.some(a => a.noteId === n.id));

  return (
    <div className={`display-tab${desktop ? ' is-desktop' : ''}`}>
      <section className="display-preview" aria-label="Wall preview">
        <div className="preview-frame">
          <Wall board={board} now={now} connectUrl={SAMPLE_CONNECT_URL} />
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
            Wall address: <strong>{SAMPLE_CONNECT_URL.replace(/^https?:\/\//, '')}</strong>
          </p>
        </section>

        <section className="set-group">
          <h3>
            <Columns3 aria-hidden="true" /> Columns
          </h3>
          <ul className="lane-list">
            {lanesInOrder(board.lanes).map(lane => (
              <li key={lane.id} className="lane-row">
                <button
                  type="button"
                  className={`swatch-btn paper-${lane.color}`}
                  aria-label={`Change color of ${lane.title} (now ${lane.color})`}
                  onClick={() => {
                    const next = NOTE_COLORS[(NOTE_COLORS.indexOf(lane.color) + 1) % NOTE_COLORS.length] ?? 'yellow';
                    store.updateLane(lane.id, { color: next });
                  }}
                />
                <input aria-label="Column name" value={lane.title} onChange={e => store.updateLane(lane.id, { title: e.target.value })} />
                <span className="lane-row-count">{board.notes.filter(n => n.laneId === lane.id && !n.done).length}</span>
              </li>
            ))}
          </ul>
          <form
            className="ne-add"
            onSubmit={e => {
              e.preventDefault();
              if (!newColumn.trim()) return;
              store.addLane(newColumn.trim());
              setNewColumn('');
            }}
          >
            <input aria-label="New column name" value={newColumn} placeholder="New column" onChange={e => setNewColumn(e.target.value)} />
            <button type="submit" className="btn btn-sm" disabled={!newColumn.trim()}>
              <Plus aria-hidden="true" /> Add
            </button>
          </form>
        </section>

        <section className="set-group">
          <h3>
            <Monitor aria-hidden="true" /> Wall screen
          </h3>
          <button type="button" className="btn btn-sm" onClick={() => showToast({ text: 'The wall screen is reloading' })}>
            <RotateCw aria-hidden="true" /> Reload the wall
          </button>
          <p className="set-note">Use this if the wall ever looks stuck.</p>
        </section>

        <section className="set-group">
          <h3>
            <Lock aria-hidden="true" /> PIN
          </h3>
          <p className="set-note">A PIN is set. Each phone or computer asks for it once.</p>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => go('login')}>
            See the PIN screen
          </button>
        </section>
      </div>
    </div>
  );
}
