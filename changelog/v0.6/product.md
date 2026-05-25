---
project: 工作台
version: v0.6
status: approved
doc_revision: 6
created: 2026-05-19
updated: 2026-05-19
author: workbench-product
review_result: "🔴=0 🟡=0 · 通过"
reviewed_by: review-agent
reviewed_at: 2026-05-19
approved_by: workbench-ceo
approved_at: 2026-05-19
---

# product.md · 工作台 v0.6 · Control Room

---

## A3 完整实现路线图定位

> **本版本是 A3 完整实现路线图的第一阶段。**
>
> A3 完整目标：真实多 Agent 并发调度 + 隔离实例 + 完整 UI 套件全部落地。
> 路线图分三阶段：
> - **v0.6（本版本）**：UI + 数据层——Control Room 界面 + Agent 任务状态机，为 Agent 调度打好数据通道
> - **v0.7（下一阶段）**：真实调度层——req-014 多 Agent 并发调度、req-015 上下文构建器、req-019 流水线自动触发、req-020 主对话隔离保护
> - **v0.8（第三阶段）**：隔离与管控——req-022 Agent 沙盒、req-023 Harness 管控层，完成 A3 完整实现

---

## 版本背景与目标

### 版本方向

**v0.6 的目标是让用户能从工作台 UI 直接管理 Agent 团队，而不需要打开命令行或手动查看文件。**

v0.1~v0.5 完成了对话界面、Token 可见性和 LLM 调用链自主可控。但 Agent 团队的运作对用户完全不透明——有哪些 Agent、它们在做什么、有没有等待决策的项目，全部需要靠记忆或命令行查询。

v0.6 打通「Control Room」：工作台从「对话工具」升级为「AI 团队驾驶舱」。

**本版本完成六件事**：
1. **req-013**：Agent 任务状态机后端——所有 Agent 协作的持久化共享状态存储，UI 的数据基础
2. **req-030**：Agent 注册表 UI——用户可以在工具管理模式里看到有哪些 Agent 角色及其当前状态
3. **req-016 精简版**：当前状态视角——控制台模式里显示所有运行中/等待决策/失败的任务跨项目总览
4. **req-018**：决策收件箱——Agent 需要用户拍板时，以非侵入方式积累请求，用户统一处理
5. **req-017 精简版**：执行流视图（只读）——点进某个任务可看到该 Agent 的执行步骤流水
6. **req-031**：手动触发任务——用户可在 UI 中创建新的 Agent 任务记录进入队列

**为什么是这六件事？**
- req-013 状态机是所有 UI 的数据源，没有它 UI 功能无从实现，必须优先
- req-030 解决「看得见」——知道有谁
- req-016 + req-017 解决「跟得上」——知道在做什么
- req-018 解决「管得了」——决策不再阻塞
- req-031 解决「触发得了」——不依赖命令行启动任务

### 需求范围评估（req-013～req-024 全量审视）

董事长批准将 req-013～req-024 纳入评估范围，由 CEO 自主裁定哪些进 v0.6、哪些推后。以下是完整评估结论：

