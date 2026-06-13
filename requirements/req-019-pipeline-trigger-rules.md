---
id: req-019
title: 流水线触发规则（自动编排）
status: done
priority: medium
source: 对话讨论 2026-05-18
created: 2026-05-18
version: v0.7
---

# req-019 · 流水线触发规则

## 需求描述

基于状态机事件自动触发后续任务，实现产品开发流水线的自动流转，无需用户手动触发每一步。

## 核心触发规则（初始集合）

| 触发条件 | 自动动作 |
|---------|---------|
| vX.Y `technical.md` status → `approved` | 立即启动 vX.(Y+1) 产品规划（产品 Agent 读原型 + 需求池，生成候选清单，进入 `awaiting-decision`） |
| 工程 Agent 某节点完成 | review-agent 自动对对应文档跑一轮审查 |
| review-agent 返回 🔴=0 | 进入 CEO 审批队列（`awaiting-decision`），不自动 approve |
| 所有节点 `[x]` → technical.md 进度 = 100% | qa-agent 自动执行 AI 测试清单 |
| qa-agent 全部通过 | 推送「可进行人工验收」通知 |
| 需求 status → `confirmed` | 若当前版本 backlog 有空间，提示 CEO 考虑纳入 |

## 规则配置

- 规则应可在 UI 中查看（显示哪些规则激活中）
- v0.x 初期规则硬编码在后端；v0.x 后期支持用户在 UI 中自定义触发条件

## 讨论记录

**2026-05-18**：用户提出「产品/设计并行流水线」——technical.md approved 时立即启动下一版本产品规划，不等开发完成。这是首个核心触发规则，代表产品流水线的核心价值：自动消除等待期，最大化并行。
