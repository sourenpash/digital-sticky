#!/usr/bin/env bash
# Lets you use the board from anywhere, not only on your home Wi-Fi. It uses Tailscale
# Funnel (free for personal use): the board gets a fixed https:// address on the
# internet, and this computer serves it itself. Tailscale only relays the encrypted
# traffic; it can't read it. Nothing changes on your router, and nothing is hosted
# anywhere else. Every device signs in once, by scanning the code on the wall.
#
# Run it from the digital-sticky folder as yourself (not with sudo):
#   scripts/linux/anywhere.sh            turn it on (installs Tailscale first if needed)
#   scripts/linux/anywhere.sh --status   say whether it's on, and the address
#   scripts/linux/anywhere.sh --off      turn it off (the board stays on your Wi-Fi)
#
#   -y, --yes       don't ask before installing Tailscale
#   --no-restart    don't restart the board afterwards (the installer does that itself)
set -euo pipefail
# shellcheck source-path=SCRIPTDIR source=common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

ACTION=on
YES=0
RESTART=1
for arg in "$@"; do
  case $arg in
    --status) ACTION=status ;;
    --off) ACTION=off ;;
    -y | --yes) YES=1 ;;
    --no-restart) RESTART=0 ;;
    -h | --help)
      sed -n '2,15s/^# \{0,1\}//p' "$0"
      exit 0
      ;;
    *) die "Unknown option: $arg (try --help)" ;;
  esac
done

# Funnel with `tailscale funnel --bg` needs Tailscale 1.52 or newer.
TAILSCALE_MIN=1.52

cd "$APP_DIR"
find_node || die "Node.js $NODE_MIN or newer is needed. Set up the board first: scripts/linux/install.sh"
PUBLIC_PORT=$(public_port)

# What Tailscale says about this computer: its state (Running once signed in), its name
# on the internet, and the account. Prints "Stopped" when it isn't answering.
tailscale_status() {
  local json
  json=$(tailscale status --json 2>/dev/null) || json='{}'
  # shellcheck disable=SC2016 # JavaScript, not shell
  "$NODE" -e '
    let s = {};
    try { s = JSON.parse(process.argv[1]); } catch {}
    const name = (s.Self?.DNSName ?? "").replace(/\.$/, "");
    console.log([s.BackendState || "Stopped", name || "-", s.CurrentTailnet?.Name ?? ""].join(" "));' "$json"
}

