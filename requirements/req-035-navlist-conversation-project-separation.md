---
id: req-035
title: NavList 对话与项目数据分离展示
status: confirmed
priority: high
source: user-report
created: 2026-05-21
version: v0.10
---

# req-035 · NavList 对话与项目数据分离展示

## 问题描述

NavList 当前「对话」section 和「项目」section 渲染的是完全相同的数据（均为 `projects.map(...)`），导致用户看到两列重复内容，无法区分项目与对话。

## 概念澄清

用户定义的信息架构：

- **项目**（Project）= 大画布容器，对应 `ProjectMeta` 对象，有唯一 id / name，包含多条对话链
- **对话**（Conversation）= 项目内的一条对话链，对应 atoms 中 `prev === null` 的根节点（即对话树的起点）

当前展示逻辑错误地将「项目」数据复用到「对话」section，两个概念被混为一谈。

## 根因分析

`NavList.tsx` 中「对话」section 和「项目」section 均使用 `projects.map(...)` 渲染，无任何筛选。

正确的展示逻辑：
- **「项目」section**：展示 `projects` 列表（`ProjectMeta[]`），每一项为一个项目
- **「对话」section**：展示当前选中项目内，`atoms` 中 `prev === null` 的根节点（每个根节点代表一条独立对话链的起点）

## 修复方向

### 逻辑修复：对话 section 改为展示 root atoms

在 `conversationSlice`（Zustand store）或 NavList 组件内，对 `atoms` 数据做筛选：

```ts
const rootAtoms = atoms.filter(atom => atom.prev === null)
```

「对话」section 改为渲染 `rootAtoms`，每项展示该 atom 的 `question`（或前 N 字）作为对话标题。

### 展示策略

- 「项目」section：展示 `projects`，点击切换当前项目
- 「对话」section：展示当前项目下的 `rootAtoms`，点击选中该对话链根节点（`selectAtom(atom.id)`），P2/P3 联动更新
- 两个 section 各自保留独立的「+」按钮（分别对应 req-034 新建项目 / 现有新建对话逻辑）

### 不涉及数据模型变更

本需求**不改变任何数据模型**（不修改 `ProjectMeta`、`QAAtom` 的数据结构，不修改 Tauri 后端命令），只改变 NavList 的展示筛选逻辑。属于纯前端展示层修复。

### 对话标题生成策略

`QAAtom.question` 可能过长，展示时截断为前 30 字符，后跟省略号。若 `question` 为空（刚新建的空对话），显示「新对话」占位文字。

## 关键验收指标

| 验收项 | 标准 |
|--------|------|
| 对话与项目不重复 | NavList「对话」section 与「项目」section 展示不同数据，无重复条目 |
| 对话 section 正确筛选 | 「对话」section 仅展示当前项目内 `prev === null` 的 root atoms |
| 点击对话联动 P2/P3 | 点击对话列表中某条对话，P2 分支树、P3 对话视图联动切换至该对话链 |
| 空对话占位 | question 为空的 root atom 在列表中显示「新对话」，不崩溃、不显示空白 |
| 对话标题截断 | 超过 30 字符的 question 显示截断后文字 + 省略号 |
| 数据模型不变 | 无对 QAAtom / ProjectMeta 结构的修改，无后端命令变动 |

## 讨论记录

- 2026-05-21：用户报告数据重复问题，明确「项目 = 容器，对话 = 链」语义模型。本需求定性为纯展示层修复，不涉及数据模型变更。
