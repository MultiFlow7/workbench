---
project: 工作台
version: v0.11
status: draft
doc_revision: 2
created: 2026-05-21
updated: 2026-05-21
author: workbench-product
tags:
  - 类型/规划文档
  - 主题/技术/工作台
  - 状态/草稿
---

# product.md · 工作台 v0.11 · 对话流修复 + 工具调用基础框架

---

## 版本主题

**对话流修复 + 工具调用基础框架**

v0.10 完成了 NavList 可用性修复。v0.11 分两个层次推进：

**第一层（还清欠债）**：v0.10 实现过程中发现并修复的五个运行时 bug（流式响应竞态、根节点结构混乱、项目文件 ID 解析错误、输入框未及时清空、BranchTree 节点不可见）——这些 bug 在上一个 session 中已完成代码修复，本版本将其正式归档为 req-036~040。

**第二层（补上最大缺口）**：工具调用基础框架（req-041~043）——让工作台里的 AI 能真正「干活」。当前工作台是纯对话界面，AI 只能说不能做；v0.11 通过 tool calling 闭环让 AI 能读取本地文件、执行 shell 命令、搜索 vault，并在 ChatView 中提供可见的执行反馈。

---

## 版本目标

1. **归档已修复的运行时 bug（req-036~040）**：将上一个 session 中已实现的五个修复正式纳入版本，更新需求状态，确保 changelog 完整记录。

2. **工具调用闭环上线（req-041~043）**：实现 AI → 工具调用 → 本地执行 → 结果回传 → AI 继续回答的完整链路，包括：Tauri `execute_tool` 命令、`stream_ai` 后端 tool_call 事件改造、ChatView 前端 tool_call 处理、三个内置工具（read_file / run_shell / search_vault）、工具执行状态 UI 反馈。

---

## 需求范围

### 纳入 v0.11 的需求

| ID | 标题 | 优先级 | 状态 | 说明 |
|----|------|--------|------|------|
| [req-036](../../requirements/req-036-streaming-race-condition-fix.md) | 流式响应 race condition 修复 | high | **已实现** | ai-done 与 stream_ai 宏任务竞争导致超时误触发 |
| [req-037](../../requirements/req-037-conversation-root-node-refactor.md) | 对话根节点结构重构 | high | **已实现** | 取消「新对话」占位 root atom，Q&A 本身作为根节点 |
| [req-038](../../requirements/req-038-atom-id-trim-fix.md) | 项目文件 Atom ID 解析 trim 修复 | high | **已实现** | `parse_atom_ids` 未 trim 导致重启后画布空白 |
| [req-039](../../requirements/req-039-input-clear-on-send.md) | 发送消息即清空输入框 | medium | **已实现** | 引入 `pendingQuestionRef`，发送后立即清空 |
| [req-040](../../requirements/req-040-branchtree-response-node-visibility.md) | BranchTree 响应节点可见 | high | **已实现** | ai-done 后调用 `addAtomToProject` 加入项目 atom 列表 |
| [req-041](../../requirements/req-041-tool-calling-framework.md) | Tool Calling 基础框架 | high | **待实现** | `execute_tool` Tauri 命令 + `stream_ai` tool_call 事件改造 + ChatView tool_call 处理 |
| [req-042](../../requirements/req-042-builtin-tools.md) | 内置工具集（read_file / run_shell / search_vault） | high | **待实现** | 三个内置工具的 Rust 实现 + tool schema 定义 |
| [req-043](../../requirements/req-043-tool-call-ui-feedback.md) | 工具调用状态 UI 反馈 | medium | **待实现** | ChatView 中工具执行进度、完成、失败状态行 |

---

## 需求详细说明

### req-036~040 · 运行时 bug 修复（已实现）

这五个修复在上一个开发 session 中已完成代码实现并通过 TypeScript 类型检查（0 errors）。本版本的任务是：

1. 确认代码修复完整（已确认）
2. 将 req 文件状态从 `planned` 改为 `done`
3. 在 changelog 中正式记录修复内容

各修复的核心要点：
- **req-036**（race condition）：`ai-done` handler 在 `await write_qa_atom` 处让出控制权，此时 `invoke('stream_ai')` resolution 跑进来设置第二层超时；修复方案是在 `ai-done` 头部清除超时、在 `invoke` 完成后仅当仍处于 streaming 状态才设置超时
- **req-037**（根节点重构）：NavList `handleNewConversation` 不再创建占位 atom，只设置 `selectedAtomId: null`；ChatView `handleSend` 中第一条消息的 `prevWikilink = null` 直接成为根节点
- **req-038**（trim 修复）：`parse_atom_ids` 提取 `[[...]]` 内容后补一次 `.trim()`
- **req-039**（输入清空）：引入 `pendingQuestionRef` 在发送时捕获问题文字，发送后立即 `setInput('')`
- **req-040**（节点可见）：`ai-done` handler 在写入磁盘后调用 `addAtomToProject` 将新 atom 加入当前项目

---

### req-041 · Tool Calling 基础框架（high，待实现）

**问题根因**

