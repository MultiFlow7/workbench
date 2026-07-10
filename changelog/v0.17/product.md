---
version: v0.17
codename: Conversation Relay MVP
status: draft
doc_revision: 3
created: 2026-07-10
review_state: 已审查
project: 工作台
draft_owner: workbench-ceo
tags:
  - 类型/规划文档
  - 主题/技术/工作台
  - 状态/草案
---

# 产品规划 · v0.17 · Conversation Relay MVP

## 版本概述

**一句话定位**：v0.17 开发“对话接力 MVP”，让工作台能读取一个外部 Codex 对话，映射为工作台的 Conversation / QA 结构，并生成一个人和 Agent 都能理解的 Handoff Packet。

本版本不是“边界校准版本”，也不是完整 Agent-Agent 协作模型。它把已经想清楚的部分开发出来：

```text
Codex Session
  -> Source Read
  -> Conversation / QAAtom
  -> Source Metadata
  -> Handoff Packet
```

同时，把尚未想清楚的 Agent-Agent 信息流只做观察标记，不强行定义为 Work Atom、Task Atom 或其他正式产品对象。

## 版本性质

| 项 | 结论 |
|---|---|
| 版本类型 | 新功能开发 / 协调层 MVP |
| 主线需求 | req-068 对话中继 |
| 暂不纳入 | req-065 cwd selector 独立 UI |
| 用户可感知变化 | 能把指定 Codex 对话读入工作台，查看来源，并生成接力包 |
| 协议增量 | Source Read、source metadata 正规化、Conversation Handoff Packet |
| 核心边界 | 做 Human-Agent 对话接力；不定义完整 Agent-Agent 协作单元 |

## 为什么是 0.17

v0.16.2 已经建立 Project / Conversation / QAAtom 三层结构。下一步最自然的版本增量，不是继续在 GUI 上补小按钮，而是验证工作台作为协调层能否接住外部 Agent 入口产生的真实对话。

用户当前的核心工作不只发生在工作台内，也发生在 Codex、Claude 等入口中。如果这些外部对话不能进入工作台协议层，工作台就会退化成另一个聊天界面，而不是协调层。

因此 v0.17 先做一个最小闭环：

1. 从 Codex 本地 session 读取真实对话。
2. 映射为工作台 Conversation / QAAtom。
3. 保留来源、cwd、标题、路径等可追溯信息。
4. 生成可交给下一个 Agent 或人继续处理的 Handoff Packet。

## 已想清楚的边界

### 1. QAAtom 继续作为 Human-Agent 信息单元

当前 QA 逻辑围绕人机交互成立。它适合沉淀：

- 用户的问题、判断、偏好、约束；
- Agent 的回答、执行总结、交付说明；
- 对话分叉和线性上下文。

v0.17 不推翻 QAAtom，也不把它扩展成所有 Agent 协作信息的唯一单元。

### 2. Source Metadata 是对话接力的协议事实

外部对话读入工作台后，必须知道它从哪里来：

- `source_platform`
- `source_session_id`
- `source_path`
- `source_cwd`
- `source_title`
- `source_key`

这些字段不是普通补充信息，而是后续接力、追溯、去重、项目归属和上下文投射的基础。

### 3. Handoff Packet 是本版本的接力产物

Handoff Packet 不是完整记忆系统，也不是目标平台原生历史伪同步。它是从工作台协议对象派生出的上下文包，目标是让人或 Agent 能接着工作。

### 4. Agent-Agent 信息流只观察，不转正

如果 Codex session 中出现 subagent、tool trace、handoff 或内部执行记录，v0.17 只标记为“可能的 Agent-Agent / Agent-World 信息”，不把它强行塞进 QAAtom，也不定义 Agent-Agent 最小沉淀单元。

## 本版本交付物

### 1. Codex Session 读取

提供一个最小读取能力，用于读取指定 Codex 本地 session。

MVP 支持：

- 按 Codex session id 或 session jsonl 文件路径读取；
- 解析用户消息、Agent 回复、时间、cwd、标题；
- 将连续对话映射为工作台 Conversation；
- 将可配对的人机消息拆为 QAAtom；
- 保留原始来源字段；
- 同一 `source_platform + source_session_hash + source_key` 重复读取时幂等。

