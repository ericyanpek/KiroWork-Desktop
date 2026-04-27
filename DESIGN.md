# Kiro CoWork Desktop — 技术方案设计

## 1. 产品定位

一个面向非技术人员的 Mac 桌面应用，将 Kiro CLI/Agent 的能力通过类似 Claude Cowork 的对话式 UI 透传给用户。用户无需接触终端，即可通过自然语言与 Kiro Agent 交互，完成代码生成、文件操作、项目管理等任务。

### 核心原则

- **不重新造轮子**：所有 AI 能力来自 Kiro CLI，Desktop App 只做 UI 层
- **认证复用**：直接使用 Kiro CLI 自身的登录流程（AWS Builder ID / IAM Identity Center / GitHub / Google）
- **Skills/MCP 透传**：自动识别项目 `.kiro/` 目录下的 skills、steering、mcp.json 配置

---

## 2. 核心架构

```
┌──────────────────────────────────────────────────────┐
│                 Tauri Mac App                         │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │              React Frontend                   │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────┐  │    │
│  │  │ Chat     │ │Workspace │ │  File/Diff    │  │    │
│  │  │ Panel    │ │ Explorer │ │  Viewer       │  │    │
│  │  └────┬─────┘ └────┬─────┘ └──────┬───────┘  │    │
│  │       │             │              │           │    │
│  │  ┌────▼─────────────▼──────────────▼───────┐  │    │
│  │  │         ACP Client (TypeScript)          │  │    │
│  │  │   JSON-RPC 2.0 over Tauri IPC Bridge     │  │    │
│  │  └────────────────┬────────────────────────┘  │    │
│  └───────────────────┼───────────────────────────┘    │
│                      │ Tauri Command (invoke)         │
│  ┌───────────────────▼───────────────────────────┐    │
│  │           Tauri Rust Backend                   │    │
│  │  ┌─────────────────────────────────────────┐  │    │
│  │  │  Process Manager                         │  │    │
│  │  │  - spawn `kiro-cli acp`                  │  │    │
│  │  │  - stdin/stdout JSON-RPC pipe            │  │    │
│  │  │  - session lifecycle management          │  │    │
│  │  └─────────────────────────────────────────┘  │    │
│  │  ┌─────────────────────────────────────────┐  │    │
│  │  │  Auth Manager                            │  │    │
│  │  │  - detect kiro-cli login state           │  │    │
│  │  │  - trigger `kiro-cli login` if needed    │  │    │
│  │  └─────────────────────────────────────────┘  │    │
│  │  ┌─────────────────────────────────────────┐  │    │
│  │  │  Workspace Scanner                       │  │    │
│  │  │  - read .kiro/settings/mcp.json          │  │    │
│  │  │  - read .kiro/skills/*.md                │  │    │
│  │  │  - read .kiro/steering/*.md              │  │    │
│  │  └─────────────────────────────────────────┘  │    │
│  └────────────────────────────────────────────────┘    │
│                      │                                 │
│                      ▼                                 │
│            kiro-cli acp (子进程)                        │
│            stdin ← JSON-RPC Request                    │
│            stdout → JSON-RPC Response/Notification     │
└──────────────────────────────────────────────────────┘
```

### 为什么选 Tauri 而不是 Electron

| 维度 | Tauri | Electron |
|------|-------|----------|
| 打包体积 | ~10-15MB | ~150MB+ |
| 内存占用 | 低（系统 WebView） | 高（自带 Chromium） |
| 后端语言 | Rust（进程管理更安全） | Node.js |
| macOS 集成 | 原生 WebKit，体验好 | Chromium，略重 |
| 适合场景 | 轻量 wrapper 类应用 ✅ | 重度 Web 应用 |

---

## 3. 通信协议：ACP (Agent Client Protocol)

Kiro CLI 已经实现了 ACP，这是整个方案的基石。Desktop App 作为 ACP Client，通过 `kiro-cli acp` 子进程通信。

### 3.1 启动连接

```bash
# Tauri Rust 后端 spawn 子进程
kiro-cli acp
```

### 3.2 初始化握手

```json
// → Client 发送 initialize
{
  "jsonrpc": "2.0",
  "id": 0,
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "clientCapabilities": {
      "fs": { "readTextFile": true, "writeTextFile": true },
      "terminal": true
    },
    "clientInfo": {
      "name": "kiro-cowork-desktop",
      "version": "0.1.0"
    }
  }
}

// ← Agent 返回 capabilities
{
  "jsonrpc": "2.0",
  "id": 0,
  "result": {
    "protocolVersion": 1,
    "agentCapabilities": {
      "loadSession": true,
      "promptCapabilities": { "image": true }
    },
    "agentInfo": { "name": "kiro-cli", "version": "2.x.x" }
  }
}
```

### 3.3 核心交互流程

```
用户输入消息
    │
    ▼
Frontend → Tauri IPC → Rust Backend
    │
    ▼
Rust 写入 kiro-cli stdin:
  session/new  (首次)
  session/prompt (后续)
    │
    ▼
Rust 从 kiro-cli stdout 读取:
  session/notification →
    - AgentMessageChunk (流式文本)
    - ToolCall (工具调用，如文件读写)
    - ToolCallUpdate (工具进度)
    - TurnEnd (回合结束)
    │
    ▼
Rust → Tauri Event → Frontend 实时渲染
```

### 3.4 关键 ACP 方法映射

