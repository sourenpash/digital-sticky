# Shared by install.sh, update.sh, kiosk.sh and anywhere.sh (sourced, not run).
# shellcheck disable=SC2034 # the variables are for the scripts that source this

APP_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}/sticky-wall"
STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}/sticky-wall"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
PRIVATE_NODE_DIR="$DATA_HOME/node"
SERVICE=sticky-wall.service
SERVICE_FILE="$CONFIG_HOME/systemd/user/$SERVICE"
AUTOSTART_FILE="$CONFIG_HOME/autostart/sticky-wall-kiosk.desktop"
# The Sticky Wall app (dock and app list). Its name matches the wall window's app id
# (kiosk.sh: --class=sticky-wall), so the dock knows the open wall is this app.
LAUNCHER_ID=sticky-wall
LAUNCHER_FILE="${XDG_DATA_HOME:-$HOME/.local/share}/applications/$LAUNCHER_ID.desktop"
NODE_MIN=22.18

if [ -t 1 ]; then
  BOLD=$'\033[1m' RED=$'\033[31m' YELLOW=$'\033[33m' GREEN=$'\033[32m' PLAIN=$'\033[0m'
else
  BOLD='' RED='' YELLOW='' GREEN='' PLAIN=''
fi

say() { printf '\n%s%s%s\n' "$BOLD" "$*" "$PLAIN"; }
info() { printf '  %s\n' "$*"; }
ok() { printf '  %s✓%s %s\n' "$GREEN" "$PLAIN" "$*"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$PLAIN" "$*" >&2; }
die() {
  printf '%s✗ %s%s\n' "$RED" "$*" "$PLAIN" >&2
  exit 1
}

# ask "Question?" y|n: yes or no, with the suggested answer used when nobody can answer
# (or when the script was told not to ask: YES=1).
ask() {
  local reply hint='[y/N]'
  [ "$2" = y ] && hint='[Y/n]'
  if [ "${YES:-0}" = 1 ] || [ ! -t 0 ]; then
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

# The value of KEY in the board's .env file (the last one wins), without quotes or a
# trailing # comment.
env_value() {
  local file="$APP_DIR/.env"
  [ -f "$file" ] || return 0
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$file" | tail -n 1 |
    sed -e 's/^"\([^"]*\)".*$/\1/' -e "t" -e "s/^'\([^']*\)'.*$/\1/" -e "t" -e 's/[[:space:]]\{1,\}#.*$//' -e 's/[[:space:]]*$//'
}

# A setting: from the environment if it's set there, otherwise from .env (like the server).
setting() {
  if [ -n "${!1:-}" ]; then echo "${!1}"; else env_value "$1"; fi
}

# The board's port (PORT, or 3000).
board_port() {
  local port
  port=$(setting PORT)
  echo "${port:-3000}"
}

# The board's door for the internet, on this computer only (PUBLIC_PORT, or PORT + 1).
# Prints nothing when it's turned off.
public_port() {
  local port
  port=$(setting PUBLIC_PORT)
  case ${port,,} in
    0 | off | false | no) ;;
    '') echo $(($(board_port) + 1)) ;;
    *) echo "$port" ;;
  esac
}

# Restarts the board's service (set up by install.sh), so it reads .env again. Says how
# to do it by hand when there's no service.
restart_board() {
  if [ -f "$SERVICE_FILE" ] && systemctl --user restart "$SERVICE" 2>/dev/null; then
    ok "The board restarted with the change"
  else
    info "Restart the board to use it: stop it with Ctrl+C, then npm start (or: systemctl --user restart sticky-wall)."
  fi
}

# Whether something on this computer accepts connections on port $1.
port_open() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

# Whether version $1 (like v22.18.0) is at least $2 (like 22.18).
version_at_least() {
  local have_major have_minor need_major need_minor
  IFS=. read -r have_major have_minor _ <<<"${1#v}"
  IFS=. read -r need_major need_minor _ <<<"$2"
  [[ $have_major =~ ^[0-9]+$ && $have_minor =~ ^[0-9]+$ ]] || return 1
  ((have_major > need_major || (have_major == need_major && have_minor >= need_minor)))
}

# Sets NODE and NODE_BIN_DIR to a new enough Node.js: the copy install.sh downloaded,
# or the one on the PATH.
find_node() {
  local candidate
  for candidate in "$PRIVATE_NODE_DIR/bin/node" "$(command -v node 2>/dev/null || true)"; do
    [ -n "$candidate" ] && [ -x "$candidate" ] || continue
    if version_at_least "$("$candidate" --version 2>/dev/null)" "$NODE_MIN"; then
      NODE=$candidate
      NODE_BIN_DIR=$(dirname "$candidate")
      return 0
    fi
  done
  return 1
}

# Prints the path of Google Chrome or Chromium.
find_browser() {
  local name
  for name in google-chrome-stable google-chrome chromium chromium-browser; do
    if command -v "$name" >/dev/null 2>&1; then
      command -v "$name"
      return 0
    fi
  done
  return 1
}

# The wall browser's own profile. The Chromium snap may only write inside ~/snap/chromium.
browser_profile() {
  case "$(basename "$1")" in
    chromium | chromium-browser)
      if [ -x /snap/bin/chromium ]; then
        echo "$HOME/snap/chromium/common/sticky-wall-browser"
        return
      fi
      ;;
  esac
  echo "$STATE_HOME/browser"
}
