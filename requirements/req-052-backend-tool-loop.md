---
id: req-052
title: 工具调用循环下沉到 Rust 后端
status: dropped
priority: high
source: 生产问题 · 2026-05-27 大量 429 限速
created: 2026-05-27
version: —
---

# req-052 · 工具调用循环下沉到 Rust 后端

## 背景

当前工具调用的协调逻辑在前端（`ChatView.tsx`）：

1. 前端发 `invoke('stream_ai')`
2. AI 返回 `ai-tool-call` 事件 → 前端收到
3. 前端调 `invoke('execute_tool')` 执行工具
4. 前端再发 `invoke('stream_ai')` 携带工具结果继续
5. 如有多轮工具调用，重复 2~4

**每一轮工具调用 = 1 次独立 HTTP 请求打到 sub2api。**  
n 次工具调用 = n+1 次 API 请求。

## 问题

- **触发 sub2api 限速（429）**：工具链长的对话每分钟打出 20~30 次请求，超出 upstream 限速
- **输入 token 随轮次线性增长**：每轮 continuation 带上所有历史 messages，越来越长
- **前端状态复杂**：`pendingMessagesRef`、`toolCallInProgressRef`、`systemPromptRef` 等 ref 都用于在前端维护工具链状态

## 目标设计

工具调用循环由 Rust 后端 `stream_ai` 内部完成，前端只参与「发起请求」和「接收流」：

```
前端 invoke('stream_ai', messages, tools)
  └→ Rust 内部 loop:
       ├→ 调 ai-service → AI 返回 tool_call
       ├→ emit 'ai-tool-start' (前端展示工具状态)
       ├→ Rust 调 execute_tool
       ├→ emit 'ai-tool-done'
       ├→ 把工具结果追加进 messages
       └→ 继续调 ai-service（同一次逻辑会话）
     最终 AI 返回 end_turn → 正常 ai-done 流式输出
```

sub2api 侧仍看到 n+1 次 HTTP 请求（API 协议本身无法合并），但：
- 这些请求由 Rust 后端发出，可在后端统一加 retry / backoff
- 前端不再感知中间轮次，复杂度大幅下降

## 验收标准

- [ ] 工具链全程在 Rust 内部闭环，前端不再调用第二次 `invoke('stream_ai')`
- [ ] 前端仍可通过 `ai-tool-start` / `ai-tool-done` 事件实时展示工具执行状态
- [ ] 429 等 upstream 错误在 Rust 层做指数退避重试（最多 3 次）
- [ ] 前端 `ChatView.tsx` 删除 `pendingMessagesRef`、`toolCallInProgressRef`、`systemPromptRef`
- [ ] 单条用户消息触发的工具链，前端只产生 1 次 `invoke('stream_ai')`

## 讨论记录

- 2026-05-27：生产日志显示今日 215 次 API 请求中 171 次（80%）为工具调用小型响应（59~61 tokens），触发 sub2api 429 限速；确认根本原因为工具调用协调逻辑在前端，每轮单独打一次 API 请求。决定记录为 confirmed 需求，在后续版本中实现。
