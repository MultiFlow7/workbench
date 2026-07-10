---
id: req-067
title: 项目-对话-QA 树三层结构
status: done
priority: high
source: 2026-07-09 · 本地 Codex / Claude 对话迁移验证后，用户明确期望保持源平台的项目归属与对话层级，而不是按来源平台汇总到大项目
created: 2026-07-09
version: v0.16.2
---

# req-067 · 项目-对话-QA 树三层结构

## 背景

工作台当前数据结构主要是：

```text
Project -> atomIds[] -> QAAtom(prev / children)
```

也就是项目直接挂 QA atom；“对话”只由 `prev === null` 的根 atom 隐式表达。这个模型在早期四面板 / 分支树场景中可用，但在导入 Codex / Claude 等外部对话历史时暴露出结构问题：

- 来源平台中的“项目 / 工作目录 / project folder”无法自然映射到工作台项目。
- 一个项目下的多条独立对话会混成一大批 atom。
- 如果按来源平台建立 `迁移-Codex` / `迁移-Claude` 这类项目，会丢失用户真正关心的项目归属。
- 多个名为“新对话”的源会话需要保留为独立对话，而不是被压扁成项目或 atom 列表。

用户期望的信息架构是：

```text
项目（用户主动选择的本地文件夹）
  -> 对话
      -> QA 树

无项目对话
  -> 对话
      -> QA 树
```

因此需要把“对话 / 会话”从隐式 root atom 概念提升为正式结构层。

## 目标

引入显式 Conversation / Session 层，让工作台支持三层组织结构：

```text
Project / Unprojected
  -> Conversation（共享画布 / 对话组）
      -> 起点（root，可作为单独对话入口选择）
      -> QAAtom tree
```

完成后：

- 项目下展示对话列表，而不是直接展示全部 QA atom。
- Project 必须是用户主动选择的本地文件夹；旧 `Projects/*.md` 不再等同于新 Project。
- 旧项目文件默认进入无项目对话；它们本身作为一个共享画布 conversation 保留历史导入和旧 Vault 的分组语义。
- 同一个 conversation 画布内如有多个独立 root 对话树，侧栏可以展开该 conversation 找到各个起点。
- 点击某个对话后，只显示该对话自己的 QA 树。
- 无法归属到项目的对话进入“无项目对话”入口。
- QA atom 继续作为最小内容单元，沿用 `prev / children` 表达树结构。
- Codex / Claude 等外部来源可以在后续导入时保持原有项目归属、对话标题和会话边界。

## 概念定义

| 概念 | 定义 |
|---|---|
| Project | 用户主动选择本地文件夹后创建的项目容器，语义接近 Codex 的项目 / 工作目录。 |
| Conversation | 一个共享画布 / 对话组；Project 下或无项目下的一条 conversation 可以包含多个 root 起点。 |
| Start Point | Conversation 画布中的 root 起点，可作为单独对话入口被用户选择。 |
| QAAtom | 一轮用户问题 + AI 回答，仍是最小内容单元。 |
| Unprojected | 无法可靠归属到具体 Project 的对话集合，不等同于一个真实项目。 |

## 数据模型需求

新增或显式化 `ConversationMeta`：

```ts
interface ConversationMeta {
  id: string
  title: string
  projectId: string | null
  groupId?: string | null
  rootAtomId: string
  atomIds: string[]
  createdAt: string
  updatedAt: string
  sourcePlatform?: 'workbench' | 'codex' | 'claude'
  sourceSessionId?: string
  sourcePath?: string
  sourceCwd?: string
}
```

调整 `ProjectMeta` 的主关系，使项目挂 conversation，而不是直接挂全部 atom：

```ts
interface ProjectMeta {
  id: string
  name: string
  folderPath: string
  conversationIds: string[]
  createdAt: string
}
```

兼容要求：

- 旧项目文件中的 `atomIds` / `## 对话索引` 读取逻辑必须保留。
- 旧项目文件可被解释为无项目下的一个完整 legacy canvas conversation；其中多个 root 先保持在同一画布里，不能因为模型升级导致现有 Vault 失效。
- `QAAtomMeta` 的 `prev / children` 语义保持不变。

## 存储建议

在 Vault 中新增 conversation 索引目录，例如：

```text
Conversations/
  conversation-id.md
```

conversation 文件记录对话级元信息与 QA 索引：

```yaml
---
id: conv-xxx
title: xxx
projectId: proj-xxx # 或 null
rootAtomId: 7291-001-...
sourcePlatform: codex
sourceSessionId: ...
createdAt: ...
updatedAt: ...
---

## QA 索引

- [[7291-001-...]]
- [[7291-002-...]]
```

