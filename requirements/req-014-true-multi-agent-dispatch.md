---
id: req-014
title: 真实多 Agent 调度（隔离实例，不角色扮演）
status: done
priority: high
source: 对话讨论 2026-05-18
created: 2026-05-18
version: v0.7
---

# req-014 · 真实多 Agent 调度

## 需求描述

每个 Agent 角色 = 一次独立的 Claude API 调用，带有专属 system prompt 和由上下文构建器注入的任务状态。不同角色之间通过状态机通信，而不是共享对话上下文。

## 核心要求

- **隔离性**：review-agent 调用时，只注入待审文档，不注入工程 Agent 的决策过程——这是结构性保证，不靠自律
- **并发性**：frontend-ui 实现节点 7 和 review-agent 审查 technical.md 可以同时触发两个独立 API 调用，真正并行
- **多租户**：同一 Agent 类型（如 review-agent）可以同时处理不同项目的任务，互不干扰
- **上下文注入**：每次调用由上下文构建器（req-015）负责构造 prompt，Agent 不依赖历史对话维持状态

## 与 req-013 的关系

Agent 调度依赖状态机（req-013）驱动：任务状态变为 `pending` → 调度器触发 API 调用 → Agent 完成后写回状态机 → 状态机触发后续任务或决策通知。

## 讨论记录

**2026-05-18**：用户明确指出现有"角色扮演"方式从根本上是错的。真实 Agent 团队 = 独立 API 调用 + 隔离上下文 + 共享状态机。review-agent 的独立性靠结构保证，不靠 prompt 里的角色指令。