| req | 标题 | v0.6 决策 | 推后原因 |
|-----|------|-----------|---------|
| req-013 | Agent 任务状态机 | **纳入 v0.6（完整）** | 数据层基础，所有 UI 依赖此 |
| req-014 | 真实多 Agent 调度（隔离实例） | **推 v0.7** | 实现复杂度高（独立进程管理、并发隔离），v0.6 先建 UI 层 |
| req-015 | Agent 上下文构建器 | **推 v0.7** | 强依赖 req-014 调度器，构建器才有用武之地 |
| req-016 | 多层级任务可视化 | **纳入 v0.6（精简：当前状态视角）** | 项目流水线视角和 Agent 平面打断能力推 v0.7 |
| req-017 | Agent 执行流视图 | **纳入 v0.6（精简：只读）** | 打断/重新引导推 v0.7 |
| req-018 | 决策收件箱 | **纳入 v0.6（完整）** | 「管得了」的核心 UI 载体，不依赖后台真实执行 |
| req-019 | 流水线触发规则（自动编排） | **推 v0.7** | 手动触发先落地（req-031），自动编排是后一步 |
| req-020 | 主对话保护 | **推 v0.7** | 结构性依赖 req-014 真实调度，v0.6 无后台 Agent 实际运行，问题暂不存在 |
| req-021 | 记忆 Agent | **推 v0.x 后期（无确定版本）** | 独立专项，依赖状态机+多 Agent 调度稳定后再做 |
| req-022 | Agent 沙盒（隔离执行环境） | **推 v0.8** | 前提是 req-014 真实调度存在，隔离才有意义 |
| req-023 | Harness 管控层 | **推 v0.8** | 同上，管控层在真实执行存在后才能发挥作用 |
| req-024 | Agent 级别 LLM 配置 | **推 v0.7（与调度器同期）** | 模型配置在 dispatch 阶段注入，与 req-014 强耦合 |

**req-030 / req-031** 为 v0.6 规划期新建需求（详见本文件对应功能设计章节）。

### 版本边界

> 详细的版本裁定依据见上方「需求范围评估」表，以下为精简汇总。

**本版本做**：
- req-013：状态机后端（SQLite 存储 + REST API + WebSocket 事件推送）
- req-030：Agent 注册表 UI（工具管理模式，P2 列表 + P4 详情）
- req-016 当前状态视角：控制台模式 P3 任务总览（跨项目，按状态分组，无项目流水线视图）
- req-017 只读执行流：任务详情中的执行日志流（只读，不含打断/重新引导功能）
- req-018：决策收件箱（P3 独立视图，主对话角标通知）
- req-031：手动触发任务（控制台模式 P3「+ 触发任务」入口，创建 pending 任务记录）

**本版本不做**：
- req-014 真实多 Agent 并发调度 → 推 v0.7（v0.6 的任务可用测试数据填充）
- req-015 上下文构建器 → 推 v0.7（依赖 req-014）
- req-016 项目视角（版本流水线视图）→ 推 v0.7
- req-016 Agent 平面打断/重新引导 → 推 v0.7（req-017 v0.6 只读）
- req-019 流水线自动触发规则 → 推 v0.7
- req-020 主对话保护 → 依赖 req-014，推 v0.7
- req-021 记忆 Agent → 推 v0.x 后期（无确定版本）
- req-022 Agent 沙盒 / req-023 Harness 管控层 → 推 v0.8
- req-024 Agent 级别 LLM 配置 → 推 v0.7（与 req-014 同期）

> **v0.6 核心约束**：任务状态机 v0.6 是数据层，v0.6 的「触发任务」只创建任务记录（status=pending），不驱动实际 Agent 执行。真实 Agent 调度能力是 req-014（v0.7），这让 v0.6 在 1-2 周内可交付，同时为 v0.7 打好数据通道。

### 选取理由

- **A3 路线图第一节点**：v0.6 是 A3 完整目标（真实多 Agent 调度 + 隔离实例 + UI 全套）三阶段路线图的起点。req-013 状态机是数据通道，没有它 v0.7 调度层无处落地；v0.6 先交付数据层是路线图逻辑上的必然选择
- **可演示**：v0.6 完成后，用户打开工作台 → 切到工具管理模式看 Agent 列表 → 切到控制台看任务状态 → 在收件箱处理一条决策 → 触发一个新任务。这个闭环可以向董事长演示，不依赖后台真实 Agent 运行（用测试数据即可）
- **阶段降险**：v0.6 只做 UI + 数据层，不碰 Agent 调度架构，风险可控
- **基础建设**：req-013 状态机是 v0.7 真实调度、v0.8 沙盒/管控的前提，必须在此版本打好

---

## 功能设计

### req-013 · Agent 任务状态机（后端）

#### 存储层

使用 SQLite 新建 `agent_tasks` 表（与现有 `llm_calls`、qa_atom 等共用同一 SQLite 数据库）：

