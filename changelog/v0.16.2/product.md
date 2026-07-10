---
version: v0.16.2
codename: Conversation Hierarchy
status: done
doc_revision: 10
created: 2026-07-09
review_state: 通过
project: 工作台
tags:
  - 类型/规划文档
  - 主题/技术/工作台
  - 状态/已完成
---

# 产品规划 · v0.16.2 · Conversation Hierarchy

## 版本概述

**一句话定位**：v0.16.2 引入显式 Conversation / Session 层，把工作台从 `Project -> QAAtom tree` 升级为 `Project / Unprojected -> Conversation(Canvas Group) -> Start Point -> QAAtom tree`。

本版本只处理一个结构问题：用户迁移 Codex / Claude 等外部对话时，工作台必须保留“项目归属”和“独立对话边界”，不能把所有源平台会话压扁成来源平台大项目，也不能继续把“对话”隐含在 `prev === null` 的 root atom 里。

## 版本性质

| 项 | 结论 |
|---|---|
| 版本类型 | 结构补丁 |
| 选入需求 | 仅 req-067 |
| 用户可感知变化 | P1 侧栏按项目下的对话 / 无项目对话分组；进入对话后 P2 继续显示共享画布，多个 root 起点由用户选择 |
| 主要风险 | 存储兼容、侧栏层级复杂度、旧 Vault 读取 |
| 不做事项 | 不批量重挂旧 atom，不重写外部导入器，不重做 QA atom 格式 |

## 选入需求

| ID | 需求 | 优先级 | 状态 |
|----|------|--------|------|
| [req-067](../../requirements/req-067-project-conversation-qa-hierarchy.md) | 项目-对话-QA 树三层结构 | high | done |

## 为什么必须插入 v0.16.2

req-065 的 `task.cwd` 选择器会继续强化“项目 / 任务 / 对话”的上下文边界。如果先做 req-065，再回头重构 conversation 层，容易让 cwd、项目、atom 三者继续纠缠在旧模型里。

v0.16.2 先把信息架构校正为：

```text
Project / Unprojected
  -> Conversation(Canvas Group)
      -> Start Point(root)
      -> QAAtom tree
```

这样 v0.17 做 task cwd 时，可以明确 cwd 是“对话 / 任务执行上下文”的属性，而不是误挂到 Vault 或 Project 的存储路径上。

## 核心决策

| 编号 | 决策 | 产品含义 |
|---|---|---|
| D1 | Conversation 成为正式结构层 | 对话不再只靠 root atom 隐式表达 |
| D2 | Project 收窄为用户主动选择的本地文件夹 | 新 Project 语义接近 Codex 工作目录，不再复用旧 `Projects/*.md` 的历史分组含义 |
| D3 | 保留 Unprojected 入口 | 无法可靠归属项目的外部会话不伪装成项目 |
| D4 | 旧 `atomIds` 项目索引必须兼容读取为无项目 conversation canvas | 老 Vault 不因结构升级失效，也不把历史画布伪装成新 Project |
| D5 | 本版本只做承载结构，不做历史批量整理 | 防止范围外溢到导入器、自动分类和数据清洗 |
| D6 | 对话标题允许重复和为空，但 UI 必须可区分 | 保留源平台事实，用时间 / 来源辅助显示 |

## 信息架构

### v0.16.1 之前

```text
Project
  -> atomIds[]
      -> QAAtom(prev / children)
```

问题是项目直接挂 atom；一条对话只通过 `prev === null` 的 root atom 间接出现。这个模型无法承载“一个项目下多条独立对话”的源平台结构。

### v0.16.2 之后

```text
Project
  -> Conversation[]
      -> QAAtom(prev / children)

Unprojected
  -> Conversation[]
      -> Start Point(root)[]
      -> QAAtom(prev / children)
```

UCI 的职责因此拆成两段：

1. P1 侧栏在项目 / 无项目入口下选择 Conversation。
2. P2 BranchTree 始终保留无限画布形态，并只渲染当前 conversation 的 QA 树。

P3 仍保持现有核心体验：点击 QA 节点后，展示从 root 到当前节点的线性历史。

## 数据模型要求

新增 `ConversationMeta`：

```ts
interface ConversationMeta {
  id: string
  title: string
  projectId: string | null
  groupId?: string | null
  rootAtomId: string | null
  atomIds: string[]
  status: 'draft' | 'active'
  createdAt: string
  updatedAt: string
  sourcePlatform?: 'workbench' | 'codex' | 'claude'
  sourceSessionId?: string
  sourcePath?: string
  sourceCwd?: string
}
```

调整 `ProjectMeta` 的主关系：

```ts
interface ProjectMeta {
  id: string
  name: string
  folderPath: string
  conversationIds: string[]
  createdAt: string
}
```

兼容规则：

