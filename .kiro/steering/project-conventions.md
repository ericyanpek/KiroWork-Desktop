---
inclusion: always
---

# KiroWork Desktop — 项目约定

## 项目概述

这是一个 Tauri 2.x + React 19 + TypeScript 的 Mac 桌面应用，通过 ACP（Agent Client Protocol）协议与 Kiro CLI 通信，提供类似 Claude Cowork 的对话式 UI。

## 架构约定

- **前端**：React 19 + TypeScript + Tailwind CSS + zustand
- **后端**：Tauri 2.x + Rust + tokio
- **通信**：kiro-cli acp 子进程，JSON-RPC 2.0 over stdin/stdout
- **前后端桥接**：所有 Tauri invoke 调用封装在 `src/lib/tauri-bridge.ts`，组件不直接调用 invoke

## 文件组织

- `src-tauri/src/` — Rust 后端代码
- `src/components/` — React 组件（PascalCase.tsx）
- `src/stores/` — zustand stores（camelCase.ts）
- `src/hooks/` — React hooks（camelCase.ts）
- `src/lib/` — 工具函数和桥接层（camelCase.ts）
- `src/types/` — TypeScript 类型定义（camelCase.ts）

## Rust 编码规范

- 内部错误用 `anyhow::Result`，Tauri command 边界转为 `AppError`
- 异步用 `tokio`，不用 `std::thread`
- 日志用 `tracing`，不用 `println!`
- 所有 public struct 实现 `Serialize` + `Debug`

## TypeScript 编码规范

- 严格模式 `"strict": true`
- 函数式组件 + hooks，不用 class 组件
- 状态管理用 zustand，不用 React Context
- 样式用 Tailwind utility classes

## 关键设计文档

- 完整技术方案：#[[file:DESIGN.md]]
- ACP 类型定义见 DESIGN.md 第 13 节
- Tauri IPC 接口契约见 DESIGN.md 第 14 节
- Phase 1 任务分解见 DESIGN.md 第 16 节
