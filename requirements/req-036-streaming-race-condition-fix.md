---
id: req-036
title: 流式响应 race condition 修复（ai-done 与 stream_ai 宏任务竞争）
status: done
priority: high
source: session-fix
created: 2026-05-21
version: v0.11
---

# req-036 · 流式响应 race condition 修复

## 问题根因

`ChatView.tsx` 的 `handleSend` 在发起 `invoke('stream_ai', ...)` 后设置了一个 30s 超时定时器（第一层超时），用于检测后端无响应的情况。

然而实现中存在第二层超时逻辑（在 `ai-done` 事件监听的某处），该定时器在 `ai-done` 事件触发后未被及时清除。由于 `ai-done` 事件回调与 `invoke('stream_ai')` 的 Promise resolve 属于不同的宏任务（macrotask），在以下竞争路径下会出错：

1. `invoke('stream_ai')` 开始执行，第二层超时定时器启动
2. 后端正常完成，`ai-done` 事件在第一个宏任务中触发并回调
3. 但回调内只执行了一次 `clearTimeout`（清除第一层），第二层定时器仍在运行
4. 第二层 30s 超时到达，错误地将 UI 状态置为「超时」，尽管对话已正常结束

**症状**：正常完成的对话，约 30s 后出现超时提示，或 UI 状态异常（流式结束后输入框被禁用）。

## 修复方案

在 `ai-done` 事件回调末尾增加第二次 `clearTimeout` 调用，确保第二层超时定时器也被清除。

修复位置：`src/components/ChatView.tsx`（或对应的 `useChat` hook），在处理 `ai-done` 事件的回调中，将两个超时定时器的 `clearTimeout` 均执行。

## 验收指标

| 验收项 | 标准 |
|--------|------|
| 正常对话不触发超时提示 | 发送消息后 AI 正常响应，对话结束后不出现超时错误提示 |
| 输入框在 ai-done 后恢复可用 | AI 回答完成后输入框立即可用，不会在 30s 后被错误禁用 |
| 真实超时仍能触发 | 模拟后端无响应，30s 后仍能正确触发超时提示（验证修复不破坏正常超时逻辑）|

## 实现状态

代码层面已在本 session 完成修复，technical.md 阶段可直接标记为 done。
