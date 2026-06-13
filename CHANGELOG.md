# Changelog · 更新日志

[English](#english) | [中文](#中文)

---

## English

### [0.13] - 2026-05-23
#### Added
- Python AI service (`ai-service/`) — independent LLM routing layer
- Multi-model adapter support: Claude, OpenAI, DeepSeek, Gemini
- LLM Gateway with API key management and token cost tracking
- Prompt caching support for Claude (Anthropic cache_control)
- Unified `/v1/chat` endpoint with streaming (SSE)

### [0.12] - 2026-05
#### Added
- Prompt caching UI — cache hit/miss indicators in token analytics
- Tool call UI feedback — inline display of tool invocations and results

### [0.10 – 0.11] - 2026-05
#### Added
- Built-in tool set (file read, shell exec, web search stub)
- Tool calling framework with structured tool-use loop

### [0.8 – 0.9] - 2026-04
#### Added
- Agent sandbox — isolated execution environment per agent task
- Harness layer — permission control and hook system for agent actions
- Markdown rendering in ChatView (GFM, syntax highlighting)

### [0.6 – 0.7] - 2026-04
#### Added
- Decision inbox — non-blocking human approval queue
- Pipeline trigger rules — event-based agent dispatch
- Agent registry UI — view and manage registered agents
- Task trigger UI — manually fire agent tasks

### [0.3 – 0.5] - 2026-03
#### Added
- Token cost dashboard — per-session and cumulative cost tracking
- Context window indicator
- Token analytics panel with time-series chart
- Multi-level branch visualization

### [0.1 – 0.2] - 2026-03
#### Added
- Tauri v2 desktop application scaffold
- Four-panel layout (Nav · Structure · Main · Detail)
- Conversation branch tree (P2) + linear chat view (P3)
- Zustand state management (conversation, layout, settings, decisions, notifications)
- Three navigation modes: Conversation · Tool Management · Console
- WebSocket AI client
- Rust backend (Axum + SQLite) — agent task state machine, context builder, dispatcher

---

## 中文

### [0.13] - 2026-05-23
#### 新增
- Python AI 服务（`ai-service/`）— 独立 LLM 路由层
- 多模型适配器：Claude、OpenAI、DeepSeek、Gemini
- LLM 网关：API Key 统一管理 + Token 成本追踪
- Claude Prompt 缓存支持（Anthropic cache_control）
- 统一 `/v1/chat` 端点，支持流式响应（SSE）

### [0.12] - 2026-05
#### 新增
- Prompt 缓存 UI — Token 分析面板显示缓存命中/未命中状态
- 工具调用 UI 反馈 — 内联展示工具调用过程与结果

### [0.10 – 0.11] - 2026-05
#### 新增
- 内置工具集（文件读取、Shell 执行、网络搜索占位）
- 工具调用框架，支持结构化工具使用循环

### [0.8 – 0.9] - 2026-04
#### 新增
- Agent 沙盒 — 每个 Agent 任务的隔离执行环境
- Harness 管控层 — Agent 行为权限控制与 Hook 系统
- ChatView Markdown 渲染（GFM 扩展语法、代码高亮）

### [0.6 – 0.7] - 2026-04
#### 新增
- 决策收件箱 — 非阻塞人工审批队列
- 流水线触发规则 — 基于事件的 Agent 自动调度
- Agent 注册表 UI — 查看和管理已注册 Agent
- 任务触发 UI — 手动触发 Agent 任务

### [0.3 – 0.5] - 2026-03
#### 新增
- Token 成本仪表盘 — 单次会话及累计成本追踪
- 上下文窗口指示器
- Token 分析面板（含时间序列图表）
- 多层级分支可视化

### [0.1 – 0.2] - 2026-03
#### 新增
- Tauri v2 桌面应用脚手架
- 四面板布局（导航 · 结构 · 主工作区 · 详情）
- 对话分支树（P2）+ 线性对话视图（P3）
- Zustand 状态管理（对话、布局、设置、决策、通知）
- 三种导航模式：对话 · 工具管理 · 控制台
- WebSocket AI 客户端
- Rust 后端（Axum + SQLite）— Agent 任务状态机、上下文构建器、调度器
