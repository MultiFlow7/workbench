---
id: req-033
title: 新建对话后发送内容无响应修复
status: confirmed
priority: high
source: user-report
created: 2026-05-21
version: v0.10
---

# req-033 · 新建对话后发送内容无响应修复

## 问题描述

用户新建对话后，在 ChatView 的输入框中输入内容并点击发送，没有任何反应。

## 根因分析

### 根因一：磁盘写入失败阻断内存状态更新

`NavList.tsx` 的 `handleNewConversation` 函数执行流程：

```
await invoke('write_qa_atom', ...)   ← 写根节点到磁盘
  ↓ 失败时 catch → return           ← 直接退出，后续不执行
appendAtom(rootAtom)                 ← 不执行
selectAtom(rootAtom.id)             ← 不执行
```

`invoke('write_qa_atom', ...)` 若因文件系统权限、路径不存在或 Tauri 后端异常而失败，catch 块直接 `return`，导致 `appendAtom` 和 `selectAtom` 均不执行。此时 `currentPath = []`，而 `ChatView.tsx` 的 textarea 有 `disabled={!currentPath.length}` 条件，输入框被禁用，用户无法输入。

### 根因二：handleSend 缺少 try/catch 导致静默失败

`ChatView.tsx` 的 `handleSend` 函数中：
- `generateNewAtomId()` 抛出异常时，整个 `handleSend` 静默失败，无任何用户可见错误
- `stream_ai` 的 `.catch` 仅设置 error 状态，但若 backend 未响应（不抛错、只是不回事件），UI 会永久卡在 streaming 状态，用户无法继续操作

## 修复方向

### 修复一：内存优先，磁盘异步写入

将 `handleNewConversation` 的执行顺序调整为：

1. 先在内存中创建对话（`appendAtom` + `selectAtom`），立即解锁 textarea
2. 再异步写磁盘（`invoke('write_qa_atom', ...)`）
3. 磁盘写入失败时：提示用户「对话已创建，但本地持久化失败，重启后可能丢失」，**不回滚内存状态**，不阻塞用户继续使用

设计理由：对话数据的即时可用性优先于持久化保障。当前阶段磁盘写入失败是边缘情况，用户体验不应因此降级为「输入框完全禁用」。

### 修复二：handleSend 错误边界

- 为 `generateNewAtomId()` 调用添加 try/catch，捕获异常后显示用户可见的错误提示（Toast 或 inline 错误文字）
- 为 `stream_ai` 添加超时机制（建议 30s），超时后自动退出 streaming 状态，显示「请求超时，请重试」提示
- streaming 状态下若 backend 连接断开（事件流中止），前端应能识别并退出 streaming 状态

## 关键验收指标

| 验收项 | 标准 |
|--------|------|
| 正常路径：新建对话后可输入 | 点击「新建对话」后，textarea 立即可用（不禁用），用户可输入文字并发送 |
| 降级路径：磁盘写入失败不阻塞 | 模拟 `write_qa_atom` invoke 失败，对话仍可在内存中创建，textarea 可用，页面出现持久化失败提示 |
| handleSend 错误可见 | 模拟 `generateNewAtomId()` 抛出异常，页面显示用户可读的错误提示，不静默失败 |
| streaming 超时退出 | 模拟 backend 无响应（不发事件），30s 后 streaming 状态自动退出，显示超时提示，输入框恢复可用 |

## 讨论记录

- 2026-05-21：用户报告，工作台 v0.9 实测复现。代码分析由 workbench-product 完成。内存优先策略为本次核心设计决策。
