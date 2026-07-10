---
version: v0.17
codename: Conversation Relay MVP
status: draft
doc_revision: 2
created: 2026-07-10
review_state: 已审查
project: 工作台
draft_owner: workbench-ceo
tags:
  - 类型/技术规划
  - 主题/技术/工作台
  - 状态/草案
---

# 技术规划 · v0.17 · Conversation Relay MVP

## 技术目标

v0.17 实现一个最小闭环：

```text
Codex rollout jsonl
  -> CodexSessionReader
  -> Conversation + QAAtom
  -> Conversation Source UI
  -> Handoff Packet Markdown
```

本版本只读外部 Codex session，不写入 Codex 内部数据，不做 Claude 读取，不定义 Agent-Agent 正式模型。

## 当前代码基础

| 模块 | 现状 | v0.17 增量 |
|---|---|---|
| `ConversationMeta` | 已有 `sourcePlatform/sourceSessionId/sourcePath/sourceCwd` | 增加 `sourceTitle/readAt/unmappedEventCount` 等可选字段 |
| `DetailPanel` | 已能展示 Conversation 来源基础字段 | 补充读取时间、可追溯状态、未建模事件计数 |
| `QAAtomMeta` | 尚未包含 source 字段 | 增加 atom 级 source metadata |
| `read_qa_atom` | 解析 id/prev/children/timestamp/token | 解析 `source_*` snake_case 字段 |
| `write_qa_atom` | 写入基础 frontmatter | 写入 source metadata |
| `atomParser` | renderer 端 mini frontmatter 只暴露基础字段 | 如 UI 需要 raw source，可同步扩展 |
| `Conversation` IPC | 已有 create/update/list/add atom | 增加 Codex 读取与 Handoff 生成 IPC |

## 数据模型

### QAAtomMeta 扩展

```ts
interface QAAtomMeta {
  source_platform?: 'workbench' | 'codex' | 'claude'
  source_session_id?: string
  source_session_hash?: string
  source_path_display?: string
  source_path_hash?: string
  source_cwd_display?: string
  source_cwd_hash?: string
  source_title?: string
  source_key?: string
  source_event_type?: string
  unmapped_source_events?: SourceEventMarker[]
}
```

保留 snake_case 是为了兼容现有 QA markdown frontmatter；renderer 层可后续再决定是否映射成 camelCase。

### ConversationMeta 扩展

```ts
interface ConversationMeta {
  sourceTitle?: string
  readAt?: string
  readCheckpoint?: string
  readRecordId?: string
  unmappedEventCount?: number
  relayStatus?: 'readable' | 'partial' | 'unmapped'
}
```

### SourceEventMarker

```ts
type SourceEventMarkerType =
  | 'agent_execution_candidate'
  | 'agent_agent_candidate'
  | 'tool_trace_candidate'
  | 'unmapped_source_event'

interface SourceEventMarker {
  type: SourceEventMarkerType
  sourceKey: string
  timestamp?: string
  reason: string
}
```

## 新增模块

### 1. `workbench/electron/relay/codexSessionReader.ts`

职责：

- 根据 session id 查找 `$HOME/.codex/sessions/**/{session-id}.jsonl`；
- 或按显式文件路径读取；
- 解析 `session_meta`；
- 读取 `response_item` 中的 user / assistant message；
- 跳过重复的 `event_msg` echo；
- 生成 normalized turns；
- 生成未映射事件标记。

权限与边界：

- session id 模式只允许读取 `$HOME/.codex/sessions/**/*.jsonl` 下的真实文件路径，必须 `realpath` 后校验前缀。
- 显式路径模式必须满足 `.jsonl` 扩展名、文件大小上限、`realpath` 后不穿越符号链接到非允许目录；MVP 可要求用户通过系统文件选择器或明确输入绝对路径后再确认。
- 写入目标 `qaDir/conversationsDir/projectsDir` 必须继续使用工作台 Vault 派生目录，不允许 renderer 任意指定外部写入目录。
- 导入失败时不写半成品；Conversation 与 QAAtom 写入按先 tmp 后 rename；写 `conv-relay-*` 前备份旧 Conversation，失败时恢复旧文件或删除本次新建文件；ReadRecord 先于 Project index 写入，Project index 最后追加，避免悬挂引用。

关键规则：

