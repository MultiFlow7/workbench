---
id: req-015
title: Agent 上下文构建器
status: done
priority: high
source: 对话讨论 2026-05-18
created: 2026-05-18
version: v0.7
---

# req-015 · Agent 上下文构建器

## 需求描述

每次 Agent 被调用前，上下文构建器负责将「任务状态 + 相关记忆/文档」拼装为完整的 prompt context，注入给当前 API 调用。这是 Agent "无状态 LLM + 外部状态"架构的核心连接层。

## 构建逻辑（Push-based，不由 Agent 拉取）

context 由进程主动推送给 Agent，Agent 不主动拉取任何信息：

1. **Role system prompt**：该 Agent 角色的固定行为边界
2. **Task state**：当前任务的结构化状态（来自 req-013 状态机）
3. **Relevant documents**：本次任务需要读取的文件（由任务定义明确列出，不由 Agent 自行决定读什么）
4. **Trigger context**：触发本次调用的原因（用户消息 / 前置任务完成 / workflow 路由）
5. **Memory injection**（v0.x 后期，由记忆 Agent 集群 push）：相关历史决策和背景

**Push 原则**：Agent 看到的就是它被允许看到的全部。不存在「Agent 自己决定去查什么」的情况——这样才能保证沙盒隔离（req-022）的结构性有效。

## 隔离原则

- 不同 Agent 角色收到的 context 严格按角色定义裁剪
- review-agent 不收到工程 Agent 的内部决策过程
- 工程 Agent 不收到其他并行工程 Agent 的中间状态
- CEO Agent 收到所有任务的状态摘要，但不包含各任务的详细执行日志

## 讨论记录

**2026-05-18**：用户指出状态共享应该靠「后端确定性代码」，记忆共享靠「上下文传递」（未来记忆 Agent 处理）。上下文构建器是这两条通道的汇聚点——把结构化状态和语义记忆一起打包给 Agent。
