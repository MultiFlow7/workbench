---
id: req-030
title: Agent 注册表 UI
status: done
priority: high
source: CEO 调度指令 2026-05-19
created: 2026-05-19
version: v0.6
---

# req-030 · Agent 注册表 UI

## 需求描述

在工作台「工具管理」模式下，用 P2 面板展示当前 `agent-registry` 中已注册的 Agent 角色列表（读取 `registry.yaml`），用 P4 面板展示选中 Agent 的详情（AGENT.md 内容只读）。

这是「看得见 Agent 团队」的第一步：用户需要知道有哪些 Agent 可用，而不是靠记忆或命令行查询。

## 功能详述

### P2：Agent 注册表列表

每个 Agent 角色以卡片形式展示：
- **角色名**（如 `workbench-product`）
- **一句话定位**（来自 AGENT.md 或 registry.yaml 描述字段）
- **当前任务数**：当前处于 `running` 状态的任务数量（来自状态机 API）
- **状态指示器**：闲置（灰）/ 运行中（蓝）/ 有阻塞任务（橙）/ 有失败任务（红）

列表支持按状态筛选（「全部」/ 「运行中」/ 「有问题」）。

### P4：Agent 详情面板

选中某个 Agent 角色后，P4 展示：
- AGENT.md 完整内容（Markdown 渲染，只读）
- 当前分配给该角色的任务列表（关联 req-013 状态机数据）
- 每条任务的状态和摘要（可点击跳转到控制台模式的任务详情）

### 数据来源

- Agent 列表：后端提供 `/agents/registry` 接口，读取 `agent-registry/registry.yaml`
- 运行任务数：req-013 状态机 API（`GET /tasks?role={role}&status=running`）
- AGENT.md 内容：后端读取文件系统，返回 Markdown 原文

## 交互要求

- 切换到工具管理模式时默认显示 Agent 注册表（与现有技能注册表并列为子视图，通过 P1 次级导航切换）
- 点击角色卡片 → P4 滑入详情，不跳转模式
- 任务数实时更新（WebSocket 或 30s 轮询，与 req-016 共用状态推送通道）

## 验收标准

- 切换到工具管理模式 → 点击「Agent 团队」→ P2 显示所有注册 Agent 的角色卡片
- 点击任意角色卡片 → P4 展示该角色的 AGENT.md 内容（Markdown 正常渲染）
- 若该角色有运行中任务，卡片状态指示器显示蓝色，任务数 > 0
- 数据来源异常时（无法读取 registry.yaml），P2 显示降级提示而非白屏

## 讨论记录

**2026-05-19**：CEO 调度指令。Agent 注册表 UI 是「管理 Agent 团队」功能的入口层，不涉及调度逻辑，只做展示。v0.6 阶段只读，v0.7+ 再考虑在线修改 Agent 配置。
