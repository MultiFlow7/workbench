---
id: req-068
title: 对话中继：多 Agent 入口的 QA 协议读写与传递
status: done
priority: high
source: 2026-07-10 · 用户明确工作台内核是协调层，Claude / Codex 等不同 Agent 入口都应能通过 QA 协议被读取、转化和传递
created: 2026-07-10
version: v0.17
---

# req-068 · 对话中继：多 Agent 入口的 QA 协议读写与传递

## 背景

工作台的产品内核不是单一 GUI 对话工具，而是个人协调层 / AgentOS。用户当前的主要对话入口仍然是 Claude 和 Codex；如果工作台要求所有主对话都回到工作台内发生，就会违背“协调层”的定位，也会增加用户在多个 Agent 入口之间切换的成本。

用户提出的关键判断：

> 对于协调层而言，理论上我应该使用不同的 Agent 入口，都能达到协调的效果。以对话为场景，Claude 和 Codex 是我目前的入口，那么工作台的一个功能模块就应该能协调管理我的对话。

因此，本需求不应被定义为“历史迁移”或“多端同步”，而应定义为：

```text
外部 Agent 入口对话
  -> 读取为工作台 QA 协议
  -> 在工作台中形成可追踪的 Conversation / QA tree
  -> 按目标入口重新组织为可传递上下文
  -> 交给 Claude / Codex / 其他 Agent 入口继续执行
```

QA 格式在这里不是单纯的存档格式，而是协调层的协议内核：`Codex -> QA` 是入口适配，`QA -> Codex` 是上下文传递，两者都属于协调功能。

## 目标

建立“对话中继 Conversation Relay”能力，让工作台能在多个 Agent 入口之间完成对话事实的读取、标准化和传递。

长期目标：

- 读取 Codex / Claude 本地对话，转为工作台 QA Atom + Conversation 结构。
- 通过 QA 协议保留来源、项目归属、对话边界、树关系和时间线。
- 支持从选定 QA / Conversation 生成目标入口可继续使用的上下文包。
- 支持把上下文包传递给 Codex / Claude 的新对话或当前对话入口。
- 支持在传递中携带 skill / agent 能力引用，而不是只传递纯文本历史。
- 记录每一次读取和传递的来源与目标，形成可追踪 handoff。

v0.17 MVP 收敛目标：

- 先读取一个指定 Codex 本地 session，不做完整 Claude 读取。
- 将 Codex session 映射为工作台 Conversation / QAAtom。
- 正规化 source metadata，并在 UI 中展示 Conversation Source。
- 从 Conversation 或 QA path 生成可复制的 Handoff Packet。
- 对 subagent / tool trace / Agent-Agent 信息只做候选标记，不定义正式 Agent-Agent 最小单元。

## 产品定位

本模块应被定位为工作台协调层的核心能力之一，而不是数据导入工具。

建议产品名：

| 名称 | 判断 |
|---|---|
| 对话中继 / Conversation Relay | 推荐。强调从一个入口读出，再传到另一个入口，范围收敛。 |
| 入口协调器 / Entry Coordinator | 更接近长期方向，但 MVP 可能过宽。 |
| 对话同步 | 不推荐作为主名。容易被理解为历史列表双向一致。 |
| 对话迁移 | 不推荐。一次性搬运语义过强，无法表达持续协调。 |

MVP 推荐命名：**对话中继**。

## 协议层概念

### 1. Read / 读取

读取不是 import，也不是 consume，而是：

> 从外部 Agent 入口中获取对话事实，并映射为工作台协议对象。

读取层至少需要保留：

| 字段 | 含义 |
|---|---|
| `source_platform` | 来源入口，如 `codex` / `claude` / `workbench`。 |
| `source_session_id` | 原始对话 ID。 |
| `source_path` / `source_db` | 来源文件或数据库位置。 |
| `source_cwd` | 来源对话的工作目录，可用于项目归属。 |
| `read_checkpoint` | 已读取到的位置，保证增量幂等。 |
| `project_binding` | 是否可归属到本地 Project。 |
| `conversation_id` | 工作台侧 Conversation ID。 |
| `qa_atoms` | 拆出的 QA 单元。 |
| `tree_relation` | QA 的父子、分支、子任务关系。 |
| `provenance` | 该 QA 从哪里来，是否经过人工或系统改写。 |