```sql
CREATE TABLE agent_tasks (
    task_id           TEXT PRIMARY KEY,
    type              TEXT NOT NULL,   -- product-planning/review/engineering/memory/custom
    role              TEXT NOT NULL,   -- workbench-product/review-agent/frontend-ui/...
    status            TEXT NOT NULL,   -- pending/running/blocked/awaiting-decision/completed/failed
    project           TEXT,
    version           TEXT,
    title             TEXT,            -- 任务摘要（展示用，来自创建时的描述前50字）
    input_context     TEXT,            -- 触发时的上下文 prompt
    output            TEXT,            -- 产出物（文件路径或报告摘要）
    blocking_on       TEXT,            -- 当 status=blocked 时，等待什么
    decision_question TEXT,            -- 当 status=awaiting-decision 时，需要用户决策的问题
    decision_options  TEXT,            -- JSON 数组，预设选项（如 ["Approve", "Reject"]）
    risk_level        TEXT,            -- low | medium | high（决策风险等级）
    capability_token  TEXT,            -- v0.6 简化：DELIVERABLE | APPROVED | MERGEABLE（v0.7 拆为独立表）
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);

CREATE TABLE agent_task_events (
    event_id      TEXT PRIMARY KEY,
    task_id       TEXT NOT NULL REFERENCES agent_tasks(task_id),
    event_type    TEXT NOT NULL,   -- thinking/tool-call/file-write/decision/output/status-change
    content       TEXT,            -- 事件内容摘要
    detail        TEXT,            -- 可展开的详细内容（JSON）
    status        TEXT,            -- in-progress/completed/failed
    created_at    TEXT NOT NULL
);
```

#### API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/tasks` | 查询任务列表，支持 `?role=&status=&project=` 过滤 |
| GET | `/tasks/:task_id` | 单任务详情（含 events 列表） |
| POST | `/tasks` | 创建新任务（req-031 触发入口使用） |
| PATCH | `/tasks/:task_id` | 更新任务状态/输出（Agent 写入结果使用） |
| GET | `/tasks/:task_id/events` | 获取该任务的执行事件流 |
| POST | `/tasks/:task_id/events` | 追加执行事件（Agent 写入执行步骤使用） |

#### 事件推送（WebSocket）

- `/ws/tasks`：任务状态变更时推送事件（`{ type: "task_updated", task_id, status, ... }`）
- `/ws/tasks/:task_id/events`：特定任务的执行事件实时推送（`{ type: "event_appended", event_id, ... }`）

前端订阅后，任务状态变化和新执行事件均无需轮询即可更新。

#### 权限令牌（v0.6 简版）

v0.6 先建立令牌字段，不做完整令牌逻辑（推 v0.7）：
- `agent_tasks` 表增加 `capability_token` 字段（TEXT，可 null）
- 令牌值：`DELIVERABLE` / `APPROVED` / `MERGEABLE`
- v0.6 可手动通过 API 写入，不做自动颁发逻辑

#### 验收标准

- `POST /tasks` 创建任务 → `GET /tasks` 返回该任务，status=pending
- `PATCH /tasks/:id` 更新 status=running → WebSocket 推送状态变更事件（Tauri 前端收到）
- `POST /tasks/:id/events` 追加一条执行事件 → `GET /tasks/:id/events` 返回该事件
- 并发写入测试：同时 PATCH 同一任务 5 次，最终状态一致（SQLite 事务保证）

---

### req-030 · Agent 注册表 UI

#### 面板归属

- **工具管理模式**（req-003 已定义）下新增次级导航：「技能」/ **「Agent 团队」**
- P1 点击「工具管理」图标 → P2 顶部显示次级 Tab（「技能」/「Agent 团队」）
- 选「Agent 团队」Tab → P2 显示 Agent 注册表列表

#### P2 Agent 列表

