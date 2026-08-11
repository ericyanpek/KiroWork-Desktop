# ⚡ KiroWork Desktop

<p align="right"><a href="./README_EN.md">English</a> | <strong>简体中文</strong></p>

> **Kiro CLI 的 macOS 桌面客户端** — 将本机 `kiro-cli` 的 Agent 能力接入一个无需持续操作终端的对话界面。应用基于 Tauri 2 桥接 ACP 协议，前端使用 React 19 + TypeScript，后端使用 Rust + Tokio。

![platform](https://img.shields.io/badge/platform-macOS-lightgrey?logo=apple)
![version](https://img.shields.io/badge/version-0.4.0-blue)
![stack](https://img.shields.io/badge/stack-Tauri%202%20%2B%20React%2019%20%2B%20Rust-orange)
![license](https://img.shields.io/badge/license-MIT-green)

---

## ✨ 核心特性

| 特性 | 说明 |
|---|---|
| 🪶 **轻量原生桌面端** | 基于 Tauri 和 macOS 系统 WebView，不捆绑浏览器引擎、模型运行时或 Kiro CLI。 |
| 🗂 **会话连续性** | 搜索、恢复和删除本地会话；ACP 异常退出后自动重连并恢复活跃会话。 |
| 💬 **可视化 Agent 工作流** | 流式展示回复、reasoning、工具调用、文件活动和编辑 diff。 |
| 🖼 **多模态输入** | 支持文件选择器和剪贴板图片输入，发送前提供缩略图预览。 |
| 🛡 **本地权限控制** | 凭据由 Kiro CLI 管理；支持 Ask/Auto，自动批准不会写入永久策略。 |
| 🎛 **Agent 实时控制** | 支持模型、模式、effort、Slash Command、Queue Steering 和独立 Stop。 |
| 🧩 **项目生态集成** | 感知 Skills、MCP 和 Steering 配置，并展示 MCP OAuth 与 Subagent 状态。 |

其他能力：上下文用量、主题切换、Markdown transcript 导出和 macOS 输入法兼容。

---

## 🎬 演示

**① 开启一个项目**

<video src="https://github.com/user-attachments/assets/6d2c2003-b3d9-4835-aaa8-6289861ff3ff" controls width="100%" style="border-radius:12px"></video>

**② 通过自然语言安装 MCP 和 Skills**

<video src="https://github.com/user-attachments/assets/73716c1b-78a6-4d37-9e05-74129d0f2b20" controls width="100%" style="border-radius:12px"></video>

---

## 🔧 前置依赖

- macOS 12 或更高版本
- [Kiro CLI](https://kiro.dev) 2.2.0 或更高版本
- 本地开发需要 Node.js 20+ 和 Rust stable

KiroWork 会依次从 `KIRO_CLI_PATH`、`~/.local/bin/kiro-cli` 和当前
`PATH` 查找 Kiro CLI。会话目录遵循 `KIRO_HOME`；未设置时使用
`~/.kiro`。

---

## 🚀 下载

**[⬇ 下载最新版 DMG → GitHub Releases](https://github.com/ericyanpek/KiroWork-Desktop/releases/latest)**

当前项目的本地发布流程生成 Apple Silicon (`aarch64`) DMG。安装步骤：

1. 打开 DMG，将 **KiroWork Desktop.app** 拖入 `/Applications`。
2. 首次启动时在 Applications 中右键应用并选择“打开”。
3. 在 macOS 安全提示中确认，之后可正常双击启动。

当前发布包使用 ad-hoc 签名。若系统提示应用“已损坏”，可执行：

```sh
xattr -cr "/Applications/KiroWork Desktop.app"
```

正式公开分发仍需配置 Apple Developer ID 签名与 notarization。

---

## 🏗 架构概览

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

前端只通过 `src/lib/tauri-bridge.ts` 调用后端。Rust 使用
`DashMap<RpcId, oneshot::Sender<_>>` 路由并发响应，因此长时间运行的
`session/prompt` 不会阻塞 cancel、permission response 或其他 ACP 请求。

ACP 进程意外退出时，前端按照 0、2、5 秒的间隔执行最多三次恢复。后端在
单一 `reconnect_acp` command 中串行完成新进程启动、`initialize` 和
`session/load`，恢复期间保留当前消息时间线。

协议与模块约束见 [DESIGN.md](./DESIGN.md)。

---

## 💻 本地开发

```sh
npm install
npm run tauri dev
```

应用启动时会检查 Kiro CLI 版本和登录状态。未登录时可从应用触发 Kiro
CLI 登录流程，认证完成后重新连接 ACP。

### 验证

```sh
npm run test:run
npm run build

cd src-tauri
cargo fmt --all -- --check
cargo test
cargo clippy --all-targets -- -D warnings
```

GitHub Actions 使用 macOS runner 执行同一组前端和 Rust 检查。

---

## 📦 macOS 打包

```sh
npm run bundle:mac
```

该命令先让 Tauri 构建并签名 `.app`，再由
`scripts/repack-dmg.sh` 使用 `hdiutil -srcfolder` 创建最终 DMG。流程不
依赖 Finder 自动化，也不挂载临时读写镜像。

产物：

```text
src-tauri/target/release/bundle/
├── macos/KiroWork Desktop.app
└── dmg/KiroWork Desktop_0.4.0_aarch64.dmg
```

---

## 📁 项目结构

```text
src/
  components/        对话、工具栏、侧边栏、权限和文件预览
  hooks/             ACP 事件、自动恢复、workspace 和主题逻辑
  stores/            Zustand 应用状态与 session replay
  lib/               Tauri IPC、重试策略和事件归一化
  types/acp.ts       ACP wire types

src-tauri/src/
  acp_client.rs      子进程、JSON-RPC 路由、权限和 ACP 事件
  commands.rs        Tauri commands 与 session 恢复
  auth_manager.rs    CLI 检测与认证
  session_store.rs   会话发现与离线 replay
  workspace_*.rs     `.kiro` 扫描与文件监听

scripts/
  repack-dmg.sh      无 Finder 依赖的 DMG 创建脚本

.github/workflows/
  ci.yml             前端 build/test 与 Rust fmt/test/clippy
```

---

## ⚠️ 当前限制

- `_kiro.dev/*` 和 `_session/steer` 属于扩展协议，能力取决于本机安装的 Kiro CLI。
- Context compaction、clear 和 Agent switch 状态尚未提供独立 UI。
- 尚未配置自动更新、Developer ID 签名和 Apple notarization。
- 当前缺少 ACP 子进程故障注入的端到端恢复测试。

---

## 🛠 推荐 IDE 配置

- [VS Code](https://code.visualstudio.com/)
- [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## License

MIT
