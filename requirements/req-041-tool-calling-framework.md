---
id: req-041
title: Tool Calling 基础框架（Tauri 侧 tool_executor + ChatView 侧 tool_call 处理）
status: backlog
priority: high
source: product-planning
created: 2026-05-21
version: ~
---

# req-041 · Tool Calling 基础框架

## 状态说明（2026-06-13）

本需求暂不做。原方案面向 Tauri 侧自建 tool executor；当前主路径已切到 Electron + Claude Code SDK，工具调用框架后续需要围绕 SDK 工具、PreToolUse Hook、ProcessTrace 重新立项。

## 背景与目标

当前工作台是纯对话界面，AI 只能「说」不能「做」。`stream_ai` 当前处理的是纯文本 streaming 响应，对模型返回的 `tool_call` 结构无任何处理路径。

v0.11 目标：在现有 ChatView + Tauri `stream_ai` 基础上，增加最小可用的 tool calling 闭环——AI 调用工具 → Tauri 本地执行 → 结果回传 AI → AI 继续回答。

## 实现方向

### Tauri 侧：新增 `execute_tool` Rust Command

在 `src-tauri/src/` 中新增 `execute_tool` 命令，职责：

1. 接收 `tool_name: String` + `tool_input: serde_json::Value`
2. 根据 `tool_name` 分发到对应的本地实现（内置工具注册表，v0.11 先支持 req-042 定义的 2-3 个工具）
3. 返回 `tool_result: String`（工具执行结果，作为纯文本传回）
4. 执行失败时返回结构化错误（`{ "error": "..." }`），不 panic

### ChatView 侧：stream_ai 响应中处理 tool_call

在 `ChatView.tsx`（或 `useChat` hook）扩展 `stream_ai` 的响应处理逻辑：

1. 检测流式数据中是否含 `tool_call` 类型的事件（依赖后端 `stream_ai` 的事件格式，需与后端对齐）
2. 收到 `tool_call` 后，暂停当前 streaming，调用 `invoke('execute_tool', { name, input })`
3. 拿到 `tool_result` 后，将结果作为 `tool` role 消息追加到对话历史，继续调用 `stream_ai`（传入更新后的消息列表）
4. 支持单轮 tool calling 闭环（AI 调用工具 → 结果回传 → AI 最终回答）

### 待 CEO 确认

1. **stream_ai 的事件格式**：当前 `stream_ai` 的 Tauri event 是否已包含 Claude API 原始 streaming event（含 `content_block_start` / `tool_use` 类型），还是后端只转发纯文本？v0.11 需要前端能识别 tool_call 事件，需确认后端是否需同步改造。
2. **tool_result 传递路径**：tool_result 应以何种形式传给下一轮 stream_ai——作为新的 `user` 消息携带，还是在 `tool` role 中携带？需与 Claude API 的 tool use 消息格式对齐。

## 验收指标

| 验收项 | 标准 |
|--------|------|
| execute_tool 命令可调用 | 前端能通过 `invoke('execute_tool', ...)` 调用并得到结果，不报错 |
| tool_call 被检测到 | 当模型返回 tool_call 时，ChatView 能识别并暂停文本 streaming |
| 工具执行并回传 | ChatView 调用 execute_tool，拿到结果，追加 tool_result 后继续对话 |
| 闭环完成 | 最终用户看到 AI 使用工具后给出的最终回答，整个流程在 ChatView 内完成 |
| 执行失败降级 | execute_tool 失败时，ChatView 展示可读错误提示，不挂起 streaming |