- `session_meta.payload.session_id` 作为 `source_session_id`。
- `session_meta.payload.cwd` 作为 `source_cwd`。
- 文件路径只进入 local-only Read Record；QAAtom / Conversation frontmatter 默认只写 display 与 hash。
- 每条可导入 turn 的 `source_key` 使用非识别型 `line:{lineIndex}`；幂等由 `source_session_hash + source_key` 共同保证，避免真实 session id 进入 QA frontmatter。
- user message 后第一个 assistant message 配对为 QAAtom。
- tool / subagent / event 类消息先进入 marker，不写成 QAAtom 正式问答。

### 2. IPC：`relay:readCodexSession`

输入：

```ts
{
  sessionId?: string
  sourcePath?: string
  qaDir: string
  conversationsDir: string
  projectsDir?: string
  projectId?: string | null
}
```

输出：

```ts
{
  conversation: ConversationMeta
  readRecord: ReadRecord
  atomIds: string[]
  createdAtomCount: number
  skippedAtomCount: number
  markers: SourceEventMarker[]
}
```

幂等：

- 导入前扫描现有 QAAtom 的 `source_platform + source_session_hash + source_key`。
- 已存在则跳过写入，只补齐 Conversation 索引。
- 重复读取同一 session 不新增重复 atom。

### 3. IPC：`relay:generateHandoffPacket`

输入：

```ts
{
  conversationId: string
  atomIds?: string[]
  targetPlatform?: 'codex' | 'claude' | 'generic'
  handoffMode?: 'continue' | 'reference' | 'execute'
  includeLocalSourceDetails?: boolean
}
```

输出：

```ts
{
  markdown: string
  handoffRecord: HandoffRecord
  source: {
    conversationId: string
    sourcePlatform?: string
    sourceSessionId?: string
    sourcePath?: string
    sourceCwd?: string
  }
}
```

MVP 生成规则先走确定性模板，不调用 AI 自动摘要。模板包含：

- 对话来源；
- 目标入口；
- handoff mode；
- 用户确认状态；
- Read Record / Handoff Record；
- QA 路径列表；
- 用户已表达判断占位；
- 已确认结论占位；
- 未决问题占位；
- 约束；
- 下一步占位。

如果无法自动识别“判断 / 结论 / 未决”，不伪造结论，直接保留“待人工填写/确认”占位。默认脱敏本地绝对路径和真实 session id；只有 `includeLocalSourceDetails=true` 时才包含完整来源细节。

### 4. Record 存储

v0.17 使用轻量 markdown/json sidecar 存储 record，后续如需要可迁移到正式事件日志。

```text
~/.workbench/relay-records/read/{readRecordId}.json
~/.workbench/relay-records/handoff/{handoffRecordId}.json
```

`ReadRecord` 至少包含 source platform、session id hash、source path hash、read checkpoint、conversation id、created/skipped atom count。

`HandoffRecord` 至少包含 conversation id、target platform、handoff mode、included atom ids、created at、user confirmation 状态、是否包含完整本地来源细节。

完整 `source_path`、`source_cwd`、真实 `source_session_id` 只允许保存在 local-only Read Record / Handoff Record 中；可同步 Markdown frontmatter 默认写：

- `source_session_hash`
- `source_path_display`
- `source_path_hash`
- `source_cwd_display`
- `source_cwd_hash`

`source_session_id` 只有在用户显式选择“包含完整来源细节”时才进入 Handoff 输出，不默认写入公开或可同步文本。

## UI 改动

### P4 Conversation Source

在已有来源区域基础上增加：

- 原始标题 `sourceTitle`；
- 读取时间 `readAt`；
- `relayStatus`；
- 未建模事件数量；
- “生成接力包”按钮。
- 目标入口和 handoff mode 最小选择控件。

### Handoff Packet 展示

MVP 可用轻量 modal 或 P4 内联 preview：

- 只读 Markdown preview；
- 复制按钮；
- 显示目标入口；
- 显示 handoff mode；
- 显示来源追踪；
- 默认显示脱敏来源，完整来源细节需要用户显式选择；P4 不直接展示绝对路径。
- 不自动发送到外部入口。

## 文件写入格式

### QAAtom frontmatter

新增字段示例：