数据来源：后端 `/agents/registry` 接口，读取 `agent-registry/registry.yaml`，与状态机 `/tasks?status=running` 合并响应。

每个 Agent 卡片（垂直列表，类似 P1 NavList 风格）：
```
┌─────────────────────────────┐
│ ● workbench-product          │  ← 状态指示器（● 蓝=运行中，灰=闲置）
│   产品规划师                  │  ← 角色描述（一句话）
│   当前任务：1 个运行中         │  ← 来自状态机 API
└─────────────────────────────┘
```

状态指示器颜色规则：
- 灰：无运行中任务（闲置）
- 蓝：有 status=running 任务
- 橙：有 status=awaiting-decision 任务（需要用户处理）
- 红：有 status=failed 任务

#### P4 Agent 详情

选中某角色 → P4 展示：

1. **角色信息区**：角色名、定位描述、激活方式（来自 AGENT.md 解析）
2. **当前任务区**：该角色的任务列表（running + awaiting-decision + failed），点击跳转控制台模式任务详情
3. **角色文档区**：AGENT.md 完整内容 Markdown 渲染（只读）

后端接口：
- `/agents/registry`：返回所有注册 Agent 的基本信息（role、description、status 统计）
- `/agents/:role/doc`：返回该 Agent 的 AGENT.md 原文（Markdown）；**若该 Agent 的 AGENT.md 不存在**（v0.6 阶段 AGENT.md 补齐为后续基建任务），降级返回 `agent-roster.md` 中对应角色的描述段落，不返回空内容

#### 验收标准

- 切换工具管理模式 → 点「Agent 团队」Tab → P2 显示所有注册 Agent 卡片
- 点击一个卡片 → P4 滑入，显示该 Agent 的 AGENT.md Markdown 内容
- 若该 Agent 的 AGENT.md 不存在，P4 显示来自 agent-roster.md 的角色描述段落，不显示空白
- 若有运行中任务，状态指示器显示蓝色，当前任务数 > 0
- 后端 registry.yaml 无法读取时，P2 显示「暂无 Agent 数据，请检查 registry.yaml」降级提示

---

### req-016（精简版）· 任务总览（当前状态视角）

#### 面板归属

**控制台模式** P3 主内容区，分为两个子视图（顶部 Tab 切换）：
- **任务总览**（本需求）
- **决策收件箱**（req-018）

#### 任务总览 UI

跨项目所有任务，按状态分组展示：

```
[待执行  2] [运行中  3] [等待决策  1] [已完成  12] [失败  0]
─────────────────────────────────
▼ 待执行（2）
  ┌─────────────────────────────────────────────────┐
  │ frontend-ui · v0.6 前端架构实现                   │
  │ 工作台 · v0.6 · 刚创建                            │
  └─────────────────────────────────────────────────┘
  ... （更多 pending 任务）

▼ 运行中（3）
  ┌─────────────────────────────────────────────────┐
  │ workbench-product · v0.6 产品文档初稿             │
  │ 工作台 · v0.6 · 已运行 2h 15m                    │
  │ 当前步骤：功能设计 req-016 章节                    │
  └─────────────────────────────────────────────────┘
  ... （更多运行中任务）

▼ 等待决策（1）
  ┌─────────────────────────────────────────────────┐
  │ review-agent · v0.6 product.md 质检              │
  │ 工作台 · v0.6 · 等待 45m · ⚠️ 中风险             │
  │ 等待：CEO 审批 product.md 是否 approved          │
  └─────────────────────────────────────────────────┘
```

任务卡片字段：
- 执行角色 + 任务标题（`title` 字段）
- 所属项目 + 版本 + 已运行时长
- 当前步骤（最新 event 的内容摘要，coming from `agent_task_events`）
- 等待原因（status=awaiting-decision 时显示 `blocking_on`）

点击任务卡片 → 展开执行流视图（req-017）

#### 状态实时更新

WebSocket 订阅 `/ws/tasks`，状态变更时对应卡片即时更新（无需刷新）。状态分组计数随之更新。

