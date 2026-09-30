#!/usr/bin/env bash
# Sets up this computer (Ubuntu with the GNOME desktop) as the wall screen:
#   - the board server, as a service that starts when the computer does
#   - the wall screen, full screen in Chrome or Chromium whenever you log in
#   - no screen blanking, locking or automatic sleep
#
# Run it from the digital-sticky folder as yourself (not with sudo):
#   ./scripts/linux/install.sh
# It asks before it downloads or installs anything, and it's safe to run again
# (that's how to repair the setup, and update.sh runs it after downloading a new version).
#
#   -y, --yes   don't ask; take the suggested answers (no PIN is set this way)
set -euo pipefail
# shellcheck source-path=SCRIPTDIR source=common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

YES=0
UPDATE=0
for arg in "$@"; do
  case $arg in
    -y | --yes) YES=1 ;;
    --update) UPDATE=1 YES=1 ;;
    -h | --help)
      sed -n '2,13s/^# \{0,1\}//p' "$0"
      exit 0
      ;;
    *) die "Unknown option: $arg (try --help)" ;;
  esac
done

# ask "Question?" y|n: yes or no, with the suggested answer used when nobody can answer.
ask() {
  local reply hint='[y/N]'
  [ "$2" = y ] && hint='[Y/n]'
  if [ "$YES" = 1 ] || [ ! -t 0 ]; then
    [ "$2" = y ]
    return
  fi
  read -r -p "  $1 $hint " reply || reply=''
  [[ ${reply:-$2} =~ ^[Yy] ]]
}

download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$2" "$1"
  else
    die "Downloading needs curl or wget: sudo apt install curl"
  fi
}

# The official Node.js 24 LTS build, checked against its published SHA-256 sums,
# unpacked into ~/.local/share/sticky-wall/node (nothing outside your home folder changes).
install_private_node() {
  local arch base tmp line file
  case "$(uname -m)" in
    x86_64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) die "There's no Node.js download for this processor ($(uname -m)). Install Node.js $NODE_MIN or newer yourself, then run this again." ;;
  esac
  base="${NODE_MIRROR:-https://nodejs.org/dist}/latest-v24.x"
  tmp=$(mktemp -d)
  # shellcheck disable=SC2064 # expand $tmp now
  trap "rm -rf '$tmp'" EXIT
  download "$base/SHASUMS256.txt" "$tmp/SHASUMS256.txt" || die "Couldn't download Node.js. Check the internet connection and try again."
  line=$(grep -E "^[0-9a-f]{64}  node-v[0-9]+\.[0-9]+\.[0-9]+-linux-$arch\.tar\.xz$" "$tmp/SHASUMS256.txt" | head -n 1 || true)
  [ -n "$line" ] || die "Couldn't find the Node.js download for linux-$arch."
  file=${line##* }
  info "Downloading $file"
  download "$base/$file" "$tmp/$file" || die "Couldn't download Node.js. Check the internet connection and try again."
  (cd "$tmp" && printf '%s\n' "$line" | sha256sum --check --status) || die "The Node.js download didn't match its checksum. Try again."
  rm -rf "$PRIVATE_NODE_DIR.new"
  mkdir -p "$PRIVATE_NODE_DIR.new"
  tar -xJf "$tmp/$file" -C "$PRIVATE_NODE_DIR.new" --strip-components=1
  rm -rf "$PRIVATE_NODE_DIR"
  mv "$PRIVATE_NODE_DIR.new" "$PRIVATE_NODE_DIR"
}

# --- Checks ---------------------------------------------------------------------

[ "$(id -u)" -ne 0 ] || die "Run this as your everyday user, not with sudo. It asks for your password if it needs it."
[ "$(uname -s)" = Linux ] || die "This installer is for Ubuntu (Linux). On other computers, use npm start (see the README)."
command -v systemctl >/dev/null 2>&1 || die "This needs systemd, which Ubuntu has."
systemctl --user show-environment >/dev/null 2>&1 ||
  die "Can't reach your user services (systemctl --user). Run this in a terminal on the wall computer's desktop."
