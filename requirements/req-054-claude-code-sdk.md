---
id: req-054
title: Claude Code SDK + Python ai-service 重定位
status: done
priority: critical
source: 架构决策 · 2026-05-28 · 解决工具循环成本问题 + 统一 AI 调用层
created: 2026-05-28
version: v0.15
---

# req-054 · Claude Code SDK + Python ai-service 重定位

## 背景

当前自建 Pipeline 存在两个结构性问题：
1. 工具调用循环在前端手动管理，n 次工具调用 = n+1 次 API 请求，触发 429 限速（req-052 根因）
2. Prompt Caching 的 `cache_control` 打在消息末尾，每轮 cache miss，开了比不开更贵（req-045 根因）

Claude Code SDK 内部自动处理这两个问题，同时提供语义化事件流（thinking / tool_use / tool_result / result），替代现在的 SSE 字节流解析。

## 架构设计

```
Claude Code SDK（执行引擎）      ← 管理 HOW
    ↓ Anthropic API 格式
    ↓ ANTHROPIC_BASE_URL
Python ai-service（模型路由器）  ← 管理 WHICH
    ├── claude-*    → Anthropic API（全功能）
    ├── gpt-*       → 格式转换 → OpenAI API
    ├── gemini-*    → 格式转换 → Gemini API
    └── deepseek-*  → 格式转换 → DeepSeek API
```

Python ai-service 从「直接调用 AI」重定位为「Anthropic 兼容代理」，对 SDK 呈现 Anthropic 格式接口，内部做 provider 路由和格式转换。v0.15 不回退任何现有 provider 支持。

## 自动解决的已有问题

- req-052（工具调用循环）：SDK 内部自动处理，req-052 dropped
- req-045（Caching 位置错误）：SDK 自动将 cache_control 打在工具定义层，req-045 done
- 429 限速：SDK 内置指数退避重试

## 验收标准

- [ ] Electron 主进程中 Claude Code SDK 成功初始化
- [ ] `ANTHROPIC_BASE_URL` 指向 Python ai-service，Claude 调用正常
- [ ] Python ai-service 接收 Anthropic 格式请求，路由 claude-* 直通正常
- [ ] 非 Claude provider（OpenAI / Gemini / DeepSeek）格式转换后正常响应
- [ ] 多轮工具调用在 SDK 内部闭环，前端只接收语义事件，不再手动发起 continuation
- [ ] Prompt Caching 命中率正常（cache_read > 0）
- [ ] 原有 sub2api 路由通过 `ANTHROPIC_BASE_URL` 配置继续工作