#### 验收标准

- 控制台模式 P3 显示任务总览，任务按状态分组
- WebSocket 状态推送：手动通过 API 更新某任务 status → 前端对应卡片状态即时变化
- 点击任务卡片 → 展开执行流视图（req-017 联动）
- 无任务数据时，各分组显示「暂无」而非空白区域崩溃

---

### req-017（精简版）· 执行流视图（只读）

#### 触发方式

从任务总览点击任务卡片后，P3 切换到执行流视图（返回按钮可回到总览）。

#### 执行流内容

时序日志，每条条目包含：
- **类型标签**：`思考` / `工具调用` / `文件写入` / `决策` / `输出`（对应 `event_type` 字段）
- **内容摘要**：`content` 字段（单行，可点击展开 `detail`）
- **时间戳**
- **状态指示器**：进行中（旋转图标）/ 已完成（✓）/ 失败（✗）

条目列表默认展示最新 50 条，支持向上滚动加载更多。

#### 实时追加

WebSocket 订阅 `/ws/tasks/:task_id/events`，Agent 写入新执行事件时，前端追加新条目到列表底部（类似 ChatView 的流式效果）。

#### 类型筛选

顶部提供类型筛选 Pills（「全部」/ 「工具调用」/ 「决策」/ 「输出」），切换后过滤显示。

#### 不做（v0.6 明确排除）

- 不实现「打断并重新引导」（在执行流中向 Agent 插入修正指令）→ 推 v0.7
- 不实现搜索功能 → 推 v0.7（类型筛选足够）

#### 验收标准

- 点击任务卡片 → 执行流视图显示该任务的 events 列表（时间正序，最新在底部，向上滚动加载更早事件）
- 每条事件可点击展开详情（`detail` JSON 字段，raw 显示即可）
- 类型筛选 Pills 工作正常，切换「工具调用」后只显示 event_type=tool-call 的条目
- WebSocket 实时追加：手动通过 API 追加一条 event → 前端执行流底部即时出现新条目

---

### req-018 · 决策收件箱

#### 面板归属

控制台模式 P3，与任务总览并列为顶部 Tab：**「任务总览」** / **「决策收件箱」**。

主对话 TopBar（req-010 已实现）新增决策数量角标，显示当前 pending 决策数（数字角标，红色气泡）。

#### 收件箱 UI

每条决策请求（status=awaiting-decision 的任务）展示为一张卡片：

```
┌──────────────────────────────────────────────────────────┐
│ ⚠️ 中风险  ·  来自 review-agent  ·  等待 45 分钟          │
│ product.md v0.6 是否可以 approve？                        │
│                                                          │
│ 背景：review-agent 完成质检，🔴=0 🟡=0，请 CEO 决策      │
│ 若继续等待将阻塞：frontend-ui 开始实现（v0.6）             │
│                                                          │
│  [✓ Approve]   [✗ 拒绝并说明原因]   [→ 稍后处理]         │
└──────────────────────────────────────────────────────────┘
```

卡片字段（来自 `agent_tasks` 表）：
- 风险等级（`risk_level` 字段，创建任务时写入）
- 来源 Agent（`role`）
- 等待时长（`updated_at` 到现在的 elapsed）
- 决策问题（`title` 字段）
- 背景说明（`input_context` 字段）
- 阻塞影响（`blocking_on` 字段）
- 操作按钮

#### 操作行为

- **Approve**：调用 `PATCH /tasks/:id`，status → `running`（任务恢复继续执行），`capability_token` 写入「APPROVED」；注：`awaiting-decision` 决策通过后任务应恢复运行而非标记为已完成，`completed` 只在任务全部产出物交付后才应使用
- **拒绝**：弹出文本框输入原因 → PATCH status → `failed`，`output` 写入拒绝原因
- **稍后处理**：不变更状态，收件箱卡片保留（用户关闭收件箱后仍积累）

操作完成后，该卡片从收件箱移除（status 已不是 awaiting-decision），TopBar 角标数字 -1。