| 用户操作 | ACP 方法 | 说明 |
|---------|----------|------|
| 打开项目 | `session/new` | cwd 设为项目路径 |
| 发送消息 | `session/prompt` | 支持 text + image |
| 切换模型 | `session/set_model` | Claude Opus/Sonnet/GLM-5 |
| 切换 Agent | `session/set_mode` | 自定义 agent 配置 |
| 取消操作 | `session/cancel` | 中断当前执行 |
| 恢复会话 | `session/load` | 加载历史 session |
| 执行斜杠命令 | `_kiro.dev/commands/execute` | /compact, /agent 等 |

---

## 4. UI 设计（参考 Claude Cowork 交互理念）

### 4.1 整体布局

```
┌─────────────────────────────────────────────────────┐
│  🟢 Kiro CoWork Desktop              ─  □  ✕       │
├──────────┬──────────────────────────────────────────┤
│          │                                          │
│ Sessions │  ┌─ Workspace: ~/my-project ──────────┐  │
│          │  │ Model: Claude Opus 4.6  │ Agent: Auto│  │
│ ● 当前    │  ├──────────────────────────────────────┤  │
│ ○ 昨天    │  │                                      │  │
│ ○ 上周    │  │  [对话区域 - 流式渲染]                 │  │
│          │  │                                      │  │
│──────────│  │  🤖 正在读取 src/main.ts...           │  │
│          │  │  🔧 Tool: readFile ✓                  │  │
│ Skills   │  │                                      │  │
│ 📋 review │  │  这个文件的主要功能是...               │  │
│ 📋 test   │  │                                      │  │
│          │  │  ```typescript                        │  │
│ MCP      │  │  // 修改建议                           │  │
│ 🔌 github │  │  export function main() {             │  │
│ 🔌 slack  │  │    ...                                │  │
│          │  │  ```                                  │  │
│ Steering │  │                                      │  │
│ 📄 coding │  ├──────────────────────────────────────┤  │
│ 📄 review │  │ 💬 输入消息... [📎] [🖼️] [Send]       │  │
│          │  └──────────────────────────────────────┘  │
└──────────┴──────────────────────────────────────────┘
```

### 4.2 核心 UI 组件

#### A. 对话面板（Chat Panel）

- 流式渲染 Agent 回复（`AgentMessageChunk`）
- Markdown 渲染 + 代码高亮（用 `react-markdown` + `shiki`）
- 工具调用可视化：显示 ToolCall 名称、参数、状态（进行中/成功/失败）
- 支持图片拖拽上传（ACP 支持 `image` content type）
- 支持文件附件（通过 `@` mention 或拖拽）

#### B. Workspace 面板（左侧栏）

- **Sessions 列表**：历史会话，可恢复（`session/load`）
- **Skills 列表**：扫描 `.kiro/skills/*.md`，显示可用 skills
- **MCP Servers**：扫描 `.kiro/settings/mcp.json`，显示连接状态
  - 绿色 = 已连接（收到 `_kiro.dev/mcp/server_initialized`）
  - 黄色 = 连接中
  - 红色 = 失败
- **Steering 规则**：扫描 `.kiro/steering/*.md`，显示当前生效的规则

#### C. Diff 视图（可选面板）

- 当 Agent 修改文件时，显示 before/after diff
- 用户可以 Accept / Reject 每个变更
- 参考 VS Code 的 inline diff 体验

#### D. 顶部工具栏

- Workspace 路径选择器（打开文件夹）
- Model 选择器（Claude Opus 4.6 / Sonnet 4.6 / GLM-5 等）
- Agent 选择器（Auto / 自定义 agent）
- Permission Mode 选择器（Ask / Auto Accept / Plan）

### 4.3 面向非技术人员的简化设计

| Claude Cowork 理念 | Kiro CoWork Desktop 实现 |
|-------------------|------------------------|
| 不需要理解终端 | 所有交互通过对话完成，终端输出格式化展示 |
| 自然语言驱动 | 输入框支持中英文，Agent 自动理解意图 |
| 任务可视化 | ToolCall 展示为可读的步骤卡片，不是原始 JSON |
| 文件变更可审查 | Diff 视图用颜色标注增删，一键接受/拒绝 |
| 项目一键打开 | 拖拽文件夹到 App 或点击选择，自动扫描配置 |

---

## 5. 技术栈选型

```
Frontend:
  - React 19 + TypeScript
  - Tailwind CSS（快速 UI 开发）
  - react-markdown + remark-gfm（Markdown 渲染）
  - shiki（代码高亮）
  - monaco-editor（可选，Diff 视图）
  - zustand（状态管理，轻量）

Backend (Tauri / Rust):
  - tauri 2.x（桌面框架）
  - tokio（异步运行时，管理子进程 IO）
  - serde_json（JSON-RPC 序列化）
  - notify（文件系统监听，检测 .kiro/ 变更）

通信:
  - kiro-cli acp（ACP 协议，JSON-RPC 2.0 over stdio）
  - Tauri IPC（Frontend ↔ Rust Backend）
  - Tauri Events（Rust → Frontend 推送流式数据）
```

---

## 6. 关键模块设计

### 6.1 ACP Client（Rust 侧）

```rust
// 核心结构
pub struct AcpClient {
    child: tokio::process::Child,
    stdin: tokio::process::ChildStdin,
    stdout_reader: BufReader<tokio::process::ChildStdout>,
    request_id: AtomicU64,
    pending_requests: DashMap<u64, oneshot::Sender<JsonValue>>,
}

impl AcpClient {
    /// 启动 kiro-cli acp 子进程
    pub async fn spawn(kiro_cli_path: &str) -> Result<Self>;

    /// 发送 JSON-RPC request，等待 response
    pub async fn request(&self, method: &str, params: JsonValue) -> Result<JsonValue>;

    /// 发送 prompt，通过 channel 流式返回 notifications
    pub async fn prompt(
        &self,
        session_id: &str,
        content: Vec<Content>,
        tx: mpsc::Sender<SessionNotification>,
    ) -> Result<()>;

    /// 持续读取 stdout，分发 response 和 notification
    async fn read_loop(&self, event_tx: mpsc::Sender<SessionNotification>);
}
```

### 6.2 Session Manager（Rust 侧）

```rust
pub struct SessionManager {
    acp_client: Arc<AcpClient>,
    active_session: Option<String>,  // session_id
    sessions_dir: PathBuf,           // ~/.kiro/sessions/cli/
}

impl SessionManager {
    /// 创建新 session，绑定到 workspace 目录
    pub async fn new_session(&mut self, cwd: &Path) -> Result<String>;

    /// 加载历史 session
    pub async fn load_session(&mut self, session_id: &str) -> Result<()>;

    /// 列出所有历史 sessions
    pub fn list_sessions(&self) -> Result<Vec<SessionMeta>>;
}
```

### 6.3 Workspace Scanner（Rust 侧）

```rust
pub struct WorkspaceScanner {
    root: PathBuf,
}

impl WorkspaceScanner {
    /// 扫描 .kiro/skills/*.md
    pub fn scan_skills(&self) -> Vec<SkillInfo>;

    /// 扫描 .kiro/settings/mcp.json
    pub fn scan_mcp_servers(&self) -> Vec<McpServerInfo>;

    /// 扫描 .kiro/steering/*.md，解析 front-matter
    pub fn scan_steering(&self) -> Vec<SteeringInfo>;

    /// 监听 .kiro/ 目录变更，实时更新
    pub fn watch(&self, tx: mpsc::Sender<WorkspaceEvent>) -> Result<()>;
}
```

### 6.4 Auth Manager（Rust 侧）

```rust
pub struct AuthManager;

impl AuthManager {
    /// 检查 kiro-cli 是否已登录
    pub async fn check_login_status() -> Result<AuthStatus>;

    /// 触发登录流程（打开浏览器 OAuth）
    pub async fn trigger_login() -> Result<()>;

    /// 检查 KIRO_API_KEY 环境变量
    pub fn has_api_key() -> bool;
}
```

### 6.5 Frontend State（TypeScript 侧）

```typescript
// zustand store
interface AppState {
  // Session
  currentSessionId: string | null;
  sessions: SessionMeta[];
  messages: Message[];
  isStreaming: boolean;

  // Workspace
  workspacePath: string | null;
  skills: SkillInfo[];
  mcpServers: McpServerInfo[];
  steeringRules: SteeringInfo[];

  // Settings
  selectedModel: string;
  selectedAgent: string;
  permissionMode: 'ask' | 'auto' | 'plan';

  // Auth
  authStatus: 'logged_in' | 'logged_out' | 'checking';

  // Actions
  sendMessage: (text: string, attachments?: File[]) => Promise<void>;
  openWorkspace: (path: string) => Promise<void>;
  switchModel: (model: string) => Promise<void>;
  cancelOperation: () => Promise<void>;
}
```

---

## 7. 数据流：用户发送一条消息

```
1. 用户在输入框输入 "帮我重构 src/utils.ts"，点击 Send

2. Frontend:
   - dispatch sendMessage("帮我重构 src/utils.ts")
   - 设置 isStreaming = true
   - 添加 user message 到 messages[]

3. Frontend → Tauri IPC:
   invoke("send_prompt", { sessionId, content: [{ type: "text", text: "..." }] })

4. Rust Backend:
   - 构造 JSON-RPC request: session/prompt
   - 写入 kiro-cli stdin

5. kiro-cli 处理，通过 stdout 流式返回:
   - { notification: "AgentMessageChunk", data: "让我先看看这个文件..." }
   - { notification: "ToolCall", data: { name: "readFile", status: "running" } }
   - { notification: "ToolCall", data: { name: "readFile", status: "completed" } }
   - { notification: "AgentMessageChunk", data: "这个文件有以下问题..." }
   - { notification: "ToolCall", data: { name: "writeFile", status: "running" } }
   - ...
   - { notification: "TurnEnd" }

6. Rust Backend → Tauri Event:
   - 每收到一个 notification，emit("session-update", payload)

7. Frontend:
   - 监听 "session-update" 事件
   - AgentMessageChunk → 追加到当前 assistant message
   - ToolCall → 渲染工具调用卡片（名称、状态、进度）
   - TurnEnd → 设置 isStreaming = false
```

---

## 8. 项目结构

```
kiro-cowork-desktop/
├── src-tauri/                    # Tauri Rust 后端
│   ├── Cargo.toml
│   ├── src/
│   │   ├── main.rs               # Tauri 入口
│   │   ├── acp_client.rs         # ACP JSON-RPC 客户端
│   │   ├── session_manager.rs    # Session 生命周期管理
│   │   ├── workspace_scanner.rs  # .kiro/ 目录扫描
│   │   ├── auth_manager.rs       # 认证状态检测
│   │   └── commands.rs           # Tauri IPC commands
│   ├── tauri.conf.json
│   └── icons/
│
├── src/                          # React Frontend
│   ├── App.tsx                   # 主布局
│   ├── main.tsx                  # 入口
│   ├── stores/
│   │   └── app-store.ts          # zustand 全局状态
│   ├── components/
│   │   ├── ChatPanel.tsx         # 对话面板
│   │   ├── MessageBubble.tsx     # 消息气泡（支持 Markdown）
│   │   ├── ToolCallCard.tsx      # 工具调用可视化卡片
│   │   ├── InputBar.tsx          # 输入框 + 附件
│   │   ├── Sidebar.tsx           # 左侧栏
│   │   ├── SessionList.tsx       # 会话列表
│   │   ├── SkillsList.tsx        # Skills 列表
│   │   ├── McpServerList.tsx     # MCP 服务器状态
│   │   ├── SteeringList.tsx      # Steering 规则
│   │   ├── Toolbar.tsx           # 顶部工具栏
│   │   ├── ModelSelector.tsx     # 模型选择器
│   │   ├── DiffViewer.tsx        # Diff 视图
│   │   └── AuthGate.tsx          # 登录状态检查
│   ├── hooks/
│   │   ├── useAcp.ts             # ACP 通信 hook
│   │   └── useWorkspace.ts       # Workspace 状态 hook
│   ├── lib/
│   │   ├── tauri-bridge.ts       # Tauri invoke 封装
│   │   └── markdown.ts           # Markdown 渲染配置
│   └── styles/
│       └── globals.css
│
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.ts
└── DESIGN.md                     # 本文档
```

---

## 9. 开发路线图

### Phase 1：最小可用（2-3 周）

- [ ] Tauri 项目脚手架 + React 前端
- [ ] Rust ACP Client：spawn kiro-cli acp，完成 initialize 握手
- [ ] 基础对话 UI：发送消息 → 流式渲染回复
- [ ] Auth 检测：未登录时引导用户执行 `kiro-cli login`
- [ ] Workspace 选择：打开文件夹，传入 session/new 的 cwd

### Phase 2：完整体验（2-3 周）

- [ ] ToolCall 可视化卡片（读文件、写文件、执行命令等）
- [ ] Skills/MCP/Steering 扫描与展示
- [ ] Session 管理（历史会话列表、恢复会话）
- [ ] Model/Agent 选择器
- [ ] 图片拖拽上传
- [ ] Diff 视图（文件变更审查）

### Phase 3：打磨体验（2 周）

- [ ] 快捷键支持（Cmd+N 新会话、Cmd+Enter 发送等）
- [ ] 深色/浅色主题
- [ ] MCP OAuth 流程处理（`_kiro.dev/mcp/oauth_request`）
- [ ] Context compaction 状态提示
- [ ] DMG 打包 + 自动更新（Tauri updater）
- [ ] 应用签名 + 公证（macOS Notarization）

---

## 10. 执行环境：对比分析与方案选择

这是整个方案中最关键的架构决策。

### 10.1 Claude Cowork 的做法：本地 Linux VM

Claude Cowork 在 macOS 上使用 Apple 的 **Virtualization.framework (VZVirtualMachine)** 运行一个完整的本地 Linux VM：

```
macOS Host
  └── Claude.app (Electron)
        ├── UI Renderer
        ├── MCP Servers (Slack, GitHub 等)
        ├── Network Proxy (域名白名单)
        └── Virtualization.framework
              └── Ubuntu 22.04 VM (ARM64)
                    ├── VirtioFS 挂载用户文件夹
                    ├── bubblewrap + seccomp 沙箱
                    └── Claude Code CLI (每个 session 独立进程)
```

关键特征：
- **完全本地运行**，VM 在用户 Mac 上启动，不依赖云端
- **Ubuntu 22.04 ARM64**，预装 Python、Node.js、ffmpeg 等工具
- **VirtioFS** 实现 host ↔ VM 文件共享（用户选择的文件夹）
- **网络受限**，通过 host 代理走域名白名单
- **MCP 透传**，Claude Desktop 的 MCP servers 通过 stdio 管道传入 VM
- **~10GB VM bundle**，首次启动需要下载
- **仅 macOS**，因为依赖 Apple Virtualization.framework

### 10.2 Kiro 的两种执行模式

Kiro 实际上有两种不同的执行环境：

#### A. Kiro CLI（本地执行）

```
用户 Mac / Linux
  └── kiro-cli
        ├── 直接在用户系统上执行命令
        ├── 读写用户文件系统
        ├── 通过 ACP 协议与编辑器通信
        └── 无沙箱隔离（信任用户环境）
```

- **没有 VM，没有容器**，直接在用户操作系统上运行
- Agent 的 bash 命令、文件操作都直接作用于用户系统
- 安全性依赖 permission mode（Ask / Auto / Plan）由用户控制

#### B. Kiro Autonomous Agent（云端沙箱）

```
AWS Cloud
  └── Kiro Autonomous Agent Service
        └── 隔离沙箱环境（每个 task 独立）
              ├── 从 GitHub clone 代码
              ├── 根据 Dockerfile 配置环境
              ├── 执行任务
              ├── 可配置网络访问、MCP、环境变量
              └── 任务完成后销毁
```

- **云端运行**，不在用户本地
- 每个 task 独立沙箱，用 Dockerfile 定义环境
- 异步执行，适合长时间任务
- 结果通过 GitHub PR 返回
- 目前 Preview 阶段，面向 Pro/Pro+/Power 用户

### 10.3 KiroWork Desktop 的执行环境方案

你的需求是 "支持 workspace Linux VM"，这里有三条路径：

#### 方案 A：直接透传 Kiro CLI（最简单，推荐 Phase 1）

```
KiroWork Desktop (Tauri)
  └── kiro-cli acp (子进程)
        └── 直接在用户 Mac 上执行
              ├── 读写用户选择的 workspace 目录
              ├── 执行 bash 命令
              └── Permission Mode 控制安全边界
```

**优点**：零额外基础设施，ACP 协议直接可用，2-3 周可交付
**缺点**：没有沙箱隔离，Agent 操作直接影响用户系统
**适合**：开发者用户，或者信任 Agent 的场景

#### 方案 B：Docker 容器沙箱（推荐 Phase 2）

```
KiroWork Desktop (Tauri)
  ├── Workspace Manager
  │     └── 创建/管理 Docker 容器
  │           ├── 基于项目 Dockerfile 或默认镜像
  │           ├── bind mount 用户 workspace 目录
  │           └── 网络策略（可选白名单）
  │
  └── kiro-cli acp (在容器内运行)
        └── 容器内 Linux 环境
              ├── Ubuntu 22.04 + 预装开发工具
              ├── 文件操作限制在 mount 的目录内
              └── MCP servers 通过 stdio 透传
```

实现方式：

```rust
// Tauri Rust 后端
pub struct ContainerManager {
    docker: Docker,  // bollard crate
}

impl ContainerManager {
    /// 为 workspace 创建容器
    pub async fn create_workspace(
        &self,
        workspace_path: &Path,
        dockerfile: Option<&Path>,
    ) -> Result<ContainerId> {
        // 1. 如果有 Dockerfile，先 build image
        // 2. 否则使用默认镜像 (kirowork/sandbox:latest)
        // 3. 创建容器，bind mount workspace
        // 4. 在容器内启动 kiro-cli acp
    }

    /// 在容器内执行 kiro-cli acp
    pub async fn start_acp_in_container(
        &self,
        container_id: &str,
    ) -> Result<AcpClient> {
        // docker exec -i <container> kiro-cli acp
        // 通过 docker attach 的 stdin/stdout 走 JSON-RPC
    }
}
```

默认沙箱镜像：

```dockerfile
# kirowork/sandbox:latest
FROM ubuntu:22.04

# 基础开发工具
RUN apt-get update && apt-get install -y \
    curl git build-essential python3 python3-pip \
    nodejs npm ffmpeg imagemagick \
    && rm -rf /var/lib/apt/lists/*

# 安装 Kiro CLI
RUN curl -fsSL https://cli.kiro.dev/install | bash

# 工作目录
WORKDIR /workspace

# 非 root 用户
RUN useradd -m kirowork
USER kirowork
```

**优点**：
- 隔离性好，Agent 操作不影响 host 系统
- 用户只需安装 Docker Desktop（Mac 用户很常见）
- 可以用项目自带的 Dockerfile 定制环境
- 与 Kiro Autonomous Agent 的 Dockerfile 配置兼容

**缺点**：
- 依赖 Docker Desktop
- 容器启动有几秒延迟
- 文件系统性能略低于原生（bind mount）

#### 方案 C：Apple Virtualization.framework 本地 VM（最接近 Cowork）

```
KiroWork Desktop (Tauri + Swift)
  └── VZVirtualMachine
        └── Ubuntu 22.04 ARM64 VM
              ├── VirtioFS 挂载 workspace
              ├── kiro-cli acp 在 VM 内运行
              ├── 网络代理 + 域名白名单
              └── bubblewrap 沙箱
```

**优点**：最接近 Claude Cowork 的体验，隔离性最强
**缺点**：
- 需要 Swift 代码调用 Virtualization.framework（Tauri 需要 Swift 插件）
- VM bundle ~5-10GB，首次下载大
- 仅 macOS，不可移植
- 开发复杂度高，需要维护 VM 镜像
- 启动时间较长（10-30 秒）

### 10.4 推荐策略：分阶段演进

```
Phase 1 (MVP)          Phase 2 (安全)           Phase 3 (完整)
┌──────────────┐      ┌──────────────┐        ┌──────────────┐
│  直接透传     │      │  Docker 容器  │        │  可选 VM     │
│  kiro-cli    │ ──→  │  沙箱执行     │  ──→   │  (高级用户)  │
│  本地执行     │      │  + 文件隔离   │        │  + 网络隔离  │
└──────────────┘      └──────────────┘        └──────────────┘
  2-3 周                2-3 周                   4+ 周
  零依赖                需要 Docker              需要 macOS
```

**Phase 1**：先跑通 ACP 对话流程，用户体验优先
**Phase 2**：加入 Docker 沙箱，面向非技术用户的安全保障
**Phase 3**：可选 VM 模式，给需要强隔离的企业用户

### 10.5 UI 上的执行环境选择器

参考 Claude Code Desktop 的 Environment 选择器：

```
┌─ Environment ──────────────────────────┐
│                                        │
│  ○ Local     直接在 Mac 上执行          │
│  ● Container Docker 容器隔离执行        │
│  ○ Remote    SSH 连接远程机器           │
│                                        │
│  Container Settings:                   │
│  Image: [kirowork/sandbox:latest  ▼]   │
│  □ Use project Dockerfile              │
│  □ Restrict network access             │
│                                        │
└────────────────────────────────────────┘
```

---

## 11. 风险与注意事项

### 11.1 kiro-cli 路径发现

用户可能通过不同方式安装 kiro-cli，需要按优先级查找：
1. `~/.local/bin/kiro-cli`（官方安装路径）
2. `which kiro-cli` 的结果
3. 用户手动配置的路径

### 11.2 认证流程的 UX

kiro-cli 的 OAuth 登录会打开浏览器。Desktop App 需要：
- 检测登录状态（尝试 initialize，看是否报认证错误）
- 未登录时显示友好的引导页面
- 登录完成后自动重连 ACP

### 11.3 ACP 扩展方法的兼容性

Kiro 文档明确标注 `_kiro.dev/*` 扩展方法是 **experimental**，可能在未来版本变更。
建议：
- 核心功能只依赖标准 ACP 方法
- 扩展功能（slash commands、MCP events）做好降级处理

### 11.4 文件系统权限

Tauri 2.x 默认有文件系统沙箱。需要在 `tauri.conf.json` 中配置：
- 允许读取用户选择的 workspace 目录
- 允许读取 `~/.kiro/` 配置目录
- 允许执行 `kiro-cli` 二进制

### 11.5 进程生命周期

- App 退出时需要优雅关闭 kiro-cli 子进程
- kiro-cli 崩溃时需要自动重启并恢复 session
- 长时间空闲后 kiro-cli 可能断开，需要心跳检测

---

## 12. 项目初始化指南

AI Coding Agent 应按以下步骤创建项目脚手架。

### 12.1 前置条件

```bash
# 需要预装
node >= 20
npm >= 10
rustc >= 1.77
cargo >= 1.77
```

### 12.2 创建 Tauri + React 项目

```bash
# 使用 create-tauri-app 脚手架
npm create tauri-app@latest kiro-cowork-desktop -- \
  --template react-ts \
  --manager npm

cd kiro-cowork-desktop

# 安装前端依赖
npm install zustand react-markdown remark-gfm rehype-raw
npm install shiki
npm install @tauri-apps/api @tauri-apps/plugin-dialog @tauri-apps/plugin-fs @tauri-apps/plugin-shell @tauri-apps/plugin-process
npm install -D tailwindcss @tailwindcss/vite

# Rust 侧依赖（在 src-tauri/Cargo.toml 中添加）
# tokio = { version = "1", features = ["full"] }
# serde = { version = "1", features = ["derive"] }
# serde_json = "1"
# notify = "7"
# dashmap = "6"
# dirs = "6"
# uuid = { version = "1", features = ["v4"] }
# anyhow = "1"
# tracing = "0.1"
# tracing-subscriber = "0.3"
```

### 12.3 Tauri 插件配置

在 `src-tauri/tauri.conf.json` 的 capabilities 中需要：

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri-utils/schema.json",
  "productName": "KiroWork Desktop",
  "identifier": "com.kirowork.desktop",
  "build": {
    "frontendDist": "../dist"
  },
  "app": {
    "withGlobalTauri": true,
    "windows": [
      {
        "title": "KiroWork Desktop",
        "width": 1200,
        "height": 800,
        "minWidth": 900,
        "minHeight": 600,
        "decorations": true,
        "transparent": false
      }
    ]
  },
  "plugins": {
    "dialog": {},
    "fs": {
      "scope": {
        "allow": [
          "$HOME/.kiro/**",
          "$HOME/.local/bin/kiro-cli"
        ]
      }
    },
    "shell": {
      "open": true
    }
  }
}
```

---

## 13. ACP 协议类型定义（TypeScript）

这些类型定义是前端渲染的基础，也是 Rust 后端序列化的参照。

```typescript
// src/types/acp.ts

