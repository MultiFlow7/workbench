---
id: req-022
title: Agent 沙盒（隔离执行环境）
status: in-progress
priority: high
source: 对话讨论 2026-05-18
created: 2026-05-18
version: v0.8
---

# req-022 · Agent 沙盒

## 需求描述

每个 Agent 在独立的执行容器（沙盒）中运行，与其他 Agent 的上下文完全隔离。沙盒定义了 Agent 能看到什么、能写到哪里，是结构性隔离而不是行为约束。

## 沙盒边界

### 可以读取（由 context builder 注入）
- 本次任务的状态描述（来自状态机）
- 指定的文档/文件（由任务定义明确列出）
- role system prompt（角色行为边界定义）

### 不可读取（结构性隔离）
- 其他 Agent 的对话历史
- 其他 Agent 的内部决策过程
- 未授权的文件或状态字段

### 可以写入（通过输出槽）
- 任务产出物（文档、代码、审查报告）
- 状态更新请求（需经 hook 验证才生效）

### 不可直接写入
- 状态机（必须经过状态机 API + hook 验证）
- 其他 Agent 的输入槽

## review-agent 的典型沙盒配置

- 注入：待审文档全文 + 审查维度 system prompt
- 不注入：工程 Agent 的决策过程、CEO 的讨论历史
- 产出：审查报告 + 状态更新请求（APPROVED / REJECTED + 原因）

## 讨论记录

**2026-05-18**：用户明确「每个 Agent 应该有自己的独立沙盒管控，沙盒内的 Agent 是无状态的」。沙盒是真实多 Agent 协作的基础——review-agent 的独立性靠结构保证，不靠 prompt 指令约束。