- 新项目必须写 `folderPath` 与 `conversationIds`。
- 旧项目的 `atomIds` / `## 对话索引` 继续读取，但旧 `Projects/*.md` 会进入无项目对话，而不是新 Project。
- 旧项目索引会解释为 `projectId: null`、带内部 `groupId` 来源标记的完整 legacy canvas conversation，进入“对话”分组；多个 root 先保持在同一画布里。
- 未被索引的旧 root atom 会合并解释为 `projectId: null` 的“无项目旧画布” legacy canvas conversation，进入“对话 / 无项目”分组。
- `QAAtomMeta.prev / children` 不改语义。
- `legacyAtomIds` 只作为旧数据读取辅助字段，不是新的主关系；新写入路径不得继续把 Project 直接挂 atom。
- 新建空对话时允许 `status: 'draft'`、`rootAtomId: null`、`atomIds: []`；第一轮 QA 写入后转为 `status: 'active'` 并填入 `rootAtomId`。

## 存储策略

新增 conversation 索引目录：

```text
Conversations/
  conv-xxx.md
```

conversation 文件记录对话元信息与 QA 索引：

```yaml
---
id: conv-xxx
title: xxx
projectId: proj-xxx
rootAtomId: atom-xxx
sourcePlatform: workbench
sourceSessionId: null
sourcePath: null
sourceCwd: null
status: active
createdAt: 2026-07-09T00:00:00.000Z
updatedAt: 2026-07-09T00:00:00.000Z
---

## QA 索引

- [[atom-xxx]]
- [[atom-yyy]]
```

产品约束：

- 文件必须可读、可手工修复。
- 不改变现有 QA atom Markdown 文件格式。
- conversation 索引缺失时，系统必须能从 legacy project atom index 降级恢复。

## UI / 交互方案

### P1 / Nav

P1 从“项目 + 根 atom 对话列表”调整为类似 Codex 的侧栏分组：

```text
项目
  项目 A
    对话 1
    对话 2
  项目 B
    对话 3

对话
  旧项目画布 / 迁移桶画布
    起点 4
    起点 5
  无项目对话 6
    起点 7
```

项目代表用户主动选择的本地文件夹，下面可以包含多条 conversation 链路。旧 `Projects/*.md` 默认成为无项目对话里的完整画布，迁移桶与历史项目不反向伪装成新 Project。对话本身就是共享画布 / 对话组；画布里的 root 起点才是可选择的单独对话入口。

如果同一个 conversation 画布里存在多个独立 root 对话树，P1 列表可展开该 conversation，列出这些起点；用户点击起点后进入同一个共享画布并选中对应 root。

点击 conversation：

- 选中 `selectedConversationId`。
- 自动选中该 conversation 的 `rootAtomId`。
- 切换到 chat 模式。
- P2 BranchTree 只渲染该 conversation 的 `atomIds`。

创建边界：

- 对话列表保留在 P1，不进入 P2 / P3。
- P2 不渲染 conversation list，始终是 BranchTree 画布或画布空态。
- 新建对话后生成 draft conversation，用户发送第一轮 QA 后转为 active。
- 顶部“新建对话”默认写 `projectId: null`；项目创建必须先选择本地文件夹。

### BranchTree

BranchTree 的过滤条件从 `selectedProject.atomIds` 改为：

```text
selectedConversation.atomIds
```

如果没有选中 conversation：

- 显示无限画布背景与“从左侧选择对话”的空态。
- 不再把整个项目的所有 atom 混成一棵大树。

### P3

P3 不重做。沿用 `selectedAtomId -> currentPath`：

- 点击 QA 节点后，仍显示 root -> 当前节点线性历史。
- `currentPath` 只在当前 conversation 的 atom 集合内计算。
- streaming 新 atom 追加时，同步追加到当前 conversation 的 `atomIds`。

### P4

P4 本版本只做只读补充：

- 当前 atom 元信息保持。
- 如果已选中 conversation，显示 conversation title / source / cwd / session id 等只读元信息。

## 外部导入承载

本版本不重写导入器，但必须让后续导入器能表达：

| 外部来源 | 映射 |
|---|---|
| Codex thread | 一个 Conversation |
| Claude jsonl session | 一个 Conversation |
| Codex cwd / Claude project folder | 用于后续推断或匹配 folder-bound `projectId` |
| 无法推断项目 | `projectId: null`，进入 Unprojected |
| 每轮 user + assistant | 仍写 QAAtom |

禁止的产品结构：

- `迁移-Codex` 作为所有 Codex 会话的大项目。
- `迁移-Claude` 作为所有 Claude 会话的大项目。
- 用来源平台替代用户真实项目归属。

## 非范围

- 不执行现有已导入 atom 的批量重挂。
- 不清理历史“迁移-Codex / 迁移-Claude”类项目。
- 不重新设计 QA atom 内容格式。
- 不实现复杂自动分类算法。
- 不实现完整 Codex / Claude 导入器重写。
- 不新增多用户、账号同步、云端项目管理。
- 不把 Codex / Claude 做成产品内置 Agent 列表。

## 与后续版本关系

| 后续项 | 关系 |
|---|---|
| req-065 task cwd 选择器 | v0.16.2 后，cwd 可作为 conversation / task 上下文自然承接 |
| 外部导入器 | 后续可写入 ConversationMeta，而不是把会话压成 root atom 列表 |
| AgentOS 协调层 | Conversation 是用户命令上下文的一层显化，但本版不扩展协议产品化 |