// ============ JSON-RPC 基础 ============

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// ============ ACP 初始化 ============

export interface InitializeParams {
  protocolVersion: number;
  clientCapabilities: {
    fs?: { readTextFile?: boolean; writeTextFile?: boolean };
    terminal?: boolean;
  };
  clientInfo: {
    name: string;
    version: string;
  };
}

export interface InitializeResult {
  protocolVersion: number;
  agentCapabilities: {
    loadSession?: boolean;
    promptCapabilities?: {
      image?: boolean;
    };
  };
  agentInfo: {
    name: string;
    version: string;
  };
}

// ============ Session 管理 ============

export interface SessionNewParams {
  cwd: string;
  mcpServers?: McpServerConfig[];
}

export interface SessionNewResult {
  sessionId: string;
}

export interface SessionLoadParams {
  sessionId: string;
}

export interface SessionPromptParams {
  sessionId: string;
  content: ContentBlock[];
}

export interface SessionCancelParams {
  sessionId: string;
}

export interface SessionSetModelParams {
  sessionId: string;
  model: string;
}

export interface SessionSetModeParams {
  sessionId: string;
  mode: string;
}

// ============ Content 类型 ============

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mediaType: string };

// ============ Session 通知（流式返回） ============

export type SessionUpdateType =
  | "AgentMessageChunk"
  | "ToolCall"
  | "ToolCallUpdate"
  | "TurnEnd";

