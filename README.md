# KiroWork Desktop

A Mac app that wraps [`kiro-cli`](https://kiro.dev) in a chat-first UI, so
non-technical users can interact with a Kiro agent without touching a
terminal. Tauri 2 + React 19 + TypeScript + Rust.

See [DESIGN.md](./DESIGN.md) for the architecture.

## Prerequisites

- macOS (Apple Silicon or Intel)
- [`kiro-cli`](https://kiro.dev) installed at `~/.local/bin/kiro-cli`
- Node 20+ and Rust stable (`rustup` recommended)

## Develop

```sh
npm install
npm run tauri dev
```

The app will auto-connect to the Kiro CLI and walk you through login on first
launch.

## Build a distributable

There are two build flavours:

```sh
# Default Tauri build — .app + a plain .dmg (drag-to-Applications only).
npm run tauri build

# Recommended for handing the DMG to someone else.
# Same .app, but the .dmg is repacked with a README and a first-run-fix
# helper so macOS's Gatekeeper doesn't block recipients.
npm run bundle:mac
```

Outputs land under:

```
src-tauri/target/release/bundle/
├── macos/KiroWork Desktop.app
└── dmg/KiroWork Desktop_0.2.0_aarch64.dmg
```

## Distributing the DMG to other people

> **Short version**: tell recipients to open the DMG, drag the app to
> Applications, then double-click **`First-run fix.command`**.

### Why they'll see "KiroWork Desktop.app is damaged"

The app is **not signed with an Apple Developer ID** (that costs 99 USD / year).
When macOS sees an unsigned app that came in through any network channel —
Safari, Chrome, AirDrop, WeChat, DingTalk, email, a cloud drive — it stamps
the download with `com.apple.quarantine` and refuses to open it. The error
message says "damaged", but the file is completely fine; Gatekeeper is just
saying no.

The file **only** gets that stamp on the recipient's machine. That's why you
can open your own builds without issue — your local files never had it.

### What `npm run bundle:mac` does about it

The repacked DMG includes a small helper (`First-run fix.command`) that
clears `com.apple.quarantine` from the installed app, plus a plain-English
README inside the disk image:

```
KiroWork Desktop 0.2.0/
├── KiroWork Desktop.app
├── Applications  ← symlink to /Applications
├── First-run fix.command
└── README.txt
```

**Instructions for recipients** (paste these alongside the DMG link):

1. Open the DMG.
2. Drag **KiroWork Desktop.app** into the **Applications** folder.
3. Double-click **First-run fix.command**. A Terminal window will open
   briefly, print "Done", and close on any keypress.
4. Launch KiroWork Desktop from Launchpad or Applications.

If they skip step 3 and get the "damaged" dialog anyway, either:

- Right-click the app → **Open** → **Open** in the dialog, OR
- Run in Terminal:
  ```sh
  xattr -cr "/Applications/KiroWork Desktop.app"
  ```

### If you want to get rid of the warning entirely

Short of paying for an Apple Developer account, there's no way to make the
first-launch warning disappear. The proper fix is:

1. Join the [Apple Developer Program](https://developer.apple.com/programs/)
   (99 USD/year).
2. Request a **Developer ID Application** certificate.
3. Set `bundle.macOS.signingIdentity` in `src-tauri/tauri.conf.json`.
4. Notarize with `xcrun notarytool` and staple with `xcrun stapler`.

See [Tauri's macOS signing guide](https://tauri.app/distribute/sign/macos/).

## Project layout

```
src/                         # React + TS frontend
  components/                  UI (AuthGate, Toolbar, Sidebar, ChatPanel, …)
  hooks/                       useAcp, useTheme, useRestoreSession, …
  stores/                      zustand app store
  lib/                         tauri-bridge, shiki
  types/acp.ts                 wire types mirroring kiro-cli's ACP protocol
src-tauri/src/               # Rust backend
  acp_client.rs                kiro-cli child process + JSON-RPC framing
  commands.rs                  Tauri commands exposed to the frontend
  session_store.rs             reads ~/.kiro/sessions/cli/ for replay
  workspace_scanner.rs         scans project .kiro/ for skills/mcp/steering
  auth_manager.rs              kiro-cli login state gate
scripts/
  dmg-first-run-fix.command    helper bundled into the DMG
  repack-dmg.sh                post-processes Tauri's DMG to include helper
```

## Recommended IDE setup

- [VS Code](https://code.visualstudio.com/)
  + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
  + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
