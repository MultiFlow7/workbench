---
project: 工作台
updated: 2026-07-09 (v0.16.2 req-067 完成；req-066 状态账收口)
---

# 需求状态看板 · 工作台

> 本看板按 `requirements/req-*.md` frontmatter 统计。v0.16 起 requirements 作为正式过程资产进入 Git 追踪。

## 需求分流规则

自 2026-06-18 起，进入需求池前先做归属判断：

| 需求类型 | 归属 |
|---|---|
| 工作台 / AgentOS 的通用协调协议、UCI / ACI 显化、用户可感知功能 | 本看板 |
| 开发工作台的 Agent 团队协作、交接、评审、复盘机制 | `../Agent团队打造/teams/workbench-agent-team/requirements/` |
| 单个 Agent 的能力、上下文、评估、版本演进 | 对应 `../Agent团队打造/agents/{agent}/requirements/` |
| Runtime、沙盒、MCP、工具、状态、权限等基础设施 | 对应基础设施项目需求池 |

Agent Team 经验进入工作台需求池前，必须先翻译成对超级个体协调多执行体也成立的通用协调问题，并有版本功能承接。

## 总览

| 统计 | 数量 |
|------|------|
| 总需求数 | 67 |
| backlog | 7 |
| confirmed | 1 |
| planned | 0 |
| in-progress | 0 |
| done | 56 |
| dropped | 3 |

---

## Confirmed

| ID | 标题 | 优先级 | 状态 | 版本 |
|----|------|--------|------|------|
| [req-065](req-065-task-cwd-selector.md) | Chat 输入框任务 cwd 选择器（类 Claude Code 风格） | high | confirmed | v0.17 |

> 📌 **req-065 背景**：v0.16 R-6 被误解为切换 Vault，已撤销。用户真实需求是切换任务工作目录（类 Claude Code 启动时选 cwd），独立立项走 v0.17。

---

## Planned

| ID | 标题 | 优先级 | 状态 | 版本 |
|----|------|--------|------|------|
| — | — | — | — | — |

---

## In Progress

| ID | 标题 | 优先级 | 状态 | 版本 |
|----|------|--------|------|------|
| — | — | — | — | — |

---

## Backlog

| ID | 标题 | 优先级 | 状态 | 版本 |
|----|------|--------|------|------|
| [req-021](req-021-memory-agent.md) | 记忆 Agent（语义上下文注入） | medium | backlog | ~ |
| [req-022](req-022-agent-sandbox.md) | Agent 沙盒（隔离执行环境） | high | backlog | ~ |
| [req-023](req-023-harness-layer.md) | Harness 管控层（hooks + 工作流 + 权限管理） | high | backlog | ~ |
| [req-041](req-041-tool-calling-framework.md) | Tool Calling 基础框架（后续按 Claude Code SDK / 新技术栈重裁） | high | backlog | ~ |
| [req-042](req-042-builtin-tools.md) | 内置工具集（后续按 Claude Code SDK / 新技术栈重裁） | high | backlog | ~ |
| [req-043](req-043-tool-call-ui-feedback.md) | 工具调用状态 UI 反馈（后续按 ProcessTrace 主路径重裁） | medium | backlog | ~ |
| [req-048](req-048-web-search-tool.md) | 工具调用 - 联网搜索能力 | medium | backlog | ~ |

---

## Done

