#!/bin/bash
# Repack the Tauri-generated DMG to include our first-run-fix helper.
#
# Tauri's bundler gives us a DMG with only the .app plus an Applications
# symlink. We can't ask Tauri to add arbitrary files (its bundle_dmg.sh
# is baked in), so instead we mount the existing DMG, copy its contents
# plus our helper into a staging dir, and ship a brand-new read-only DMG.
#
# Usage: scripts/repack-dmg.sh [<version>]
#   version defaults to the value in tauri.conf.json.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

VERSION="${1:-$(grep '"version"' src-tauri/tauri.conf.json | head -1 | sed -E 's/.*"version": *"([^"]+)".*/\1/')}"
BUNDLE_DIR="src-tauri/target/release/bundle"
ORIGINAL_DMG="${BUNDLE_DIR}/dmg/KiroWork Desktop_${VERSION}_aarch64.dmg"
APP_SRC="${BUNDLE_DIR}/macos/KiroWork Desktop.app"
HELPER_SRC="${PROJECT_ROOT}/scripts/dmg-first-run-fix.command"

OUTPUT_DMG="${BUNDLE_DIR}/dmg/KiroWork Desktop_${VERSION}_aarch64.dmg"

if [ ! -d "$APP_SRC" ]; then
  echo "Missing .app bundle at $APP_SRC. Run 'npm run tauri build' first." >&2
  exit 1
fi
if [ ! -f "$HELPER_SRC" ]; then
  echo "Missing helper script at $HELPER_SRC." >&2
  exit 1
fi

STAGING="$(mktemp -d -t kirowork-dmg.XXXXXX)"
trap 'rm -rf "$STAGING"' EXIT

echo "Staging DMG contents in $STAGING"

# Copy the .app (preserving symlinks and metadata)
cp -R "$APP_SRC" "$STAGING/"

# Applications symlink so users can drag-install
ln -s /Applications "$STAGING/Applications"

# The helper — name it so it's obvious in Finder and sorts last
cp "$HELPER_SRC" "$STAGING/First-run fix.command"
chmod +x "$STAGING/First-run fix.command"

# A short README visible inside the DMG
cat > "$STAGING/README.txt" <<'EOF'
KiroWork Desktop — first launch instructions
=============================================

1. Drag "KiroWork Desktop.app" into the Applications folder.

2. Double-click "First-run fix.command".
   (macOS flags unsigned apps arriving from the internet. The helper
    clears that flag so the app will open. You only need to run it once.)

3. Open KiroWork Desktop from Launchpad or Applications.

If macOS still blocks the app, right-click it → Open → Open in the
dialog, or run:
  xattr -cr "/Applications/KiroWork Desktop.app"
in Terminal.
EOF

# Clear the quarantine flag on the helper so double-click actually runs
# (the flag is inherited from whatever network path reached the user).
xattr -cr "$STAGING/First-run fix.command" || true

# Rebuild a read-only DMG. We overwrite the Tauri-produced one in-place.
echo "Creating DMG at $OUTPUT_DMG"
rm -f "$OUTPUT_DMG"
hdiutil create \
  -volname "KiroWork Desktop ${VERSION}" \
  -srcfolder "$STAGING" \
  -fs HFS+ \
  -format UDZO \
  -imagekey zlib-level=9 \
  -ov \
  "$OUTPUT_DMG" >/dev/null

echo ""
echo "✓ Repacked DMG:"
du -sh "$OUTPUT_DMG"
echo "  $OUTPUT_DMG"
