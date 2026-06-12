---
id: req-037
title: 对话根节点结构重构（取消「新对话」占位 root atom）
status: done
priority: high
source: session-fix
created: 2026-05-21
version: v0.11
---

# req-037 · 对话根节点结构重构

## 问题根因

原实现中，「新建对话」操作会预先创建一个空的占位 root atom（`question: ''`，`answer: ''`，`prev: null`），代表一条「未开始的对话」。实际的第一条 Q&A 被追加为该占位节点的子节点，导致：

1. **数据模型语义模糊**：占位节点本身没有对话内容，却占据树根位置，`prev === null` 的节点不再可靠地代表「对话链起点」
2. **NavList 展示错误**：`req-035` 要求「对话」section 展示 `prev === null` 的 root atoms，但占位节点的 `question` 为空，展示为「新对话」占位；真正有内容的第一条消息不是根节点
3. **BranchTree 结构混乱**：分支树渲染从占位根节点出发，多出一层无内容节点，影响层级展示
4. **ChatView 路径计算**：`path(node)` 从根到当前节点，占位根节点被包含在路径中，但渲染时无内容，产生空白

## 修复方案

取消「新对话」占位 root atom 的预创建逻辑。改为：

- **新建对话时**：不写入磁盘，不创建任何 atom，只在 UI 状态中记录「当前处于空对话状态」
- **发送第一条消息时**：第一条 Q&A 直接作为根节点（`prev: null`）写入，成为该对话链的真正起点
- **NavList**：`prev === null` 的节点语义恢复为「有内容的对话链起点」，展示逻辑与 `req-035` 完全对齐
- **BranchTree**：从真实的第一条 Q&A 渲染树，无占位层级

受影响的组件：`NavList.tsx`（新建对话逻辑）、`ChatView.tsx`（handleSend 中首条消息的 prev 赋值）、`BranchTree.tsx`（树根节点查找逻辑）。

## 验收指标

| 验收项 | 标准 |
|--------|------|
| 新建对话不产生空节点 | 点击「新建对话」后，磁盘上无新文件写入，atom 列表无新增空节点 |
| 第一条消息成为根节点 | 发送第一条消息后，该 Q&A atom 的 `prev` 为 null，是该对话链唯一的根 |
| NavList 对话列表正确 | NavList「对话」section 展示的条目均有实际问题内容，无空标题占位条目 |
| BranchTree 根节点正确 | 分支树从第一条有内容的 Q&A 节点开始渲染，无多余空根层级 |
| 多轮对话路径正确 | 在已有多条消息的对话中继续发送，`path(node)` 计算正确，ChatView 渲染完整线性历史 |

## 实现状态

代码层面已在本 session 完成修复（NavList、ChatView、BranchTree 均已更新），technical.md 阶段可直接标记为 done。