读取原则：

- 不改写外部原始对话。
- 不伪造外部平台内部历史。
- 不把内部执行子任务误提升为独立 Conversation。
- 同一 `source_platform + source_session_id + turn_index/source_key` 必须幂等。

### 2. Relay / 传递

传递不是把完整历史复制到另一端，而是：

> 将工作台协议对象组织成目标 Agent 可理解、可继续执行的上下文包。

建议协议对象名：

```text
Conversation Handoff Packet
```

Handoff Packet 至少包含：

| 字段 | 含义 |
|---|---|
| `target_platform` | 目标入口，如 Codex / Claude。 |
| `handoff_mode` | 继续对话 / 作为参考 / 执行任务。 |
| `selected_conversation_ids` | 被传递的 Conversation。 |
| `selected_qa_path` | 被传递的 QA 路径或子树。 |
| `project_context` | 本地项目路径、相关文件、当前 cwd。 |
| `skill_context` | 相关 skill / agent 能力引用与调用说明。 |
| `constraints` | 当前任务约束、禁止事项、已确认决策。 |
| `pending_items` | 待办、下一步、未决问题。 |
| `provenance` | 来源追踪。 |
| `user_confirmation` | 用户触发或确认记录。 |

传递原则：

- 目标是让另一个入口“接得上”，不是伪装成原生历史。
- 传递内容应可审阅、可复制、可追踪。
- MVP 不让 AI 自动决定传什么；用户选择或显式规则选择。

### 3. Skill 传递

本需求中的 skill 传递不等同于自动安装或复制目标平台的 skill 文件。

MVP 中 skill 传递的含义是：

- 识别当前对话 / 任务依赖的 skill 或 agent 能力。
- 在 Handoff Packet 中携带 skill 名称、用途、入口、必要上下文。
- 告诉目标入口应如何使用这些能力。
- 保留来源平台的 skill 使用痕迹，供工作台追踪。

不在 MVP 中承诺：

- 自动安装 Claude / Codex skill。
- 自动判断 skill 兼容性。
- 自动把某平台专属 skill 转换为另一平台原生 skill。

## 推进规划

### Phase 0：协议收口

目标：先把“对话中继”的协议对象和边界定清楚。

交付：

- 定义 Read Record：外部对话读取记录。
- 定义 Conversation Handoff Packet：对话传递上下文包。
- 明确 QA Atom 在中继中的不可变事实层地位。
- 明确外部入口原始数据只读，工作台只维护协议映射与派生索引。

不做：

- 不做 AI 摘要、AI 归类、AI 冲突合并。
- 不做实时同步。
- 不写入外部平台内部数据库。

### Phase 1：读取端 MVP

目标：先让 Codex 对话稳定进入工作台协议层；Claude 读取进入后续版本。

交付：

- Codex 本地 thread / rollout 增量读取。
- `source_key` 幂等去重。
- Codex 项目对话按 `cwd` 归属本地 Project。
- Codex 无项目对话归入无项目入口。
- Codex 子任务线程归并为父 QA 回答内容或执行记录，不作为独立 Conversation。

验收：

- 重复运行读取不产生重复 QA。
- 新增外部对话能增量进入工作台。
- 项目 / 无项目 / Conversation / QA tree 结构保持稳定。

### Phase 2：传递端 MVP

目标：从 QA / Conversation 生成可交给目标入口继续使用的上下文包。

交付：

- 用户选择一个 Conversation、QA 路径或 QA 子树。
- 工作台生成 Handoff Packet。
- 支持导出为目标入口可读的 prompt / context 文本。
- 支持携带项目路径、任务 cwd、相关 skill 引用、约束和待办。
- 记录 handoff 日志。