| ID | 标题 | 优先级 | 状态 | 版本 |
|----|------|--------|------|------|
| [req-001](req-001-tauri-app-skeleton.md) | Tauri 应用骨架 | high | done | v0.1 |
| [req-002](req-002-four-panel-layout.md) | 四面板布局与折叠 | high | done | v0.1 |
| [req-003](req-003-navigation-mode-switch.md) | 模式切换导航（P1） | high | done | v0.1 |
| [req-004](req-004-conversation-branch-tree.md) | 对话分支树（P2） | high | done | v0.1 |
| [req-005](req-005-linear-conversation-view.md) | 线性对话视图（P3） | high | done | v0.1 |
| [req-006](req-006-node-detail-panel.md) | 节点详情面板（P4 只读） | medium | done | v0.1 |
| [req-007](req-007-zustand-state-management.md) | Zustand 状态管理层 | high | done | v0.1 |
| [req-008](req-008-tauri-file-commands.md) | Tauri 本地文件命令（QA 原子 + Obsidian vault） | high | done | v0.1 |
| [req-009](req-009-websocket-ai-client.md) | AI 流式对话客户端（Tauri HTTP Plugin + SSE） | high | done | v0.1 |
| [req-010](req-010-topbar-global-header.md) | TopBar 全局顶栏 | medium | done | v0.1 |
| [req-011](req-011-p1-navlist-panel.md) | P1 NavList 项目与对话列表 | medium | done | v0.1 |
| [req-012](req-012-list-projects-command.md) | list_projects 项目切换后端命令 | medium | done | v0.1 |
| [req-013](req-013-agent-task-state-machine.md) | Agent 任务状态机（后端） | high | done | v0.6 |
| [req-014](req-014-true-multi-agent-dispatch.md) | 真实多 Agent 调度（隔离实例，不角色扮演） | high | done | v0.7 |
| [req-015](req-015-context-builder.md) | Agent 上下文构建器 | high | done | v0.7 |
| [req-016](req-016-multi-level-visualization.md) | 多层级任务可视化 | high | done | v0.6 |
| [req-017](req-017-agent-execution-stream-view.md) | Agent 执行流视图（结构化日志） | medium | done | v0.6 |
| [req-018](req-018-decision-inbox.md) | 决策收件箱（非阻塞人工决策队列） | high | done | v0.6 |
| [req-019](req-019-pipeline-trigger-rules.md) | 流水线触发规则（自动编排） | medium | done | v0.7 |
| [req-020](req-020-main-conversation-isolation.md) | 主对话保护（独立于后台任务） | high | done | v0.8 |
| [req-024](req-024-per-agent-llm-config.md) | Agent 级别 LLM 配置（每个角色可绑定不同底层模型） | medium | done | v0.9 |
| [req-025](req-025-qa-atom-token-metadata.md) | QA Atom Token 元数据采集 | high | done | v0.3 |
| [req-026](req-026-context-window-indicator.md) | 上下文窗口占用实时指示器 | high | done | v0.3 |
| [req-027](req-027-canvas-token-analytics.md) | 画布 Token 分析视图（节点级统计） | high | done | v0.3 |
| [req-028](req-028-token-cost-dashboard.md) | Token 与成本时序仪表盘 | medium | done | v0.4 |
| [req-030](req-030-agent-registry-ui.md) | Agent 注册表 UI | high | done | v0.6 |
| [req-031](req-031-agent-task-trigger-ui.md) | Agent 任务手动触发 UI | high | done | v0.6 |
| [req-032](req-032-markdown-rendering.md) | ChatView Markdown 渲染（对话内容格式化显示） | high | done | v0.9 |
| [req-033](req-033-new-conversation-blocking-fix.md) | 新建对话后发送内容无响应修复 | high | done | v0.10 |
| [req-034](req-034-create-project-entry.md) | 新建项目入口（NavList 前端 + create_project 后端） | high | done | v0.10 |
| [req-035](req-035-navlist-conversation-project-separation.md) | NavList 对话与项目数据分离展示 | high | done | v0.10 |
| [req-036](req-036-streaming-race-condition-fix.md) | 流式响应 race condition 修复（ai-done 与 stream_ai 宏任务竞争） | high | done | v0.11 |
| [req-037](req-037-conversation-root-node-refactor.md) | 对话根节点结构重构（取消「新对话」占位 root atom） | high | done | v0.11 |
| [req-038](req-038-atom-id-trim-fix.md) | 项目文件 Atom ID 解析 trim 修复（重启后画布空白） | high | done | v0.11 |
| [req-039](req-039-input-clear-on-send.md) | 发送消息即清空输入框（引入 pendingQuestionRef） | medium | done | v0.11 |
| [req-040](req-040-branchtree-response-node-visibility.md) | BranchTree 响应节点可见（ai-done 后加入项目 atom 列表） | high | done | v0.11 |
| [req-044](req-044-p4-text-input-expansion.md) | P4 文本输入展开面板（长文本输入体验优化） | medium | done | v0.12 |
| [req-045](req-045-prompt-caching.md) | Prompt Caching 优化长对话输入 Token 消耗 | high | done | v0.12 |
| [req-046](req-046-trackpad-gesture-fix.md) | Mac 触摸板手势修正（双指平移=平移，捏合=缩放） | high | done | v0.12 |
| [req-047](req-047-ai-service-backend.md) | AI 工具层 Python 后端服务（Model Router + LLM Gateway） | high | done | v0.13 |
| [req-049](req-049-chat-scroll-jump-fix.md) | 对话框滚动跳动 bug 修复 | high | done | v0.14 |
| [req-050](req-050-stream-leak-and-force-nav-fix.md) | 切换对话时流式内容泄漏 + 强制跳转 bug 修复 | high | done | v0.14 |
| [req-051](req-051-concurrent-conversations.md) | 并发对话 + 即时卡片 | high | done | v0.14 |
| [req-053](req-053-electron-migration.md) | Electron 迁移（从 Tauri） | critical | done | v0.15 |
| [req-054](req-054-claude-code-sdk.md) | Claude Code SDK + Python ai-service 重定位 | critical | done | v0.15 |
| [req-055](req-055-process-trace-ui.md) | ProcessTrace 执行时间线 UI | high | done | v0.15 |
| [req-056](req-056-qa-atom-execution-storage.md) | QA 原子全量执行步骤存储 | high | done | v0.15 |
| [req-057](req-057-interruption-intervention.md) | 中断干预模型（PreToolUse + 干预记录） | high | done | v0.15 |
| [req-058](req-058-design-token.md) | Design Token 全局 CSS 重构 | high | done | v0.15 |
| [req-059](req-059-server-basic-layer.md) | 服务器基础接入层 | medium | done | v0.15 |
| [req-060](req-060-process-trace-chat-integration.md) | ProcessTrace Chat 模式接入（方案B渲染体系） | high | done | v0.15.1 |
| [req-061](req-061-send-button-pause-state.md) | 发送按钮运行状态感知（运行时变全局暂停） | medium | done | v0.15.1 |
| [req-062](req-062-activitybar-topbar-fixes.md) | ActivityBar 布局规范修正 + TopBar 运行状态 pill | medium | done | v0.15.1 |
| [req-063](req-063-oss-personal-info-decoupling.md) | OSS 化改造 · 解耦个人化信息与发布产物 | high | done | v0.16 |
| [req-066](req-066-public-cleanliness-patch.md) | 公开产品洁净度补丁 | critical | done | v0.16.1 |
| [req-067](req-067-project-conversation-qa-hierarchy.md) | 项目-对话-QA 树三层结构 | high | done | v0.16.2 |

> 📌 **v0.16 发布说明**：req-063 自动验证已通过并记录在 `changelog/release/v0.16.0.md`。正式打 `v0.16.0` tag 前仍需完成发布机人工首启验收与 dmg 解包扫描。

---

## Dropped

| ID | 标题 | 优先级 | 版本 |
|----|------|--------|------|
| [req-029](req-029-llm-gateway.md) | 自建 LLM Gateway（sub2api 内化替换） | medium | v0.9 |
| [req-052](req-052-backend-tool-loop.md) | 工具调用循环下沉到 Rust 后端 | high | — |
| [req-064](req-064-vault-cwd-single-source.md) | workspace.cwd 与 vault.vaultRoot 合并为单源 | medium | - |
