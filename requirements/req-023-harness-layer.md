---
id: req-023
title: Harness 管控层（hooks + 工作流 + 权限管理）
status: in-progress
priority: high
source: 对话讨论 2026-05-18
created: 2026-05-18
version: v0.8
---

# req-023 · Harness 管控层

## 需求描述

Harness 是整个 Agent 协作体系的管控外壳，防止 Agent 偷懒、跑偏或绕过流程。它不依赖 Agent 的行为自律，而是在状态机转换点设置结构性门控，使不符合条件的操作在架构层面不可执行。

## 三个核心子系统

### 1. Hook 网关

挂在状态机状态转换点上的检查器：

| Hook 类型 | 触发时机 | 作用 |
|-----------|---------|------|
| pre-hook | 状态转换请求到来时 | 检查前置条件是否满足，不满足则拒绝 |
| post-hook | 状态转换成功后 | 触发副作用（如通知、下游任务启动） |
| error-hook | 转换失败时 | 处理失败（重试、告警、降级） |

**关键示例**：Technical Agent 尝试拉取产品文档时，pre-hook 检查状态机中该文档是否持有 `DELIVERABLE` 令牌；若无，拒绝访问，Technical Agent 收到「文档尚未通过审查」的错误。

### 2. 工作流引擎（DAG）

定义 Agent 协作的有向无环图：
- 节点 = 任务类型（product-agent 任务 / review-agent 任务 / engineering 任务）
- 边 = 触发条件（状态 A 且持有令牌 X → 触发下一任务）
- 引擎负责按 DAG 调度任务，不由任何单一 Agent 决定下一步

Flow Agent（流程引导 Agent）是工作流引擎的自然语言接口，但决策权在引擎，不在 Agent 的判断。

### 3. 权限管理（能力式权限）

**核心区分**：
- **策略式权限**：「Agent 不应该做 X」→ 行为约束，可绕过
- **能力式权限**：「没有令牌就物理上拿不到 X」→ 结构性阻断

权限令牌由状态机颁发，在确定性代码层面操作，不由 Agent 自行主张：
- `DELIVERABLE`：产品文档通过审查后颁发，Technical Agent 才能拉取
- `APPROVED`：CEO 审批后颁发，工程 Agent 才能启动
- `MERGEABLE`：QA 全部通过后颁发，release 流程才能触发

## Harness 与 Agent 的关系

Agent 在沙盒内运行，感知不到 Harness 的存在——它只知道「我请求读取某文件，被拒绝了 / 成功了」。Harness 对 Agent 是透明的管控层，不是 Agent 能直接调用的接口。

## 实现优先级

初期只需实现最关键的 hook：
1. 产品文档审查通过门（`DELIVERABLE` 令牌）
2. 工程启动审批门（technical.md `status: approved`）

其余 hook 和完整 DAG 引擎可以迭代添加。

## 讨论记录

**2026-05-18**：用户描述「harness 是防止 Agent 跑偏或者偷懒，hook 会拒绝没有审查通过的产品文档交付，拒绝的判断依据来自状态改变（确定性代码）」。Harness 是整个 Agent 体系的完整性保证，使流程规则从纸面约束变为结构性强制。