FIRST_INSTALL=1
[ -f "$SERVICE_FILE" ] && FIRST_INSTALL=0
cd "$APP_DIR"

# --- 1. Node.js -----------------------------------------------------------------

say "1/7  Node.js"
if ! find_node; then
  if ask "Node.js $NODE_MIN or newer is needed. Download the official Node.js 24 LTS for the board (into $PRIVATE_NODE_DIR, no sudo)?" y; then
    install_private_node
    find_node || die "The downloaded Node.js doesn't run on this computer."
  else
    die "Install Node.js $NODE_MIN or newer (https://nodejs.org), then run this again."
  fi
fi
ok "Node.js $("$NODE" --version) ($NODE)"
export PATH="$NODE_BIN_DIR:$PATH"
# The downloaded Node.js also goes on your PATH (Ubuntu adds ~/.local/bin at login), for npm run pin and friends.
NEW_PATH=0
if [ "$NODE" = "$PRIVATE_NODE_DIR/bin/node" ]; then
  mkdir -p "$HOME/.local/bin"
  for tool in node npm npx; do
    if [ "$(readlink "$HOME/.local/bin/$tool" 2>/dev/null)" != "$PRIVATE_NODE_DIR/bin/$tool" ]; then
      ln -sfn "$PRIVATE_NODE_DIR/bin/$tool" "$HOME/.local/bin/$tool"
      NEW_PATH=1
    fi
  done
fi

# --- 2. The board -----------------------------------------------------------------

say "2/7  Installing and building the board (a minute or two)"
npm ci --no-audit --no-fund --loglevel=error
npm run build --silent >/dev/null
ok "Built"

# --- 3. PIN ---------------------------------------------------------------------

say "3/7  PIN"
if [ -n "$(env_value BOARD_PIN)" ]; then
  ok "A PIN is set (change it with: npm run pin)"
elif [ "$FIRST_INSTALL" = 1 ] && [ "$YES" = 0 ] && ask "Lock the board with a PIN? Without one, anyone on your Wi-Fi can open the board and use the wall remote." y; then
  node scripts/pin.ts --no-restart || warn "No PIN was set. Set one any time with: npm run pin"
else
  info "No PIN. Anyone on your Wi-Fi can open the board. Set one any time with: npm run pin"
fi

# --- 4. Browser -----------------------------------------------------------------

say "4/7  Browser for the wall screen"
if ! BROWSER=$(find_browser); then
  if [ "$YES" = 0 ] && command -v snap >/dev/null 2>&1 && ask "Chrome or Chromium is needed. Install Chromium now (sudo snap install chromium)?" y; then
    sudo snap install chromium
  fi
fi
if BROWSER=$(find_browser); then
  ok "$BROWSER"
else
  warn "No Chrome or Chromium: install one (for example: sudo snap install chromium), then run this again."
fi

# --- 5. Board server ------------------------------------------------------------

say "5/7  Board server (starts when the computer does)"
mkdir -p "$(dirname "$SERVICE_FILE")"
cat >"$SERVICE_FILE" <<UNIT
[Unit]
Description=Digital Sticky board server
Documentation=file://$APP_DIR/README.md

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart="$NODE" "$APP_DIR/server/index.ts"
Environment=NODE_ENV=production
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable "$SERVICE" >/dev/null 2>&1
systemctl --user restart "$SERVICE"
ok "Service $SERVICE is running (logs: journalctl --user -u sticky-wall)"
# Keep it running without anyone logged in, from power-on.
if [ "$(loginctl show-user "$USER" --property=Linger --value 2>/dev/null || true)" != yes ]; then
  if loginctl enable-linger "$USER" 2>/dev/null || sudo loginctl enable-linger "$USER"; then
    ok "It starts at power-on, before anyone logs in"
  else
    warn "Couldn't make it start at power-on; it starts when you log in instead."
  fi
fi

# --- 6. Wall screen -------------------------------------------------------------