具体文件格式可在 technical.md 阶段定稿，但必须满足：

- 可读、可手工修复。
- 能从 `ConversationMeta` 还原对话列表。
- 能从 `rootAtomId` / `atomIds` 还原 QA 树。
- 不破坏现有 atom Markdown 格式。

## UI / 交互需求

P1 / NavList 与 P2 / BranchTree 需要支持从“项目直接显示 atom 树”调整为“侧栏选对话，画布看树”的结构：

```text
项目
  项目 A
    对话 1
    对话 2
  项目 B
    对话 3

无项目对话
  旧项目画布 / 迁移桶画布
    起点 4
    起点 5
  无项目对话
    起点 6
    起点 7
```

点击某个对话后：

- P1 保持对话列表；P2 显示该对话对应的 QA 树。
- P3 展示选中 QA 节点从 root 到当前节点的线性历史。
- P4 可显示当前 atom 与 conversation 的只读元信息。

标题规则：

- 对话标题优先使用 `ConversationMeta.title`。
- 空标题、重复标题或源平台默认“新对话”不应被丢弃。
- UI 可附加来源、项目名或时间辅助区分，例如 `新对话 · 2026-07-09 10:59`。

## 外部导入承载需求

本需求只要求产品结构能承载外部对话导入，不要求在本需求内完成历史数据整理。

后续导入器应能基于新结构做到：

- Codex thread -> 一个 Conversation。
- Claude jsonl session -> 一个 Conversation。
- Codex `cwd` / Claude project folder 可用于推断 `projectId`。
- 无法可靠推断项目的对话进入 `projectId: null`。
- 每轮 user + assistant final answer 仍写为 QA atom。

## 不纳入范围

- 不在本需求内执行现有已导入 atom 的批量重挂、清理或重排。
- 不在本需求内重新设计 QA atom 内容格式。
- 不在本需求内引入多用户、账号同步或云端项目管理。
- 不在本需求内实现复杂自动分类算法；项目归属推断先以可解释规则为准。
- 不把 Codex / Claude 作为产品内置 Agent 列表；它们只是外部来源平台。

## 验收标准

- [x] 工作台存在显式 Conversation / Session 层。
- [x] Project 与旧项目文件定义分离：新 Project 绑定本地文件夹，旧 `Projects/*.md` 进入无项目对话。
- [x] Project 下可展示 conversation 列表，而不是只展示 atom 列表。
- [x] 无项目对话可展示旧项目 / 迁移桶对应的完整 legacy canvas conversation。
- [x] 多 root 画布可在列表中展开，选择具体起点进入。
- [x] 存在“无项目对话”入口，展示 `projectId: null` 的 conversations。
- [x] 点击 conversation 后，BranchTree 只渲染该 conversation 的 QA 树。
- [x] 点击 QA 节点后，P3 仍按现有路径逻辑展示 root -> 当前节点的线性历史。
- [x] 旧 Vault 中仅有 atom / project 索引的数据仍可读取。
- [x] 对话标题支持空标题、重复标题和“新对话”来源标题的可区分展示。
- [x] 新结构能表达外部来源元信息：`sourcePlatform`、`sourceSessionId`、`sourcePath`、`sourceCwd`。
- [x] 不出现把所有外部来源会话汇总到 `迁移-Codex` / `迁移-Claude` 这类大项目的产品结构要求。

## 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 模型迁移影响旧数据 | Project 从 atomIds 转为 conversationIds，可能影响老 Vault | 保留 legacy 读取；必要时自动生成 legacy conversation 视图 |
| UI 层级变复杂 | 侧栏同时承担项目空间与对话列表可能拥挤 | P1 承载列表，P2 保留无限画布职责 |
| 标题质量参差 | 源平台大量“新对话”或空标题 | 保留原始标题，并追加时间 / 来源辅助信息 |
| 项目归属推断错误 | Codex cwd / Claude project folder 不一定等于工作台项目 | 先做可解释规则，允许用户后续手工改归属 |
| 范围外溢 | 容易把历史数据整理、自动分类、导入器重写全部塞进本需求 | 本需求只做结构承载，历史整理另行处理 |

## 关联

- 关联旧需求：req-035 NavList 对话与项目数据分离展示
- 关联旧需求：req-037 对话根节点结构重构
- 关联实现：`QAAtomMeta`、`ProjectMeta`、`conversationSlice`、`NavList`、`BranchTree`、`ChatViewV2`
