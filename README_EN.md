# ⚡ KiroWork Desktop

<p align="right"><strong>English</strong> | <a href="./README.md">简体中文</a></p>

> **A macOS desktop client for Kiro CLI** — Bring the agent capabilities of your local `kiro-cli` into a conversational interface that does not require constant terminal interaction. The app bridges the ACP protocol with Tauri 2, using React 19 + TypeScript on the frontend and Rust + Tokio on the backend.

![platform](https://img.shields.io/badge/platform-macOS-lightgrey?logo=apple)
![version](https://img.shields.io/badge/version-0.4.0-blue)
![stack](https://img.shields.io/badge/stack-Tauri%202%20%2B%20React%2019%20%2B%20Rust-orange)
![license](https://img.shields.io/badge/license-MIT-green)

---

## ✨ Core Features

| Feature | Description |
|---|---|
| 🪶 **Lightweight Native Desktop** | Built with Tauri and the macOS system WebView, without bundling a browser engine, model runtime, or Kiro CLI. |
| 🗂 **Session Continuity** | Search, restore, and delete local sessions; reconnect and restore the active session after an unexpected ACP exit. |
| 💬 **Visual Agent Workflow** | Stream responses, reasoning, tool calls, file activity, and edit diffs. |
| 🖼 **Multimodal Input** | Add images through the file picker or clipboard, with thumbnail previews before sending. |
| 🛡 **Local Permission Controls** | Keep credentials managed by Kiro CLI; use Ask or Auto without writing automatic approvals to permanent policy. |
| 🎛 **Live Agent Controls** | Use models, modes, effort, slash commands, Queue Steering, and independent Stop. |
| 🧩 **Project Ecosystem Integration** | Discover Skills, MCP, and Steering configuration while displaying MCP OAuth and Subagent status. |

Additional capabilities: context usage, theme switching, Markdown transcript
export, and macOS IME compatibility.

---

## 🎬 Demo

**① Open a project**

<video src="https://github.com/user-attachments/assets/6d2c2003-b3d9-4835-aaa8-6289861ff3ff" controls width="100%" style="border-radius:12px"></video>

**② Install MCP servers and Skills with natural language**

<video src="https://github.com/user-attachments/assets/73716c1b-78a6-4d37-9e05-74129d0f2b20" controls width="100%" style="border-radius:12px"></video>

---

## 🔧 Prerequisites

- macOS 12 or later
- [Kiro CLI](https://kiro.dev) 2.2.0 or later
- Node.js 20+ and Rust stable for local development

KiroWork searches for Kiro CLI in `KIRO_CLI_PATH`, `~/.local/bin/kiro-cli`,
and the current `PATH`, in that order. Session storage follows `KIRO_HOME`,
falling back to `~/.kiro` when it is not set.

---

## 🚀 Download

**[⬇ Download the latest DMG from GitHub Releases](https://github.com/ericyanpek/KiroWork-Desktop/releases/latest)**

The current local release workflow produces an Apple Silicon (`aarch64`) DMG.
To install:

1. Open the DMG and drag **KiroWork Desktop.app** into `/Applications`.
2. For the first launch, right-click the app in Applications and select "Open."
3. Confirm the macOS security prompt. Subsequent launches can use a normal double-click.

Current release builds use ad-hoc signing. If macOS reports that the app is
"damaged," run:

```sh
xattr -cr "/Applications/KiroWork Desktop.app"
```

Public distribution still requires Apple Developer ID signing and notarization.

---

## 🏗 Architecture Overview

```text
┌─────────────────────────────────────────────────────┐
│ React 19 + TypeScript                               │
│ Components ← Hooks ← Zustand ← tauri-bridge         │
└───────────────────────┬─────────────────────────────┘
                        │ Tauri invoke / event
┌───────────────────────▼─────────────────────────────┐
│ Tauri 2 + Rust                                      │
│                                                     │
│ AcpClient                                           │
│  ├── kiro-cli child lifecycle                       │
│  ├── JSON-RPC request / response routing            │
│  ├── permission and notification handling           │
│  └── reconnect and active-session recovery          │
│                                                     │
│ SessionStore · WorkspaceScanner · WorkspaceWatcher  │
└───────────────────────┬─────────────────────────────┘
                        │ JSON-RPC 2.0 over stdio
                        ▼
                  kiro-cli acp
```

The frontend accesses the backend exclusively through
`src/lib/tauri-bridge.ts`. Rust routes concurrent responses with
`DashMap<RpcId, oneshot::Sender<_>>`, so a long-running `session/prompt` does
not block cancel, permission responses, or other ACP requests.

After an unexpected ACP process exit, the frontend makes up to three recovery
attempts with delays of 0, 2, and 5 seconds. A single `reconnect_acp` command
serializes process startup, `initialize`, and `session/load`, while preserving
the current message timeline during recovery.

See [DESIGN.md](./DESIGN.md) for protocol and module constraints.

---

## 💻 Local Development

```sh
npm install
npm run tauri dev
```

At startup, the app checks the Kiro CLI version and authentication status. If
authentication is required, the app can start the Kiro CLI login flow and
reconnect ACP after authentication completes.

### Verification

```sh
npm run test:run
npm run build

cd src-tauri
cargo fmt --all -- --check
cargo test
cargo clippy --all-targets -- -D warnings
```

GitHub Actions runs the same frontend and Rust checks on a macOS runner.

---

## 📦 macOS Packaging

```sh
npm run bundle:mac
```

This command first asks Tauri to build and sign the `.app`, then uses
`scripts/repack-dmg.sh` with `hdiutil -srcfolder` to create the final DMG. The
flow does not depend on Finder automation or mount a temporary writable image.

Artifacts:

```text
src-tauri/target/release/bundle/
├── macos/KiroWork Desktop.app
└── dmg/KiroWork Desktop_0.4.0_aarch64.dmg
```

---

## 📁 Project Structure

```text
src/
  components/        Conversation, toolbar, sidebar, permissions, and file preview
  hooks/             ACP events, automatic recovery, workspace, and themes
  stores/            Zustand application state and session replay
  lib/               Tauri IPC, retry policy, and event normalization
  types/acp.ts       ACP wire types

src-tauri/src/
  acp_client.rs      Child process, JSON-RPC routing, permissions, and ACP events
  commands.rs        Tauri commands and session recovery
  auth_manager.rs    CLI discovery and authentication
  session_store.rs   Session discovery and offline replay
  workspace_*.rs     `.kiro` scanning and file watching

scripts/
  repack-dmg.sh      Finder-independent DMG creation

.github/workflows/
  ci.yml             Frontend build/test and Rust fmt/test/clippy
```

---

## ⚠️ Current Limitations

- `_kiro.dev/*` and `_session/steer` are extension protocols whose availability depends on the installed Kiro CLI.
- Context compaction, clear, and Agent switch status do not yet have dedicated UI.
- Automatic updates, Developer ID signing, and Apple notarization are not yet configured.
- End-to-end recovery tests with ACP child-process fault injection are not yet available.

---

## 🛠 Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/)
- [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## License

MIT
