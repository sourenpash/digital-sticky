# Digital Sticky

A sticky-note wall for a bedroom monitor. It shows colored squares for funding applications, sources to double-check, to-dos, recurring tasks and reminders, next to a calendar, deadline countdowns and progress bars for your goals. You edit it from your iPhone or any computer's browser, and the wall updates live.

![The wall screen](docs/screenshots/wall-day.png)

## Status: checkpoint 2, real data and live sync

The board is now real. A small server on the wall computer saves it to disk, and every phone, computer and the wall screen stay in sync:

- **Live updates.** A change on your phone shows on the wall within a moment (usually well under a second), and on every other open phone or computer.
- **Saved safely.** The board lives in `data/board.json`. Every save goes to a temporary file first and then replaces the old one, so a power cut can't leave half a file. The first save of each day keeps a copy of the day before in `data/backups/` (the last 30 days).
- **Undo works from any device.** Deleted notes, goals and columns wait in a trash for 30 days, so the Undo button always works.
- **Works through Wi-Fi hiccups.** Changes show instantly on the device you're using and are sent in the background. If the connection drops, they wait (the badge says "Offline · 1 waiting") and go through when it's back. iPhones reconnect by themselves when you come back to the page.
- **Columns** can be added (choose what goes in them), renamed, recolored, reordered and deleted, from the Wall tab.
- **On a computer**, drag a square to another column. Dragging into Recurring makes a note repeat; dragging out makes it a one-off again.
- **Download a backup** of everything from the Wall tab, and **Reload the wall** remotely if it ever looks stuck.

| Checkpoint | What it adds | Status |
| --- | --- | --- |
| 1 | Clickable prototype of the wall, phone and computer screens, with placeholder data | Done |
| 2 | Real data and live sync: a small server on the wall computer that saves the board to disk | Ready for review |
| 3 | Reminders on a timer, night-mode polish, PIN protection, add to Home Screen | Next |
| 4 | One-command install on the Intel NUC: auto-start and the full-screen wall | Planned |

Until checkpoint 3 adds the PIN, anyone on your Wi-Fi who knows the address can open and change the board.

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

### Backups and restoring

- `data/board.json` is the board. It's plain JSON; you can copy it anywhere.
- `data/backups/board-YYYY-MM-DD.json` holds a copy for each of the last 30 days.
- To restore, stop the server, copy the backup (or a downloaded one) over `data/board.json`, and start it again. Open screens reload the board by themselves.
- If `board.json` is ever damaged, the server sets it aside as `board.damaged-….json` and starts from the newest good backup.

## Screenshots

| Phone and wall side by side | The wall on day one |
| --- | --- |
| ![Side by side](docs/screenshots/demo-side-by-side.png) | ![A new board](docs/screenshots/wall-first-day.png) |

| Phone board | A goal | A recurring task | Editing a note | Columns and backups |
| --- | --- | --- | --- | --- |
| ![Phone board](docs/screenshots/phone-board.png) | ![Goal form](docs/screenshots/phone-goal.png) | ![Recurring task](docs/screenshots/phone-recurring.png) | ![Note form](docs/screenshots/phone-note.png) | ![Wall settings](docs/screenshots/phone-wall-settings.png) |

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
| `GET /api/events` | Live updates (server-sent events): `hello`, `change`, `ping` |
| `POST /api/notes` | Add a note: `{"laneId": "todo", "title": "Email the program officer"}` |
| `PATCH /api/notes/:id` | Change a note's fields (`null` clears one) |
| `DELETE /api/notes/:id`, `POST /api/notes/:id/restore` | Delete to the trash, and undo |
| `POST /api/notes/:id/completions` | Recurring tasks: `{"add": [time]}` or `{"remove": [time]}` |
| `POST /api/lanes`, `PATCH`/`DELETE /api/lanes/:id`, `PUT /api/lanes/order` | Columns |
| `POST /api/goals`, `PATCH`/`DELETE /api/goals/:id` | Goals |
| `PATCH /api/settings` | Night mode and wall settings |
| `GET /api/export` | Download everything, trash included |

Changes must be sent as JSON (`Content-Type: application/json`).

## Development

| Command | What it does |
| --- | --- |
| `npm run dev` | The board server plus a development server with live reload, at `http://localhost:5173` (add `-- --demo` for the sample board) |
| `npm run typecheck` | TypeScript checks for the app, the server and the tooling |
| `npm test` | Unit tests: the data rules, the store, the API, live updates and syncing |
| `npm run test:e2e` | Builds, then runs a real server with headless Chromium as a phone, a computer and the wall |
| `npm run build` | Production build into `dist/web` |
| `npm run screenshots` | Renders `docs/screenshots` against a real server with the sample board (build first) |
| `npm run build:preview-page` | A single self-contained HTML file that runs on sample data with no server |

The end-to-end tests and screenshots use Playwright's Chromium; set `PW_CHROMIUM` to the path of another Chrome or Chromium to use that instead.