#### 风险等级视觉区分

- 低（建议）：蓝色边框
- 中（影响当前版本）：橙色边框
- 高（数据风险 / 范围重大变更）：红色边框 + 顶部固定置顶

#### 角标通知

TopBar 角标：`awaiting-decision` 任务数量，来自 WebSocket 订阅的实时统计。数量 = 0 时角标消失。

#### 验收标准

- 存在 status=awaiting-decision 的任务时，TopBar 显示红色角标（数字正确）
- 打开决策收件箱 → 每条 awaiting-decision 任务显示为决策卡片（字段正确渲染）
- 点击「Approve」→ API 调用成功 → 该任务 status=running，卡片从收件箱消失，角标 -1，任务出现在任务总览「运行中」分组
- 点击「拒绝」→ 弹出文本框 → 输入原因 → 提交 → status=failed，卡片消失
- 角标实时更新（WebSocket 驱动，无需刷新）

---

### req-031 · Agent 任务手动触发 UI

#### 面板归属

控制台模式 P3 任务总览顶部固定「+ 触发任务」按钮（位于分组 Tab 右侧）。

#### 触发表单

点击「+ 触发任务」后，P4 展开任务配置表单（利用 P4 详情面板，不覆盖 P3）。**P4 内容优先级规则**：「+ 触发任务」点击后，P4 切换为触发表单，若当前 P4 正展示 Agent 详情（req-030），则切换后 Agent 详情暂时隐藏，关闭表单或提交后 P4 恢复空白（不自动回到之前的 Agent 详情，避免状态歧义）：

| 字段 | 说明 | 类型 | 必填 |
|------|------|------|------|
| 执行角色 | 从 req-030 Agent 注册表中选择 | 下拉选择 | 是 |
| 任务类型 | product-planning / review / engineering / custom | 单选 | 是 |
| 任务描述 | 自由文本，作为 input_context | 多行文本（max 2000 字符） | 是 |
| 所属项目 | 下拉选择（来自现有项目列表） | 下拉选择 | 否 |
| 所属版本 | 自由输入 | 文本输入 | 否 |
| 优先级 | low / medium / high | 单选 | 否（默认 medium）|

#### 提交行为

- 调用 `POST /tasks`，创建 status=pending 的新任务记录
- P3 任务总览中「等待中」分组即时出现新任务卡片（WebSocket 驱动）
- P4 表单显示「任务已加入队列（status: pending），等待 Agent 执行」提示文字
- 表单保持打开（方便连续触发），内容不自动清空（方便参考上一次）
- 提交中按钮显示 Loading，防止重复提交

#### 重要说明：v0.6 任务不自动执行

v0.6 创建的任务停留在 pending，需要 Agent 手动接取或 v0.7 调度器驱动。UI 明确标注此说明，不给用户「点了就会执行」的误导。

#### 验收标准

- 控制台模式 P3 显示「+ 触发任务」按钮
- 点击 → P4 展开表单 → 选角色 + 填写描述 → 点「提交」→ 任务出现在 P3 任务总览（status=pending）
- 必填字段（角色+描述）为空时，提交按钮禁用
- 提交成功后显示提示文字，说明 v0.6 任务为 pending 状态

---

## 关键数据流

### v0.6 控制台模式整体数据流

```
用户打开控制台模式（P3）
    ↓
前端 WebSocket 连接 /ws/tasks
    ↓
GET /tasks → 渲染任务总览（按状态分组）
GET /tasks?status=awaiting-decision → 渲染收件箱 + TopBar 角标数

─────────────────────────────────────────────────────
用户点击任务卡片 → GET /tasks/:id/events → 渲染执行流视图
前端 WebSocket 连接 /ws/tasks/:id/events → 实时追加新事件

─────────────────────────────────────────────────────
用户在收件箱点击 Approve
    ↓ PATCH /tasks/:id { status: "running", capability_token: "APPROVED" }
    ↓ WebSocket 推送 task_updated 事件
前端：收件箱卡片消失，TopBar 角标 -1，任务总览该任务移入「运行中」分组

─────────────────────────────────────────────────────
用户点击「+ 触发任务」→ 填表单 → POST /tasks
    ↓ WebSocket 推送新任务 task_created 事件
前端：任务总览「等待中」分组出现新任务卡片
```

