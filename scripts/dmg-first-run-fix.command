#!/bin/bash
# KiroWork Desktop — first-run fix
#
# macOS stamps anything arriving via a browser / AirDrop / chat app /
# cloud drive with com.apple.quarantine. Combined with an unsigned bundle
# that makes Gatekeeper refuse the app with a scary "…is damaged…" dialog.
# The file is fine; macOS is just refusing to run it.
#
# Double-click this file AFTER dragging "KiroWork Desktop.app" into your
# Applications folder. It strips the quarantine flag so the app will open.

set -e
cd "$(dirname "$0")"

APP_NAME="KiroWork Desktop.app"
TARGETS=(
  "/Applications/${APP_NAME}"
  "${HOME}/Applications/${APP_NAME}"
)

echo ""
echo "=== KiroWork Desktop — First-run fix ==="
echo ""

FIXED=0
for APP in "${TARGETS[@]}"; do
  if [ -d "$APP" ]; then
    echo "Found ${APP}"
    echo "Clearing extended attributes (com.apple.quarantine)…"
    xattr -cr "$APP" || true
    echo "Done."
    FIXED=1
  fi
done

if [ "$FIXED" -eq 0 ]; then
  echo "Could not find KiroWork Desktop.app in /Applications or ~/Applications."
  echo ""
  echo "Please drag 'KiroWork Desktop.app' from this DMG into your Applications"
  echo "folder first, then double-click this file again."
  echo ""
  read -n 1 -s -r -p "Press any key to close this window…"
  echo ""
  exit 1
fi

echo ""
echo "You can now open KiroWork Desktop from Launchpad or Applications."
echo ""
read -n 1 -s -r -p "Press any key to close this window…"
echo ""
