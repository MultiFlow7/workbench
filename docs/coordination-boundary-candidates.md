---
project: 工作台
created: 2026-07-10
updated: 2026-07-10
status: draft
tags:
  - 类型/边界文档
  - 主题/技术/工作台
  - 主题/技术/AgentOS
  - 状态/草案
---

# 协调层边界候选账本

## 用途

本文档记录工作台在向个人协调层 / AgentOS 演进过程中尚未完全定性的概念。

这些概念不能因为“听起来像内核”就直接产品化。它们需要先作为边界候选接受版本验证，逐步判断归属：

- 工作台协调层
- Agent Team
- 单个 Agent 能力
- Runtime / 基础设施
- 信息层 / 记忆系统
- 暂不纳入

## 判断原则

1. **四流是思考内核，不是当前产品模块。** 业务流、信息流、决策流、价值流用于规划判断，不直接变成页面、导航或数据表。
2. **Human User 与 Agent User 都是一等公民。** 每个候选概念都必须说明它如何服务人、如何服务 Agent。
3. **Memory 与 Context 分离。** 记忆是长期语义沉淀；上下文是 session 内的信息投射。
4. **产品对象必须被版本功能逼出来。** 没有可感知功能支撑的协议事实默认暂缓。
5. **边界不清先记账，不强判。** 候选概念可以保留不确定性，但必须写清转正条件。

## 候选状态

| 状态 | 含义 |
|---|---|
| candidate | 已识别，尚未验证 |
| validating | 已进入某个版本验证 |
| accepted | 已转正为工作台产品对象 |
| externalized | 已判定归属 Agent / Runtime / 信息层等外部边界 |
| deferred | 暂不处理 |

## 首批候选概念

### C-001 · Session

| 字段 | 内容 |
|---|---|
| 状态 | candidate |
| 当前归属判断 | 工作台协调层候选，和 Runtime session / 外部平台 session 有交界 |
| 四流映射 | 业务流锚点 + 信息流投射 + 决策流反馈 + 价值流沉淀 |
| Human User 价值 | 让人知道一次协作围绕什么目标、用了哪些上下文、现在是否可接续 |
| Agent User 价值 | 让 Agent 获得明确的运行上下文、边界和交接单位 |
| 证据 | v0.16.2 已引入 Conversation / Session 层；req-068 需要读取 Claude / Codex 外部 session |
| 未决问题 | Session 与 Conversation 是否一一对应？外部平台 session、工作台 session、Runtime session 是否需要分层命名？ |
| 转正条件 | 至少一个外部 Agent session 能被稳定映射为工作台 Conversation / QAAtom，并能生成后续上下文投射 |

### C-002 · Context Projection

| 字段 | 内容 |
|---|---|
| 状态 | candidate |
| 当前归属判断 | 工作台协调层核心候选，与 Runtime context window 有交界 |
| 四流映射 | 信息流 |
| Human User 价值 | 人能审阅“这次给 Agent 带了什么、遗漏了什么、风险是什么” |
| Agent User 价值 | Agent 获得压缩、相关、可执行的上下文窗口 |
| 证据 | 用户指出上下文窗口投射可能是 Agent 间最佳协作逻辑，类似信息库逻辑 |
| 未决问题 | 投射由确定性规则生成、AI 辅助生成，还是两者结合？人类审阅界面如何避免变成噪音？ |
| 转正条件 | 能从选定 Conversation / QA path / 信息源生成目标 Agent 可用的上下文包，并让人可读可审 |

### C-003 · External Agent Session Read

| 字段 | 内容 |
|---|---|
| 状态 | validating |
| 当前归属判断 | 工作台协调层候选；外部平台适配属于 ACI / adapter 边界 |
| 四流映射 | 信息流 |
| Human User 价值 | 人可以把 Claude / Codex 中发生的真实协作接入工作台，不丢失来源和边界 |
| Agent User 价值 | 后续 Agent 可以基于外部 session 的事实继续工作 |
| 证据 | req-068 已进入 v0.17；Claude / Codex 等外部 Agent 入口不应被要求回到工作台内发生 |
| 未决问题 | v0.17 先读取指定 Codex session；读取结果进入正式 Vault 数据还是 local-only fixture 需由技术规划决定 |
| 转正条件 | 重复读取同一 Codex session 不产生重复 QAAtom，并能保留 source metadata |