### Agent 注册表数据流

```
用户切换工具管理模式 → 点「Agent 团队」Tab
    ↓
GET /agents/registry
    → registry.yaml 解析 + GET /tasks?status=running 合并
    → 返回 [{ role, description, running_count, ... }]

前端 P2 渲染 Agent 卡片列表（WebSocket 订阅状态实时更新卡片颜色）

用户点击卡片 → GET /agents/:role/doc（返回 AGENT.md 原文）
    → P4 Markdown 渲染
```

---

## 数据埋点计划

根据团队章程 6.5 要求，v0.6 需收集以下埋点数据，写入新建的 `ui_events` 表（不影响核心状态机）。`ui_events` 表与状态机迁移脚本同级管理（同一 SQLite 数据库，独立 CREATE TABLE 语句），由后端工程 Agent 在 technical.md 的迁移节点中实现：

```sql
CREATE TABLE ui_events (
    event_id    TEXT PRIMARY KEY,
    event_name  TEXT NOT NULL,
    payload     TEXT,           -- JSON
    created_at  TEXT NOT NULL
);
```

### 核心埋点列表

| 埋点名称 | 触发场景 | payload 字段 |
|---------|---------|-------------|
| `agent_registry_opened` | 用户切换到 Agent 团队 Tab | `{ session_id }` |
| `agent_detail_viewed` | 用户点击某 Agent 卡片查看详情 | `{ role }` |
| `task_overview_opened` | 用户打开控制台任务总览 | `{ session_id }` |
| `task_detail_opened` | 用户点击任务卡片展开执行流 | `{ task_id, role, status }` |
| `decision_inbox_opened` | 用户打开决策收件箱 | `{ pending_count }` |
| `decision_approved` | 用户点击 Approve | `{ task_id, role, wait_minutes }` |
| `decision_rejected` | 用户点击拒绝 | `{ task_id, role, wait_minutes }` |
| `decision_deferred` | 用户点击稍后处理 | `{ task_id, risk_level }` |
| `task_triggered` | 用户手动触发新任务 | `{ role, type, has_project, has_version }` |

### 关键指标（product 关注）

- **决策收件箱处理率**：decision_approved + decision_rejected / 总 awaiting-decision 任务（反映用户是否在用收件箱）
- **决策平均等待时长**：`wait_minutes` 均值（反映 Agent 等待决策的效率损耗）
- **手动触发任务频次**：task_triggered 日均次数（反映用户是否开始从 UI 调度 Agent）
- **执行流视图打开率**：task_detail_opened / task_overview_opened（反映用户对执行透明度的需求）

埋点数据供 workbench-analytics 在下一版本分析，v0.6 只采集不分析。

---

## 产品边界确认

**v0.6 不做的事**：
- 不实现 Agent 真实执行（任务停留在 pending，req-014 推 v0.7）
- 不实现执行流的打断/重新引导能力（req-017 v0.6 只读）
- 不实现流水线自动触发（req-019 推 v0.7）
- 不实现 Agent 沙盒和管控层（req-022、023 推 v0.8）
- 不修改已有对话界面和 token 可见性功能（v0.3~v0.5 成果保留）
- 不实现 Agent 角色的在线编辑（req-030 只读注册表）

**v0.6 对用户的可见变化**：
- 工具管理模式新增「Agent 团队」Tab，可查看所有注册 Agent
- 控制台模式 P3 新增任务总览 + 决策收件箱两个子视图
- TopBar 出现决策待处理角标（橙/红数字气泡）
- 控制台模式 P3 可点击「+ 触发任务」创建任务记录

