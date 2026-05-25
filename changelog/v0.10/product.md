---
project: 工作台
version: v0.10
status: approved
doc_revision: 2
created: 2026-05-21
updated: 2026-05-21
author: workbench-product
approved_by: workbench-ceo
approved_at: 2026-05-21
tags:
  - 类型/规划文档
  - 主题/技术/工作台
  - 状态/已批准
---

# product.md · 工作台 v0.10 · NavList 基础交互修复

---

## 版本主题

**NavList 基础交互修复**

v0.9 完成了 Markdown 渲染、模型灵活性与成本可见性三项能力。v0.10 转向基础可用性修复：三个用户实测报告的问题——新建对话后无法发送、只能新建对话不能新建项目、NavList 数据重复——均指向 NavList 与 ChatView 的交互层存在基础缺陷。v0.10 的任务是还清这笔「可用性欠债」，确保工作台的核心操作流程可靠运转。

---

## 版本目标

1. **新建对话后输入框可靠解锁**：修复磁盘写入失败阻断内存状态更新的问题，确保对话在内存中创建后 textarea 立即可用，发送路径有完整的错误边界与用户可见反馈。

2. **新建项目入口上线**：在 NavList 「项目」section 新增创建入口，用户可通过内联输入框直接创建新项目，前端调用 Tauri `create_project` 命令，项目创建后自动出现在列表中并自动选中。

3. **对话与项目在 NavList 中正确分离展示**：「对话」section 改为展示当前项目内 `prev === null` 的根节点（各条对话链起点），与「项目」section 的 `ProjectMeta` 列表彻底分开，消除数据重复，呈现符合用户预期的信息架构。

---

## 需求范围

### 纳入 v0.10 的需求

| ID | 标题 | 优先级 | 来源 | 说明 |
|----|------|--------|------|------|
| [req-033](../../requirements/req-033-new-conversation-blocking-fix.md) | 新建对话后发送内容无响应修复 | high | user-report | 磁盘写入失败阻断内存状态，导致 textarea 永久禁用 |
| [req-034](../../requirements/req-034-create-project-entry.md) | 新建项目入口（NavList + create_project） | high | user-report | NavList 缺少项目创建入口，前端 + 后端命令待确认 |
| [req-035](../../requirements/req-035-navlist-conversation-project-separation.md) | NavList 对话与项目数据分离展示 | high | user-report | 两个 section 渲染相同数据，概念混淆 |

---

## 需求详细说明

### req-033 · 新建对话后发送内容无响应修复（high）

**问题根因**

`NavList.tsx` 的 `handleNewConversation` 采用「磁盘写入优先」策略：先 `await invoke('write_qa_atom', ...)`，成功后才执行 `appendAtom` + `selectAtom`。若 invoke 失败，catch 块直接 return，导致内存状态（`currentPath`）始终为空，`ChatView.tsx` 的 `disabled={!currentPath.length}` 条件使 textarea 永久禁用。

同时，`handleSend` 对 `generateNewAtomId()` 未加 try/catch，异常时静默退出；`stream_ai` 后端若无响应（不抛错、只是不回事件），UI 永久卡在 streaming 状态。

**修复方向**

采用「内存优先，磁盘异步」策略：
1. 先执行 `appendAtom` + `selectAtom`（内存操作，立即解锁 textarea）
2. 再异步发起 `invoke('write_qa_atom', ...)`（磁盘持久化）
3. 磁盘写入失败时：显示持久化失败提示，**不回滚内存状态**，用户对话不中断

`handleSend` 补充完整错误边界：`generateNewAtomId()` 异常时显示可读错误；`stream_ai` 加 30s 超时，超时后退出 streaming 状态，显示超时提示。

**关键验收指标**