### C-004 · Conversation Handoff Packet

| 字段 | 内容 |
|---|---|
| 状态 | validating |
| 当前归属判断 | 工作台协调层候选 |
| 四流映射 | 信息流 + 决策流 |
| Human User 价值 | 人能看懂“传给谁、传了什么、为什么传、有什么风险” |
| Agent User 价值 | 目标 Agent 能接续任务，而不是读取一大段无结构历史 |
| 证据 | req-068 中已有 Handoff Packet 草案字段；v0.17 已将其作为对话接力 MVP 的可感知交付物 |
| 未决问题 | v0.17 先作为确定性 Markdown / prompt 导出与 Handoff Record，不自动摘要；后续再判断是否转为完整产品对象 |
| 转正条件 | 从一个真实 Conversation 生成目标入口可用的 Handoff，并经人类审阅后成功接续 |

### C-005 · Agent Feedback Translation

| 字段 | 内容 |
|---|---|
| 状态 | candidate |
| 当前归属判断 | 工作台协调层核心候选 |
| 四流映射 | 决策流 + 信息流 |
| Human User 价值 | 把 Agent 原始反馈转成人能接受、理解、判断和干预的交互反馈 |
| Agent User 价值 | Agent 可以通过结构化反馈请求人的判断，而不是只输出日志或长文本 |
| 证据 | 用户明确指出“把 Agent 的反馈转化成人能接受和理解的交互反馈形式”是内核另一半 |
| 未决问题 | 哪些反馈应成为 Situation / Progress / Risk / Choice / Outcome？哪些只留在 Trace？ |
| 转正条件 | ProcessTrace / Decision / Handoff 中至少一种 Agent 反馈被稳定转译成人类可操作 UI |

### C-006 · Memory Agent

| 字段 | 内容 |
|---|---|
| 状态 | candidate |
| 当前归属判断 | 信息层 / 专门 Agent 候选，不应默认成为所有 Agent 的内置能力 |
| 四流映射 | 信息流 |
| Human User 价值 | 长期追溯为什么这样决策、过去有哪些经验 |
| Agent User 价值 | 在需要时检索长期语义背景，而不是每次全量加载 |
| 证据 | req-021 已记录记忆 Agent；用户本轮明确 Memory 与 Context 是两件事 |
| 未决问题 | 记忆由专门 Memory Agent 维护，还是由信息层服务维护？工作台只显化结果还是直接管理记忆？ |
| 转正条件 | 多个 session 反复需要同一语义背景，且文件注入无法满足检索和老化需求 |

### C-007 · cwd / execution directory

| 字段 | 内容 |
|---|---|
| 状态 | candidate |
| 当前归属判断 | Session context 字段候选，不是独立产品内核 |
| 四流映射 | 业务流 + 信息流 |
| Human User 价值 | 人知道 Agent 将在哪个本地目录执行 |
| Agent User 价值 | Agent 获得文件读写、命令执行的默认工作目录 |
| 证据 | req-065 来自用户对输入框文件夹按钮的澄清；v0.16.2 曾为 cwd 预留 Conversation 边界 |
| 未决问题 | cwd 是否需要 UI 选择器？它应属于 Project、Conversation、Session 还是单次任务？ |
| 转正条件 | 真实跨项目 / 跨入口 session 中反复需要选择或传递执行目录，且缺少该字段会导致 Agent 接续失败 |

### C-008 · Harness / Permission Gate

