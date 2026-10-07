# Digital Sticky

A sticky-note wall for a bedroom monitor. It shows colored squares for applications (grants, jobs, schools, fellowships), sources to double-check, to-dos, recurring tasks and reminders, with a two-week calendar, deadline countdowns, progress bars for your goals and a ticker of prices and tech news. You edit it from your iPhone or any computer's browser, and the wall updates live. Your phone can also act as a touchpad and keyboard for the wall.

![The wall screen](docs/screenshots/wall-day.png)

## Status: checkpoint 7, use it from anywhere, and any device as the wall

- **From anywhere.** One command on the wall computer, `scripts/linux/anywhere.sh`, gives the board a fixed `https://` address on the internet (with Tailscale Funnel, free). Nothing changes on your router, and the wall computer still serves everything itself. See [From anywhere](#from-anywhere-optional).
- **Sign in by scanning the wall.** The wall's "Connect your phone" code now signs a phone in too: point the camera at it and the board opens, signed in. Under the code is the same code as text, like `K7QM-2XPA`, to type in where you can't scan (a Home Screen app, say).
  - From the internet, every device signs in once, PIN or not. At home, a board without a PIN stays open as before.
  - Away from the wall, a phone that's signed in can connect another device: Wall → **Connect another device** shows a code for it.
  - Codes work once, for 10 minutes, and the wall shows a new one every couple of minutes.
- **Wall screens.** Any device can show the wall: an iPad, a TV's web browser, an old laptop, as many as you like. On the device, choose Wall → **Use this device as a wall screen**. From then on it opens straight to the wall, and a tap shows **Edit the board**. The Wall tab lists every wall screen and whether it's showing the wall now.
- **The AI helper** is still screens only. Next, any AI that can use MCP (a Claude routine, Claude Code, OpenClaw and others) connects to the board to do the stickies you hand it, and reports back on them.

| Checkpoint | What it adds | Status |
| --- | --- | --- |
| 1 | Clickable prototype of the wall, phone and computer screens, with placeholder data | Done |
| 2 | Real data and live sync: a small server on the wall computer that saves the board to disk | Done |
| 3 | Two-week calendar, application types, ticker and phone remote screens; reminders on a timer | Done |
| 4 | Reminders on your phone, PIN protection, add to Home Screen, wall polish, live ticker prices and headlines | Done |
| 5 | Remote control of the wall from your phone, and a one-command install on the Intel NUC | Done |
| 6 | Related tasks, follow-up reminders, emails and texts as to-dos, hiding the Connect code, and the AI helper's screens | Done |
| 7 | Use it from anywhere (Tailscale Funnel), sign in by scanning the wall's code, and any device as a wall screen | Ready for review |
| 8 | The AI helper: any AI connects over MCP, and the board wakes it when something's due (Claude routines, OpenClaw, webhooks) | Next |
| 9 | Reminders by text: push notifications on your iPhone, and iMessage through a Mac | Later |

## Set up the wall computer

### What you need

- An Intel NUC (or any small PC) with **Ubuntu Desktop 24.04 LTS or newer**, plugged into the monitor, and a keyboard and mouse for the setup. Afterwards the wall runs without them.
- While installing Ubuntu:
  - pick your **time zone**, because the wall's clock, night mode and reminders follow it;
  - don't turn on disk encryption with a passphrase, because nobody will be there to type it when the NUC starts.
- In the NUC's firmware settings (press F2 while it starts), set **After Power Failure** to **Power On**, so the wall comes back after a power cut.

### Install

Open a terminal on the NUC (Ctrl+Alt+T) and run:

```sh
sudo apt install -y git
git clone https://github.com/sourenpash/digital-sticky.git
cd digital-sticky
./scripts/linux/install.sh
```

If the repository is private, sign in to GitHub first: `sudo apt install -y gh`, then `gh auth login`, then `gh repo clone sourenpash/digital-sticky` instead of `git clone`.

The installer explains each step and asks before it downloads or installs anything:

1. **Node.js.** It uses the Node.js already installed (22.18 or newer). Otherwise it offers to download the official Node.js 24 LTS into `~/.local/share/sticky-wall/node`, checked against its published checksum. Nothing outside your home folder changes.
2. **The board** is installed and built.
3. **PIN.** It offers to set one (recommended). Without a PIN, anyone on your Wi-Fi can open the board and use the wall remote.
4. **From anywhere.** It asks whether to set up using the board from anywhere (see [From anywhere](#from-anywhere-optional)). You can also do that later.
5. **Browser.** It looks for Google Chrome or Chromium, and offers to install Chromium if neither is there.
6. **Board server.** It sets the board up as a service that starts at power-on, even before anyone logs in.
7. **Wall screen.** The wall opens full screen whenever someone logs in.
8. **Screen settings.** It turns off screen blanking, the lock screen, automatic suspend, and pop-ups over the wall.

Then do the one step the installer can't: turn on **automatic login** (Settings → System → Users → Automatic Login). Restart the NUC, and the wall comes up by itself.

It's safe to run the installer again at any time; that's also how to repair the setup.

The wall looks after itself. If the browser closes or crashes, it opens again. If the wall's page crashes, or can't load because the board was restarting, it's loaded again within seconds. The browser also restarts once a night, at 4 AM, so it doesn't slowly use up memory.

### Connect your phone

Point your phone's camera at the code on the wall, or open the address the installer printed, such as `http://192.168.1.23:3000`. Without [From anywhere](#from-anywhere-optional), your phone has to be on the same Wi-Fi. In Safari, tap Share → **Add to Home Screen**.

Where the board asks you to sign in (with a PIN, or from the internet), scanning the code signs you in too. Or type the code shown under it, or the PIN. The Home Screen app usually comes signed in; if it asks, type the code from the wall.

The Home Screen app and its sign-in are tied to that address. With From anywhere, the address never changes. Otherwise, to keep it from changing, do one of these:

- give the NUC a fixed address in your router's settings (often called a "DHCP reservation");
- or use its name instead, such as `http://nuc.local:3000` (the installer prints it). To make the wall's QR code show the name, put `PUBLIC_URL=http://nuc.local:3000` in `.env`.

### Wall screens: an iPad or a TV as the wall

Any device with a web browser can show the wall, next to the NUC's monitor or in another room. On the device, open the board (and sign in if it asks), then choose Wall → **Use this device as a wall screen** and give it a name.

- From then on it opens straight to the wall. Tap it, or move the mouse, for **Edit the board**.
- On an iPad, add the board to the Home Screen first and open it from there, so the wall fills the screen. Keep it plugged in. At the From anywhere address (which is `https://`) the wall asks the iPad to keep the screen on; if it still goes dark, or at a Wi-Fi address, set Auto-Lock to Never (Settings → Display & Brightness).
- Browsers hold sounds back until the wall has been tapped once, so the wall says "Tap anywhere to turn on sounds" until then.
- The Wall tab lists every wall screen: "Showing the wall now", or when it last did, with Rename and Remove. Removing one stops it opening to the wall, and where devices sign in, it has to sign in again.
- A wall screen is tied to the address it was set up at, like a sign-in. If you turn on From anywhere later, set it up again at the new address.
- An iPad can't take over from the NUC, because iPadOS doesn't let a web server run in the background. Something still has to run the board: the NUC, a mini PC or a Raspberry Pi. The phone remote controls only that computer's wall.

### Using the remote

![The phone as a remote](docs/screenshots/phone-remote.png)

On the phone, go to Wall → **Control the wall screen**, and see the [screenshots](#screenshots) below.

- Drag to move the cursor, tap to click, tap twice to double-click, and scroll with two fingers.
- When you tap a text box on the wall, a **Tap to type** bar shows up. Letters appear on the wall as you type, and the phone's keyboard matches the box: an email box gets the @ keyboard, and a password stays out of the phone's word suggestions.
- **Website** opens a site over the wall in its own tab. **Back** or **Board** closes it again, and the board keeps running underneath, so reminders and changes are there when you come back.
- When a website asks "OK or Cancel?", you answer it on the phone.

A few things to know:

- **Only the wall's browser can be controlled.** Ubuntu's own windows and messages can't, and neither can a browser welcome or privacy notice that appears once when Chrome first starts: click through that with a mouse.
- **What it can't do (yet):**
  - right-click, or drag things around;
  - point with the phone's motion sensors (that needs HTTPS on iPhone; it could come with Tailscale, below).
- **How it works:** the board server drives the wall's browser through Chrome's debugging port. Only programs on the NUC itself can reach that port; phones and web pages can't.
- **Don't sign in to personal accounts** (Google, email, banking) in the wall's browser. Any program running on the NUC could use that browser.
- **Typing isn't encrypted.** What you type on the remote crosses your Wi-Fi unencrypted, like the rest of the board. Don't type important passwords into websites on the wall, or use Tailscale, which encrypts it.
- **Turning the remote off:** put `KIOSK_DEBUG_PORT=off` in `.env`, then restart the NUC.

### Everyday things

| To… | Run this on the NUC |
| --- | --- |
| Update to the newest version | `scripts/linux/update.sh` (or `npm run update`) |
| Set, change or remove the PIN | `npm run pin` (or `npm run pin -- --off`); the board restarts with the change |
| Use the board from anywhere | `scripts/linux/anywhere.sh` (`--status` to check, `--off` to stop) |
| Restart the board | `systemctl --user restart sticky-wall` |
| See what the board is doing | `journalctl --user -u sticky-wall -f` |
| Get to the desktop | Move the mouse: the pointer shows, with **Exit to desktop** in the top-right corner. (Or Alt+Tab, or `scripts/linux/kiosk.sh --stop`) |
| Open the wall screen again | Click **Sticky Wall** in the dock. (Or `scripts/linux/kiosk.sh`, or log out and back in) |
| See what the wall screen did | `~/.local/state/sticky-wall/kiosk.log` |

### From anywhere (optional)

Run `scripts/linux/anywhere.sh` on the NUC, or say yes to it in the installer. It sets up [Tailscale Funnel](https://tailscale.com/kb/1223/funnel), which gives the board a fixed `https://` address on the internet, like `https://nuc.tail1234.ts.net`:

- **Nothing changes on your router.** It works behind any internet connection, including a phone hotspot or a provider that shares one address between many homes ("carrier-grade NAT").
- **The NUC still serves the board itself.** Nothing is hosted anywhere else, and there's no account with us. Tailscale's relays pass the traffic along without being able to read it: the encryption ends on the NUC, which holds the certificate.
- **It's free** for personal use. Your phone doesn't need Tailscale; it's an ordinary web address.

The script asks before it changes anything, then:

1. installs Tailscale with its official script, if it's missing (this needs your password);
2. signs the NUC in to Tailscale: scan the QR code it shows with your phone and sign in with Google, Apple, Microsoft or GitHub;
3. turns on Funnel for the board. The first time, Tailscale shows a link (also as a QR code) to approve Funnel and HTTPS;
4. saves the address in `.env` as `PUBLIC_URL`, restarts the board and checks that the address answers.

The wall's code then leads to the new address. It works at home too, so use it everywhere. **Every device signs in once**, even without a PIN:

- scan the code on the wall: the board opens, signed in;
- or type the code shown under it, for example in the Home Screen app;
- away from the wall, on a device that's signed in: Wall → **Connect another device**, then scan or type the code it shows;
- with a PIN, the PIN works too. From the internet, wrong PINs are limited to 5 per device and 20 in all per hour.

`scripts/linux/anywhere.sh --status` says whether it's on. `--off` turns it off, and the board stays on your Wi-Fi.

**How it's kept safe.** The board takes requests from the internet on a separate port (`PUBLIC_PORT`, normally 3001) that only the NUC itself can reach, and Funnel delivers there. Everything arriving on that port counts as coming from outside, whatever it says about itself: it always has to sign in, and it never gets the wall computer's rights (no **Exit to desktop**, no sign-in codes from the wall). Without a PIN, anyone on your Wi-Fi can still open the board, and so could connect a device that works from anywhere; set a PIN if that's a worry.

**Other ways, without Tailscale.** Point them at `http://127.0.0.1:3001` (the internet port, never 3000), and set `PUBLIC_URL` to your address:

- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) with your own domain. No router change, but Cloudflare decrypts the traffic at its servers.
- A port forward on your router to the NUC, with [Caddy](https://caddyserver.com) in front for automatic HTTPS. This needs a router change and an address of your own on the internet (it won't work behind carrier-grade NAT).

### If something's wrong

- **Your phone can't connect:**
  - check that it's on the same Wi-Fi as the NUC;
  - if Ubuntu's firewall is on (`sudo ufw status`), let the board through: `sudo ufw allow 3000/tcp`.
- **The From anywhere address doesn't open:** run `scripts/linux/anywhere.sh --status`. The first time, Tailscale can take a few minutes to get the certificate. A phone signed in at the Wi-Fi address signs in once more at the internet address, because to the browser they're different places.
- **The wall shows the wrong time:** set the NUC's time zone, for example `sudo timedatectl set-timezone America/New_York`.
- **The remote says it can't find the wall's browser:** the wall screen has to be started by the kiosk script. Restart the NUC, or run `scripts/linux/kiosk.sh`.
- **`npm` isn't found:** if the installer downloaded Node.js, log out and back in once so it's on your PATH.
- **The wall stays black after a restart:** turn on automatic login (see Install above).

### Uninstall

```sh
scripts/linux/kiosk.sh --stop
systemctl --user disable --now sticky-wall
rm ~/.config/systemd/user/sticky-wall.service ~/.config/autostart/sticky-wall-kiosk.desktop ~/.local/share/applications/sticky-wall.desktop
```

The board itself stays in this folder's `data/`. `~/.local/share/sticky-wall` holds the downloaded Node.js (if any), and `~/.local/state/sticky-wall` holds the wall browser's profile and log.

## Try it on any computer at home

You need [Node.js](https://nodejs.org) 22.18 or newer (the current LTS is fine). On any Mac or Linux computer:

```sh
npm install
npm run build
npm start
```

It prints the addresses to open:

- **On that computer:** `http://localhost:3000/#wall` is the wall screen (press F11 for full screen), and `http://localhost:3000` is the editor.
- **On your phone** (same Wi-Fi): the address it prints next to "On your phone", such as `http://192.168.1.23:3000`. The wall also shows it with a QR code until you turn that off under Wall → Connect a phone or computer.

The board starts empty with five columns. Stop the server with Ctrl+C; it saves before it quits. The phone remote needs the wall computer's setup above; here it says it can't find the wall's browser.

To look around with the sample board instead, run `npm run demo`. It keeps its board in `data-demo/` and starts over from the sample on every start, so your real board is untouched.

### Settings

Put any of these in a `.env` file next to `package.json` (or set them in the environment):

| Setting | Default | What it does |
| --- | --- | --- |
| `PORT` | `3000` | Port the board is served on |
| `HOST` | `0.0.0.0` | Network address to listen on (all of them, so phones can connect) |
| `DATA_DIR` | `data` | Where the board and its backups are kept |
| `PUBLIC_URL` | (this computer's Wi-Fi address) | Address shown on the wall for phones: the board's internet address once From anywhere is on (`anywhere.sh` sets it), or e.g. `http://nuc.local:3000` |
| `PUBLIC_PORT` | `PORT` + 1 | The port for requests from the internet, on this computer only (Tailscale Funnel delivers there). Everything on it signs in. `off` turns it off |
| `BOARD_PIN` | (none) | 6 to 12 digits to lock the board with; set it with `npm run pin` |
| `TRUST_LOCALHOST` | `1` | Let the wall computer's own browser (at `localhost`) in without signing in. Set to `0` to ask there too |
| `ALLOWED_HOSTS` | (none) | Other names the board may be opened at, comma-separated (its IP addresses, `localhost`, home-network names and the `PUBLIC_URL` name always work) |
| `KIOSK_DEBUG_PORT` | `9222` | The wall browser's debugging port, which the phone remote uses (only this computer can reach it). `off` turns the remote off |

### Backups and restoring

- `data/board.json` is the board. It's plain JSON; you can copy it anywhere.
- `data/backups/board-YYYY-MM-DD.json` holds a copy for each of the last 30 days.
- To restore, stop the server, copy the backup (or a downloaded one) over `data/board.json`, and start it again. Open screens reload the board by themselves.
- If `board.json` is ever damaged, the server sets it aside as `board.damaged-….json` and starts from the newest good backup.

## Screenshots

| Signing in from the internet | The wall's code to scan or type | Connect another device | Wall screens |
| --- | --- | --- | --- |
| ![Sign in](docs/screenshots/phone-sign-in-anywhere.png) | ![The wall's code](docs/screenshots/wall-anywhere-code.png) | ![Connect another device](docs/screenshots/phone-connect-anywhere.png) | ![Wall screens](docs/screenshots/phone-wall-screens.png) |

![An iPad as a wall screen](docs/screenshots/ipad-wall-screen.png)

| Related tasks | Submitted: follow up? | An email to follow up | A follow-up reminder |
| --- | --- | --- | --- |
| ![Related tasks](docs/screenshots/phone-related.png) | ![Follow up?](docs/screenshots/phone-submitted-ask.png) | ![An email to follow up](docs/screenshots/phone-email-follow-up.png) | ![A follow-up reminder](docs/screenshots/phone-follow-up-nudge.png) |

| A sticky handed to the AI helper | Giving a new sticky to AI | Hide the Connect code? |
| --- | --- | --- |
| ![AI helper](docs/screenshots/phone-ai.png) | ![New sticky for AI](docs/screenshots/phone-new-ai.png) | ![Hide the code?](docs/screenshots/phone-pair-prompt.png) |

| The remote | Typing on the wall | A website asks | The cursor on the wall |
| --- | --- | --- | --- |
| ![Remote](docs/screenshots/phone-remote.png) | ![Typing](docs/screenshots/phone-remote-typing.png) | ![Question](docs/screenshots/phone-remote-question.png) | ![Cursor on the wall](docs/screenshots/wall-remote-cursor.png) |

| Phone and wall side by side | The preview page's remote |
| --- | --- |
| ![Side by side](docs/screenshots/demo-side-by-side.png) | ![Remote preview](docs/screenshots/demo-remote.png) |

| A reminder going off | Signing in with the PIN | New application: what kind? | A job application | Ticker settings |
| --- | --- | --- | --- | --- |
| ![Reminder](docs/screenshots/phone-reminder.png) | ![PIN](docs/screenshots/phone-pin.png) | ![New application](docs/screenshots/phone-new-application.png) | ![Job application](docs/screenshots/phone-job.png) | ![Ticker settings](docs/screenshots/phone-ticker-settings.png) |

| Phone board | A goal | A recurring task | Editing a note | Columns and backups |
| --- | --- | --- | --- | --- |
| ![Phone board](docs/screenshots/phone-board.png) | ![Goal form](docs/screenshots/phone-goal.png) | ![Recurring task](docs/screenshots/phone-recurring.png) | ![Note form](docs/screenshots/phone-note.png) | ![Wall settings](docs/screenshots/phone-wall-settings.png) |

![The wall on day one](docs/screenshots/wall-first-day.png)

![On a computer](docs/screenshots/desktop-board.png)

![Wall at night (dim)](docs/screenshots/wall-night-dim.png)

## How it works

- `server/` is a small [Hono](https://hono.dev) server:
  - `store.ts` keeps the board in memory and saves it to `data/board.json`;
  - `reminders.ts` pops reminders and follow-up reminders up on the wall at their time;
  - `app.ts` is the HTTP API;
  - `events.ts` sends live updates as server-sent events;
  - `remote.ts` drives the wall's browser for the phone remote through Chrome's DevTools protocol (`cdp.ts`), and reloads the wall's page if it crashes or fails to load;
  - `auth.ts` signs devices in (the PIN, and the codes the wall shows), and `server.ts` opens the second port for the internet, where everything counts as coming from outside;
  - `screens.ts` keeps track of the wall screens.
- `web/` is the React app for the wall, phones and computers.
  - `store/sync.ts` applies each change on screen at once, sends it to the server in order, and keeps waiting changes through a lost connection.
  - `store/live.ts` holds the live connection open and reconnects when an iPhone drops it.
  - `store/remote.ts` sends touchpad moves and typing to the server, one request at a time.
- `shared/` holds what both sides use: the data types, the checks the server applies to every change (`schema.ts`), and the changes themselves (`ops.ts`), so a change looks the same on screen before and after the server saves it.
- `scripts/linux/` sets up and runs the wall computer:
  - `install.sh`, the one-time setup;
  - `anywhere.sh`, which sets up using the board from anywhere;
  - `kiosk.sh`, which runs the full-screen browser and brings it back if it closes;
  - `update.sh`, for updates.

The API, for scripts (and later, an AI assistant):

| Request | What it does |
| --- | --- |
| `GET /api/state` | The whole board, with its revision number |
| `GET /api/events` | Live updates (server-sent events): `hello`, `change`, `ticker`, `connect`, `pair`, `screens`, `ping` |
| `GET /api/session`, `POST /api/login`, `POST /api/logout` | Whether this device has to sign in and how it got in, and signing in with the PIN (`{"pin": "…"}`) and out |
| `POST /api/pair` | Sign in with a code from the wall: `{"code": "K7QM-2XPA"}` |
| `GET /api/pair-code`, `POST /api/pair-code` | The code the wall shows (the wall computer and wall screens only, never from the internet), and a new code for **Connect another device** |
| `GET /api/anywhere` | The board's internet address, when From anywhere is on |
| `GET`/`POST /api/screens`, `PATCH`/`DELETE /api/screens/:id`, `POST /api/screens/here` | Wall screens: the list, setting this device up as one, renaming and removing, and the check-in each one sends every minute |
| `GET /api/ticker` | The ticker's current prices and headlines |
| `POST /api/notes` | Add a note: `{"laneId": "todo", "title": "Email the program officer"}` |
| `PATCH /api/notes/:id` | Change a note's fields (`null` clears one) |
| `DELETE /api/notes/:id`, `POST /api/notes/:id/restore` | Delete to the trash, and undo |
| `POST /api/notes/:id/completions` | Recurring tasks: `{"add": [time]}` or `{"remove": [time]}` |
| `POST /api/lanes`, `PATCH`/`DELETE /api/lanes/:id`, `PUT /api/lanes/order` | Columns |
| `POST /api/goals`, `PATCH`/`DELETE /api/goals/:id` | Goals |
| `PATCH /api/settings` | Night mode, wall and ticker settings |
| `POST /api/alerts`, `DELETE /api/alerts/:id` | Pop a note's reminder up on the wall now, and take it down |
| `GET /api/remote` | What the wall's browser shows, and whether a text box there is selected |
| `POST /api/remote` | Remote commands, in order: `{"commands": [{"type": "move", "dx": 40, "dy": 0}, {"type": "click"}, {"type": "text", "text": "hi"}]}`. Others are `scroll`, `key`, `back`, `reload`, `board`, `open` (`{"url": …}`) and `dialog` (`{"accept": true}`) |
| `GET /api/export` | Download everything, trash included |

Besides the usual fields, a note can have:

- `parentId`: the sticky it's a related task of;
- `channel` (`email`, `text` or `call`) and `sentAt`, for messages;
- `followUp`: `{"at": time, "everyDays": 14}`;
- `ai`: the AI helper's settings.

The server sets `followedUpFor`, `aiLog` and `aiState` itself and ignores them in requests.

Changes must be sent as JSON (`Content-Type: application/json`). With a PIN, and always from the internet, everything except the health check and signing in needs the session cookie from `POST /api/login` or `POST /api/pair` (scripts on the wall computer itself, at `localhost`, don't).

## Development

| Command | What it does |
| --- | --- |
| `npm run dev` | The board server plus a development server with live reload, at `http://localhost:5173` (add `-- --demo` for the sample board) |
| `npm run pin` | Set the board's PIN in `.env` (`npm run pin -- --off` removes it) |
| `npm run typecheck` | TypeScript checks for the app, the server and the tooling |
| `npm test` | Unit tests: the data rules, follow-up timing, the store, the API, signing in from inside and outside, wall screens, live updates, syncing, the remote's input handling, and `anywhere.sh` with a stand-in Tailscale |
| `npm run test:e2e` | Builds, then runs a real server with headless Chromium as a phone, a computer and the wall, plus the kiosk script driving the wall's browser for the remote |
| `npm run build` | Production build into `dist/web` |
| `npm run screenshots` | Renders `docs/screenshots` against a real server with the sample board (build first) |
| `npm run build:preview-page` | A single self-contained HTML file that runs on sample data with no server |

The end-to-end tests and screenshots use Playwright's Chromium; set `PW_CHROMIUM` to the path of another Chrome or Chromium to use that instead. The shell scripts are checked with [ShellCheck](https://www.shellcheck.net).
