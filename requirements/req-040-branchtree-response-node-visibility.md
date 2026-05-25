---
id: req-040
title: BranchTree 响应节点可见（ai-done 后加入项目 atom 列表）
status: done
priority: high
source: session-fix
created: 2026-05-21
version: v0.11
---

# req-040 · BranchTree 响应节点可见

## 问题根因

`ChatView.tsx` 在 AI 响应完成（`ai-done`）后，将完整的 Q&A atom（含问题 + AI 回答）写入磁盘。但写入磁盘后，**未将该 atom 加入当前项目的 atom 列表**（即项目文件中记录的 `atomIds`）。

**后果**：BranchTree（P2 分支树）的展示数据来源于「当前项目的 atom 列表」，过滤层只展示属于当前项目的 atom。由于新 atom 未被加入项目，BranchTree 的过滤层看不到它，导致：

1. 用户发送消息、AI 回答后，BranchTree 没有新节点出现
2. 刷新或重启后，新 atom 同样不出现（因为项目文件的 `atomIds` 中没有该 ID）
3. 用户看到「聊天在进行，但分支树不更新」的割裂感

## 修复方案

在 `ai-done` 事件回调中，写入磁盘成功后，调用 `addAtomToProject(projectId, atomId)` 将该 atom 加入当前项目的 atom 列表：

1. 更新内存状态中的 `currentProject.atomIds`
2. 异步将更新后的项目文件写回磁盘
3. BranchTree 的响应式过滤层因状态更新自动重新渲染，新节点出现

修复位置：`src/components/ChatView.tsx`（`ai-done` 回调区域）+ 相关的 store action（`addAtomToProject`）。

## 验收指标

| 验收项 | 标准 |
|--------|------|
| 回答完成后 BranchTree 更新 | AI 回答完成后，BranchTree 立即出现新的对话节点，无需刷新 |
| 重启后节点持久存在 | 重启应用，打开同一项目，BranchTree 能看到之前对话的所有节点 |
| 节点层级正确 | 新节点在树中的位置符合 `prev` 字段的父子关系，不错乱 |
| 多轮对话节点累积正确 | 连续多条对话后，BranchTree 展示完整的多节点树，不丢失历史节点 |

## 实现状态

代码层面已在本 session 完成修复（`ai-done` 后调用 `addAtomToProject`，BranchTree 过滤层正确响应），technical.md 阶段可直接标记为 done。