首个验收样本使用用户指定的 local-only Codex session。真实 session id 不写入公开规划文档，只在本地验收记录中引用。

```text
<local-codex-session-id>
```

### 2. QA / Conversation Source Metadata 正规化

让工作台数据模型和读取链路正式承认 source metadata。

交付：

- `QAAtomMeta` 支持读取 source 字段；
- atom parser 能解析现有 QA markdown frontmatter 中的 `source_*` 字段；
- Conversation 层可聚合来源信息；
- UI 可以展示当前对话来自 Codex / Workbench / 其他入口；
- 缺失来源信息时显示为本地原生或未知来源，不阻断旧数据。

### 3. Conversation Source 视图

在现有 UCI 中增加一个轻量来源详情区域，优先放在 P4 或当前详情面板中。

展示内容：

- 来源平台；
- 原始 session id；
- 原始 cwd；
- 原始标题；
- 原始路径；
- 读取时间；
- 是否可追溯；
- 是否存在未建模的 Agent 执行 / Agent-Agent 信息。

这不是新的大模块，只是让用户看清“这段 Conversation 从哪里来、能不能继续接力”。

### 4. Handoff Packet 生成

用户可以从一个 Conversation 或选中的 QA path 生成接力包。

MVP Handoff Packet 先使用确定性模板，不调用 AI 自动摘要，不自动归类。语义字段分为两类：

| 字段类型 | v0.17 处理方式 |
|---|---|
| 结构化事实 | 由系统确定性生成，包括来源、QA path、时间、cwd、目标入口、handoff mode |
| 人工审阅字段 | 用待填写/待确认占位呈现，包括关键判断、已确认结论、未决问题、下一步建议 |

MVP Handoff Packet 至少包含：

- 目标入口；
- Handoff mode：继续对话 / 作为参考 / 执行任务；
- 用户确认状态；
- Read Record / Handoff Record；
- 当前对话在解决什么问题；
- 用户已经表达过的关键判断；
- 已确认结论；
- 未决问题；
- 下一步建议；
- 目标 Agent 需要遵守的约束；
- 项目 / cwd / skill 相关上下文；
- 来源追踪信息。

MVP 输出形式可以先是可复制的 Markdown / prompt 文本，不要求自动注入 Codex 或 Claude。默认输出会脱敏本地绝对路径和真实 session id；用户需要显式选择“包含本地来源细节”才显示完整 `source_path / source_cwd / source_session_id`。

### 5. 未建模信息标记

当读取到无法稳定归类的信息时，不丢弃，也不误定义。

标记类型：

| 标记 | 含义 |
|---|---|
| `agent_execution_candidate` | 可能属于 Agent 执行过程 |
| `agent_agent_candidate` | 可能属于 Agent-Agent 信息流 |
| `tool_trace_candidate` | 可能属于工具 / Runtime trace |
| `unmapped_source_event` | 暂无法映射的外部 session 事件 |

这些标记只进入观察层，不作为正式产品对象转正。

## 非范围

- 不做完整 Claude 读取。
- 不做多端实时同步。
- 不写入 Codex / Claude 内部数据库。
- 不伪造目标平台原生历史。
- 不做 Agent-Agent 最小协作单元定义。
- 不做 Memory Agent。
- 不把四流做成产品模块。
- 不开发独立 cwd selector UI。
- 不做自动摘要、自动归类、自动决定传递内容。
- 不自动安装或改写目标平台 skill。

## 与需求池关系

| 需求 | 本版本处理 |
|---|---|
| req-068 对话中继 | v0.17 主线，收敛为 Codex Session 读取 + QA/Conversation 映射 + Handoff Packet MVP |
| req-065 任务 cwd 选择器 | 不进入 v0.17 UI；cwd 仅作为 source metadata 和 handoff context 字段使用 |
| req-021 记忆 Agent | 不处理；Memory 与 Context 保持分离 |
| req-023 Harness | 不处理；只在 Handoff 约束中保留后续接口意识 |
| req-043 工具调用状态 UI | 不处理；未建模 trace 只做候选标记 |

## Human User / Agent User 价值

| 用户 | v0.17 提供的价值 |
|---|---|
| Human User | 能把真实外部对话接入工作台，看清来源、上下文、未决问题，并生成可审阅接力包 |
| Agent User | 能收到结构化上下文，而不是一整段无边界历史；能知道来源、约束、cwd、待办 |

