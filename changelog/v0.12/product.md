---
project: 工作台
version: v0.12
status: draft
doc_revision: 5
created: 2026-05-22
---

# 产品规划 · v0.12 · 画布与对话体验优化

## 版本定位

v0.12 是一个**体验打磨版本**，聚焦画布交互和对话使用质量，不引入新的系统模块。三个需求都直接来自真实使用中暴露的摩擦点：

- 长对话 token 成本过高（每轮重传全量历史）
- 长文本输入体验差（P3 输入框局促）
- Mac 触摸板手势与平台习惯不符

本版本完成后，工作台在「日常对话」这条核心路径上的体验应达到可持续使用的水准。

---

## 本版本选入需求

| ID | 需求 | 优先级 | 来源 |
|----|------|--------|------|
| [req-045](../../requirements/req-045-prompt-caching.md) | Prompt Caching 优化长对话输入 Token 消耗 | high | 成本问题 |
| [req-046](../../requirements/req-046-trackpad-gesture-fix.md) | Mac 触摸板手势修正（双指平移=平移，捏合=缩放） | high | 交互习惯不符 |
| [req-044](../../requirements/req-044-p4-text-input-expansion.md) | P4 文本输入展开面板（长文本输入体验优化） | medium | 输入体验差 |

---

## 需求详解与设计决策

### req-045 · Prompt Caching

**问题**：每次发送消息都重传完整历史 messages，对话越长浪费越多。一条 20 轮对话每次续接都要传全量历史，实际有效 token 只是新问题本身。

**方案**：采用 **Anthropic Automatic Caching**，在请求顶层传入 `cache_control: {"type": "ephemeral"}`，由 Anthropic 系统自动管理缓存 mark 位置，无需手动逐条标记历史消息。

**方案选型讨论（已决策）**：

在确定最终方案前，对比了两种路径：

| 方案 | 描述 | 结论 |
|------|------|------|
| 手动标记 | 由前端逐条选择哪些历史 messages 附加 cache_control | ❌ 实现复杂，需要维护标记位置状态，且标记错误会导致缓存 miss |
| Automatic Caching（选定） | 在最后一条 user message 的最后一个 block 上注入一次 cache_control，Anthropic 自动跟踪 prefix 滚动 | ✅ 零维护，线性续接自动命中，分叉可共享父节点缓存 |

**缓存机制工作方式**：

- **线性续接**：每次请求在历史末尾注入 cache_control，Anthropic 自动滚动缓存命中——每轮只有新增内容付全价
- **分叉节点**：在父节点处开启 caching，子分支发出的第一条消息可命中父节点的 prefix 缓存；超过 5 分钟未访问的冷分叉会 miss，付全价重建缓存
- **其他模型（OpenAI / DeepSeek / Gemini）**：`caching=true` 通过 ai-service 的 Noop 策略处理，不注入任何额外字段，对这些 provider 无效果也无额外成本
- **计费**：cache write 125%，cache read 10%，TTL 5 分钟 rolling 续期

**后端实现（v0.13 已完成）**：

v0.13 在 ai-service 中通过 `_AnnotatedMessageList` 子类携带 `cache_inject_index` 标记，`AnthropicAdapter.to_api_messages()` 在序列化时在标记位置注入 `cache_control: {"type": "ephemeral"}`。路由逻辑、adapter 接口完全不感知此细节。

**UI 决策**：在 P3 输入框区域的模型选择旁边新增「Caching」开关按钮。按钮亮（active）= 开启，按钮暗（inactive）= 关闭。建议用户在预期分叉的父节点处开启，以便后续分支命中共享缓存。

**关键决策**：
- 实现方式：Automatic Caching（注入最后一条 user message 的最后一个 block），不手动管理 mark 位置
- UI 入口：P3 模型选择旁的「Caching」开关按钮，用户可随时手动控制
- 开关持久化：写入 `~/.config/workbench/settings.json`（复用 v0.13 建立的 `read_settings` / `write_settings` Tauri 命令 + `hydrateSettingsFromFile` 机制），不随节点切换重置，重启 app 后保留
- token 统计：ai-done 事件的元数据区分 `input_tokens` / `cache_read_input_tokens` / `cache_creation_input_tokens`

