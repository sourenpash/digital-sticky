#!/usr/bin/env bash
# Lets you use the board from anywhere at your own domain, like https://sticky.example.com,
# with Cloudflare Tunnel (free). This computer connects out to Cloudflare, and visitors to
# that address reach the board through it: nothing changes on your router, and your home
# address stays hidden. Cloudflare decrypts the traffic at its servers (Tailscale, in
# anywhere.sh, can't). Every device signs in once, by scanning the code on the wall.
#
# The domain has to use Cloudflare for its DNS (free plan: add it at dash.cloudflare.com,
# then change its nameservers where you bought it).
#
# Run it from the digital-sticky folder as yourself (not with sudo):
#   scripts/linux/domain.sh sticky.example.com   turn it on (installs cloudflared first if needed)
#   scripts/linux/domain.sh --status             say whether it's on, and the address
#   scripts/linux/domain.sh --off                turn it off (the board stays on your Wi-Fi)
#
#   -y, --yes       don't ask before installing cloudflared
#   --no-restart    don't restart the board afterwards
set -euo pipefail
# shellcheck source-path=SCRIPTDIR source=common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

ACTION=on
YES=0
RESTART=1
HOST=''
for arg in "$@"; do
  case $arg in
    --status) ACTION=status ;;
    --off) ACTION=off ;;
    -y | --yes) YES=1 ;;
    --no-restart) RESTART=0 ;;
    -h | --help)
      sed -n '2,20s/^# \{0,1\}//p' "$0"
      exit 0
      ;;
    -*) die "Unknown option: $arg (try --help)" ;;
    *) HOST=$arg ;;
  esac
done

TUNNEL=sticky-wall
CF_DIR="$HOME/.cloudflared"
TUNNEL_CONFIG="$CF_DIR/$TUNNEL.yml"
TUNNEL_SERVICE=sticky-wall-tunnel.service
TUNNEL_SERVICE_FILE="$CONFIG_HOME/systemd/user/$TUNNEL_SERVICE"

cd "$APP_DIR"
find_node || die "Node.js $NODE_MIN or newer is needed. Set up the board first: scripts/linux/install.sh"
PUBLIC_PORT=$(public_port)

# The name the tunnel serves, from its settings file (empty when there's none).
tunnel_host() {
  [ -f "$TUNNEL_CONFIG" ] || return 0
  sed -n 's/^[[:space:]]*-[[:space:]]*hostname:[[:space:]]*//p' "$TUNNEL_CONFIG" | head -n 1
}

