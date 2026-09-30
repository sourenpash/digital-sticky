# Digital Sticky

A sticky-note wall for a bedroom monitor. It shows colored squares for funding applications, sources to double-check, to-dos and reminders, next to a calendar and deadline countdowns. You edit it from your iPhone or any computer's browser, and the wall updates live.

![The wall screen](docs/screenshots/wall-day.png)

## Status: checkpoint 1, the clickable UI prototype

This checkpoint is the user interface only, filled with sample data. **Nothing is saved yet.** It exists so the layout and the flow of information can be approved before the real functionality is built.

| Checkpoint | What it adds | Status |
| --- | --- | --- |
| 1 | Clickable prototype of the wall, phone and computer screens, with placeholder data | Ready for review |
| 2 | Real data and live sync: a small server on the wall computer that saves the board to disk | Next |
| 3 | Reminders on a timer, night-mode schedule, PIN protection, the phone QR code | Planned |
| 4 | One-command install on the Intel NUC: auto-start and the full-screen wall | Planned |

## Try the prototype

You need Node.js 22.12 or newer.

```sh
npm install
npm run dev
```

Then open the address it prints:

- `http://localhost:5173/#demo` shows the phone and the wall side by side, sharing one board
- `#wall` is the wall screen on its own (what the bedroom monitor will show)
- `#board` is the editor; narrow the window to see the phone layout
- `#login` is the PIN screen

The **Prototype** button in the corner switches screens and wall states: night mode (dim or clock only), a reminder popping up, and the "connect your phone" QR code.

## Screenshots

| Phone and wall side by side | Wall at night (dim) |
| --- | --- |
| ![Side by side](docs/screenshots/demo-side-by-side.png) | ![Night](docs/screenshots/wall-night-dim.png) |

| Phone board | Editing a note | On a computer |
| --- | --- | --- |
| ![Phone board](docs/screenshots/phone-board.png) | ![Note form](docs/screenshots/phone-note.png) | ![Desktop](docs/screenshots/desktop-board.png) |

## Planned setup

An Intel NUC running Ubuntu LTS drives the monitor. It runs the board server and shows the wall in a full-screen browser, so no keyboard is needed. Phones and computers connect over home Wi-Fi, or from anywhere with Tailscale.

## Development

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with live reload |
| `npm run typecheck` | TypeScript checks for the app and the tooling |
| `npm test` | Unit tests |
| `npm run build` | Production build into `dist/web` |
| `npm run screenshots` | Renders `docs/screenshots` in headless Chromium (build first) |
| `npm run build:preview-page` | A single self-contained HTML file of the prototype |
