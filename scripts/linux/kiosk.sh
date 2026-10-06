#!/usr/bin/env bash
# Shows the wall screen full screen in Chrome or Chromium, and brings it back if the
# browser closes or crashes. install.sh starts it whenever you log in.
#
#   scripts/linux/kiosk.sh          start the wall screen now (from a terminal, it carries on
#                                   after the terminal closes)
#   scripts/linux/kiosk.sh --stop   close it (so does "Exit to desktop" on the wall, which shows
#                                   when you move the mouse; with a keyboard, Alt+Tab also gets you past it)
#
# The browser gets its own profile and a debugging port that only this computer can
# reach (127.0.0.1): the board server uses it for the phone remote.
set -uo pipefail
# shellcheck source-path=SCRIPTDIR source=common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

mkdir -p "$STATE_HOME"
PID_FILE="$STATE_HOME/kiosk.pid"
LOG="$STATE_HOME/kiosk.log"

BROWSER=$(find_browser) || die "Chrome or Chromium is needed for the wall screen: run scripts/linux/install.sh"
PROFILE=$(browser_profile "$BROWSER")

stop_kiosk() {
  local pid
  pid=$(cat "$PID_FILE" 2>/dev/null || true)
  # Only if that process is still this script (process numbers get reused).
  if [[ $pid =~ ^[0-9]+$ ]] && grep -q kiosk.sh "/proc/$pid/cmdline" 2>/dev/null; then kill "$pid" 2>/dev/null || true; fi
  rm -f "$PID_FILE"
  pkill -f -- "--user-data-dir=$PROFILE" 2>/dev/null || true
}

case "${1:-}" in
  --stop)
    stop_kiosk
    echo "Closed the wall screen. It comes back at the next login, or with the Sticky Wall icon (or scripts/linux/kiosk.sh)."
    exit 0
    ;;
  -h | --help)
    sed -n '2,12s/^# \{0,1\}//p' "$0"
    exit 0
    ;;
  '') ;;
  *) die "Unknown option: $1 (try --help)" ;;
esac

# Started from a terminal: carry on in the background, so closing the terminal doesn't
# close the wall.
if [ -t 0 ] && [ -z "${KIOSK_DETACHED:-}" ]; then
  KIOSK_DETACHED=1 nohup setsid bash "$APP_DIR/scripts/linux/kiosk.sh" </dev/null >/dev/null 2>&1 &
  echo "Opening the wall screen (log: $LOG)."
  exit 0
fi

# One at a time: login can start it twice, and so can a person.
exec 9>"$STATE_HOME/kiosk.lock"
if ! flock -n 9; then
  echo "The wall screen is already running."
  exit 0
fi
echo $$ >"$PID_FILE"

# From here on, write to a log file (kept under 1 MB).
if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG")" -gt 1000000 ]; then mv -f "$LOG" "$LOG.old"; fi
exec >>"$LOG" 2>&1
log() { echo "$(date '+%F %T') $*"; }

PORT=$(board_port)
URL="http://localhost:$PORT/#wall"
DEBUG_PORT=$(setting KIOSK_DEBUG_PORT)
case "${DEBUG_PORT:-9222}" in
  0 | off | false | no) DEBUG_PORT='' ;;
  *[!0-9]*)
    log "KIOSK_DEBUG_PORT should be a port number or off, not \"$DEBUG_PORT\"; using 9222."
    DEBUG_PORT=9222
    ;;
  *) DEBUG_PORT=${DEBUG_PORT:-9222} ;;
esac

# shellcheck disable=SC2054 # the comma belongs to --disable-features
FLAGS=(
  --kiosk
  "--class=$LAUNCHER_ID"
  --no-first-run
  --no-default-browser-check
  --noerrdialogs
  --deny-permission-prompts
  --disable-session-crashed-bubble
  --hide-crash-restore-bubble
  --password-store=basic
  --autoplay-policy=no-user-gesture-required
  --disable-features=Translate,TranslateUI
  --overscroll-history-navigation=0
  --disable-pinch
  --check-for-update-interval=31536000
  "--user-data-dir=$PROFILE"
)
# The phone remote drives the browser through this port (only this computer can reach it).
[ -n "$DEBUG_PORT" ] && FLAGS+=("--remote-debugging-port=$DEBUG_PORT")

# After a crash or a power cut, open the wall without asking to restore pages.
clean_exit_flags() {
  local prefs="$PROFILE/Default/Preferences"
  [ -f "$prefs" ] || return 0
  sed -i -e 's/"exited_cleanly":false/"exited_cleanly":true/' -e 's/"exit_type":"[A-Za-z]*"/"exit_type":"Normal"/' "$prefs" 2>/dev/null || true
}

# A browser already running with this profile would only open another tab in it. A
# lock left behind by one that's gone (a power cut, or a new computer name) is cleared,
# or the browser would stop to ask about it.
browser_running() {
  local target pid
  target=$(readlink "$PROFILE/SingletonLock" 2>/dev/null) || return 1
  pid=${target##*-}
  if [[ $pid =~ ^[0-9]+$ ]] && tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null | grep -qF -- "--user-data-dir=$PROFILE"; then
    return 0
  fi
  rm -f "$PROFILE/SingletonLock" "$PROFILE/SingletonSocket" "$PROFILE/SingletonCookie"
  return 1
}

child=''
on_stop() {
  [ -n "$child" ] && kill "$child" 2>/dev/null
  rm -f "$PID_FILE"
  log "Stopped."
  exit 0
}
trap on_stop TERM INT HUP

log "Starting the wall screen: $BROWSER"
# Give the board server a moment after power-on (the page also keeps retrying by itself).
for _ in $(seq 1 60); do
  port_open "$PORT" && break
  sleep 1
done

delay=2
while true; do
  if browser_running; then
    sleep 5 &
    wait $!
    continue
  fi
  clean_exit_flags
  started=$(date +%s)
  # The lock stays with this script, not the browser (9>&-). The browser's own messages
  # would fill the log, so they're dropped.
  "$BROWSER" "${FLAGS[@]}" "$URL" 9>&- >/dev/null 2>&1 &
  child=$!
  while kill -0 "$child" 2>/dev/null; do
    sleep 5 &
    wait $!
    # Once a day, in the small hours, start the browser fresh: one that runs for weeks
    # slowly takes more and more memory.
    if (($(date +%s) - started > 20 * 3600)) && [ "$(date +%H)" = 04 ]; then
      log "Daily browser restart."
      kill "$child" 2>/dev/null
      started=$(date +%s)
      daily=1
    fi
  done
  wait "$child"
  code=$?
  child=''
  # A browser that keeps closing right away is retried more and more slowly (up to a minute).
  if [ "${daily:-0}" = 1 ]; then
    daily=0
    delay=1
  elif (($(date +%s) - started < 30)); then
    delay=$((delay * 2 > 60 ? 60 : delay * 2))
  else
    delay=2
  fi
  log "The browser closed (exit code $code); opening it again in ${delay}s."
  sleep "$delay" &
  wait $!
done