**需要 design-agent 确认的视觉决策**：
- 任务总览卡片的信息密度（当前设计包含 4 行信息，是否可接受）
- 执行流视图与任务总览的切换方式（P3 内部切换 vs 打开 P4）
- 决策收件箱卡片的操作按钮布局（「Approve / 拒绝 / 稍后处理」是否加确认二次弹窗）

---

## 版本一致性说明

v0.6 是「Control Room 建设」版——在 v0.1~v0.5 完成的对话和 LLM 调用链基础上，加入 Agent 管理维度。

**与产品方向文档的一致性**：
- 产品方向「我管理 AI」维度：v0.6 是此方向的第一个实质交付
- 产品方向「前端逻辑 Human first」：任务总览、收件箱、注册表均为人机交互界面，符合定位
- 产品方向「降低人管理 AI 团队的认知负担，保留人的控制权」：收件箱和手动触发正是这一原则的体现
- Panel 职责边界：控制台模式 P2（结构列表，未来可扩展到 Agent 树）、P3（主工作区，任务总览/执行流/收件箱）、P4（详情，Agent 详情/触发表单）——与产品方向各面板职责定义一致

**与 req-003 的关系**：控制台模式已在 req-003 中定义，v0.6 是控制台模式的首次实质填充。工具管理模式 Agent 团队子视图通过 P1 次级导航接入，不影响 req-003 的模式切换逻辑。

---

## 修订记录

| 版本 | 日期 | 作者 | 说明 |
|------|------|------|------|
| v1 | 2026-05-19 | workbench-product | 初稿，基于 CEO 调度指令 2026-05-19-agent-management-kickoff.md |
| v2 | 2026-05-19 | review-agent | Round 1 修复：B-01「四件事」改「六件事」（数字与列表一致）、B-02 agent_tasks 表补充决策字段（decision_question/decision_options/risk_level/capability_token）、B-03 Approve 操作后 status 改为 running（而非 completed，语义修正）、W-01 capability_token 注释说明 v0.6 降级策略（v0.7 拆独立表）、W-02 任务总览新增「待执行（pending）」分组、W-03 P4 面板切换优先级规则明确（触发表单覆盖 Agent 详情，关闭后恢复空白）、W-04 ui_events 表管理方式说明（同 SQLite，独立 CREATE TABLE，随状态机迁移脚本管理）|
| v3 | 2026-05-19 | workbench-ceo | 补充「A3 完整实现路线图定位」章节，明确 v0.6 = A3 第一阶段，v0.7 = 真实调度层，v0.8 = 沙盒管控层 |
| v4 | 2026-05-19 | workbench-product | 董事长 A3 决策后完整修订：新增「需求范围评估（req-013～req-024 全量审视）」章节，逐条裁定所有 13 个需求的 v0.6 决策；「本版本不做」补充 req-021 记忆 Agent（推无确定版本）和 req-024 Agent 级别 LLM 配置（推 v0.7）；doc_revision 更新为 4，重置 status 为 draft 以触发新一轮 review-agent 质检 |
| v5 | 2026-05-19 | review-agent | Round 2 修复：B-01 数据流图 Approve 后 status 修正为 running（原为 completed，与操作行为章节不一致）、B-02 req-018 验收标准 Approve 后 status 修正为 running 并补充「移入运行中分组」说明、W-01 版本边界章节增加交叉引用注（指向需求范围评估表）、W-02 选取理由补充「A3 路线图第一节点」条目、W-03 doc_revision 同步为 5 |
| v6 | 2026-05-19 | review-agent | Round 3 修复：B-01 收件箱卡片「风险等级」字段来源从 blocking_on 改为 risk_level（与 DDL 定义一致）、W-01 req-030 P4 补充 AGENT.md 不存在时的降级策略（回退到 agent-roster.md，验收标准同步新增一条）、W-02 执行流视图验收标准「时间倒序，最新在底部」矛盾表述改为「时间正序，最新在底部，向上滚动加载更早事件」|