export interface SessionNotification {
  sessionId: string;
  type: SessionUpdateType;
  data: AgentMessageChunk | ToolCallData | ToolCallUpdateData | TurnEndData;
}

export interface AgentMessageChunk {
  type: "AgentMessageChunk";
  content: string;           // 增量文本
}

export interface ToolCallData {
  type: "ToolCall";
  toolCallId: string;
  name: string;              // e.g. "readFile", "writeFile", "bash"
  parameters?: Record<string, unknown>;
  status: "running" | "completed" | "failed";
  result?: string;
  error?: string;
}

export interface ToolCallUpdateData {
  type: "ToolCallUpdate";
  toolCallId: string;
  progress?: string;         // 进度描述
}

export interface TurnEndData {
  type: "TurnEnd";
}

// ============ Kiro 扩展 ============

export interface SlashCommand {
  name: string;
  description: string;
}

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

// ============ Workspace 扫描结果 ============

export interface SkillInfo {
  name: string;
  filePath: string;
  description?: string;      // 从 md front-matter 解析
}

export interface McpServerInfo {
  name: string;
  command: string;
  status: "connected" | "connecting" | "disconnected" | "error";
  disabled?: boolean;
}

export interface SteeringInfo {
  name: string;
  filePath: string;
  inclusion: "always" | "fileMatch" | "manual";
  fileMatchPattern?: string;
}

