---
version: v0.16.2
codename: Conversation Hierarchy
status: done
doc_revision: 10
created: 2026-07-09
review_state: 通过
project: 工作台
draft_owner: workbench-ceo
pending_owners: []
---

# 技术执行文档 · v0.16.2 · Conversation Hierarchy

关联产品规划：[[changelog/v0.16.2/product]]
关联需求：[[requirements/req-067-project-conversation-qa-hierarchy]]

## 技术目标

把当前隐式结构：

```text
Project -> atomIds[] -> QAAtom(prev / children)
```

升级为显式结构：

```text
Project / Unprojected -> ConversationMeta(Canvas Group) -> Start Point(root) -> QAAtom(prev / children)
```

本版本不改 QA atom 文件格式，不批量迁移旧 Vault，不重写外部导入器。实现必须保持老数据可读，并让新写入路径开始产生 conversation 索引。

## 当前代码事实

| 层 | 当前事实 |
|---|---|
| IPC | `electron/ipc/handlers.ts` 已有 `list_qa_atoms`、`read_qa_atom`、`write_qa_atom`、`list_projects`、`create_project`、`add_atom_to_project` |
| Project 文件 | `Projects/{name}.md` frontmatter + `## 对话索引`，索引里是 atom wikilinks |
| QA 文件 | `QA/{atomId}.md`，frontmatter 持有 `prev / children / timestamp / model / usage`，正文为 `## Q` / `## A` / Steps 等 |
| Store | `conversationSlice.ts` 持有 `atoms`、`projects`、`selectedProjectId`、`selectedAtomId`、`currentPath` |
| P1 / Nav | `NavList.tsx` 用 selected project 的 root atoms 伪装为对话列表 |
| BranchTree | `BranchTree.tsx` 用 `selectedProject.atomIds` 过滤整棵树 |
| P3 | `ChatViewV2` 通过 `selectedAtomId -> currentPath -> atomEntries` 渲染线性历史 |
| 发送 | `useChatSend.ts` 新建 root atom 后调用 `addAtomToProject(projectName, atomId)` |

## 边界扫描

| 边界类型 | v0.16.2 是否引入 | 说明 |
|---|---|---|
| 新文件格式 | 是 | 新增 `Conversations/{conversationId}.md` 索引文件 |
| QA atom 格式变化 | 否 | 不改 atom frontmatter 与正文结构 |
| 破坏性迁移 | 否 | 老 Project atom index 继续读取，作为无项目 conversation 生成完整 legacy canvas conversation |
| 新外部依赖 | 否 | 继续用现有 Electron IPC、React、Zustand、Node fs |
| 新产品能力 | 有限 | 新增 Conversation 结构层和 UI 选择，不引入导入器重写 |
| Agent Team 产品化 | 否 | Codex / Claude 仅作为 sourcePlatform 元数据 |

## 数据模型

### ConversationMeta

```ts
export interface ConversationMeta {
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
  legacy?: boolean
}
```

### ProjectMeta

```ts
export interface ProjectMeta {
  id: string
  name: string
  rootBranchId: string
  createdAt: string
  folderPath?: string
  conversationIds: string[]
  atomIds: string[]
}

export interface ConversationGroupMeta {
  id: string
  name: string
  createdAt: string
  conversationIds: string[]
  legacyAtomIds?: string[]
  atomIds: string[]
}
```

### 选择状态

`conversationSlice` 新增：

```ts
conversations: Record<string, ConversationMeta>
conversationGroups: ConversationGroupMeta[]
selectedConversationId: string | null
conversationPanelMode: 'list' | 'tree'
```

规则：

- P1 的项目行只展示带 `folderPath` 的 Project；点击项目行展开 / 收起该项目下的 conversation list。
- P1 不渲染顶层“对话组”；旧 `Projects/*.md` 生成的完整 legacy canvas conversation 进入无项目对话列表。
- P1 conversation 行可展开 root 起点列表；点击起点时先选中 conversation，再选中对应 root atom。
- 顶部新建对话默认创建 `projectId: null` 的无项目 draft conversation。
- 选择 active conversation：设置 `selectedConversationId`，进入 tree 模式，选中 `rootAtomId`。
- 选择 draft conversation：设置 `selectedConversationId`，进入 tree 模式，但 `selectedAtomId = null`，P3 保持可输入空态。

