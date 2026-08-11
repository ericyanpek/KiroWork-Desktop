#!/bin/bash
# Package the Tauri-generated app bundle into a DMG with a README.
#
# Tauri's create-dmg path uses Finder AppleScript for icon positioning. On
# newer macOS releases Finder can keep the temporary image busy while the
# bundled script attempts to detach it, causing the build to fail. This script
# deliberately uses hdiutil's srcfolder path, which needs no Finder automation
# or temporary mounted image.
#
# The app is ad-hoc signed (tauri.conf.json -> bundle.macOS.signingIdentity: "-"),
# so macOS shows the "unidentified developer" dialog on first launch instead
# of the unworkable "is damaged" one. Recipients right-click -> Open -> Open.
#
# Bundling a `.command` helper doesn't work here: macOS applies a stricter
# Gatekeeper policy to double-clicked shell scripts than to .app bundles,
# with NO right-click-to-open escape hatch. The helper gets silently blocked.
#
# Usage: scripts/repack-dmg.sh [<version>]
#   version defaults to the value in tauri.conf.json.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

VERSION="${1:-$(grep '"version"' src-tauri/tauri.conf.json | head -1 | sed -E 's/.*"version": *"([^"]+)".*/\1/')}"
BUNDLE_DIR="src-tauri/target/release/bundle"
APP_SRC="${BUNDLE_DIR}/macos/KiroWork Desktop.app"

OUTPUT_DMG="${BUNDLE_DIR}/dmg/KiroWork Desktop_${VERSION}_aarch64.dmg"

if [ ! -d "$APP_SRC" ]; then
  echo "Missing .app bundle at $APP_SRC. Run 'npm run tauri build' first." >&2
  exit 1
fi

STAGING="$(mktemp -d -t kirowork-dmg.XXXXXX)"
trap 'rm -rf "$STAGING"' EXIT

echo "Staging DMG contents in $STAGING"

# Copy the .app (preserving symlinks, metadata, and the ad-hoc signature)
cp -R "$APP_SRC" "$STAGING/"

# Applications symlink so users can drag-install
ln -s /Applications "$STAGING/Applications"

# Plain-English first-launch README. Covers the ad-hoc-signed path.
cat > "$STAGING/READ ME FIRST.txt" <<'EOF'
KiroWork Desktop — first launch
================================

1. Drag "KiroWork Desktop.app" into the Applications folder.

2. Open the Applications folder, find KiroWork Desktop, and
   RIGHT-CLICK it -> choose "Open".

3. A dialog will say macOS cannot verify the developer.
   Click "Open" to confirm.

You only need to do the right-click step ONCE. After that, double-
click works normally from Launchpad, Dock, Applications, or Spotlight.

---

Why? This app isn't signed with a paid Apple Developer ID (99 USD/year).
macOS shows a warning for any unsigned app on first launch. The
right-click -> Open flow is Apple's built-in way to approve it.

If macOS still blocks the app with a "damaged" error, open Terminal
and run:

    xattr -cr "/Applications/KiroWork Desktop.app"

then try right-click -> Open again.
EOF

# Build the final read-only DMG.
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
echo "Packaged DMG:"
du -sh "$OUTPUT_DMG"
echo "  $OUTPUT_DMG"