工作台当前只有纯文字对话，AI 无法执行任何本地操作。`stream_ai` 只解析文字 token（`content_block_delta.type == "text_delta"`），对模型返回的 `tool_use` 事件结构零处理。

**实现方向**

**Tauri 侧（Rust）：**
1. 新增 `execute_tool` 命令（接收 `tool_name: String` + `tool_input: serde_json::Value`，分发到工具注册表，返回结果字符串）
2. 改造 `stream_ai`：新增可选 `tools` 参数（`Option<serde_json::Value>`，Rust serde 默认 None）；解析 SSE 流中的 `content_block_start`（type=tool_use）和 `content_block_delta`（type=input_json_delta）事件，在工具调用完整后 emit `ai-tool-call` 事件。不传 `tools` 时行为与当前完全相同（向后兼容，现有前端调用路径无需修改）

**ChatView 侧（TypeScript）：**
1. 监听 `ai-tool-call` 事件，暂停文字 streaming 显示，调用 `invoke('execute_tool', ...)`
2. 拿到 tool_result 后，将结果作为 `tool_result` role 消息追加到对话历史，继续调用 `stream_ai`
3. 支持单轮 tool calling 闭环（单次工具调用 → AI 最终回答）

**关键 CEO 决策（已确认）**

1. **stream_ai 需要改造**：当前后端只转发纯文字，不含 Claude API 原始 tool_use 事件；v0.11 需同步改造后端，增加 tool_call 事件解析和 `tools` 参数支持
2. **tool_result 传递格式**：使用 Claude API 原生格式——`{ role: "user", content: [{ type: "tool_result", tool_use_id, content: result_text }] }`，严格对齐 Claude API 多轮 tool use 协议
3. **多轮限制**：v0.11 仅支持单次工具调用闭环（不支持 AI 在一次回答中多次连续调用工具），后续版本可扩展

**关键验收指标**

| 验收项 | 标准 |
|--------|------|
| execute_tool 可调用 | 前端通过 `invoke('execute_tool', ...)` 得到结果，不报错 |
| tool_call 被检测到 | 模型返回 tool_call 时，ChatView 识别并暂停文字 streaming |
| 工具执行并回传 | 调用 execute_tool → 结果追加为 tool_result → 继续对话 |
| 闭环完成 | 用户看到 AI 使用工具后给出的最终回答 |
| 执行失败降级 | execute_tool 失败时显示可读错误，不挂起 streaming |

---

### req-042 · 内置工具集（high，待实现）

**实现方向**

三个工具均在 `execute_tool` 分发表中注册：

**工具 1：`read_file`**
- 读取本地文件内容，超过 50KB 截断并附注
- 路径限制：仅允许访问 vault 目录（`app.state::<VaultPaths>()`）+ 工作台项目目录，系统路径（`/etc/`、`/usr/`、`/bin/` 等前缀）拒绝

**工具 2：`run_shell`**
- 执行 shell 命令，返回 `stdout / stderr / exit_code`
- 黑名单：拒绝含 `rm -rf`、`sudo`、`curl | sh`、`chmod 777` 等高危模式
- 超时 10s，超时强制终止
- **v0.11 不可见**：Rust 侧定义 `run_shell_enabled: bool`（默认 false），工具注册表中注册 run_shell 但执行时检查该字段返回错误；Settings UI 开关留给后续版本，v0.11 该工具对用户不可见、不可用

**工具 3：`search_vault`**
- Rust 侧遍历 vault 目录的 `.md` 文件，字符串包含匹配（不需要向量搜索）
- 返回前 5 条匹配，每条含 `{ path, snippet }` （匹配前后各 100 字符为摘要）

**关键 CEO 决策（已确认）**

1. **read_file 路径白名单**：限制在 vault 目录 + 工作台项目目录。用户可在设置中配置额外可读目录（v0.11 先实现基础限制，设置 UI 占位留给后续版本）
2. **run_shell v0.11 不可见**：Rust 工具注册表中注册 run_shell 但执行时检查 `run_shell_enabled: bool`（默认 false）返回错误；Settings UI 开关留给后续版本，v0.11 该工具对用户不可见、不可用；不阻塞 read_file 和 search_vault 的实现
3. **tool schema 随 tools 参数传给 Claude API**：在 `stream_ai` 的 request_body 中加入 `tools` 字段（JSON Schema 格式），Claude 模型识别后在合适时机调用

**关键验收指标**

| 验收项 | 标准 |
|--------|------|
| read_file 正确读取 | AI 请求读取文件，返回正确内容 |
| read_file 路径限制生效 | vault 外路径拒绝，返回权限错误 |
| run_shell 执行合法命令 | AI 请求执行命令（需 settings 开启），返回 stdout/stderr |
| run_shell 黑名单拦截 | 含 `rm -rf` 的命令被拒绝 |
| run_shell 超时生效 | 超时命令被强制终止 |
| search_vault 返回结果 | 搜索关键词，返回包含路径+摘要的列表 |
| tool schema 正确传递 | 调用 stream_ai 时携带 tools schema，Claude 能识别工具 |