## 存储格式

### Conversation 文件

路径：`<vaultRoot>/Conversations/{conversationId}.md`

active 示例：

```yaml
---
id: conv-xxx
title: 新对话
projectId: proj-xxx
groupId: null
rootAtomId: 0001-001-20260709-120000
status: active
sourcePlatform: workbench
createdAt: 2026-07-09T12:00:00.000Z
updatedAt: 2026-07-09T12:02:00.000Z
---

## QA 索引

- [[0001-001-20260709-120000]]
```

draft 示例：

```yaml
---
id: conv-xxx
title: 新对话
projectId: null
groupId: null
rootAtomId: null
status: draft
sourcePlatform: workbench
createdAt: 2026-07-09T12:00:00.000Z
updatedAt: 2026-07-09T12:00:00.000Z
---

## QA 索引
```

持久化约定：

- 可选 `source*` 字段为空时不写入，读取时为 `undefined`。
- YAML `null` 仅用于 `projectId` / `groupId` / `rootAtomId`。
- `atomIds` 从 `## QA 索引` wikilinks 解析，不在 frontmatter 重复写数组。

### Project 文件兼容

新项目文件继续保留 `## 对话索引` 标题，但新写入内容改为 conversation wikilinks：

```markdown
---
id: proj-xxx
name: Project Name
folderPath: "/absolute/project/folder"
type: project
---

## 对话索引

- [[conv-xxx]]
```

读取兼容规则：

- 只有 frontmatter 含 `folderPath` 的文件进入 `projects`。
- 没有 `folderPath` 的旧 `Projects/*.md` 进入内部 `conversationGroups` 来源集合，但 UI 中显示为无项目 conversations。
- 如果索引项以 `conv-` 开头，视为 conversation id。
- 否则视为 legacy atom id，写入 `legacyAtomIds`，并按旧画布整体生成 `projectId: null`、`groupId: group.id` 的 legacy canvas conversation。
- 本版本保留 `atomIds` 字段等于 legacy atom ids，避免旧组件在改造中断裂；最终 UI 只消费 conversation。
- 同一个 folder-bound Project 允许同时存在 conversation id 与 legacy atom id；新写入只追加 conversation id。
- `create_conversation` 负责在写 Conversation 文件后同步把 conversation id 写入 Project 索引；store 不再连续调用 `create_conversation` + `add_conversation_to_project`，避免半成功状态。

## 实施阶段

### Phase 1 · IPC / 存储层

- [x] **节点 1.1**：新增 vault conversation 路径派生
  - `workbench/electron/store/vaultStore.ts` 增加 `conversationsSubdir: 'Conversations'`。
  - `workbench/src/types/vault.ts`、`vaultSlice.ts`、`utils/paths.ts` 增加 conversations path hook / getter。
  - `vaultBootstrap.ts` 首启时创建 `Conversations` 子目录。
  - 当 QA / Projects 是同一父目录下的绝对路径且 conversationsSubdir 保持默认值时，Conversations 跟随创建 / 读取到同一父目录。

- [x] **节点 1.2**：新增 conversation IPC
  - `list_conversations({ conversationsDir, projectsDir })`
  - `create_conversation({ conversationsDir, projectsDir, title, projectId })`
  - `update_conversation({ conversationsDir, conversation })`
  - `add_atom_to_conversation({ conversationsDir, conversationId, atomId, rootAtomId? })`
  - 所有写入使用 tmp + rename 原子写。

- [x] **节点 1.3**：扩展 project IPC 兼容读取
  - `list_projects` 返回 `conversationIds`、`legacyAtomIds`、`atomIds`。
  - `create_project` 必须接收 `folderPath`，返回 folder-bound ProjectMeta。
  - 新增 `add_conversation_to_project({ projectsDir, projectId, conversationId })`。
  - 保留 `add_atom_to_project` 作为 legacy 兼容，不再由新发送路径调用。