**与 v0.13 的关系**：v0.13 已完整实现 ai-service 后端，`POST /v1/chat` 已接受 `caching: bool` 参数并按 provider 差异化处理（Anthropic 注入 `cache_control`，其他模型 noop）。v0.12 的 req-045 工作范围**仅限前端**：Zustand `cachingEnabled` 状态 + settings 持久化 + UI 开关 + 两处 `invoke('stream_ai')` 参数接入（替换 `caching: false` 的 TODO 注释）。后端零改动。

**与产品方向的一致性**：符合「后端逻辑 AI first」原则，降低与 AI 协作的持续成本。

---

### req-046 · 触摸板手势修正

**问题**：当前双指滑动触发缩放，与 Mac 平台标准（Figma、Safari 等）相反，使用画布时频繁误操作。

**方案**：在画布 wheel 事件处理中区分 `e.ctrlKey`——macOS 将捏合手势映射为 `ctrlKey=true` 的 wheel 事件，这是浏览器/Tauri WebView 的标准行为。

```
e.ctrlKey = true  → 捏合手势 → 缩放
e.ctrlKey = false → 双指滑动 → 平移
```

**适用范围**：本版本修复 P2 BranchTree SVG 画布；后续无限画布引入时（v0.3+ 规划）同一 `ctrlKey` 逻辑直接复用，无需重新设计。

**与产品方向的一致性**：符合「前端逻辑 Human first」原则，以人的操作习惯为准。

---

### req-044 · P4 文本输入展开面板

**问题**：P3 输入框高度有限，输入多段落长提示词时无法看全内容，编辑体验很差。

**方案**：P3 输入框右侧新增「展开」图标按钮，点击后 P4 切换为 `text-input` 模式，显示全高 textarea，与 P3 输入框双向实时同步（debounce 100ms）。

**关键决策**：
- P4 两种互斥模式：`detail`（节点只读详情）/ `text-input`（输入展开）
- 点击展开时若 P4 在 detail 模式，直接切换（节点详情可通过 P2 重新选中恢复，不需提示）
- **退出 text-input 模式**：用户点击 P4 顶部「收起」按钮后退回 `detail` 模式；发送消息后**不**自动退出（用户可能连续编辑多条长消息，不应打断其节奏）
- `Cmd+Shift+E` 作为可选快捷键（技术规划阶段确认）
- 发送逻辑不变：Enter / 发送按钮始终在 P3 侧触发，P4 只负责编辑（决策：不支持从 P4 直接发送，req-044 中该项为待确认，此处明确收窄）

**与产品方向的一致性**：符合 P4「渐进成为第二工作区」的演化路径——这是 P4 从只读详情走向编辑能力的第一步。

---

## 不在本版本范围内

- 对话分叉操作（P2 节点创建/编辑）
- 系统提示词（system prompt）的 caching 优化（可作为 v0.12.1 追加）
- P4 支持编辑 Obsidian vault 文件（更大的演化，留后续版本）
- 多工作区 Tab（独立需求，不在本版本）

---

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1 | 2026-05-22 | 初稿，选入 req-044/045/046 |
| v2 | 2026-05-22 | 修正 token 计费表述歧义；明确 P4 发送决策；补全 req-046 适用范围举例 |
| v3 | 2026-05-23 | req-045 方案改为 Automatic Caching + Caching 开关按钮 |
| v4 | 2026-05-23 | 补充 req-045 与 v0.13 ai-service 的边界说明：后端已完成，v0.12 仅做前端接入 |
| v5 | 2026-05-23 | review-agent 修订：req-045 补充方案选型讨论、后端实现机制、持久化路径（settings 文件）；req-044 补充退出 text-input 模式决策（手动收起，发送后不自动退出）；req-046 适用范围表述精确化 |
