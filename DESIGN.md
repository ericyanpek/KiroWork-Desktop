# KiroWork Desktop 设计说明

本文描述 KiroWork Desktop 0.4.0 的当前实现和后续边界。代码是协议行为的
最终依据；扩展方法必须保持可降级。

## 1. 产品边界

KiroWork 是 Kiro CLI 的本地桌面客户端，不实现模型推理、Agent loop 或
工具系统。应用负责：

- 启动、监控并关闭 `kiro-cli acp`
- 将 ACP JSON-RPC 映射为 Tauri command/event
- 管理 workspace、会话历史和用户权限
- 将流式文本、reasoning、工具调用和项目配置呈现为桌面 UI

工作区文件由 Kiro CLI 工具访问。Rust 后端只为会话发现、文件预览、
workspace 配置扫描和 transcript 导出提供受控本地能力。

## 2. 运行架构

```text
┌─────────────────────────────────────────────────────┐
│ React 19                                            │
│ Components ─ Hooks ─ Zustand ─ tauri-bridge         │
└──────────────────────┬──────────────────────────────┘
                       │ invoke / event
┌──────────────────────▼──────────────────────────────┐
│ Tauri 2 + Rust                                      │
│                                                     │
│ AcpClient                                           │
│  ├── child lifecycle                                │
│  ├── concurrent JSON-RPC request routing            │
│  ├── server request / permission handling           │
│  └── notification forwarding                        │
│                                                     │
│ AuthManager · SessionStore · WorkspaceWatcher       │
└──────────────────────┬──────────────────────────────┘
                       │ JSON-RPC 2.0 over stdio
                       ▼
                 kiro-cli acp
```

前端只能通过 `src/lib/tauri-bridge.ts` 调用后端。组件不得直接调用 Tauri
`invoke` 或 `listen`。

## 3. ACP 生命周期

### 3.1 启动

1. 根据 `KIRO_CLI_PATH`、默认安装目录和 `PATH` 查找 Kiro CLI。
2. 执行 `kiro-cli --version`，最低支持版本为 2.2.0。
3. 启动 `kiro-cli acp`，分别持有 stdin、stdout 和 stderr。
4. 发送 `initialize` 并保存 capabilities 与 CLI 版本。
5. 将 reader loop 独立运行，按 JSON-RPC id 分发 response。

请求路由使用 `DashMap<RpcId, oneshot::Sender<_>>`。`session/prompt` 可以
长时间等待，同时 cancel、permission response 和其他请求仍可写入 stdin。

### 3.2 会话

- `session/new`：以 workspace 绝对路径创建会话。
- `session/load`：恢复 Kiro 会话，并从本地 JSONL replay 历史 UI。
- `session/prompt`：发送 text/image content blocks。
- `session/cancel`：以 notification 中止当前 turn。
- `session/set_model`、`session/set_mode`：热切换模型和 Agent。

活跃会话的 lock 文件由 Kiro CLI 所有。应用不得修改被锁定的 session
JSON/JSONL，只能读取标题或通过 ACP 操作会话。

### 3.3 扩展能力

当前可选扩展包括：

| 能力 | 方法或通知 |
|---|---|
| Queue Steering | `_session/steer` |
| Slash Command | `_kiro.dev/commands/execute` |
| Command discovery | `_kiro.dev/commands/available` |
| Subagent list/activity | `_kiro.dev/subagent/list_update`, `_kiro.dev/session/update` |
| MCP OAuth/status | `_kiro.dev/mcp/*` |
| Context metadata | `_kiro.dev/metadata` |

Slash commands 只展示 CLI 实际公布的命令。Reasoning effort 只在
`configOptions[id="effort"]` 存在时显示。未知通知只记录 debug 日志，
不能中断主会话。

## 4. 权限模型

Kiro CLI 发起 `session/request_permission` server request 后，Rust 将请求
缓存并发出 Tauri event。前端只允许选择 CLI 提供的 option id：

- Ask：逐次显示权限对话框
- Auto：本次应用运行期间自动选择首选 allow option