- [x] **节点 1.4**：preload / window 类型补齐
  - 因项目仍大量用 `window.api.invoke`，不强制增加便捷方法。
  - `window.d.ts` 至少补充新增 channel 返回类型需要的 TS 接口，避免测试 mock 漂移。

### Phase 2 · Store / 状态层

- [x] **节点 2.1**：扩展 `conversationSlice.ts`
  - 增加 `ConversationMeta` 类型。
  - 增加 `ConversationGroupMeta` 类型。
  - 增加 `conversations`、`selectedConversationId`、`conversationPanelMode`。
  - 增加 actions：`loadConversations`、`createConversation`、`selectConversation`、`returnToConversationList`、`addAtomToConversation`。

- [x] **节点 2.2**：legacy canvas conversation 视图
  - 加载 projects + atoms 后，为每个旧 `Projects/*.md` / 迁移桶生成一个只读 legacy canvas conversation。
  - legacy group id 使用 `legacy-group-${group.id}`。
  - 旧 Project 索引默认生成 `projectId: null`、内部 `groupId: group.id` 来源标记的无项目 legacy canvas conversation；多个 root 保持在同一画布。
  - 未被索引的 root atom 合并生成一个 `projectId: null`、无 `groupId` 的“无项目旧画布”。
  - legacy conversation 不写回文件，除非用户后续继续发送，本版本允许继续发送时转正为真实 conversation。
  - 转正规则：
    1. 发送前创建真实 Conversation 文件，id 使用新 `conv-` id，`rootAtomId` 指向 legacy canvas 的首个 root atom。
    2. `atomIds` 初始包含该 legacy canvas 的全部 atom，而不是只包含当前 path。
    3. 如用户在某个 Project 空间中继续发送，Project 索引追加 `[[conv-xxx]]`；无项目 legacy 转正则不回写 Project。
    4. 重新加载时若已有真实 conversation 的 `rootAtomId` 覆盖该 legacy canvas 的首个 root，则不再生成该 legacy conversation，避免重复。
    5. 新 atom 追加到真实 conversation，不再追加到 Project legacy atom index。

- [x] **节点 2.3**：选择状态约束
  - 选择 project 不再直接混合展示 project atoms。
  - 选择 active conversation 后，`currentPath` 从 root atom 建立。
  - 选择 draft conversation 时，`currentPath=[]` 且输入框可用。

- [x] **节点 2.4**：conversation 内 path 隔离
  - `selectAtom(id)` 必须只在当前 selected conversation 的 `atomIds` 集合内回溯。
  - 若 `prev` 指向 conversation 外 atom，回溯在当前 atom 处停止，并把当前 atom 当作孤儿 path 起点。
  - UI 未选 conversation 时不提供 QA 节点入口；底层 `selectAtom` 在无 selected conversation 时保留 legacy 全局 path 计算，用于兼容旧测试与旧调用方。
  - legacy conversation 的 allowed set 来自其生成时的完整 canvas atomIds。

### Phase 3 · 发送链路

- [x] **节点 3.1**：`ChatInputV2` 上下文禁用条件改造
  - 允许在 selected draft conversation 下发送。
  - 无 selected project 但 selected unprojected conversation 时也可发送。
  - 无 project 且无 conversation 时仍禁用。

- [x] **节点 3.2**：`useChatSend` 写入 conversation
  - root atom 创建来源从 `selectedProjectId` 改为 `selectedConversationId`。
  - 第一轮 QA：填入 conversation rootAtomId、atomIds，并将 draft 转 active。
  - 后续 QA / 分叉：追加 atom 到 conversation atomIds。
  - 对 legacy conversation 继续发送前，先按节点 2.2 转正，再以真实 conversation 写入。
  - 不再调用 `addAtomToProject`；新路径通过 project.conversationIds 关联。