export interface SessionMeta {
  sessionId: string;
  createdAt: string;         // ISO 8601
  workspacePath: string;
  lastMessage?: string;      // 最后一条消息摘要
}
```

---

## 14. Tauri IPC 命令接口契约

前端通过 `@tauri-apps/api` 的 `invoke()` 调用 Rust 后端命令。以下是完整的命令列表和参数/返回值定义。

### 14.1 认证相关

```typescript
// 检查登录状态
invoke<AuthStatus>("check_auth")
// 返回: { status: "logged_in", user?: string } | { status: "logged_out" } | { status: "error", message: string }

// 触发登录（打开浏览器 OAuth）
invoke<void>("trigger_login")

// 类型
type AuthStatus =
  | { status: "logged_in"; user?: string }
  | { status: "logged_out" }
  | { status: "error"; message: string };
```

### 14.2 ACP 生命周期

```typescript
// 启动 ACP 连接（spawn kiro-cli acp + initialize 握手）
invoke<InitializeResult>("acp_connect")

// 断开 ACP 连接（kill 子进程）
invoke<void>("acp_disconnect")

// 获取连接状态
invoke<AcpConnectionStatus>("acp_status")
// 返回: "connected" | "disconnected" | "connecting" | "error"
```

### 14.3 Session 管理

```typescript
// 创建新 session
invoke<SessionNewResult>("session_new", { cwd: string })