| 验收项 | 标准 |
|--------|------|
| 正常路径：新建对话后可输入 | 点击「新建对话」后，textarea 立即可用，用户可输入文字并发送 |
| 降级路径：磁盘写入失败不阻塞 | 模拟 `write_qa_atom` 失败，对话仍可在内存中创建，textarea 可用，页面出现持久化失败提示 |
| handleSend 错误可见 | 模拟 `generateNewAtomId()` 抛出异常，页面显示用户可读错误提示，不静默失败 |
| streaming 超时退出 | 模拟 backend 无响应，30s 后 streaming 状态自动退出，显示超时提示，输入框恢复可用 |

---

### req-034 · 新建项目入口（NavList 前端 + create_project 后端）（high）

**问题根因**

`NavList.tsx` 只有「+ 新建对话」按钮，无「+ 新建项目」入口。`ProjectMeta` 接口结构已完备（id / name / rootBranchId / createdAt / atomIds），后端 `list_projects` 命令已存在，说明项目管理基础设施具备，仅缺少创建路径。

**边界跨越说明**

本需求涉及新的 CRUD 操作（项目创建），可能需要在 tauri-platform（Rust 后端）新增 `create_project` 命令。

- 若后端已有 `create_project`：本需求为纯前端工作，直接调用 `invoke('create_project', { projectsDir, name })`
- 若后端未有：需在 tauri-platform 新增该命令，实现创建项目目录、写入 `project.json` 元数据、返回 `ProjectMeta` 对象的逻辑

**technical.md 阶段必须首先确认后端命令是否已有**，再决定实现节点范围。

**修复方向**

前端在 NavList「项目」section 标题旁添加「+」按钮，点击出现内联输入框（Enter 确认 / Esc 取消），确认后调用 `invoke('create_project', ...)`，成功后 append 新项目到状态并自动选中。

**关键验收指标**

| 验收项 | 标准 |
|--------|------|
| 创建入口可见 | NavList「项目」section 标题旁有「+」按钮，与「新建对话」按钮视觉一致 |
| 内联输入确认 | 点击「+」出现内联输入框；Enter 确认，Esc 取消；空名称无法提交 |
| 项目出现在列表 | 创建成功后，新项目立即出现在 NavList「项目」列表中，无需刷新 |
| 自动选中 | 新建成功后自动选中该项目，P2/P3 切换至该项目视图 |
| 错误处理 | `create_project` 失败时，内联输入框不关闭，显示错误提示，用户可修改后重试 |
| （若后端命令需新增）命令行为正确 | `create_project` 命令成功创建项目目录与 `project.json`，返回合法 `ProjectMeta` 对象；重名或非法路径时命令返回可读错误，前端可捕获 |

---

### req-035 · NavList 对话与项目数据分离展示（high）

**问题根因**

`NavList.tsx` 的「对话」section 和「项目」section 均使用 `projects.map(...)` 渲染，数据来源完全相同，用户看到两列重复内容。

用户定义的正确信息架构：
- **项目** = `ProjectMeta` 容器（大画布）
- **对话** = 该项目下 `prev === null` 的 root atom（对话链起点）

**修复方向**

仅修改 NavList 展示筛选逻辑，不改变任何数据模型：

- 「项目」section：继续渲染 `projects`（`ProjectMeta[]`）
- 「对话」section：渲染 `atoms.filter(a => a.prev === null)`（当前项目下的 root atoms）

对话标题取 `atom.question` 前 30 字符（超出截断 + 省略号），空 question 显示「新对话」占位。

**关键验收指标**

| 验收项 | 标准 |
|--------|------|
| 对话与项目不重复 | NavList「对话」section 与「项目」section 展示不同数据，无重复条目 |
| 对话 section 正确筛选 | 「对话」section 仅展示当前项目内 `prev === null` 的 root atoms |
| 点击对话联动 P2/P3 | 点击对话列表中某条对话，P2 分支树、P3 对话视图联动切换至该对话链（此联动依赖已有的选中状态事件机制，req-035 不新增联动逻辑，仅确保筛选后的条目可正常触发现有事件） |
| 空对话占位 | question 为空的 root atom 在列表中显示「新对话」，不崩溃、不显示空白 |
| 数据模型不变 | 无对 QAAtom / ProjectMeta 结构的修改，无后端命令变动 |