```yaml
source_platform: "codex"
source_session_hash: "<sha256-prefix>"
source_path_display: "~/.codex/sessions/.../<file>.jsonl"
source_path_hash: "<sha256-prefix>"
source_cwd_display: ".../<folder>"
source_cwd_hash: "<sha256-prefix>"
source_title: "定义Agent协作最小单元"
source_key: "line:42"
```

### Conversation frontmatter

沿用 camelCase：

```yaml
sourcePlatform: codex
sourceSessionId: "<sha256-prefix>"
sourcePath: "~/.codex/sessions/.../<file>.jsonl"
sourceCwd: ".../<folder>"
sourceTitle: "定义Agent协作最小单元"
readAt: "2026-07-10T..."
readRecordId: "read-..."
relayStatus: partial
unmappedEventCount: 3
```

## 测试计划

### Unit

- `codexSessionReader` 能解析 `session_meta`。
- `codexSessionReader` 只从 `response_item` 生成消息，跳过 `event_msg` echo。
- user / assistant message 能稳定配对为 QAAtom draft。
- 重复 `source_key` 被跳过。
- 未识别事件产生 marker。
- `read_qa_atom` 能读回 source metadata。
- `write_qa_atom` 能写出 source metadata。
- `update_conversation/add_atom_to_conversation` 后 source/read/relay 字段不丢失。
- 非 allowlist 的 `sourcePath` 被拒绝。
- 超大或损坏 jsonl 不落半成品。
- `generateHandoffPacket` 输出包含来源和 QA path。
- `generateHandoffPacket` 默认脱敏本地路径和真实 session id。
- `generateHandoffPacket` 输出 target platform、handoff mode、handoff record。

### Integration

- 使用脱敏 fixture 读取一段 Codex session。
- 写入 Conversation 文件和 QAAtom 文件。
- 再次读取同一 fixture，不新增重复 QAAtom。
- 生成 Read Record 与 Handoff Record。
- UI store reload 后 Conversation Source 仍可显示。

### Manual Acceptance

以用户指定的 local-only 真实样本验证。真实 session id 和路径只保留在本地验收记录，不提交到公开仓库。

```text
<local-codex-session-id>
```

验收：

- 能读取；
- 能形成 Conversation；
- QA 拆分基本合理；
- 来源信息完整；
- P4 能看到来源；
- 能生成 Handoff Packet；
- subagent / tool / 未映射事件没有被误写成 QA 正文。

真实样本只用于本地手工验收，不提交到公开仓库。

## 实施步骤

1. 数据模型扩展：`QAAtomMeta`、`ConversationMeta`、读写 parser。
2. Codex reader：读取 session、normalize turns、生成 markers。
3. 导入 IPC：写 QAAtom、写 Conversation、幂等去重。
4. Source UI：扩展 DetailPanel 来源区。
5. Handoff IPC：确定性 Markdown 生成。
6. Handoff UI：preview + copy。
7. 测试与隐私扫描。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| Codex jsonl 格式变化 | reader 只依赖少量稳定字段；未知事件转 marker |
| event echo 导致重复导入 | 只以 `response_item` 为主读取源 |
| QA 配对不准 | MVP 允许 partial；无法配对的消息进入 marker |
| 真实路径进入公开产物 | fixture 必须脱敏；release 前跑 privacy scan |
| Handoff 被误认为自动摘要 | v0.17 使用确定性模板，并标记待人工审阅 |

## 非技术范围

- 不接 Claude 本地数据库。
- 不写 Codex 内部 session。
- 不调用 AI 自动总结。
- 不实现长期记忆。
- 不实现 Agent-Agent 正式协作原子。

## 修订记录

| doc_revision | 日期 | 作者 | 变化 |
|---|---|---|---|
| 1 | 2026-07-10 | workbench-ceo | 初稿：基于 product.md doc_revision 2，拆解 v0.17 对话接力 MVP 的数据模型、IPC、UI、测试和隐私边界 |
| 2 | 2026-07-10 | workbench-ceo | review 修订：source_key 去除真实 session id；完整本地来源只进 local-only record；补 allowlist、rollback、字段保真和 Handoff 明示来源细节策略 |

## Review 记录

| 日期 | 范围 | 结果 |
|---|---|---|
| 2026-07-10 | technical review | 已修复阻断项：source_key 隐私泄露、导入半成品 rollback、local-only 来源细节读取、renderer source 类型 |
