---
id: req-026
title: 上下文窗口占用实时指示器
status: done
priority: high
source: 对话讨论 2026-05-18
created: 2026-05-18
version: v0.3
---

# req-026 · 上下文窗口占用实时指示器

## 需求描述

用户在 P3 输入框发送消息前，底部状态栏实时显示当前路径的上下文占用情况（`X / Y tokens · Z%`），帮助用户感知何时接近模型上下文窗口上限，主动决定是否开新分支。

## 显示形式

```
[进度条]  2,048 / 1,048,576 tokens · 0.2%   模型：gemini-2.5-pro
```

- 进度条颜色：0–70% 绿色，70–90% 橙色，90%+ 红色
- 超过 90% 时配合文字提示：「上下文接近上限，建议在此节点开新分支」
- 模型切换时立即重算（分母随模型而变）

## 数据来源

- **分子（context_tokens_used）**：沿 `currentPath` 对所有已有 atom 的 `input_tokens + output_tokens` 求和（近似值，与 req-025 同口径）
- **分母（context_window_limit）**：后端模型对照表中当前选中模型的上限值（req-025 同源）
- 数据均来自已落盘的 QA atom frontmatter，无需额外 API 调用

## 实现位置

- **前端 `ChatView.tsx`**：订阅 `currentPath`，每次路径变化重新求和，更新 `contextUsage` 状态
- **`conversationSlice.ts`**：新增 selector `selectContextTokensUsed`，遍历 currentPath atoms 求和
- **模型上限**：前端维护一张 `MODEL_CONTEXT_LIMITS` 常量表，与后端对照表共源（req-025 实现后复用）

## 与其他需求的关系

- 依赖 req-025（QA atom 需先写入 token 字段，指示器才有数据）
- 为 req-027（画布分析视图）提供单路径维度的直观感知
- `context_tokens_used` 字段规范与 req-025 统一

## 讨论记录

**2026-05-18**：用户要求「每一个节点作为父节点继续新的节点的时候，我需要知道现在的上下文占用」。实时指示器是最低成本的感知手段——用户在输入时即可看到当前路径的 token 负担，不需要主动查询。