// 加载历史 session
invoke<void>("session_load", { sessionId: string })

// 列出所有 sessions
invoke<SessionMeta[]>("session_list")

// 发送 prompt（触发流式返回，通过 Tauri Event 接收）
invoke<void>("session_prompt", {
  sessionId: string,
  content: ContentBlock[]
})

// 取消当前操作
invoke<void>("session_cancel", { sessionId: string })

// 切换模型
invoke<void>("session_set_model", { sessionId: string, model: string })

// 切换 agent mode
invoke<void>("session_set_mode", { sessionId: string, mode: string })
```

### 14.4 Workspace 扫描

```typescript
// 扫描 workspace 的 .kiro/ 配置
invoke<WorkspaceScanResult>("scan_workspace", { path: string })

// 返回类型
interface WorkspaceScanResult {
  skills: SkillInfo[];
  mcpServers: McpServerInfo[];
  steering: SteeringInfo[];
  hasKiroConfig: boolean;    // .kiro/ 目录是否存在
}
```

### 14.5 Tauri Events（后端 → 前端推送）

```typescript
import { listen } from "@tauri-apps/api/event";

// 流式 session 更新
listen<SessionNotification>("session-update", (event) => {
  const notification = event.payload;
  switch (notification.type) {
    case "AgentMessageChunk": // 追加文本
    case "ToolCall":          // 工具调用状态
    case "ToolCallUpdate":    // 工具进度
    case "TurnEnd":           // 回合结束
  }
});

