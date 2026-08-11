# KiroWork Desktop

KiroWork Desktop 是一个面向 macOS 的 Kiro CLI 图形客户端。应用通过
Tauri 2 启动本机 `kiro-cli acp` 子进程，以 JSON-RPC 2.0 与 Kiro Agent
通信；React 前端负责会话、权限、工具调用和项目配置的可视化。

![platform](https://img.shields.io/badge/platform-macOS-lightgrey?logo=apple)
![version](https://img.shields.io/badge/version-0.4.0-blue)
![stack](https://img.shields.io/badge/stack-Tauri%202%20%2B%20React%2019%20%2B%20Rust-orange)
![license](https://img.shields.io/badge/license-MIT-green)

## 功能

- 多会话列表、搜索、恢复和删除
- Agent 回复、reasoning 和工具调用流式展示
- 文件变更 diff、文件活动与侧边预览
- 图片选择和剪贴板图片输入
- 模型、Agent 模式、reasoning effort 动态切换
- Ask/Auto 工具权限模式和逐次权限确认
- 运行中 Queue Steering 与独立 Stop 操作
- Kiro CLI 动态 Slash Command 命令面板
- Subagent 活动、MCP 连接状态和 OAuth 授权入口
- `.kiro/skills`、MCP 和 Steering 配置热更新
- 上下文用量、主题切换和 Markdown transcript 导出
- `KIRO_HOME` 与 Kiro CLI 版本兼容检查

## 系统要求

- macOS 12 或更高版本
- Kiro CLI 2.2.0 或更高版本
- 本地开发需要 Node.js 20+ 和 Rust stable

Kiro CLI 默认从 `KIRO_CLI_PATH`、`~/.local/bin/kiro-cli` 和当前 `PATH`
发现。会话目录遵循 `KIRO_HOME`，未设置时使用 `~/.kiro`。

## 本地开发

```sh
npm install
npm run tauri dev
```

应用启动时会检查 Kiro CLI 和登录状态。未登录时可从应用触发 Kiro CLI
登录流程，认证完成后重新连接 ACP。

## 验证

```sh
npm run build
cd src-tauri
cargo test
cargo clippy --all-targets -- -D warnings
```

## macOS 打包

```sh
npm run bundle:mac
```

该命令先让 Tauri 构建并签名 `.app`，再使用项目脚本创建最终 DMG。DMG
流程不依赖 Finder 自动化，可避免新版本 macOS 下临时卷无法及时卸载。

产物：

```text
src-tauri/target/release/bundle/
├── macos/KiroWork Desktop.app
└── dmg/KiroWork Desktop_0.4.0_aarch64.dmg
```

当前发布包使用 ad-hoc 签名，首次启动需要在 Applications 中右键应用并
选择“打开”。正式分发前仍需配置 Apple Developer ID、notarization 和
universal build。

## 架构

```text
React 19 + Zustand
        │ Tauri invoke / event
        ▼
Rust backend
  ├── ACP client and JSON-RPC router
  ├── Kiro CLI discovery and authentication
  ├── session replay and persistence
  └── workspace scanner and watcher
        │ stdin / stdout
        ▼
kiro-cli acp
```

主要目录：

```text
src/
  components/        对话、工具栏、侧边栏、权限和文件预览
  hooks/             ACP 事件、workspace 和主题逻辑
  stores/            Zustand 应用状态
  lib/               Tauri IPC 边界
  types/acp.ts       ACP wire types

src-tauri/src/
  acp_client.rs      子进程、JSON-RPC 路由和 ACP 事件
  commands.rs        Tauri command handlers
  auth_manager.rs    CLI 检测与认证
  session_store.rs   会话发现与离线 replay
  workspace_*.rs     `.kiro` 扫描与文件监听
```

协议与模块约束见 [DESIGN.md](./DESIGN.md)。

## 当前限制

- `_kiro.dev/*` 和 `_session/steer` 属于扩展协议，能力依赖已安装 CLI。
- 应用当前不会在 Kiro CLI 异常退出后自动恢复 ACP 与活跃会话。
- Context compaction 等部分扩展状态尚未提供独立 UI。
- 尚未配置自动更新、Developer ID 签名和 Apple notarization。

## License

MIT