| 字段 | 内容 |
|---|---|
| 状态 | candidate |
| 当前归属判断 | Runtime / 基础设施与工作台决策流显化的交界 |
| 四流映射 | 决策流 |
| Human User 价值 | 人在关键风险点获得可理解的批准、拒绝、打断入口 |
| Agent User 价值 | Agent 清楚哪些动作可做、哪些动作需要等待授权 |
| 证据 | req-023 已定义 Harness；控制平面 REQ-007 也有 Hook / SessionStart / SessionEnd 约束层 |
| 未决问题 | 工作台应实现 gate 本身，还是只显化 Runtime gate 的请求和结果？ |
| 转正条件 | 某个真实动作需要确定性阻断，并且用户需要在工作台中理解和裁决该阻断 |

### C-009 · Value Record

| 字段 | 内容 |
|---|---|
| 状态 | candidate |
| 当前归属判断 | 工作台价值流候选，短期只做观测，不做清算 |
| 四流映射 | 价值流 |
| Human User 价值 | 人能看到一次协作消耗了什么、产出了什么、沉淀了什么 |
| Agent User 价值 | Agent 的贡献、成本和产物能被记录，便于后续优化 |
| 证据 | 现有 Token / Cost、ProcessTrace 已有价值流雏形；四流文档定义价值流为度量与清算网络 |
| 未决问题 | 短期只记录 token/cost/outcome，还是加入贡献归因？ |
| 转正条件 | 至少一个版本需要基于成本、产物或贡献记录做用户可感知判断 |

## 样本记录

### S-001 · 2026-07-10 用户与 CEO 关于协调层内核的对话

| 字段 | 内容 |
|---|---|
| 来源 | 当前 Codex 会话 |
| 业务锚点 | 工作台下一阶段产品规划 |
| 触发问题 | 用户无法判断宏大路线是否正确，希望 CEO 给出可协作的下一步 |
| 暴露概念 | 四流、Human/Agent 双用户、Session、Context Projection、Memory、AgentOS 边界、cwd 降级 |
| Human User 反馈需求 | 不要直接下定义；需要把不确定性变成候选账本和验证流程 |
| Agent User 反馈需求 | CEO 需要读取用户知识库文件，结合项目事实重新校准规划 |
| 初步结论 | v0.17 应做“对话接力 MVP”：读取指定 Codex session，映射为 Conversation / QAAtom，生成 Handoff Packet；边界账本只作为未决概念观察机制 |
| 隐私边界 | 当前对话与知识库路径默认 local-only；公开文档只保留脱敏后的产品结论 |

### S-002 · 2026-07-10 CEO 文档交付反馈不可操作

| 字段 | 内容 |
|---|---|
| 来源 | 当前 Codex 会话 |
| 业务锚点 | v0.17 product.md 与边界候选账本草案交付 |
| 触发问题 | CEO 只反馈“已起草两份文档、请看是否说偏或太重”，用户不知道自己具体要判断什么、下一步要做什么 |
| 暴露概念 | Agent Feedback Translation、Human Review Prompt、Decision Request |
| Human User 反馈需求 | Agent 交付后必须把抽象产物转译成明确审阅问题、可选动作和推荐路径 |
| Agent User 反馈需求 | Agent 需要知道交付不是结束；必须给出下一步协作接口，降低用户判断成本 |
| 初步结论 | 反馈必须从“我做了什么”升级为“你现在需要判断什么 / 可以怎么回应 / 我推荐怎么走” |
| 隐私边界 | 当前对话样本默认 local-only；公开文档只保留脱敏后的产品结论 |

## 转正规则

候选概念转正为工作台产品对象前，必须满足：

1. 至少被一个版本的可感知功能逼出来。
2. 能说明它如何同时服务 Human User 与 Agent User。
3. 能说明它不属于单个 Agent 自身能力，或即使属于交界，也需要工作台显化。
4. 有明确的数据对象、UI 显化或交互反馈形态。
5. 通过 review-agent 审查，没有把四流思考内核直接产品化。

## 更新记录

| 日期 | 变化 |
|---|---|
| 2026-07-10 | 初稿：建立首批协调层边界候选概念和样本记录 |
| 2026-07-10 | 修订：按用户确认将 v0.17 从边界校准改为对话接力 MVP，External Agent Session Read 进入 v0.17 验证 |
