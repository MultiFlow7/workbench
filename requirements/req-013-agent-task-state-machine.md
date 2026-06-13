---
id: req-013
title: Agent 任务状态机（后端）
status: planned
priority: high
source: 对话讨论 2026-05-18
created: 2026-05-18
version: v0.6
---

# req-013 · Agent 任务状态机（后端）

## 需求描述

工作台后端维护一个持久化的任务状态机，作为所有 Agent 协作的共享"大脑"。Agent 本身无状态（LLM 天然如此），状态外化到这里。

## 核心数据结构

每个任务记录包含：
- `task_id`：唯一标识
- `type`：任务类型（product-planning / review / engineering / memory）
- `role`：执行角色（ceo / product-agent / review-agent / frontend-ui / desktop-platform）
- `status`：`pending | running | blocked | awaiting-decision | completed | failed`
- `project`：所属项目
- `version`：所属版本（如 v0.2）
- `input_context`：触发时注入的上下文摘要
- `output`：产出物（文件路径 / 报告内容）
- `blocking_on`：当 status=blocked 时，等待什么（用户决策 / 前置任务 ID）
- `created_at / updated_at`

## 权限令牌（Capability Tokens）

状态机除了管理任务状态，还负责颁发和撤销权限令牌。令牌是能力式权限的实现载体：

| 令牌 | 颁发条件 | 作用 |
|------|---------|------|
| `DELIVERABLE` | Review Agent 审查通过后，由确定性代码颁发 | Technical Agent 的 intake hook 凭此令牌才能拉取产品文档 |
| `APPROVED` | CEO 完成审批后颁发 | 工程 Agent 启动的前提条件 |
| `MERGEABLE` | QA 全部通过后颁发 | release 流程触发的前提条件 |

令牌的颁发和撤销只能通过确定性代码（非 Agent 自主操作），Agent 只能读取令牌存在与否，不能自行修改。

## 行为要求

- 任务状态变更时触发事件，前端实时更新可视化
- 支持并发任务（同一时刻多个 running 任务）
- 支持任务依赖（任务 B 等待任务 A 完成）
- 幂等写入：同一 Agent 多次写入相同输出不产生副作用
- 令牌操作原子性：颁发/撤销是原子操作，并发场景下不出现中间状态

## 讨论记录

**2026-05-18**：确定状态机是工作台后端的核心基础设施。Agent 的"持久性"不在 LLM 调用本身，而在状态机维护的任务生命周期。这使得真正的并发成为可能——多个 API 调用并行，共享读写同一状态机。
