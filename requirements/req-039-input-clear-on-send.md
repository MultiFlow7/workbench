---
id: req-039
title: 发送消息即清空输入框（引入 pendingQuestionRef）
status: done
priority: medium
source: session-fix
created: 2026-05-21
version: v0.11
---

# req-039 · 发送消息即清空输入框

## 问题根因

原实现中，`ChatView.tsx` 的 `handleSend` 在 AI 响应完成后（`ai-done` 事件触发时）才执行 `setInput('')` 清空输入框。

**问题**：用户点击发送后，输入框仍保留已发送的文字，直到 AI 完成回答（可能需要数秒到数十秒）才清空。这与用户对「发送」操作的预期不符——按下发送后，输入框应立即清空，表示消息已被接受。

**次要问题**：由于问题文字被 `setInput` 状态保持，问题内容在 streaming 期间直接从 React state 读取，导致 `pendingQuestion` 与 `input` 状态耦合，难以独立维护「当前 AI 正在回答的问题」这一信息。

## 修复方案

引入 `pendingQuestionRef`（`useRef<string>`）：

1. `handleSend` 触发时，将 `input` 当前值复制到 `pendingQuestionRef.current`
2. 立即执行 `setInput('')` 清空输入框（无需等待 AI 响应）
3. Streaming 过程中，问题文字从 `pendingQuestionRef.current` 读取，而非 `input` 状态
4. `ai-done` 后，`pendingQuestionRef.current` 置空（可选，视 UI 展示需要）

修复位置：`src/components/ChatView.tsx`（或对应的 `useChat` hook）。

## 验收指标

| 验收项 | 标准 |
|--------|------|
| 点击发送后输入框立即清空 | 用户点击发送（或按 Enter），输入框内容在同一渲染帧内清空，不等待 AI 响应 |
| 问题内容正确保留用于展示 | ChatView 在 streaming 期间能正确展示当前正在回答的问题（不丢失问题文字）|
| 多次连续发送不互相覆盖 | 在 AI 未回答完时发送第二条（如果允许），不影响第一条问题的展示 |

## 实现状态

代码层面已在本 session 完成修复（`pendingQuestionRef` 已引入，`setInput('')` 在发送时立即执行），technical.md 阶段可直接标记为 done。
