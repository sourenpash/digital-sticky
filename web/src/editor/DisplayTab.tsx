import { useState } from 'react';
import { Bell, ChevronDown, ChevronRight, ChevronUp, Columns3, Download, Lock, Monitor, Moon, MousePointer2, Plus, QrCode, RotateCw, Trash2, TrendingUp, X } from 'lucide-react';
import { lanesInOrder } from '../../../shared/board.ts';
import { CRYPTO_SYMBOL, MAX_CRYPTO, MAX_NEWS, MAX_STOCKS, NEWS_SOURCES, STOCK_SYMBOL, newsTag } from '../../../shared/ticker.ts';
import { LANE_KINDS, NOTE_COLORS, type Board, type Lane, type LaneKind, type NightMode, type NightStyle, type Settings, type TickerSettings } from '../../../shared/types.ts';
import { board as store, reloadWall, useSync } from '../store/board.ts';
import { logout, useSession } from '../store/session.ts';
import { showToast } from '../store/toasts.ts';
import { Wall } from '../wall/Wall.tsx';
import { normalizeUrl } from './NoteEditor.tsx';

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

const STAY_UP = [
  { minutes: 15, label: '15 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 120, label: '2 hours' },
  { minutes: 240, label: '4 hours' },
];

const NIGHT_STYLES: Array<{ value: NightStyle; label: string; hint: string }> = [
  { value: 'dim', label: 'Dim the board', hint: 'Everything stays, much darker' },
  { value: 'clock', label: 'Clock only', hint: 'Just the time and next deadline' },
];

/** What a new column is for, in the words the Add menu uses. */
const KIND_LABEL: Record<LaneKind, string> = {
  application: 'Applications',
  source: 'Sources to double-check',
  task: 'To-dos',
  routine: 'Recurring tasks',
  reminder: 'Reminders',
  note: 'Sticky notes',
};

/** Symbols as removable chips, plus a box to add one. */
function SymbolList({
  id,
  label,
  placeholder,
  values,
  max,
  pattern,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  values: string[];
  max: number;
  pattern: RegExp;
  onChange: (values: string[]) => void;
}) {
  const [text, setText] = useState('');
  const symbol = text.trim().toUpperCase();
  const valid = pattern.test(symbol) && !values.includes(symbol);
  const add = () => {
    if (!valid) return;
    onChange([...values, symbol]);
    setText('');
  };
  return (
    <div className="sym-field">
      <span className="field-label">{label}</span>
      <ul className="sym-list">
        {values.map(value => (
          <li key={value} className="sym-chip">
            {value}
            <button type="button" aria-label={`Remove ${value}`} onClick={() => onChange(values.filter(v => v !== value))}>
              <X aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {values.length < max && (
        <form
          className="set-row"
          onSubmit={e => {
            e.preventDefault();
            add();
          }}
        >
          <input id={id} className="sym-input" aria-label={`New ${label.toLowerCase()} symbol`} value={text} placeholder={placeholder} autoCapitalize="characters" autoComplete="off" onChange={e => setText(e.target.value)} />
          <button type="submit" className="btn btn-sm" aria-label={`Add to ${label.toLowerCase()}`} disabled={!valid}>
            <Plus aria-hidden="true" /> Add
          </button>
        </form>
      )}
    </div>
  );
}

function TickerSection({ ticker }: { ticker: TickerSettings }) {
  const [feed, setFeed] = useState('');
  const set = (patch: Partial<TickerSettings>) => store.updateSettings(s => ({ ...s, ticker: { ...s.ticker, ...patch } }));
  const custom = ticker.news.filter(entry => !NEWS_SOURCES.some(source => source.id === entry));
  const toggle = (id: string) => set({ news: ticker.news.includes(id) ? ticker.news.filter(entry => entry !== id) : [...ticker.news, id] });
  const feedUrl = normalizeUrl(feed);
  const addFeed = () => {
    if (!feedUrl || ticker.news.includes(feedUrl) || ticker.news.length >= MAX_NEWS) return;
    set({ news: [...ticker.news, feedUrl] });
    setFeed('');
  };

  return (
    <section className="set-group">
      <h3>
        <TrendingUp aria-hidden="true" /> Ticker
      </h3>
      <Switch id="ticker-show" checked={ticker.show} label="Show prices and tech news along the bottom (hidden at night)" onChange={show => set({ show })} />
      {ticker.show && (
        <>
          <SymbolList id="ticker-crypto" label="Crypto" placeholder="e.g. SOL" values={ticker.crypto} max={MAX_CRYPTO} pattern={CRYPTO_SYMBOL} onChange={crypto => set({ crypto })} />
          <SymbolList id="ticker-stocks" label="Stocks" placeholder="e.g. TSLA" values={ticker.stocks} max={MAX_STOCKS} pattern={STOCK_SYMBOL} onChange={stocks => set({ stocks })} />
          <div className="sym-field">
            <span className="field-label">Tech news</span>
            <div className="seg-group" role="group" aria-label="News sources">
              {NEWS_SOURCES.map(source => {
                const on = ticker.news.includes(source.id);
                return (
                  <button key={source.id} type="button" aria-pressed={on} className={`seg${on ? ' is-on' : ''}`} onClick={() => toggle(source.id)}>
                    {source.label}
                  </button>
                );
              })}
            </div>
            {custom.length > 0 && (
              <ul className="sym-list">
                {custom.map(entry => (
                  <li key={entry} className="sym-chip">
                    {newsTag(entry)}
                    <button type="button" aria-label={`Remove ${newsTag(entry)}`} onClick={() => set({ news: ticker.news.filter(e => e !== entry) })}>
                      <X aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {ticker.news.length < MAX_NEWS && (
              <form
                className="set-row"
                onSubmit={e => {
                  e.preventDefault();
                  addFeed();
                }}
              >
                <input id="ticker-feed" className="sym-input sym-input-wide" aria-label="Add a news feed address" value={feed} placeholder="RSS feed address" inputMode="url" autoComplete="off" onChange={e => setFeed(e.target.value)} />
                <button type="submit" className="btn btn-sm" aria-label="Add news feed" disabled={!feedUrl}>
                  <Plus aria-hidden="true" /> Add
                </button>
              </form>
            )}
          </div>
          <p className="set-note">
            {__DEMO_BUILD__
              ? 'The preview shows made-up prices and headlines.'
              : 'The wall computer fetches prices every 5 minutes (crypto from CoinGecko, stocks from Yahoo Finance, which can be about 15 minutes behind) and headlines from each site’s feed.'}
          </p>
        </>
      )}
    </section>
  );
}

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

function PinSection({ go }: { go: (token: string) => void }) {
  const session = useSession();
  let body;
  if (__DEMO_BUILD__) {
    body = (
      <>
        <p className="set-note">A PIN is set. Each phone or computer asks for it once.</p>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => go('login')}>
          See the PIN screen
        </button>
      </>
    );
  } else if (!session) {
    body = <p className="set-note">Checking…</p>;
  } else if (!session.pinSet) {
    body = (
      <p className="set-note">
        No PIN is set, so anyone on your Wi-Fi who knows the address can open the board. To set one, run <code>npm run pin</code> on the wall computer and
        restart the board.
      </p>
    );
  } else if (session.wallComputer) {
    body = <p className="set-note">The board is locked with a PIN. This is the wall computer, so it doesn’t need it.</p>;
  } else {
    body = (
      <>
        <p className="set-note">The board is locked with a PIN, and this device is signed in. It stays signed in until you sign out or the PIN changes.</p>
        <button type="button" className="btn btn-sm" onClick={() => void logout()}>
          Sign out this device
        </button>
      </>
    );
  }
  return (
    <section className="set-group">
      <h3>
        <Lock aria-hidden="true" /> PIN
      </h3>
      {body}
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
          <p className="set-note">A reminder pops up on the wall at its time, and at the top of this app, with Done and Dismiss.</p>
          <div className="sym-field">
            <span className="field-label" id="stay-up">Reminders stay up for</span>
            <div className="seg-group" role="radiogroup" aria-labelledby="stay-up">
              {STAY_UP.map(option => (
                <button key={option.minutes} type="button" role="radio" aria-checked={wall.alertMinutes === option.minutes} className={`seg${wall.alertMinutes === option.minutes ? ' is-on' : ''}`} onClick={() => setWall({ alertMinutes: option.minutes })}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
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
          <p className="set-note">
            <strong>Add it to your Home Screen:</strong> open the address in Safari, tap Share, then Add to Home Screen. It opens like an app. If the board has a PIN,
            enter it once there too.
          </p>
        </section>

        <TickerSection ticker={board.settings.ticker} />

        <ColumnsSection board={board} />

        <section className="set-group">
          <h3>
            <Monitor aria-hidden="true" /> Wall screen
          </h3>
          <button type="button" className="remote-card" onClick={() => go('remote')}>
            <MousePointer2 aria-hidden="true" />
            <span className="remote-card-text">
              <span className="remote-card-title">Control the wall screen</span>
              <span className="remote-card-hint">Use your phone as a touchpad and keyboard</span>
            </span>
            <ChevronRight aria-hidden="true" />
          </button>
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

        <PinSection go={go} />
      </div>
    </div>
  );
}
