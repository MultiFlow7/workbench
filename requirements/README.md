---
project: 工作台
updated: 2026-05-23
---

# 需求状态看板 · 工作台

## 总览

| 统计 | 数量 |
|------|------|
| 总需求数 | 39 |
| backlog | 1 |
| confirmed | 6 |
| planned | 0 |
| in-progress | 6 |
| done | 25 |
| dropped | 1 |

---

## 需求列表

| ID | 标题 | 优先级 | 状态 | 版本 |
|----|------|--------|------|------|
| [req-001](req-001-tauri-app-skeleton.md) | Tauri 应用骨架 | high | done | v0.1 |
| [req-002](req-002-four-panel-layout.md) | 四面板布局与折叠 | high | done | v0.1 |
| [req-003](req-003-navigation-mode-switch.md) | 模式切换导航（P1） | high | done | v0.1 |
| [req-004](req-004-conversation-branch-tree.md) | 对话分支树（P2） | high | done | v0.1 |
| [req-005](req-005-linear-conversation-view.md) | 线性对话视图（P3） | high | done | v0.1 |
| [req-006](req-006-node-detail-panel.md) | 节点详情面板（P4 只读） | medium | done | v0.1 |
| [req-007](req-007-zustand-state-management.md) | Zustand 状态管理层 | high | done | v0.1 |
| [req-008](req-008-tauri-file-commands.md) | Tauri 本地文件命令 | high | done | v0.1 |
| [req-009](req-009-websocket-ai-client.md) | AI 流式对话客户端（Tauri HTTP Plugin + SSE） | high | done | v0.1 |
| [req-010](req-010-topbar-global-header.md) | TopBar 全局顶栏 | medium | done | v0.1 |
| [req-011](req-011-p1-navlist-panel.md) | P1 NavList 项目与对话列表 | medium | done | v0.1 |
| [req-012](req-012-list-projects-command.md) | list_projects 项目切换后端命令 | medium | done | v0.1 |
| [req-025](req-025-qa-atom-token-metadata.md) | QA Atom Token 元数据采集 | high | done | v0.3 |
| [req-026](req-026-context-window-indicator.md) | 上下文窗口占用实时指示器 | high | done | v0.3 |
| [req-027](req-027-canvas-token-analytics.md) | 画布 Token 分析视图（节点级统计） | high | done | v0.3 |
| [req-028](req-028-token-cost-dashboard.md) | Token 与成本时序仪表盘 | medium | done | v0.4 |
| [req-013](req-013-agent-task-state-machine.md) | Agent 任务状态机（后端） | high | done | v0.6 |
| [req-016](req-016-multi-level-visualization.md) | 多层级任务可视化（精简版：当前状态视角） | high | done | v0.6 |
| [req-017](req-017-agent-execution-stream-view.md) | Agent 执行流视图（只读，流式日志） | medium | done | v0.6 |
| [req-018](req-018-decision-inbox.md) | 决策收件箱（非阻塞人工决策队列） | high | done | v0.6 |
| [req-030](req-030-agent-registry-ui.md) | Agent 注册表 UI | high | done | v0.6 |
| [req-031](req-031-agent-task-trigger-ui.md) | Agent 任务手动触发 UI | high | done | v0.6 |
| [req-014](req-014-true-multi-agent-dispatch.md) | 真实多 Agent 调度（隔离实例） | high | done | v0.7 |
| [req-015](req-015-context-builder.md) | Agent 上下文构建器 | high | done | v0.7 |
| [req-019](req-019-pipeline-trigger-rules.md) | 流水线触发规则（自动编排，精简版） | medium | done | v0.7 |
| [req-020](req-020-main-conversation-isolation.md) | 主对话保护前端（TopBar 通知 badge） | high | in-progress | v0.8 |
| [req-022](req-022-agent-sandbox.md) | Agent 沙盒（隔离执行环境） | high | in-progress | v0.8 |
| [req-023](req-023-harness-layer.md) | Harness 管控层（hooks + 工作流 + 权限管理） | high | in-progress | v0.8 |

---

## 进行中 / Backlog

| ID | 标题 | 优先级 | 状态 | 版本方向 |
|----|------|--------|------|---------|
| [req-029](req-029-llm-gateway.md) | 自建 LLM Gateway（成本可见性子集） | medium | dropped | — |
| [req-024](req-024-per-agent-llm-config.md) | Agent 级别 LLM 配置（每角色可绑定不同模型） | medium | in-progress | v0.9 |
| [req-032](req-032-markdown-rendering.md) | ChatView Markdown 渲染（对话内容格式化显示） | high | in-progress | v0.9 |
| [req-033](req-033-new-conversation-blocking-fix.md) | 新建对话后发送内容无响应修复 | high | confirmed | v0.10 |
| [req-034](req-034-create-project-entry.md) | 新建项目入口（NavList 前端 + create_project 后端） | high | confirmed | v0.10 |
| [req-035](req-035-navlist-conversation-project-separation.md) | NavList 对话与项目数据分离展示 | high | confirmed | v0.10 |
| [req-021](req-021-memory-agent.md) | 记忆 Agent（语义上下文注入） | medium | backlog | — |
| [req-044](req-044-p4-text-input-expansion.md) | P4 文本输入展开面板（长文本输入体验优化） | medium | confirmed | v0.12 |
| [req-045](req-045-prompt-caching.md) | Prompt Caching 优化长对话输入 Token 消耗 | high | confirmed | v0.12 |
| [req-046](req-046-trackpad-gesture-fix.md) | Mac 触摸板手势修正（双指平移=平移，捏合=缩放） | high | confirmed | v0.12 |
| [req-047](req-047-ai-service-backend.md) | AI 工具层 Python 后端服务（Model Router + LLM Gateway） | high | in-progress | v0.13 |

### 旧 Backlog 条目（未成 req 文件的待评估项）

| 需求 | 说明 |
|------|------|
| 对话目录配置 UI | v0.1 先硬编码默认路径 |
| 对话分叉操作 | P2 v0.1 只读，v0.2 规划 |
