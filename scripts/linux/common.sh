# Shared by install.sh, update.sh and kiosk.sh (sourced, not run).
# shellcheck disable=SC2034 # the variables are for the scripts that source this

APP_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}/sticky-wall"
STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}/sticky-wall"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
PRIVATE_NODE_DIR="$DATA_HOME/node"
SERVICE=sticky-wall.service
SERVICE_FILE="$CONFIG_HOME/systemd/user/$SERVICE"
AUTOSTART_FILE="$CONFIG_HOME/autostart/sticky-wall-kiosk.desktop"
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
