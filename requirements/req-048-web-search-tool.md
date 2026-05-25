---
id: req-048
title: 工具调用 - 联网搜索能力
status: backlog
priority: medium
source: user
created: 2026-05-24
version: ~
---

## 需求描述

在工作台的工具调用框架中添加联网搜索工具，让 AI 能够调用搜索 API 获取实时网络信息。

## 用户故事

作为工作台用户，我希望 AI 能够在对话中主动搜索网络，调研最新数据、查询实时信息，不再局限于 Vault 本地内容。

## 功能要求

- 新增 `web_search` 工具，加入 `TOOL_SCHEMAS`
- Rust 后端 `execute_tool.rs` 实现搜索调用逻辑
- 支持至少一种搜索 API（候选：Brave Search API / Serper.dev / Tavily）
- API Key 通过环境变量或前端配置注入，不硬编码
- 搜索结果截断到合理长度（防止上下文膨胀）

## 待决策

- 选用哪家搜索 API（需确认用户偏好和 API Key 来源）
- 搜索结果是否需要二次摘要（防止原始 HTML 噪音）

## 讨论记录

2026-05-24：用户提出需求，决定先入库不做，等待 API 方案确认后再实现。