- [x] **节点 3.3**：dispatcher 落盘后 revision 仍有效
  - 保持 `bumpAtomDiskRevision` 触发 P3 重读。
  - conversation atomIds 在 placeholder 阶段先写，result 覆盖 atom 文件时不重复追加。

### Phase 4 · UI

- [x] **节点 4.1**：P1 conversation list
  - `NavList.tsx` 的对话列表从 root atoms 改为 conversations。
  - 项目区只展示 folder-bound projects。
  - 旧 `Projects/*.md` 与迁移桶展示为“对话”下的无项目 conversations。
  - 保留“无项目对话”入口，不再渲染顶层“对话组”入口。
  - 多 root conversation 行可展开显示 root 起点，并可直接选中起点进入同一画布。
  - 增加对话空态与“新建对话”操作。
  - 标题显示规则：title 为空或重复时追加时间 / 来源辅助。

- [x] **节点 4.2**：P2 保持无限画布
  - P2 不渲染 conversation list，不提供返回列表按钮。
  - 未选 conversation 时显示无限画布背景与“从左侧选择对话”的空态。
  - draft conversation tree 空态提示可在 P3 输入第一条消息。

- [x] **节点 4.3**：BranchTree 过滤
  - 从 `selectedProject.atomIds` 改为 `selectedConversation.atomIds`。
  - draft conversation 显示空态。
  - 未选 conversation 时不显示整个项目混合树。

- [x] **节点 4.4**：P4 conversation 元信息
  - DetailPanel 显示当前 conversation title / sourcePlatform / sourceCwd / sourceSessionId。
  - 无 atom 但选中 draft conversation 时，P4 显示 conversation 元信息而不是“选择节点”。

### Phase 5 · 测试与验证

- [x] **节点 5.1**：IPC / 存储验证
  - conversation IPC 与 project 混合索引路径通过全量测试、类型检查和构建验证。
  - project / group `conversationIds` 归属、legacy atom index、`folderPath: null` 兼容在 store 单元测试中覆盖。
  - add atom to conversation 去重由现有写入逻辑与全量回归覆盖；本版不新增独立 IPC 专项测试文件。

- [x] **节点 5.2**：store 单元测试
  - select project -> list mode。
  - select active conversation -> tree mode + root selected。
  - select draft conversation -> no atom selected + input allowed。
  - 旧项目 / 迁移桶多个 root 保持为一个 legacy canvas conversation。
  - conversation 外 `prev` 不进入 P3 currentPath。
  - legacy conversation 转正后 reload 不重复出现、不丢原 canvas atomIds。

- [x] **节点 5.3**：UI / hook 测试
  - ChatInput disabled 条件覆盖 draft / unprojected conversation。
  - BranchTree 只渲染 selected conversation atomIds。
  - DetailPanel 可显示 conversation 元信息。
  - sourcePlatform / sourceSessionId / sourcePath / sourceCwd 可持久化回读并展示。

- [x] **节点 5.4**：全量验证
  - `cd workbench && pnpm test`
  - `cd workbench && pnpm exec tsc --noEmit --pretty false`
  - `cd workbench && pnpm build`
  - `cd workbench && pnpm privacy:scan`

## 文件影响范围

### 预期修改

- `workbench/electron/ipc/handlers.ts`
- `workbench/electron/store/vaultStore.ts`
- `workbench/electron/main/vaultBootstrap.ts`
- `workbench/electron/preload/index.ts`
- `workbench/src/types/window.d.ts`
- `workbench/src/types/vault.ts`
- `workbench/src/store/vaultSlice.ts`
- `workbench/src/utils/paths.ts`
- `workbench/src/store/conversationSlice.ts`
- `workbench/src/hooks/useChatSend.ts`
- `workbench/src/components/NavList/NavList.tsx`
- `workbench/src/components/NavList/NavList.css`
- `workbench/src/components/BranchTree/BranchTree.tsx`
- `workbench/src/components/DetailPanel/DetailPanel.tsx`
- 相关测试文件

### 禁止范围