say "6/7  Wall screen (opens full screen when you log in)"
mkdir -p "$(dirname "$AUTOSTART_FILE")"
chmod +x "$APP_DIR/scripts/linux/kiosk.sh" 2>/dev/null || true
cat >"$AUTOSTART_FILE" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Digital Sticky wall screen
Comment=Shows the wall screen full screen
Exec="$APP_DIR/scripts/linux/kiosk.sh"
Terminal=false
X-GNOME-Autostart-enabled=true
X-GNOME-Autostart-Delay=3
DESKTOP
ok "Starts at login ($AUTOSTART_FILE)"

# --- 7. Screen settings -----------------------------------------------------------

say "7/7  Screen settings"
# Over SSH, the desktop's settings are still reachable through its session bus.
if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ] && [ -S "${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/bus" ]; then
  export DBUS_SESSION_BUS_ADDRESS="unix:path=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/bus"
fi
if command -v gsettings >/dev/null 2>&1 && [ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
  # Some of these only exist on some GNOME versions; the rest still apply.
  gset() { gsettings set "$@" >/dev/null 2>&1 || true; }
  gset org.gnome.desktop.session idle-delay 0
  gset org.gnome.desktop.screensaver lock-enabled false
  gset org.gnome.desktop.screensaver idle-activation-enabled false
  gset org.gnome.desktop.screensaver ubuntu-lock-on-suspend false
  gset org.gnome.desktop.lockdown disable-lock-screen true
  gset org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type nothing
  gset org.gnome.settings-daemon.plugins.power sleep-inactive-battery-type nothing
  gset org.gnome.settings-daemon.plugins.power idle-dim false
  gset org.gnome.desktop.notifications show-banners false
  gset com.ubuntu.update-notifier show-apport-crashes false
  # No "not responding" box over the wall while a page is busy for a moment.
  gset org.gnome.mutter check-alive-timeout 0
  ok "The screen never blanks, locks or sleeps, and notifications don't pop up over the wall"
else
  warn "Skipped: run this in a terminal on the wall computer's desktop to turn off screen blanking."
fi

# --- Done -------------------------------------------------------------------------

PORT=$(board_port)
say "Waiting for the board to start"
PHONE_URL=''
for _ in $(seq 1 30); do
  # shellcheck disable=SC2016 # JavaScript, not shell
  if PHONE_URL=$("$NODE" -e '
    fetch(`http://127.0.0.1:${process.argv[1]}/api/state`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(s => console.log(s.connectUrl ?? ""), () => process.exit(1))' "$PORT" 2>/dev/null); then
    break
  fi
  sleep 1
done
port_open "$PORT" || die "The board didn't start. See what went wrong with: journalctl --user -u sticky-wall -n 50"
ok "The board is running"

TIMEZONE=$(timedatectl show --property=Timezone --value 2>/dev/null || echo unknown)
say "${GREEN}Done.${PLAIN}"
[ -n "$PHONE_URL" ] || PHONE_URL="http://<this computer’s address>:$PORT"
info "On your phone:  $PHONE_URL (same Wi-Fi), or scan the code on the wall"
info "                (or http://$(hostname -s 2>/dev/null || hostname).local:$PORT, which keeps working if the address changes)"
info "PIN:            $([ -n "$(env_value BOARD_PIN)" ] && echo on || echo 'off (npm run pin sets one)')"
info "Time zone:      $TIMEZONE (the wall's clock, night mode and reminders follow it;"
info "                change it with: sudo timedatectl set-timezone Area/City; see timedatectl list-timezones)"
info "Update later:   scripts/linux/update.sh"
[ "$NEW_PATH" = 0 ] || info "To use npm (npm run pin, for one), log out and back in first."

if [ "$UPDATE" = 0 ]; then
  say "One more thing"
  info "Turn on automatic login (Settings → System → Users → Automatic Login), so the"
  info "wall comes back by itself after a restart or power cut. Then restart the computer."
  if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] && [ -n "${BROWSER:-}" ] && ask "Open the wall screen now? (Alt+Tab switches back to this window)" n; then
    "$APP_DIR/scripts/linux/kiosk.sh" || true
  fi
fi