---

### req-043 · 工具调用状态 UI 反馈（medium，待实现）

**实现方向**

在 ChatView（P3）中，AI 发起工具调用时展示状态行：

```
⚙ 正在执行工具：read_file（"/path/to/file.md"）...
```

执行完成后变为：
```
✓ 工具执行完成（1.2s）
```

执行失败时变为：
```
✗ 工具执行失败：[原因摘要]
```

**关键 CEO 决策（已确认）**

1. **工具调用状态仅内存展示**：v0.11 不持久化工具调用历史到 atom 数据结构，仅在当前会话内存展示；重新加载对话时不显示历史工具调用状态行
2. **不支持用户中断**：工具执行期间输入框禁用，v0.11 不实现工具执行中途取消；后续版本可考虑

**关键验收指标**

| 验收项 | 标准 |
|--------|------|
| 工具执行中有可见反馈 | 显示「正在执行工具：xxx」提示行，有 CSS 动效 |
| 工具名称和参数可读 | 展示工具名 + 关键参数（路径/命令摘要，不超出宽度） |
| 执行完成状态更新 | 工具完成后变更为「✓ 执行完成」并展示耗时 |
| 执行失败有提示 | 工具失败时变更为「✗ 失败：[原因]」 |
| 多次对话工具调用各自显示 | 两条用户消息各触发一次工具调用，各自显示一行状态，不互相覆盖（非单次 AI 回答内的连续调用） |
| 样式与设计系统一致 | 字体 Inter，颜色 `--accent: #2563eb`，不突兀 |

---

## Out of Scope

| 项目 | 推迟原因 |
|------|---------|
| 多轮连续工具调用 | v0.11 只支持单次工具调用闭环，多轮场景（AI 连续调用 3+ 个工具）待 v0.12 评估 |
| run_shell 对用户可见/可用 | 高风险工具，v0.11 Rust 侧注册但屏蔽执行（`run_shell_enabled: false`），Settings UI 开关留给后续版本 |
| 工具调用历史持久化 | 数据模型改动影响面大，v0.11 内存展示，后续版本评估 |
| 工具执行中途取消 | 需要 CancellationToken 在 execute_tool 层传递，v0.11 后续版本实现 |
| 向量搜索 search_vault | v0.11 字符串匹配已满足基本需求，向量化方案待后续独立版本 |
| 工具调用超时（前端级） | Tauri invoke 本身超时由 Rust 侧 10s 保证，前端层不需要单独超时 |
| req-021（记忆 Agent） | 继续推迟，依赖上下文构建器深度改造 |

---

## 长期一致性说明

### 与「Human first 前端」原则的对应

**req-036~040（bug 修复）**：这些修复直接服务于控制权保障——对话流不卡死、根节点语义清晰、节点正确显示。这是「Human first」的基础——人必须能看见并控制 AI 的对话状态。

**req-041~043（工具调用）**：工具调用是「Human first」的进阶体现：
- **AI 做事，人可见**：工具执行状态行让用户知道 AI 在做什么（不是黑盒执行）
- **安全边界**：`read_file` 路径白名单、`run_shell` 默认关闭，人保留对 AI 操作范围的控制权
- **决策留给人**：工具失败时 AI 降级提示，不静默失败、不自动重试

### 与四面板布局原则的一致性

工具调用在 ChatView（P3）内完成，工具状态行嵌入 AI 回答气泡中，不新增独立面板，不跨越面板职责边界。`execute_tool` 是纯本地 Tauri 命令，不影响 P2/P4 的展示层。

### 与「不堵死未来」原则的一致性

`execute_tool` 采用分发表（match 工具名）设计，未来注册新工具只需在分发表追加分支，无需修改前端。`tools` 参数作为可选参数追加到 `stream_ai`，不破坏现有无工具调用的对话场景。

---

## 依赖关系

| 依赖项 | 说明 |
|--------|------|
| req-036~040 实现状态 | **已完成**（上一 session 代码修复，TypeScript 0 errors）|
| stream_ai 后端改造 | req-041 **关键前置**：`stream_ai` 需新增 `tools` 参数、tool_use 事件解析、`ai-tool-call` emit |
| execute_tool 命令 | req-042 工具实现依赖 req-041 的分发框架，需顺序实现 |
| req-043 对 req-041 的依赖 | UI 反馈依赖前端 tool_call 处理逻辑（req-041 ChatView 侧），需顺序实现 |

---

## 修订记录

| 版本 | 日期 | 修改内容 |
|------|------|---------|
| doc_revision 1 | 2026-05-21 | 初稿，workbench-product 基于上一 session 代码状态和 req-036~043 创建 |
| doc_revision 2 | 2026-05-21 | workbench-review 修复：① 将 req-036~040 frontmatter status 更新为 done；② stream_ai tools 参数补充向后兼容说明；③ run_shell v0.11 策略措辞统一（Rust 侧注册+屏蔽，不暴露 UI）；④ req-043 验收指标「多轮」歧义修正为「两条用户消息各触发一次」 |