## 验收标准

### 数据层

- [x] 存在显式 `ConversationMeta` 类型与 store 状态。
- [x] 新 conversation 可持久化到 Vault conversation 索引。
- [x] 新 Project 必须绑定本地 `folderPath`。
- [x] Project 可通过 `conversationIds` 关联 conversations。
- [x] 旧 `atomIds` / `## 对话索引` 项目文件仍可读取。
- [x] 旧项目索引可解释为无项目对话下的完整 legacy canvas conversation。
- [x] 未索引 root atoms 可合并解释为无项目 legacy canvas conversation。

### UI 层

- [x] 项目下展示 conversation 列表，而不是直接展示全部 QA atom。
- [x] 旧项目 / 迁移桶在“对话”下作为完整画布出现。
- [x] 存在“无项目对话”入口。
- [x] 多 root conversation 可在列表中展开并选择具体起点。
- [x] 点击 conversation 后，BranchTree 只渲染该 conversation 的 QA 树。
- [x] 点击 QA 节点后，P3 仍展示 root -> 当前节点的线性历史。
- [x] 空标题、重复标题、“新对话”标题在 UI 中可区分。

### 运行路径

- [x] 新建对话时会创建 draft ConversationMeta：`rootAtomId: null`、`atomIds: []`、`status: 'draft'`。
- [x] 发送第一轮 QA 时写入 rootAtomId 与 atomIds，并将 conversation 转为 `status: 'active'`。
- [x] 分叉 / 继续对话时，新 atom 追加到当前 conversation。
- [x] 无项目对话可以创建、选择、继续发送。
- [x] ConversationMeta 可持久化并回读外部来源元信息：`sourcePlatform`、`sourceSessionId`、`sourcePath`、`sourceCwd`。
- [x] P1 承载 conversation 列表，P2 不替代无限画布。
- [x] 新建对话可创建 draft conversation。
- [x] P4 可只读展示当前 conversation 的 title / source / cwd / session id。

### 兼容性

- [x] 老 Vault 不需要迁移也能打开。
- [x] 老项目文件中的多个 root atom 仍能在同一个无项目对话画布中出现。
- [x] 当 QA / Projects 为同一父目录下的绝对路径时，默认 Conversations 路径跟随到同一父目录。
- [x] 旧 BranchTree 路径计算不因 conversation 过滤断链。

## 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| 旧 Vault 读取回归 | 高 | legacy atomIds 读取必须优先测试；不做破坏性迁移 |
| 侧栏层级拥挤 | 中 | 对话列表收敛在 P1，P2 保留画布职责 |
| streaming atom 没写入 conversation | 高 | `useChatSend` / dispatcher 完成标准必须覆盖发送、分叉、落盘三处 |
| 标题重复导致误选 | 中 | 保留原始标题，追加时间 / 来源辅助信息 |
| 范围扩到导入器重写 | 高 | product/technical 均把导入器重写列为非范围 |

## 状态账收口

v0.16.2 实现收口时同步完成一项版本账清理：

- `req-066` 已随 v0.16.1 发布完成，本次把 requirements 状态从 `confirmed` 校准为 `done`。
- `requirements/README.md` 当前显示：`confirmed=1`、`planned=0`、`in-progress=0`、`done=56`。
- 剩余 confirmed 项仅为 v0.17 的 req-065。

## 修订记录

| doc_revision | 日期 | 作者 | 变化 |
|---|---|---|---|
| 1 | 2026-07-09 | workbench-ceo | 初稿：纳入 req-067，定义 Conversation 层、兼容策略、UI 边界与非范围 |
| 2 | 2026-07-09 | workbench-ceo | review-agent 修复：明确 draft conversation、外部来源元信息验收、P2 返回与空态创建边界 |
| 3 | 2026-07-09 | workbench-ceo | review-agent 第二轮通过后修正 active conversation 示例状态，并标记 product.md 通过 |
| 4 | 2026-07-09 | workbench-ceo | 实现收口：标记 req-067 验收完成 |
| 5 | 2026-07-09 | workbench-ceo | 状态账收口：记录 req-066 校准为 done 与 v0.16.2 完成后的需求看板状态 |
| 6 | 2026-07-09 | workbench-ceo | 根据验收反馈校准 UI：P1 承载对话列表，P2 保留无限画布；旧 root atom 默认归无项目对话 |
| 7 | 2026-07-09 | workbench-ceo | 根据项目定义决策校准：新 Project 绑定本地文件夹，旧 Projects 进入对话组，默认 Conversations 路径跟随旧知识库父目录 |
| 8 | 2026-07-09 | workbench-ceo | 根据旧无限画布理念校准：旧项目 / 迁移桶多个 root 保持为一个完整 legacy canvas conversation，拆分由用户选择 |
| 9 | 2026-07-09 | workbench-ceo | 根据对话组语义校准：顶层只保留项目下的对话 / 无项目对话；Conversation 本身即共享画布，对话组不再是顶层分类 |
| 10 | 2026-07-09 | workbench-ceo | 根据多 root 画布查找需求校准：conversation 行可展开显示 root 起点，点击起点进入同一画布对应树 |
