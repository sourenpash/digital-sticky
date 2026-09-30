#!/usr/bin/env bash
# Updates the board to the newest version: downloads it, rebuilds, and refreshes the
# setup (the service and the wall screen). Your board and settings stay as they are,
# and the wall and open phones reload by themselves.
#
#   scripts/linux/update.sh      (or: npm run update)
set -euo pipefail
# shellcheck source-path=SCRIPTDIR source=common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

cd "$APP_DIR"
say "Downloading the newest version"
git pull --ff-only || die "Couldn't update: files in this folder were changed by hand. See: git status"
# The installer (as just downloaded) does the rest without questions.
exec "$APP_DIR/scripts/linux/install.sh" --update