# The address the board has in .env, if it's a Tailscale one.
board_url() {
  local url
  url=$(env_value PUBLIC_URL)
  [[ $url == https://*.ts.net ]] && echo "$url"
  return 0
}

# Runs a Tailscale command that may print a link to open (to sign in, or to allow
# Funnel); each link is also shown as a QR code to scan with a phone.
with_qr_links() {
  local line url status
  set +e
  "$@" 2>&1 | while IFS= read -r line; do
    printf '%s\n' "$line"
    if [[ $line =~ (https://login\.tailscale\.com/[^[:space:]]+) ]]; then
      url=${BASH_REMATCH[1]}
      "$NODE" scripts/qr.ts "$url" 2>/dev/null || true
    fi
  done
  status=${PIPESTATUS[0]}
  set -e
  return "$status"
}

if [ "$ACTION" = status ]; then
  say "From anywhere"
  if ! command -v tailscale >/dev/null 2>&1; then
    info "Off: Tailscale isn't installed. Turn it on with: scripts/linux/anywhere.sh"
    exit 0
  fi
  read -r STATE NAME ACCOUNT < <(tailscale_status)
  if [ "$STATE" != Running ]; then
    info "Off: Tailscale is installed but not signed in. Turn it on with: scripts/linux/anywhere.sh"
    exit 0
  fi
  ok "Tailscale is signed in${ACCOUNT:+ ($ACCOUNT)}, as $NAME"
  info "What Tailscale serves:"
  tailscale funnel status 2>&1 | sed 's/^/    /' || true
  URL=$(board_url)
  if [ -n "$URL" ]; then
    ok "The board's address: $URL"
  else
    warn "The board doesn't have its internet address in .env. Run scripts/linux/anywhere.sh to set it."
  fi
  exit 0
fi

if [ "$ACTION" = off ]; then
  say "Turning off From anywhere"
  if command -v tailscale >/dev/null 2>&1; then
    if sudo tailscale funnel --https=443 off >/dev/null 2>&1; then
      ok "Tailscale no longer serves the board on the internet"
    else
      warn "Couldn't turn Funnel off (maybe it was off). To clear everything Tailscale serves: sudo tailscale funnel reset"
    fi
  fi
  if [ -n "$(board_url)" ]; then
    "$NODE" scripts/envFile.ts unset PUBLIC_URL
    ok "Removed the internet address from .env"
  fi
  [ "$RESTART" = 0 ] || restart_board
  info "The board works on your home Wi-Fi as before."
  exit 0
fi

[ -n "$PUBLIC_PORT" ] || die "PUBLIC_PORT is off in .env, so the board has no door for the internet. Remove that line and run this again."

# --- 1. Tailscale ------------------------------------------------------------------

say "1/4  Tailscale"
if ! command -v tailscale >/dev/null 2>&1; then
  ask "Using the board from anywhere needs Tailscale (free; from tailscale.com). Install it now? It asks for your password." y ||
    die "Nothing changed. Run this again when you want to set it up."
  TMP=$(mktemp)
  trap 'rm -f "$TMP"' EXIT
  download https://tailscale.com/install.sh "$TMP"
  sh "$TMP" || die "Tailscale didn't install. See tailscale.com/download/linux, then run this again."
fi
# (sed reads all of it: with head, tailscale could be cut off mid-write and fail the pipe)
VERSION=$(tailscale version 2>/dev/null | sed -n 1p)
version_at_least "v$VERSION" "$TAILSCALE_MIN" ||
  die "Tailscale $VERSION is too old for this (it needs $TAILSCALE_MIN or newer). Update it with: sudo apt install --only-upgrade tailscale"
ok "Tailscale $VERSION"

# --- 2. Signing in -----------------------------------------------------------------

say "2/4  Signing in to Tailscale"
read -r STATE NAME ACCOUNT < <(tailscale_status)
if [ "$STATE" != Running ]; then
  info "Sign in with Google, Apple, Microsoft or GitHub. Scan the code with your phone,"
  info "or open the link on any device. This waits until you're signed in."
  sudo tailscale up --qr || die "Tailscale didn't sign in. Run this again to try again."
  read -r STATE NAME ACCOUNT < <(tailscale_status)
fi
[ "$STATE" = Running ] && [ "$NAME" != - ] || die "Tailscale isn't signed in yet (it says: $STATE). Run this again to try again."
ok "Signed in${ACCOUNT:+ as $ACCOUNT}. This computer is $NAME"

# --- 3. Funnel ---------------------------------------------------------------------

say "3/4  Opening the board to the internet"
info "The first time, Tailscale asks you to allow Funnel (and HTTPS): open the link it"
info "shows, on any device where you're signed in to Tailscale, and approve."
with_qr_links sudo tailscale funnel --bg "$PUBLIC_PORT" ||
  die "Tailscale couldn't open the board to the internet. See what it said above, then run this again."
ok "https://$NAME now leads to this board (port $PUBLIC_PORT on this computer only)"

# --- 4. The board ------------------------------------------------------------------

say "4/4  Telling the board its address"
"$NODE" scripts/envFile.ts set PUBLIC_URL "https://$NAME"
ok "Saved PUBLIC_URL=https://$NAME in .env"
if [ "$RESTART" = 1 ]; then
  restart_board
  if [ -f "$SERVICE_FILE" ]; then
    for _ in $(seq 1 30); do
      port_open "$PUBLIC_PORT" && break
      sleep 1
    done
  fi
  # Through Tailscale, the way phones come in (from here it stays on the tailnet).
  # shellcheck disable=SC2016 # JavaScript, not shell
  if ! port_open "$PUBLIC_PORT"; then
    warn "The board isn't running yet, so this couldn't check the address. Once it is, open https://$NAME on your phone."
  elif "$NODE" -e '
    const deadline = Date.now() + 60_000;
    const check = () =>
      fetch(process.argv[1], { signal: AbortSignal.timeout(10_000) })
        .then(r => { if (!r.ok) throw new Error(); })
        .catch(() => { if (Date.now() > deadline) process.exit(1); return new Promise(r => setTimeout(r, 3000)).then(check); });
    check();' "https://$NAME/api/health" 2>/dev/null; then
    ok "The board answers at https://$NAME"
  else
    warn "https://$NAME doesn't answer yet. The first time, Tailscale can take a few minutes to get its certificate."
    warn "Try it on your phone with Wi-Fi off in a little while, or check with: scripts/linux/anywhere.sh --status"
  fi
fi

say "${GREEN}Done.${PLAIN}"
info "The board's address:  https://$NAME (at home and away)"
info "Sign in a phone:      scan the code on the wall (it now leads to that address)."
info "Away from the wall:   on a device that's signed in, Wall, then Connect another device."
info "Turn it off:          scripts/linux/anywhere.sh --off"