// ACP 连接状态变更
listen<AcpConnectionStatus>("acp-status-changed", (event) => {
  // "connected" | "disconnected" | "error"
});

// Workspace 文件变更（.kiro/ 目录被修改）
listen<WorkspaceScanResult>("workspace-changed", (event) => {
  // 重新渲染 sidebar
});

// MCP 服务器事件
listen<McpServerEvent>("mcp-event", (event) => {
  // { type: "initialized", serverName: string }
  // { type: "oauth_request", url: string }
});

// Slash commands 可用列表
listen<SlashCommand[]>("commands-available", (event) => {
  // 更新输入框的 / 命令自动补全
});
```

---

## 15. 错误处理策略

### 15.1 错误分类

```typescript
// src/types/errors.ts

export type AppError =
  | { kind: "kiro_not_found"; message: string }       // kiro-cli 未安装
  | { kind: "auth_required"; message: string }         // 未登录
  | { kind: "acp_connection_failed"; message: string } // ACP 连接失败
  | { kind: "acp_timeout"; message: string }           // ACP 响应超时
  | { kind: "session_error"; message: string }         // Session 操作失败
  | { kind: "workspace_error"; message: string }       // Workspace 扫描失败
  | { kind: "docker_not_found"; message: string }      // Docker 未安装（Phase 2）
  | { kind: "unknown"; message: string };
```

### 15.2 Rust 侧错误处理

```rust
// src-tauri/src/error.rs

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(tag = "kind")]
pub enum AppError {
    #[serde(rename = "kiro_not_found")]
    KiroNotFound { message: String },

    #[serde(rename = "auth_required")]
    AuthRequired { message: String },

    #[serde(rename = "acp_connection_failed")]
    AcpConnectionFailed { message: String },

    #[serde(rename = "acp_timeout")]
    AcpTimeout { message: String },

    #[serde(rename = "session_error")]
    SessionError { message: String },

    #[serde(rename = "workspace_error")]
    WorkspaceError { message: String },

    #[serde(rename = "unknown")]
    Unknown { message: String },
}

// 所有 Tauri command 返回 Result<T, AppError>
```

### 15.3 前端错误展示策略

| 错误类型 | 展示方式 | 用户操作 |
|---------|---------|---------|
| `kiro_not_found` | 全屏引导页 | 显示安装链接 + 安装命令 |
| `auth_required` | 全屏登录页 | "登录" 按钮触发 OAuth |
| `acp_connection_failed` | Toast 通知 + 重试按钮 | 自动重试 3 次，间隔 2s |
| `acp_timeout` | 对话区内联提示 | "重新发送" 按钮 |
| `session_error` | 对话区内联提示 | "新建会话" 按钮 |
| `workspace_error` | Sidebar 警告图标 | 提示检查 .kiro/ 目录 |

### 15.4 ACP 进程恢复策略

```
kiro-cli 进程退出
    │
    ├── exit code 0 → 正常退出，不重启
    │
    ├── exit code != 0 → 异常退出
    │     │
    │     ├── 重试次数 < 3 → 等待 2s，重新 spawn + initialize
    │     │     │
    │     │     └── 如果有 active session → 尝试 session/load 恢复
    │     │
    │     └── 重试次数 >= 3 → 显示错误页面，让用户手动重试
    │
    └── 进程无响应（30s 无 stdout） → kill -9，按异常退出处理