---

## Out of Scope

| 项目 | 推迟原因 |
|------|---------|
| req-021（记忆 Agent） | 依赖上下文构建器深度改造未完成，向量存储方案未选型，继续推迟至 v0.10+ |
| req-029 完整版 Gateway | v0.9 成本日志数据尚未积累，Phase 1 启动时机待评估，不在本版本纳入 |
| 对话分叉操作（P2 编辑） | 仍在 backlog，P2 当前版本只读，后续版本规划 |
| 对话目录配置 UI | 仍在 backlog，当前硬编码路径，不影响本版本可用性修复 |
| NavList 搜索 / 过滤 | 不在本版本范围，待基础交互稳定后可评估 |
| 删除项目 | req-034 仅实现新建入口；删除操作涉及级联删除 atoms 和文件系统操作，影响面更大，推迟至独立版本评估 |

---

## 长期一致性说明

### 与「Human first 前端」原则的对应

产品方向确立「前端逻辑 Human first」——降低人管理 AI 团队的认知负担，保留人的控制权。v0.10 三个需求均直接服务于此原则：

**req-033（新建对话修复）**——控制权保障。当前 textarea 被磁盘写入失败意外禁用，用户失去了对话发起的控制权。修复后确保对话创建路径可靠，用户的操作意图得到尊重。

**req-034（新建项目入口）**——信息架构掌控。用户无法创建项目，意味着工作台的顶层组织单元（大画布）不在用户控制范围内。新增创建入口让用户能主动管理自己的工作空间结构。

**req-035（数据分离展示）**——认知负担降低。两个 section 显示相同数据，用户无法区分「我在哪个项目」和「我在哪条对话」，认知成本极高。分离展示直接降低导航认知负担，是 Panel 1（导航）「列表浏览」职责的基本实现。

### 与四面板布局原则的一致性

产品方向规定 Panel 1（导航）职责为「模式切换 + 列表浏览（项目/工具/服务）」，「不渲染结构，不渲染内容」。

三个需求的修复范围严格限于 Panel 1（NavList）和 Panel 3（ChatView）交互层，不跨越面板职责边界，不影响 Panel 2 结构面板和 Panel 4 详情面板的独立性。

### 与「不想堵死」原则的一致性

req-034 采用内联输入框而非弹窗 Modal，避免引入重量级 UI 组件；req-035 不改变数据模型，只改展示筛选——这两个设计决策均遵循「为未来留空间，当前实现最小化」的架构原则，不提前锁死更复杂的项目管理 UI 形态。

---

## 依赖关系

| 依赖项 | 说明 |
|--------|------|
| v0.9 验收状态 | **不依赖**。v0.10 三个需求均为 NavList / ChatView 层修复，与 v0.9 的 Markdown 渲染、LLM 配置、成本日志无功能依赖，可并行推进 |
| tauri-platform `create_project` 命令 | req-034 的**关键待确认项**。technical.md 阶段需首先查明后端命令是否存在；若不存在，本版本需同步新增（Rust 后端工作量约 1~2 天）|
| req-035 对 req-034 的依赖 | req-035 需要「对话」section 展示逻辑正确；req-034 需要「项目」section 有创建入口。两者修改的 NavList 区域不同，可独立开发，无强依赖 |
| req-033 对 req-035 的依赖 | 无直接依赖。req-033 修复 handleNewConversation + handleSend，req-035 修复 NavList 展示逻辑，可并行实现 |

---

## 修订记录

| 版本 | 日期 | 修改内容 |
|------|------|---------|
| doc_revision 1 | 2026-05-21 | 初稿，workbench-product 基于用户报告三个问题创建 |
| doc_revision 2 | 2026-05-21 | workbench-review 修复：① req-034 验收指标补充「若后端命令需新增」场景的验收行；② Out of Scope 补充「删除项目」明确排除；③ req-035 验收指标「P2 联动」行补充说明其依赖已有事件机制，澄清修复范围不新增联动逻辑 |