# Runs a cloudflared command that may print a link to open (to sign in); each link is
# also shown as a QR code to scan with a phone.
with_qr_links() {
  local line url status
  set +e
  "$@" 2>&1 | while IFS= read -r line; do
    printf '%s\n' "$line"
    if [[ $line =~ (https://dash\.cloudflare\.com/[^[:space:]]+) ]]; then
      url=${BASH_REMATCH[1]}
      "$NODE" scripts/qr.ts "$url" 2>/dev/null || true
    fi
  done
  status=${PIPESTATUS[0]}
  set -e
  return "$status"
}

if [ "$ACTION" = status ]; then
  say "Your own domain"
  NAME=$(tunnel_host)
  if [ -z "$NAME" ]; then
    info "Off. Turn it on with: scripts/linux/domain.sh sticky.example.com"
    exit 0
  fi
  if systemctl --user is-active --quiet "$TUNNEL_SERVICE" 2>/dev/null; then
    ok "The tunnel is running, for https://$NAME (logs: journalctl --user -u $TUNNEL_SERVICE)"
  else
    warn "The tunnel for https://$NAME isn't running. Start it with: systemctl --user start $TUNNEL_SERVICE"
  fi
  if [ "$(env_value PUBLIC_URL)" = "https://$NAME" ]; then
    ok "The board's address: https://$NAME"
  else
    warn "The board's address in .env isn't https://$NAME. Run scripts/linux/domain.sh $NAME to set it."
  fi
  exit 0
fi

if [ "$ACTION" = off ]; then
  say "Turning off your own domain"
  NAME=$(tunnel_host)
  if [ -f "$TUNNEL_SERVICE_FILE" ]; then
    systemctl --user disable --now "$TUNNEL_SERVICE" >/dev/null 2>&1 || true
    rm -f "$TUNNEL_SERVICE_FILE"
    systemctl --user daemon-reload 2>/dev/null || true
    ok "The tunnel is stopped, and no longer starts with the computer"
  fi
  if [ -n "$NAME" ] && [ "$(env_value PUBLIC_URL)" = "https://$NAME" ]; then
    "$NODE" scripts/envFile.ts unset PUBLIC_URL
    ok "Removed the internet address from .env"
  fi
  [ "$RESTART" = 0 ] || restart_board
  info "The board works on your home Wi-Fi as before."
  if [ -n "$NAME" ]; then
    info "The tunnel and the DNS record for $NAME are still in your Cloudflare account. To remove"
    info "them: cloudflared tunnel delete $TUNNEL, then delete the record in Cloudflare's DNS settings."
  fi
  exit 0
fi

HOST=$(printf '%s' "$HOST" | tr '[:upper:]' '[:lower:]' | sed -e 's#^https\{0,1\}://##' -e 's#/.*$##')
[ -n "$HOST" ] || die "Say which address to use, like: scripts/linux/domain.sh sticky.example.com"
[[ $HOST =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]$ ]] || die "\"$HOST\" isn't a name like sticky.example.com"
[[ $HOST == *.ts.net ]] && die "That's a Tailscale name. For Tailscale, use scripts/linux/anywhere.sh instead."
[ -n "$PUBLIC_PORT" ] || die "PUBLIC_PORT is off in .env, so the board has no door for the internet. Remove that line and run this again."

# --- 1. cloudflared ----------------------------------------------------------------

say "1/5  cloudflared (Cloudflare's tunnel program)"
if ! command -v cloudflared >/dev/null 2>&1; then
  ask "This needs cloudflared (free; from Cloudflare's own package site). Install it now? It asks for your password." y ||
    die "Nothing changed. Run this again when you want to set it up."
  TMP=$(mktemp)
  trap 'rm -f "$TMP"' EXIT
  download https://pkg.cloudflare.com/cloudflare-main.gpg "$TMP"
  sudo install -D -m 0644 "$TMP" /usr/share/keyrings/cloudflare-main.gpg
  echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' |
    sudo tee /etc/apt/sources.list.d/cloudflared.list >/dev/null
  { sudo apt-get update -qq && sudo apt-get install -y -qq cloudflared; } ||
    die "cloudflared didn't install. See developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads, then run this again."
fi
ok "$(cloudflared --version 2>/dev/null | sed -n 1p)"

# --- 2. Signing in -----------------------------------------------------------------

say "2/5  Signing in to Cloudflare"
if [ -f "$CF_DIR/cert.pem" ]; then
  ok "Signed in already"
else
  info "Open the link (or scan the code), sign in, and pick the domain that ${HOST#*.} is in."
  info "This waits until you have."
  with_qr_links cloudflared tunnel login || die "Cloudflare didn't sign in. Run this again to try again."
  [ -f "$CF_DIR/cert.pem" ] || die "Cloudflare didn't sign in. Run this again to try again."
  ok "Signed in"
fi

# --- 3. The tunnel -----------------------------------------------------------------

say "3/5  The tunnel"
tunnel_id() {
  cloudflared tunnel list --output json --name "$TUNNEL" 2>/dev/null |
    "$NODE" -e 'let s = ""; process.stdin.on("data", d => (s += d)).on("end", () => { try { console.log(JSON.parse(s)[0]?.id ?? ""); } catch { console.log(""); } });'
}
ID=$(tunnel_id)
if [ -z "$ID" ]; then
  cloudflared tunnel create "$TUNNEL" >/dev/null || die "Cloudflare couldn't make the tunnel. See what it said above, then run this again."
  ID=$(tunnel_id)
fi
[ -n "$ID" ] || die "Cloudflare made the tunnel, but it isn't listed. Run this again to try again."
CREDENTIALS="$CF_DIR/$ID.json"
[ -f "$CREDENTIALS" ] ||
  die "Your Cloudflare account has a tunnel named $TUNNEL that was made on another computer. Remove it with: cloudflared tunnel delete $TUNNEL, then run this again."
ok "Tunnel $TUNNEL ($ID)"

# --- 4. The address ----------------------------------------------------------------

say "4/5  Pointing $HOST at the tunnel"
if ! ROUTE=$(cloudflared tunnel route dns "$TUNNEL" "$HOST" 2>&1); then
  printf '%s\n' "$ROUTE" | sed 's/^/    /'
  if [[ $ROUTE == *"already exists"* ]]; then
    die "$HOST already has a DNS record. Delete it in Cloudflare's DNS settings (or pick another name), then run this again."
  fi
  die "Cloudflare couldn't point $HOST at the tunnel. See what it said above, then run this again."
fi
# Signed in to a different domain: Cloudflare adds that domain to the end of the name.
if [[ $ROUTE =~ CNAME[[:space:]]+([^[:space:]]+) ]] && [ "${BASH_REMATCH[1]}" != "$HOST" ]; then
  die "Cloudflare made ${BASH_REMATCH[1]} instead, because you're signed in for another domain. Delete that record in Cloudflare, then sign in for the right one: rm $CF_DIR/cert.pem, and run this again."
fi
ok "$HOST leads to the tunnel"

# --- 5. Running it -----------------------------------------------------------------

say "5/5  Running it, and telling the board its address"
cat >"$TUNNEL_CONFIG" <<YAML
# Made by scripts/linux/domain.sh: https://$HOST leads to the board's door for the internet.
tunnel: $ID
credentials-file: $CREDENTIALS
ingress:
  - hostname: $HOST
    service: http://127.0.0.1:$PUBLIC_PORT
  - service: http_status:404
YAML
mkdir -p "$(dirname "$TUNNEL_SERVICE_FILE")"
cat >"$TUNNEL_SERVICE_FILE" <<UNIT
[Unit]
Description=Digital Sticky at https://$HOST (Cloudflare Tunnel)
Documentation=file://$APP_DIR/README.md
After=network-online.target

[Service]
Type=simple
ExecStart="$(command -v cloudflared)" --no-autoupdate tunnel --config "$TUNNEL_CONFIG" run
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable "$TUNNEL_SERVICE" >/dev/null 2>&1 || true
systemctl --user restart "$TUNNEL_SERVICE" || die "The tunnel didn't start. See: journalctl --user -u $TUNNEL_SERVICE"
ok "The tunnel is running, and starts with the computer (logs: journalctl --user -u $TUNNEL_SERVICE)"
if [ "$(loginctl show-user "$USER" --property=Linger --value 2>/dev/null || true)" != yes ]; then
  warn "It starts when you log in, not at power-on. To change that: sudo loginctl enable-linger $USER"
fi
OLD=$(env_value PUBLIC_URL)
"$NODE" scripts/envFile.ts set PUBLIC_URL "https://$HOST"
ok "Saved PUBLIC_URL=https://$HOST in .env"
if [[ $OLD == https://*.ts.net ]]; then
  info "Tailscale Funnel still serves $OLD too. Turn that off with: scripts/linux/anywhere.sh --off"
fi
if [ "$RESTART" = 1 ]; then
  restart_board
  if [ -f "$SERVICE_FILE" ]; then
    for _ in $(seq 1 30); do
      port_open "$PUBLIC_PORT" && break
      sleep 1
    done
  fi
  # shellcheck disable=SC2016 # JavaScript, not shell
  if ! port_open "$PUBLIC_PORT"; then
    warn "The board isn't running yet, so this couldn't check the address. Once it is, open https://$HOST on your phone."
  elif "$NODE" -e '
    const deadline = Date.now() + 90_000;
    const check = () =>
      fetch(process.argv[1], { signal: AbortSignal.timeout(10_000) })
        .then(r => { if (!r.ok) throw new Error(); })
        .catch(() => { if (Date.now() > deadline) process.exit(1); return new Promise(r => setTimeout(r, 3000)).then(check); });
    check();' "https://$HOST/api/health" 2>/dev/null; then
    ok "The board answers at https://$HOST"
  else
    warn "https://$HOST doesn't answer yet. A new DNS record can take a few minutes to reach everyone."
    warn "Try it on your phone with Wi-Fi off in a little while, or check with: scripts/linux/domain.sh --status"
  fi
fi

say "${GREEN}Done.${PLAIN}"
info "The board's address:  https://$HOST (at home and away)"
info "Sign in a phone:      scan the code on the wall (it now leads to that address)."
info "In the iPhone app:    scan the wall's code again."
info "Turn it off:          scripts/linux/domain.sh --off"