Auto 不写入 Kiro 的永久策略，应用重启后恢复 Ask。所有未决 permission
在断开连接或切换会话时清理。

## 5. 前端状态

Zustand store 分为：

- ACP/auth 状态
- 活跃 session/workspace
- messages、reasoning 和 tool calls
- model/mode/config options
- permission queue
- subagent、MCP 和 steering 状态
- persisted sessions 与 workspace manifest
- file preview 和 UI 状态

`useAcp` 在应用生命周期内建立一次全局监听。流式文本与 reasoning 先在
模块缓冲区聚合，再异步 flush，避免高频 React render。

## 6. Workspace 与本地数据

- `KIRO_HOME` 未设置时使用 `~/.kiro`。
- 会话位于 `$KIRO_HOME/sessions/cli`。
- 项目配置只扫描 `<workspace>/.kiro`。
- 文件 watcher 变更后重新生成 manifest 并通知前端。
- MCP runtime 状态来自 CLI 通知，不从配置文件推断“已连接”。

Transcript 由前端转换为 Markdown，后端只向用户通过 save dialog 选择的
绝对路径写入，最大 16 MiB。

## 7. 错误和兼容策略

后端错误序列化为稳定的 `AppError`：

- `kiro_not_found`
- `auth_required`
- `acp_connection_failed`
- `acp_timeout`
- `session_error`
- `workspace_error`
- `unknown`

实验扩展失败应影响单次操作，不应破坏标准 ACP prompt。CLI 版本无法解析
时显示 compatibility warning，并继续使用能力发现。

## 8. macOS 打包

正式命令：

```sh
npm run bundle:mac
```

Tauri 只生成 ad-hoc signed `.app`。`scripts/repack-dmg.sh` 将 `.app`、
Applications 软链接和首次运行说明放入 staging，再直接通过
`hdiutil create -srcfolder` 生成只读 zlib DMG。

该流程不使用 Finder AppleScript，也不挂载临时读写镜像。

## 9. 测试基线

当前必须通过：

```sh
npm run build
cd src-tauri
cargo test
cargo clippy --all-targets -- -D warnings
```

Rust 单元测试覆盖 JSON-RPC 分类、permission 形状、CLI 版本、session
路径、steering/command payload 和 MCP 状态归一化。

## 10. 路线图

### 已完成

- [x] Kiro CLI discovery、认证与 ACP initialize
- [x] 并发 JSON-RPC 路由、prompt、cancel 和 permission
- [x] 会话列表、恢复、删除和 JSONL replay
- [x] 流式文本、reasoning、tool call、diff 和文件预览
- [x] Model、Agent、effort 和 permission mode
- [x] Slash Command、Queue Steering 和 prompt reuse
- [x] Subagent activity、MCP status/OAuth 和配置热更新
- [x] Markdown transcript 导出
- [x] macOS `.app` 与无 Finder 依赖的 DMG 打包

### 下一阶段

- [ ] ACP 异常退出自动重连并恢复活跃 session
- [ ] 前端 state/normalizer 单元测试
- [ ] Rust reconnect 生命周期测试
- [ ] GitHub Actions build/test/clippy
- [ ] Context compaction、clear 和 Agent switch 状态 UI
- [ ] Slash Command 参数补全
- [ ] CSP 与 Tauri capability 收紧

### 发布阶段

- [ ] Universal macOS 构建，或明确限定 Apple Silicon
- [ ] Apple Developer ID 签名与 notarization
- [ ] Tauri updater 与发布校验
- [ ] 真实 Kiro CLI 版本兼容矩阵

## 11. 不变量

1. 不直接编辑活跃 Kiro session 文件。
2. 不将 Auto permission 持久化为永久批准。
3. 不假设扩展通知一定存在。
4. 不把 prompt reuse 标记为 rewind。
5. 不在前端保存 Kiro 凭据或 OAuth token。
6. 不从任意 URL 调用 shell open；仅允许 `http:` 和 `https:`。