```

---

## 16. Phase 1 任务分解与验收标准

Phase 1 的目标是：**用户可以打开 App → 选择项目文件夹 → 与 Kiro Agent 对话 → 看到流式回复**。

### Task 1: 项目脚手架

**做什么**：创建 Tauri + React + TypeScript 项目，配置好所有依赖。

**验收标准**：
- `npm run tauri dev` 能启动 App 窗口
- 窗口显示 "KiroWork Desktop" 标题
- Tailwind CSS 生效（能看到样式）
- Rust 后端能编译通过

**产出文件**：
```
kiro-cowork-desktop/
├── src-tauri/
│   ├── Cargo.toml          # 含所有 Rust 依赖
│   ├── tauri.conf.json     # 窗口配置 + 插件
│   ├── capabilities/       # Tauri 权限
│   └── src/
│       ├── main.rs
│       └── lib.rs
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   └── styles/globals.css
├── package.json
├── tsconfig.json
├── vite.config.ts
└── index.html
```

### Task 2: Rust ACP Client

**做什么**：实现 `AcpClient` struct，能 spawn `kiro-cli acp` 并完成 initialize 握手。

**验收标准**：
- 能自动发现 `kiro-cli` 路径（~/.local/bin/kiro-cli 或 PATH）
- spawn 子进程后，发送 initialize request
- 收到 initialize response，打印 agentInfo
- 如果 kiro-cli 未安装，返回 `KiroNotFound` 错误
- 如果未登录，返回 `AuthRequired` 错误

**产出文件**：
```
src-tauri/src/
├── acp_client.rs       # AcpClient 实现
├── error.rs            # AppError 定义
└── kiro_discovery.rs   # kiro-cli 路径发现
```

### Task 3: 基础对话 UI

**做什么**：实现 Chat Panel，能发送消息并流式渲染回复。

**验收标准**：
- 输入框能输入文本，按 Enter 或点击按钮发送
- 发送后显示 user message bubble
- Agent 回复流式渲染（逐字/逐块出现）
- Markdown 正确渲染（标题、列表、代码块、链接）
- 代码块有语法高亮
- 发送中显示 loading 状态，不能重复发送
- 可以点击 Stop 按钮取消

**产出文件**：
```
src/
├── components/
│   ├── ChatPanel.tsx
│   ├── MessageBubble.tsx
│   └── InputBar.tsx
├── stores/
│   └── app-store.ts
├── hooks/
│   └── useAcp.ts
├── lib/
│   └── tauri-bridge.ts
└── types/
    └── acp.ts
```

### Task 4: Auth Gate

**做什么**：App 启动时检查登录状态，未登录显示引导页。

**验收标准**：
- App 启动自动调用 `check_auth`
- 已登录 → 显示主界面
- 未登录 → 显示登录引导页，有 "登录" 按钮
- 点击 "登录" → 触发 `kiro-cli login`（打开浏览器）
- 登录完成后自动检测并切换到主界面
- kiro-cli 未安装 → 显示安装引导页

**产出文件**：
```
src/
├── components/
│   ├── AuthGate.tsx
│   ├── LoginPage.tsx
│   └── InstallGuidePage.tsx
src-tauri/src/
└── auth_manager.rs
```

### Task 5: Workspace 选择

**做什么**：用户可以选择项目文件夹，创建 ACP session。

**验收标准**：
- 顶部工具栏有 "打开文件夹" 按钮
- 点击后弹出系统文件夹选择对话框
- 选择后调用 `session_new`，cwd 设为选择的路径
- 工具栏显示当前 workspace 路径
- 支持拖拽文件夹到 App 窗口打开

**产出文件**：
```
src/
├── components/
│   └── Toolbar.tsx
src-tauri/src/
├── session_manager.rs
└── commands.rs          # 所有 Tauri IPC command 注册
```

---

## 17. 编码规范

### 17.1 Rust 侧

- 使用 `anyhow::Result` 做内部错误处理，Tauri command 边界转为 `AppError`
- 异步代码使用 `tokio`，不使用 `std::thread`
- 日志使用 `tracing` crate，不使用 `println!`
- 所有 public struct 实现 `Serialize`（给前端用）和 `Debug`
- JSON-RPC 消息用 `serde_json::Value` 处理，不过度定义 struct

### 17.2 TypeScript 侧

- 严格模式 `"strict": true`
- 组件使用函数式组件 + hooks
- 状态管理用 zustand，不用 Context
- 样式用 Tailwind utility classes，不写自定义 CSS（除非必要）
- 文件命名：组件 PascalCase.tsx，工具 camelCase.ts，类型 camelCase.ts
- 所有 Tauri invoke 调用封装在 `lib/tauri-bridge.ts` 中，组件不直接调用 invoke

### 17.3 Git 规范

- 每个 Task 一个 branch：`feat/task-1-scaffold`、`feat/task-2-acp-client` 等
- Commit message 格式：`feat: xxx` / `fix: xxx` / `chore: xxx`
