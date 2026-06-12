---
id: req-049
title: 对话框滚动跳动 bug 修复
status: done
priority: high
source: user
created: 2026-05-27
version: v0.14
---

# req-049 · 对话框滚动跳动 bug 修复

## 背景与问题描述

AI 流式生成时，聊天消息区域（`.chat-messages`）会持续跳动，严重影响阅读体验。

## 根因分析

问题由三个因素叠加导致：

1. **浏览器锚点补偿**：`.chat-messages` 容器未禁用 `overflow-anchor`，浏览器的滚动锚定机制在内容增长时自动补偿位置，导致视口上跳。

2. **smooth scroll 与气泡增长互相干扰**：`streamingState` effect 在 stream 开始时触发一次 `scrollIntoView({ behavior: 'smooth' })`，动画过程中气泡高度持续增长，产生抖动。

3. **整体重渲染**：每个 token 触发 `setStreamingText`，导致 ChatView 整体重渲染，包含所有 ReactMarkdown 气泡，进一步放大滚动问题。

## 修复方案

- 添加 `messagesContainerRef`，实现 `isNearBottom()` 判断（距底部 ≤ 80px 时返回 true）
- 实现 `scrollToBottom()` 方法（直接设置 `scrollTop = scrollHeight`，不使用 smooth）
- 删除 `streamingState` scroll effect（根源之一）
- `ai-token` 事件处理改为：`isNearBottom()` 为 true 时调用 `scrollToBottom()`
- CSS 对 `.chat-messages` 添加 `overflow-anchor: none`

## 实现状态

代码已在本次对话中修复，涉及文件：
- `ChatView.tsx`：添加容器 ref 和滚动逻辑，删除旧的 streamingState scroll effect
- `ChatView.css`：添加 `overflow-anchor: none`

## 验收标准

- AI 流式输出过程中，已滚动到底部时视口保持稳定，不发生跳动
- 用户手动向上滚动查看历史时，新 token 到来不强制滚回底部
- 流式开始时无 smooth scroll 抖动