## 发布边界

| 边界类型 | v0.17 是否跨越 | 处理方式 |
|---|---|---|
| workspace boundary | 是 | 读取本地 Codex session、cwd、source path，默认 local-only |
| publication boundary | 是 | release 前扫描真实路径、session id、私人对话内容 |
| external platform boundary | 是 | 只读 Codex 本地 session，不写入外部平台 |
| Agent Team boundary | 有观察 | subagent / handoff 只标记，不产品化为内置 Agent Team |
| personal data | 是 | Handoff 样本和读取 fixtures 不进入公开产物，除非脱敏 |

发布阻断项：

- 不得把真实本地路径、私人知识库路径、完整 session 原文写入公开 release 产物。
- 若保留测试 fixture，必须脱敏或 local-only。
- Handoff Packet 外发字段必须经过 allowlist 审核，默认只允许包含脱敏来源、目标入口、handoff mode、QA 摘要占位、约束占位和待办占位。
- 公开发布前运行 staged/tracked/build 隐私扫描。
- Handoff Packet 生成结果必须让用户可审阅，不允许静默发送给外部入口。

## 验收标准

- [ ] 可按 Codex session id 或文件路径读取指定本地 Codex session。
- [ ] 用户指定的 local-only Codex session 样本可进入工作台。
- [ ] 读取结果形成稳定 Conversation。
- [ ] 存在 Read Record，可追踪 `source_platform + source_session_id + read_checkpoint`。
- [ ] 读取结果能归属到 Project 或无项目入口，归属失败时不阻断导入。
- [ ] 可配对人机消息被映射为 QAAtom。
- [ ] QAAtom 保留 `source_platform / source_session_id / source_path / source_cwd / source_title / source_key`。
- [ ] 重复读取同一 session 不产生重复 QAAtom。
- [ ] UI 能显示 Conversation Source 信息。
- [ ] 用户能从 Conversation 或 QA path 生成 Handoff Packet。
- [ ] Handoff Packet 包含目标入口、handoff mode、用户确认状态、来源、已确认判断占位、未决问题占位、约束、下一步占位。
- [ ] 每次 Handoff 生成都有 Handoff Record 或等价可追踪记录。
- [ ] 无法归类的 Agent 执行 / Agent-Agent 信息被标记为候选，不被误写入 QAAtom 正式语义。
- [ ] v0.17 不开发 cwd selector UI，不做 Claude 完整读取，不做自动同步。
- [ ] Handoff Packet 默认脱敏本地路径和真实 session id；完整来源细节只能由用户显式包含。
- [ ] publication boundary 检查项进入 release 流程。

## 后续版本建议

| 版本 | 主题 | 前置条件 |
|---|---|---|
| v0.18 | Claude Session Read / 多入口读取 | v0.17 Codex 读取和 source metadata 稳定 |
| v0.19 | Handoff Review / Context Projection | Handoff Packet 已能被真实 Agent 接续使用 |
| v0.20 | Agent Feedback Translation | ProcessTrace、Decision、Handoff 的人类可操作反馈需要统一 |
| v0.21+ | Agent-Agent Collaboration Model | 多个真实样本证明 QAAtom 之外的信息流需要独立模型 |

## 修订记录

| doc_revision | 日期 | 作者 | 变化 |
|---|---|---|---|
| 1 | 2026-07-10 | workbench-ceo | 初稿：将 v0.17 误定为协调层边界校准版本 |
| 2 | 2026-07-10 | workbench-ceo | 按用户校正，改为 Conversation Relay MVP：开发 Codex Session 读取、Source Metadata、Source View、Handoff Packet；Agent-Agent 信息只做观察标记 |
| 3 | 2026-07-10 | workbench-ceo | review 修订：Handoff 改为确定性模板 + 人工占位，补 Read Record / Handoff Record / target platform / handoff mode / allowlist / 默认脱敏验收 |

## Review 记录

| 日期 | 范围 | 结果 |
|---|---|---|
| 2026-07-10 | product review | 通过；Handoff 自动摘要边界、Read/Handoff Record、target platform / handoff mode / publication boundary 已修订 |
