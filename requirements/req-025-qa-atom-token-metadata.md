---
id: req-025
title: QA Atom Token 元数据采集
status: done
priority: high
source: 对话讨论 2026-05-18
created: 2026-05-18
version: v0.3
---

# req-025 · QA Atom Token 元数据采集

## 需求描述

每次 AI 回复完成后，将本次调用的 token 消耗信息写入 QA atom 文件的 frontmatter。这是所有 token 分析功能（req-026/027/028）的数据基础。

## 数据字段

QA atom frontmatter 新增以下字段：

```yaml
---
id: "0001-002"
model: "gemini-2.5-pro"          # 本次调用的模型 ID
input_tokens: 2048                # 输入 token 数（含历史上下文）
output_tokens: 512                # 输出 token 数
context_tokens_used: 2048         # 发送时路径中所有历史 token 总量（不含本次输出）
context_window_limit: 1048576     # 该模型的上下文窗口上限
---
```

## 数据来源

- `model`：用户在 P3 选择的模型，发送时已知
- `input_tokens` / `output_tokens`：从 API 响应的 usage 字段读取（Claude API 返回 `input_tokens` / `output_tokens`；Gemini API 返回 `promptTokenCount` / `candidatesTokenCount`）
- `context_tokens_used`：发送前，沿 `currentPath` 将所有已有 atom 的 `input_tokens + output_tokens` 求和（近似值；精确值需要 tokenizer，先用近似）
- `context_window_limit`：后端维护一张模型→上限对照表（hardcode 常用模型，可配置扩展）

## 实现位置

- **Rust 后端**：`stream_ai` 完成后的 `ai-done` 事件 payload 扩展，新增 `{ usage: { input_tokens, output_tokens } }`
- **前端**：`ChatView.tsx` 的 `ai-done` 监听器接收 usage，写入 `write_qa_atom` 调用时带上 token 字段
- **`write_qa_atom`**：扩展 `QAAtom` 结构体，新增可选 token 字段（旧文件无此字段时不报错，兼容 v0.1 数据）

## 与 sub2api 的关系

sub2api 已在自己的日志里记录 token 消耗，但数据孤立于工作台。本需求将 token 数据写入 QA atom 文件本身（Obsidian 知识库的一部分），实现「数据随内容走」，不依赖 sub2api 日志。

## 讨论记录

**2026-05-18**：用户要求「每一个 QA 消耗的 token，输入输出都需要」，且「每个模型消耗了多少 token」。token 元数据写入 QA atom frontmatter 是最自然的存储位置——数据与内容共生，Obsidian 可直接查询，也是其他分析功能的基础。
