---
id: req-045
title: Prompt Caching 优化长对话输入 Token 消耗
status: planned
priority: high
source: user-feedback
created: 2026-05-22
version: v0.12
doc_revision: 2
---

# req-045 · Prompt Caching 优化长对话输入 Token 消耗

## 背景与目标

工作台当前的 QA Atom 模型中，每次发送消息都会把完整的历史 messages 数组传给 Anthropic API。对话越长，每次请求的 input_tokens 越多——一条 20 轮的对话，每次续接都要重新传送全部 20 轮的内容，造成大量重复 token 消耗。

Anthropic 的 Prompt Caching 功能允许对 messages 数组中不会变化的历史部分打上 `cache_control: {"type": "ephemeral"}` 标记，后续请求命中缓存时，这部分内容不计费（或大幅折扣），显著降低长对话的运行成本。

v0.12 目标：在 `stream_ai` 的 messages 构建阶段引入 cache_control 标记，让 Anthropic 对固定历史自动缓存。

## 设计方向

### 核心机制：Automatic Caching

采用 **Anthropic Automatic Caching** 方案：在请求顶层传入 `cache_control`，由 Anthropic 系统自动管理 mark 位置，无需手动逐条标记历史消息。

Automatic Caching 工作规则（截至 2026-05）：
- 在线性续接时自动滚动命中，Anthropic 自动跟踪哪段 prefix 已缓存
- cache TTL 为 5 分钟 rolling 续期（ephemeral），每次命中都会续期
- 收费：cache write 125%，cache read 10%

### 分叉节点的缓存策略

分叉节点是 Prompt Caching 收益最高的场景：

- 若在父节点处已开启缓存，子分支发出的第一条消息可命中父节点的 hash(prefix) 缓存，节省跨分支重复 token 成本
- 每条新分支的第一条消息需额外支付父节点 AI 回复（C_ai）的写入成本（125%），后续消息正常命中
- 冷分叉（超过 5 分钟未访问）会 miss，付全价后重建缓存

### UI：Caching 开关按钮

在 **P3 输入框区域的模型选择旁边**新增一个「Caching」开关按钮：

- 按钮亮（active）= 开启缓存，向 Anthropic API 传递 cache_control
- 按钮暗（inactive）= 关闭缓存，不传 cache_control，按普通请求计费
- 用户可在任意节点手动开启；建议在预期分叉的父节点处开启，以便后续分支命中共享缓存
- **开关状态全局持久化**：不随节点切换重置，保持用户上一次的选择

## 验收指标

| 验收项 | 标准 |
|--------|------|
| 开关可见且可交互 | P3 输入框区域模型选择旁有「Caching」按钮，点击可切换亮/暗状态 |
| 开关状态持久化 | 切换节点后开关状态不重置，保持用户上一次的选择 |
| 开启后请求带 cache_control | 开关处于 active 时，发出的 API 请求中包含 cache_control 字段 |
| 关闭后请求不带 cache_control | 开关处于 inactive 时，请求中无 cache_control，按普通计费 |
| 缓存命中可观测 | 开启后第二轮及后续请求的 `usage` 字段中 `cache_read_input_tokens > 0` |
| token 统计准确 | `ai-done` 的 token 元数据区分 `input_tokens` / `cache_read_input_tokens` / `cache_creation_input_tokens` |
