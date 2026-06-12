---
id: req-024
title: Agent 级别 LLM 配置（每个角色可绑定不同底层模型）
status: in-progress
priority: medium
source: 对话讨论 2026-05-18
created: 2026-05-18
version: v0.9
---

# req-024 · Agent 级别 LLM 配置

## 需求描述

每个 Agent 角色可以独立配置底层 LLM（模型提供商 + 模型名称）。v0.x 早期所有 Agent 默认使用 Claude，后续支持按角色单独指定，无需修改代码。

## 使用场景

不同任务对模型能力和成本的要求不同：

| Agent 角色 | 可能的模型偏好 | 原因 |
|----------|------------|------|
| review-agent | Claude Opus（最强推理） | 文档审查需要最严格的逻辑判断 |
| product-agent | Claude Sonnet / Gemini 2.5 Pro | 长文档生成，性价比优先 |
| ceo-event | Claude Haiku | 事件响应逻辑简单，延迟敏感 |
| engineering agents | 按任务类型切换 | 代码生成可用专项模型 |

## 设计方向

配置存在角色定义文件中（`roles/{role_name}.md` frontmatter 或独立 `roles/{role_name}.yaml`）：

```yaml
role: review-agent
model:
  provider: anthropic        # anthropic | google | openai | custom
  model_id: claude-opus-4-7
  api_endpoint: ~            # 空则用全局默认（sub2api）
  max_tokens: 4096
  temperature: 0
```

调度器（req-014）在构建 API call 时读取角色配置，选择对应的 provider 和 endpoint。

## v0.x 默认行为

早期版本：所有角色的 `model` 字段未配置时，fallback 到全局默认模型（当前为 `gemini-2.5-pro` via sub2api），行为与现有一致。

## 与其他需求的关系

- 依赖 req-014（调度器）和 req-015（上下文构建器）先实现，模型配置在 dispatch 阶段注入
- 不影响主对话路径（ceo-main 的 stream_ai 走独立路径，模型由前端用户选择）

## 讨论记录

**2026-05-18**：用户提出「不同 Agent 需要的底层 LLM 是不同的，早期先默认都用 Claude，后续要支持这个能力」。这是一个设计预留需求——v0.2 调度器实现时在角色配置结构中预留 `model` 字段，实际多模型切换在后续版本启用。
