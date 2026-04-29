# ⚡ KiroWork Desktop

> **Kiro AI 的 macOS 原生客户端** — 将 `kiro-cli` 的全部 Agent 能力封装进一个零终端操作的对话界面。基于 Tauri 2 IPC 桥接 Kiro ACP 协议，前端 React 19 + TypeScript，后端 Rust 异步运行时。

![platform](https://img.shields.io/badge/platform-macOS-lightgrey?logo=apple)
![version](https://img.shields.io/badge/version-0.3.0-blueviolet)
![stack](https://img.shields.io/badge/stack-Tauri%202%20%2B%20React%2019%20%2B%20Rust-orange)
![license](https://img.shields.io/badge/license-MIT-green)

---

## ✨ 核心特性

| 特性 | 说明 |
|------|------|
| 🗂 **多会话管理** | 侧边栏列出所有持久化会话，顶部搜索框按标题/路径即时过滤；切换、恢复、删除；会话历史通过本地 JSONL 离线重建。切换活跃会话后会话条目保持不消失 |
| 🔧 **实时工具调用卡片** | Agent 每次调用工具时自动渲染入参、执行状态（running / success / error）及输出 diff；完成后的编辑卡片自动折叠，点标题可展开 |
| 💬 **悬浮输入药丸** | 底部输入框以独立合成层渲染，流式回复不会与背后的毛玻璃重绘冲突；最新气泡自动停在药丸上方，避免被遮挡 |
| 🤖 **模型 & Agent 模式热切换** | 顶栏下拉直接切换模型和 Agent 模式，无需重建会话上下文 |
| 🧩 **Skills / MCP / Steering 侧边栏** | 基于 macOS FSEvents 实时监听 `.kiro/` 目录变更，自动刷新已安装的 Skills、MCP Server 和 Steering 配置 |
| 🖼 **多模态输入** | 支持文件选择器或剪贴板粘贴上传图片，附缩略图预览，编码为 base64 随 prompt 一同发送 |
| 📊 **上下文用量指示** | 顶栏实时渲染 context window 使用百分比，超过阈值自动切换警告色 |
| 🛑 **非阻塞 Stop** | `session/cancel` 通过独立 `CancelSender` 通道发送，不竞争 `session/prompt` 持有的 ACP 锁 |
| 🈶 **IME 兼容** | 基于时间戳的输入法确认守卫，正确处理 macOS WKWebView 上 `compositionend` 早于 `keydown` 的时序问题 |

---

## 🎬 演示

**① 开启一个项目**

<video src="https://github.com/user-attachments/assets/d2ce553a-621f-429a-a139-c73e229f5081" controls width="100%" style="border-radius:12px"></video>

**② 通过自然语言安装 MCP**

<video src="https://github.com/user-attachments/assets/2a19b9c4-a684-4cb5-b20d-3c69b41928af" controls width="100%" style="border-radius:12px"></video>

---

## 🔧 前置依赖

- macOS 12+（Apple Silicon 或 Intel）
- [`kiro-cli`](https://kiro.dev) 已安装（默认路径 `~/.local/bin/kiro-cli`）
- Node.js 20+
- Rust stable（推荐通过 `rustup` 安装）

---

## 🚀 下载

> 仅支持 macOS（Apple Silicon / Intel）

**[⬇ 下载最新版 DMG → GitHub Releases](https://github.com/ericyanpek/KiroWork-Desktop/releases/latest)**

安装：
1. 打开 DMG，将 **KiroWork Desktop.app** 拖入 `/Applications`
2. **首次启动必须右键 → 打开**，在系统弹窗中确认（ad-hoc 签名绕过 Gatekeeper）
3. 后续双击正常启动

> 若系统提示「已损坏」，终端执行 `xattr -cr "/Applications/KiroWork Desktop.app"` 后重试。

---

## 🏗 架构概览

```
┌─────────────────────────────────────────────────────┐
│                  React 19 Frontend                  │
│  Zustand store ←→ tauri-bridge ←→ Tauri IPC layer  │
└───────────────────────┬─────────────────────────────┘
                        │ invoke / emit
┌───────────────────────▼─────────────────────────────┐
│               Rust Backend (Tokio async)             │
│  AcpClient ──► kiro-cli acp (JSON-RPC 2.0 / stdio) │
│  SessionStore ──► ~/.kiro/sessions/cli/*.jsonl      │
│  WorkspaceWatcher ──► FSEvents → Tauri event bus    │
└─────────────────────────────────────────────────────┘
```

**通信协议**：Tauri IPC（`invoke` / `emit`）封装 JSON-RPC 2.0，通过 kiro-cli 子进程的 stdin/stdout 与 Kiro ACP 协议交互。响应通过 `DashMap<u64, oneshot::Sender>` 按请求 ID 路由；流式通知（`session/update`）直接转发为 Tauri 事件。

---

## 💻 本地开发

```sh
npm install
npm run tauri dev
```

首次启动自动执行 `initialize` 握手连接 Kiro ACP，未认证时跳转登录页，轮询 `check_auth` 直至 OAuth 完成。

---

## 📦 打包

```sh
# 标准打包 — 生成 .app + .dmg
npm run tauri build

# 推荐分发版本 — DMG 内附首次运行说明
npm run bundle:mac
```

产物：

```
src-tauri/target/release/bundle/
├── macos/KiroWork Desktop.app
└── dmg/KiroWork Desktop_0.3.0_aarch64.dmg
```

---

## 📁 项目结构

```
src/
  components/        AuthGate · Toolbar · Sidebar · ChatPanel · InputBar · ToolCallCard …
  hooks/             useAcp · useWorkspaceScan · useOpenWorkspace · useIsDark …
  stores/            Zustand app store（会话状态 / ACP 状态 / 错误）
  lib/               tauri-bridge（唯一 IPC 边界）· shiki（懒加载语法高亮）
  types/acp.ts       ACP 协议 wire types

src-tauri/src/
  acp_client.rs      kiro-cli 子进程生命周期 + JSON-RPC 帧解析 + 事件路由
  commands.rs        16 个 Tauri command handler
  session_store.rs   ~/.kiro/sessions/cli/ JSONL 解析与会话元数据
  workspace_scanner.rs  .kiro/ 静态扫描（Skills / MCP / Steering frontmatter）
  workspace_watcher.rs  FSEvents 动态监听 → workspace-manifest-updated 事件
  auth_manager.rs    kiro-cli 认证状态检测与登录触发

scripts/
  repack-dmg.sh      Tauri DMG 后处理（注入 Applications 软链接 + 说明文件）
```

---

## 🛠 推荐 IDE 配置

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