验收：

- 从 Codex 读取的 QA 可以生成可复制 Handoff Packet。
- 用户能看懂“传了什么、从哪里来、传给谁”。

### Phase 3：入口联动

目标：减少用户手工复制成本，但仍不伪造目标平台原生历史。

候选能力：

- 一键复制 Handoff Packet。
- 一键打开 Codex / Claude 入口并填入上下文。
- 若平台提供稳定 CLI / SDK，可创建新对话并注入上下文。
- 支持选择“新对话接续”或“当前对话参考”。

不做：

- 不直接写 Codex / Claude 内部数据库。
- 不伪造工具调用记录、权限记录、subagent trace。
- 不追求 Claude 和 Codex 历史列表完全一致。

## MVP 不纳入范围

- AI 自动摘要、自动归类、自动决定传递内容。
- 多端实时双向同步。
- 冲突合并。
- 账号级云同步。
- 外部平台原生历史伪同步。
- 自动安装或改写目标平台 skill。
- 把 Claude / Codex 变成工作台产品内置 Agent 列表；它们是外部 Agent 入口。

## 与既有需求关系

| 需求 | 关系 |
|---|---|
| req-067 项目-对话-QA 树三层结构 | 本需求依赖 req-067。没有显式 Conversation 层，就无法表达对话中继。 |
| req-065 任务 cwd 选择器 | Handoff Packet 需要携带目标任务 cwd；req-065 可作为传递端的项目上下文基础。 |
| req-021 记忆 Agent | 本需求先处理协议事实读取和传递，不做语义记忆注入。 |
| req-041 / req-042 Tool Calling | Skill / tool 传递后续可能依赖工具协议，但 MVP 只传引用和说明。 |

## 验收标准

- [ ] 存在“对话中继”产品定义，区别于迁移 / 同步。
- [ ] 存在外部对话 Read Record 协议。
- [ ] 存在 Conversation Handoff Packet 协议。
- [ ] 指定 Codex session 可按幂等规则读取为 QA Atom。
- [ ] 读取结果能进入 Project / 无项目 / Conversation / QA tree 结构。
- [ ] Codex 子任务不作为独立 Conversation 污染对话列表。
- [ ] 用户可选择 QA 路径 / 子树 / Conversation 生成 Handoff Packet。
- [ ] Handoff Packet 可复制给目标 Agent 入口继续使用。
- [ ] Handoff Packet 中可携带 project context、cwd、skill context、约束和待办。
- [ ] 每次传递有可追踪记录。
- [ ] MVP 不直接写入 Claude / Codex 内部数据库。

## 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 被误解为同步产品 | 用户可能期待两端历史列表完全一致 | 产品命名使用“中继”，明确不承诺原生历史伪同步 |
| 外部平台格式变化 | Codex / Claude 本地存储可能升级 | 读取层必须有 adapter 边界和失败提示 |
| 上下文包过大 | 长对话直接传递会超上下文 | MVP 先由用户选择范围，不做 AI 自动压缩 |
| skill 传递边界不清 | skill 可能跨平台不兼容 | MVP 只传引用和说明，不自动安装 / 改写 |
| 污染 QA 事实层 | 为了传递方便改写原始 QA | 原始 QA 只读，传递内容作为 Handoff Packet 派生层 |

## CEO 判断

这是工作台从“本地对话管理”进入“多 Agent 入口协调”的关键需求。它应作为协调层主线需求进入需求池，但版本范围需要谨慎：建议先完成协议和读取端稳定，再进入入口联动。

## v0.17 实现结果

v0.17 已完成对话接力 MVP：

- 支持读取指定 Codex 本地 session。
- 支持映射为 Conversation / QAAtom。
- 支持 source metadata display/hash 保真。
- 支持 Handoff Packet 确定性模板生成。
- 支持 local-only Read/Handoff Record。
- 不做 Claude 完整读取、不做自动同步、不定义 Agent-Agent 正式协作单元。
