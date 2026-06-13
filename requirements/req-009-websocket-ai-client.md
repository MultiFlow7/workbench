---
id: req-009
title: AI 流式对话客户端（Tauri HTTP Plugin + SSE）
status: done
priority: high
source: 架构决策：AI streaming 走远程 sub2api，已验证流式可用
created: 2026-05-17
version: v0.1
---

# req-009 · AI 流式对话客户端

## 需求描述

P3 发送消息后，通过 Tauri HTTP Plugin（Rust 层）向 sub2api 发起流式请求，逐 token 推送到前端渲染。已验证：`203.0.113.10:8080/v1/messages` 支持 Anthropic SSE 格式流式输出。

## 协议（已验证）

**请求**：
```http
POST http://203.0.113.10:8080/v1/messages
x-api-key: <config>
anthropic-version: 2023-06-01
Content-Type: application/json

{
  "model": "gemini-2.5-pro",
  "max_tokens": 4096,
  "stream": true,
  "messages": [
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."}
  ]
}
```

**SSE 流式响应（标准 Anthropic 格式）**：
```
event: message_start
data: {"type":"message_start", ...}

event: content_block_delta
data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}

event: message_stop
data: {"type":"message_stop"}
```

前端只需处理 `content_block_delta` 事件提取 `delta.text` 拼接渲染。

## 为什么用 Tauri HTTP Plugin 而不是前端 fetch

浏览器 fetch 在 Tauri WebView 中处理 SSE 有兼容性问题。Tauri HTTP Plugin 在 Rust 层原生处理流式，每收到一个 SSE 事件通过 Tauri Event 推送给前端，可靠性更高。

## 实现结构

```
前端发送消息
  → invoke('stream_ai', { messages, model })   // Tauri Command
    → Rust: POST sub2api，读 SSE 流
      → 每个 content_block_delta
        → emit('ai-token', { text })           // Tauri Event 推前端
      → message_stop
        → emit('ai-done', { fullContent })
        → 调用 write_qa_atom 写本地文件
        → emit('ai-atom-saved', { atomId })    // 通知 P2 追加节点
```

## Tauri Commands / Events

```rust
// Command（前端调用启动流式请求）
#[tauri::command]
async fn stream_ai(
    app: AppHandle,
    messages: Vec<Message>,
    model: String,
    atom_id: String,
) -> Result<(), String>

// Events（Rust 推送给前端）
"ai-token"      → { text: String }
"ai-done"       → { atom_id: String, full_content: String }
"ai-error"      → { message: String }
"ai-cancelled"  → { atom_id: String }
```

## 验收标准

- [ ] 发送消息后 P3 立即显示加载动画
- [ ] token 逐字追加渲染，无卡顿
- [ ] 流式完成后：本地生成新 QA 原子 .md 文件，P2 追加新节点
- [ ] 用户点击停止 → Rust 中止 HTTP 请求，P3 显示已中止状态
- [ ] 网络错误时 P3 显示错误提示 + 重试按钮
- [ ] API key 和服务器地址从 Tauri 配置读取，不硬编码

## 依赖

req-001（Tauri 骨架）、req-005（P3 渲染）、req-008（write_qa_atom）