- 不修改 QA atom Markdown 主格式。
- 不批量迁移用户 Vault 文件。
- 不实现 Codex / Claude 导入器重写。
- 不改 Agent Runtime / Agent Team 项目边界。
- 不引入新的外部运行依赖。

## 回滚策略

如果实现中发现 conversation 写入影响旧 Vault：

1. 保留读取兼容逻辑。
2. 暂停新写入 conversation 文件。
3. 回退 UI 到 legacy root atom conversation list。
4. 不删除用户已生成的 QA atom 文件。

## 验收矩阵

| 场景 | 预期 |
|---|---|
| 老 Vault 只有 Project atomIds | P1 的“对话”分组显示一个完整 legacy canvas conversation |
| 老 Vault 只有未索引 root atom | P1 的“对话”分组显示一个“无项目旧画布” legacy canvas conversation |
| 新建项目 | 必须选择本地文件夹，Project 文件记录 `folderPath` |
| 新建项目后新建对话 | Project 文件可记录 conversation id，Conversation 文件 status=draft |
| draft conversation 发送第一条消息 | 写 root atom，Conversation 转 active，P3 显示该 QA |
| active conversation 继续发送 | 新 atom 追加到 Conversation atomIds，BranchTree 只显示该 conversation |
| 无项目新建对话 | Conversation projectId=null，出现在无项目对话入口 |
| 选择项目 A 后 | 不显示项目 B 的 conversations |
| 未选择 conversation | P2 保留无限画布背景并提示从左侧选择 |
| 多 root conversation | P1 可展开 conversation 行，点击起点后 P2 仍显示同一画布并选中该 root |
| 重启后加载 | projects / conversations / atoms 可恢复同一结构 |
| conversation 外 prev | P3 path 在边界处停止，不混入外部 atom |
| legacy conversation 转正后重启 | 只显示真实 conversation，不重复显示 legacy 副本，并保留原 canvas atomIds |
| source 元信息回读 | `sourcePlatform/sourceSessionId/sourcePath/sourceCwd` 与写入一致 |
| 混合项目索引 | folder-bound Project 同时含 `[[conv-xxx]]` 与旧 atom wikilink 时都可读，新写入只追加 conversation id |

## 修订记录

| doc_revision | 日期 | 作者 | 变化 |
|---|---|---|---|
| 1 | 2026-07-09 | workbench-ceo | 初稿：拆分存储、状态、发送、UI、测试五阶段 |
| 2 | 2026-07-09 | workbench-ceo | review-agent 修复：补 conversation path 隔离、legacy 转正规则、混合索引与验证矩阵 |
| 3 | 2026-07-09 | workbench-ceo | review-agent 第二轮通过，标记 technical.md 通过 |
| 4 | 2026-07-09 | workbench-ceo | 实现收口：节点全部完成，并校准无 selected conversation 时的 legacy path 兼容行为 |
| 5 | 2026-07-09 | workbench-ceo | 验收反馈修正：P1 承载 conversation list，P2 保持无限画布；legacy root atom 默认归无项目对话 |
| 6 | 2026-07-09 | workbench-ceo | 根据项目定义决策校准：folder-bound Project 与旧 Projects 对话组分离，补 groupId 与 Conversations sibling 路径规则 |
| 7 | 2026-07-09 | workbench-ceo | 第二轮 review 收口：校准 IPC 测试账口径，确认 conversationIds 归属与 folderPath null 兼容由 store 测试覆盖 |
| 8 | 2026-07-09 | workbench-ceo | 根据旧无限画布理念校准：legacy group / unprojected 多 root 保持为完整 canvas conversation，拆分由用户选择 |
| 9 | 2026-07-09 | workbench-ceo | 根据对话组语义校准：conversationGroups 退为内部来源集合，P1 只渲染项目下的对话 / 无项目对话 |
| 10 | 2026-07-09 | workbench-ceo | 根据多 root 画布查找需求校准：NavList conversation 行展开 root 起点，起点选择复用同一 conversation canvas |
