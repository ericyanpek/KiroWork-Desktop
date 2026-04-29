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

> **Short version**: tell recipients to drag the app to Applications, then
> **right-click → Open** on the first launch.

### How the unsigned bundle behaves

The app is ad-hoc signed (`bundle.macOS.signingIdentity: "-"` in
`tauri.conf.json`) but **not signed with an Apple Developer ID** (which
costs 99 USD/year). On first launch, macOS shows an "unidentified
developer" dialog. Apple's built-in escape hatch is **right-click → Open**:
choose Open from the context menu, then click Open in the confirmation
dialog. Done once, then double-click works forever after.

### Why not a .command helper?

An earlier attempt bundled a `First-run fix.command` that cleared
`com.apple.quarantine`. Don't do this — macOS applies a **stricter Gatekeeper
policy to double-clicked `.command` files than to `.app` bundles**, with
**no right-click → Open escape hatch**. Unsigned shell scripts from a
quarantined DMG get blocked silently every time. Ad-hoc signing the app
is the only approach that actually works without paying Apple.

### DMG contents

`npm run bundle:mac` produces a DMG with:

```
KiroWork Desktop 0.2.0/
├── KiroWork Desktop.app
├── Applications        ← symlink, for drag-install
└── READ ME FIRST.txt
```

**Instructions for recipients** (paste these alongside the DMG link):

1. Open the DMG.
2. Drag **KiroWork Desktop.app** into the **Applications** folder.
3. Open Applications, **right-click KiroWork Desktop → Open**, click
   **Open** in the confirmation dialog.
4. After the first launch, open it normally from Launchpad / Dock /
   Spotlight.

If macOS still blocks with a "damaged" error, in Terminal run:

```sh
xattr -cr "/Applications/KiroWork Desktop.app"
```

then try right-click → Open again.

### Eliminating the warning entirely

To skip the first-launch warning, join the
[Apple Developer Program](https://developer.apple.com/programs/) (99 USD/year),
request a **Developer ID Application** certificate, replace the `"-"` in
`bundle.macOS.signingIdentity` with your identity, and notarize with
`xcrun notarytool` + `xcrun stapler`. See
[Tauri's macOS signing guide](https://tauri.app/distribute/sign/macos/).

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
  repack-dmg.sh                post-processes Tauri's DMG with a README
```

## Recommended IDE setup

- [VS Code](https://code.visualstudio.com/)
  + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
  + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
