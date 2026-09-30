# Digital Sticky

A sticky-note wall for a bedroom monitor. It shows colored squares for applications (grants, jobs, schools, fellowships), sources to double-check, to-dos, recurring tasks and reminders, with a two-week calendar, deadline countdowns, progress bars for your goals and a ticker of prices and tech news. You edit it from your iPhone or any computer's browser, and the wall updates live.

![The wall screen](docs/screenshots/wall-day.png)

## Status: checkpoint 4, reminders, PIN, Home Screen and live ticker

- **Reminders on your phone.** When a reminder goes off it pops up on the wall (with a chime, never at night) and at the top of every screen of the app, with **Done** and **Dismiss**. A phone that has the app open also shows a short notice. Done on a recurring task logs it for today instead of ending it. Choose how long reminders stay up on the wall (15 minutes to 4 hours) under Wall → Reminders.
- **Optional PIN.** Run `npm run pin` on the wall computer, then restart the board. Each phone or computer asks for the PIN once and stays signed in (for a year, renewed while it's used). The wall computer itself never asks, because it has no keyboard. Sign a device out under Wall → PIN. Changing the PIN signs everyone out. Five wrong tries lock that device out for 15 minutes.
- **Add to Home Screen.** In Safari, tap Share → Add to Home Screen. The board opens like an app with its own icon. If there's a PIN, enter it once there too (Home Screen apps keep their own sign-in).
- **Live ticker.** The wall computer fetches prices every 5 minutes (crypto from CoinGecko; stocks from Yahoo Finance, which can be about 15 minutes behind) and headlines from each site's feed every 15 minutes. No accounts are needed. If a source can't be reached, the last values stay up, marked "As of …".
- **Wall polish.** The wall keeps the screen awake, says "Reconnecting to the board…" if it loses the server for more than 10 seconds, and shifts by a few pixels every 10 minutes so nothing burns into the screen.
- **Safer at home.** The board only answers to its own addresses (its IP address, `localhost`, and home-network names like `nuc.local`), so a web page on another site can't reach it through your browser. Add other names with `ALLOWED_HOSTS`.

From checkpoint 3: the two-week calendar strip, application types (grant, job, school, fellowship, other), the ticker settings and the phone remote screen. The remote starts working in checkpoint 5.

| Checkpoint | What it adds | Status |
| --- | --- | --- |
| 1 | Clickable prototype of the wall, phone and computer screens, with placeholder data | Done |
| 2 | Real data and live sync: a small server on the wall computer that saves the board to disk | Done |
| 3 | Two-week calendar, application types, ticker and phone remote screens; reminders on a timer | Done |
| 4 | Reminders on your phone, PIN protection, add to Home Screen, wall polish, live ticker prices and headlines | Ready for review |
| 5 | Remote control of the wall from your phone, and a one-command install on the Intel NUC | Next |

## Try it on any computer at home

You need [Node.js](https://nodejs.org) 22.18 or newer (the current LTS is fine). On the computer that will show the wall, or any Mac or Linux computer for now:

```sh
npm install
npm run build
npm start
```

It prints the addresses to open:

- **On that computer:** `http://localhost:3000/#wall` is the wall screen (press F11 for full screen), and `http://localhost:3000` is the editor.
- **On your phone** (same Wi-Fi): the address it prints next to "On your phone", such as `http://192.168.1.23:3000`. The wall also shows it with a QR code until you turn that off under Wall → Connect a phone.

The board starts empty with five columns. Stop the server with Ctrl+C; it saves before it quits.

To look around with the sample board instead, run `npm run demo`. It keeps its board in `data-demo/` and starts over from the sample on every start, so your real board is untouched.

### Settings

Put any of these in a `.env` file next to `package.json` (or set them in the environment):

| Setting | Default | What it does |
| --- | --- | --- |
| `PORT` | `3000` | Port the board is served on |
| `HOST` | `0.0.0.0` | Network address to listen on (all of them, so phones can connect) |
| `DATA_DIR` | `data` | Where the board and its backups are kept |
| `PUBLIC_URL` | (this computer's Wi-Fi address) | Address shown on the wall for phones, e.g. a Tailscale `https://` name |
| `BOARD_PIN` | (none) | 6 to 12 digits to lock the board with; set it with `npm run pin` |
| `TRUST_LOCALHOST` | `1` | With a PIN, let the wall computer's own browser (at `localhost`) in without it. Set to `0` to ask there too |
| `ALLOWED_HOSTS` | (none) | Other names the board may be opened at, comma-separated (its IP addresses, `localhost`, home-network names and the `PUBLIC_URL` name always work) |

### Backups and restoring

- `data/board.json` is the board. It's plain JSON; you can copy it anywhere.
- `data/backups/board-YYYY-MM-DD.json` holds a copy for each of the last 30 days.
- To restore, stop the server, copy the backup (or a downloaded one) over `data/board.json`, and start it again. Open screens reload the board by themselves.
- If `board.json` is ever damaged, the server sets it aside as `board.damaged-….json` and starts from the newest good backup.

## Screenshots

| Phone and wall side by side | The phone as a remote for the wall |
| --- | --- |
| ![Side by side](docs/screenshots/demo-side-by-side.png) | ![Remote](docs/screenshots/demo-remote.png) |

| A reminder going off | The PIN screen | New application: what kind? | A job application | Ticker settings | Wall remote |
| --- | --- | --- | --- | --- | --- |
| ![Reminder](docs/screenshots/phone-reminder.png) | ![PIN](docs/screenshots/phone-pin.png) | ![New application](docs/screenshots/phone-new-application.png) | ![Job application](docs/screenshots/phone-job.png) | ![Ticker settings](docs/screenshots/phone-ticker-settings.png) | ![Remote](docs/screenshots/phone-remote.png) |

| Phone board | A goal | A recurring task | Editing a note | Columns and backups |
| --- | --- | --- | --- | --- |
| ![Phone board](docs/screenshots/phone-board.png) | ![Goal form](docs/screenshots/phone-goal.png) | ![Recurring task](docs/screenshots/phone-recurring.png) | ![Note form](docs/screenshots/phone-note.png) | ![Wall settings](docs/screenshots/phone-wall-settings.png) |

![The wall on day one](docs/screenshots/wall-first-day.png)

![On a computer](docs/screenshots/desktop-board.png)

![Wall at night (dim)](docs/screenshots/wall-night-dim.png)

## Planned setup

An Intel NUC running Ubuntu LTS drives the monitor. It runs the board server and shows the wall in a full-screen browser, so no keyboard is needed. Phones and computers connect over home Wi-Fi, or from anywhere with Tailscale.

## How it works

- `server/` is a small [Hono](https://hono.dev) server. `store.ts` keeps the board in memory and saves it to `data/board.json`; `app.ts` is the HTTP API; `events.ts` sends live updates as server-sent events.
- `web/` is the React app for the wall, phones and computers. `store/sync.ts` applies each change on screen at once, sends it to the server in order, and keeps waiting changes through a lost connection. `store/live.ts` holds the live connection open and reconnects when an iPhone drops it.
- `shared/` holds what both sides use: the data types, the checks the server applies to every change (`schema.ts`), and the changes themselves (`ops.ts`), so a change looks the same on screen before and after the server saves it.

The API, for scripts (and later, an AI assistant):

| Request | What it does |
| --- | --- |
| `GET /api/state` | The whole board, with its revision number |
| `GET /api/events` | Live updates (server-sent events): `hello`, `change`, `ticker`, `ping` |
| `GET /api/session`, `POST /api/login`, `POST /api/logout` | Whether there's a PIN, and signing in (`{"pin": "…"}`) and out |
| `GET /api/ticker` | The ticker's current prices and headlines |
| `POST /api/notes` | Add a note: `{"laneId": "todo", "title": "Email the program officer"}` |
| `PATCH /api/notes/:id` | Change a note's fields (`null` clears one) |
| `DELETE /api/notes/:id`, `POST /api/notes/:id/restore` | Delete to the trash, and undo |
| `POST /api/notes/:id/completions` | Recurring tasks: `{"add": [time]}` or `{"remove": [time]}` |
| `POST /api/lanes`, `PATCH`/`DELETE /api/lanes/:id`, `PUT /api/lanes/order` | Columns |
| `POST /api/goals`, `PATCH`/`DELETE /api/goals/:id` | Goals |
| `PATCH /api/settings` | Night mode, wall and ticker settings |
| `POST /api/alerts`, `DELETE /api/alerts/:id` | Pop a note's reminder up on the wall now, and take it down |
| `GET /api/export` | Download everything, trash included |

Changes must be sent as JSON (`Content-Type: application/json`). With a PIN, everything except the health check and signing in needs the session cookie from `POST /api/login` (scripts on the wall computer itself, at `localhost`, don't).

## Development

| Command | What it does |
| --- | --- |
| `npm run dev` | The board server plus a development server with live reload, at `http://localhost:5173` (add `-- --demo` for the sample board) |
| `npm run pin` | Set the board's PIN in `.env` (`npm run pin -- --off` removes it) |
| `npm run typecheck` | TypeScript checks for the app, the server and the tooling |
| `npm test` | Unit tests: the data rules, the store, the API, live updates and syncing |
| `npm run test:e2e` | Builds, then runs a real server with headless Chromium as a phone, a computer and the wall |
| `npm run build` | Production build into `dist/web` |
| `npm run screenshots` | Renders `docs/screenshots` against a real server with the sample board (build first) |
| `npm run build:preview-page` | A single self-contained HTML file that runs on sample data with no server |

The end-to-end tests and screenshots use Playwright's Chromium; set `PW_CHROMIUM` to the path of another Chrome or Chromium to use that instead.
