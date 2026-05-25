---
project: 工作台
version: v0.3
status: draft
doc_revision: 3
created: 2026-05-18
updated: 2026-05-18
author: workbench-product
---

# product.md · 工作台 v0.3

---

## 版本背景与目标

### 版本方向

**v0.3 的目标是让 Token 消耗对用户可见、可感知、可分析。**

v0.2 建立了 Agent 协作的后端基础设施：状态机、调度器、决策收件箱均已运转。v0.3 转向「数据层透明化」：将每次 AI 调用的 token 消耗信息从 sub2api 黑盒中取出，写入 QA atom 文件本身，并在界面上提供三个层次的可见性——实时感知（输入时看到当前路径的上下文占用）、节点粒度（在对话树上看到每个节点的消耗）、画布维度（整棵对话树的 token 汇总分析）。

**为什么现在做这个？**

用户每天使用工作台与多个模型对话，但 token 消耗完全不可见。两个具体痛点：
1. 对话变长时不知道什么时候会撞到上下文窗口上限，导致回复质量骤降
2. 不同对话分支、不同模型的消耗差异完全不透明，无法做出有信息量的调度决策

v0.3 解决这两个问题，同时为 v0.4 的成本仪表盘（req-028）奠定数据基础。

### 版本边界

**本版本做**：
- req-025：QA Atom Token 元数据采集（数据基础层）
- req-026：上下文窗口占用实时指示器（实时感知层）
- req-027：画布 Token 分析视图（历史分析层）

**本版本不做**：
- req-028：跨时间轴的 token 成本仪表盘（依赖 v0.3 数据积累，推 v0.4）
- req-016：多层级 Agent 执行可视化（仍需 v0.3 数据层先行，推 v0.4）
- req-019：完整 Pipeline 触发规则 DAG 引擎（推 v0.4）
- 任何改变 v0.2 已有 Agent 调度架构的内容

### 选取理由

- **可演示**：v0.3 结束后，用户可以看到：发送消息前底部显示「2,048 / 200,000 tokens · 1.0%」；在 P2 分支树中每个节点旁显示 token 数徽章（根据用户在议题 B 的决策确定交互方式）；点击「Token 分析」入口打开汇总面板，看到本画布各模型消耗分布。这是完整的三层可见性闭环。
- **可独立**：token 元数据采集是纯数据增量，不改变 v0.2 的任何架构，不影响现有功能。
- **可依赖**：v0.4 的成本仪表盘和 v0.5 的 LLM Gateway 都需要 token 消耗数据，v0.3 是它们的前提。

---

## 功能设计

### req-025 · QA Atom Token 元数据采集

**核心功能**：AI 回复完成后，将本次调用的 token 消耗信息写入 QA atom 文件的 YAML frontmatter。

**新增 frontmatter 字段**：

```yaml
---
id: "0001-002"
model: "claude-sonnet-4-6"
input_tokens: 2048
output_tokens: 512
context_tokens_used: 2048
context_window_limit: 200000
---
```

字段说明：
- `model`：本次调用的模型 ID（与发送给 sub2api 的 `model` 字段完全一致，使用同一字符串格式）
- `input_tokens` / `output_tokens`：从 API 响应的 `usage` 字段读取
- `context_tokens_used`：**发送前**（不含本次新生成的 atom），沿 currentPath 对所有**已落盘** atom 的 `input_tokens + output_tokens` 求和（近似值）；本次新 atom 自身不纳入此求和。注：`context_tokens_used` 与本次 atom 的 `input_tokens` 并不相等——`input_tokens` 是 API 实际计量值（含 system prompt、本次用户消息、所有历史消息），`context_tokens_used` 是基于已有 atom token 字段的近似估算；两者之差体现了 system prompt 和本次用户消息本身的 token 占用，属于近似值固有误差
- `context_window_limit`：该模型的上下文窗口上限，来自前端常量表，与 `model` 字段同一格式做 key 查找

**`ai-done` 事件 payload 扩展**（前后端接口契约）：

```typescript
// 现有
{ atom_id: string; full_content: string }

// v0.3 扩展后
{
  atom_id: string;
  full_content: string;
  usage?: {           // 可选，sub2api 中间层屏蔽时可能缺失
    input_tokens: number;
    output_tokens: number;
  }
}
```

**数据来源**：
- sub2api → Claude API 的 SSE 流式响应的最后一条消息包含 `usage.input_tokens` 和 `usage.output_tokens`
- Rust 侧 `stream_ai` 命令在收到 `ai-done` 时解析 usage，写入事件 payload

**错误处理**：
- `usage` 字段缺失（sub2api 版本差异或中间件截断）：跳过 token 字段，atom 正常写入，frontmatter 中不包含 token 相关字段（而非写 0）；UI 层对此 atom 显示「无数据」
- `usage` 字段存在但值为 0：视为有效数据（空回复时合理），正常写入

**向后兼容**：旧版 QA atom（无 token 字段）在读取时所有 token 字段返回 `undefined`，不报错。

**模型上下文窗口常量表**（前端内置，可扩展）：

> `model` 字段存储的字符串与此表 key **格式完全一致**，均使用 sub2api 接收的 model ID。未知模型查不到时，`context_window_limit` 返回 `undefined`，指示器降级显示（见 req-026）。

| Model ID（与 `model` 字段同格式） | 上限（tokens） |
|------|--------------|
| claude-opus-4-7 | 200,000 |
| claude-sonnet-4-6 | 200,000 |
| claude-haiku-4-5-20251001 | 200,000 |
| gemini-2.5-pro | 1,048,576 |
| gemini-2.5-flash | 1,048,576 |

**验收标准**：AI 回复完成后，打开对应 `.md` 文件，frontmatter 中应包含 `input_tokens`、`output_tokens`、`model`、`context_tokens_used`、`context_window_limit` 五个字段，且 `input_tokens` / `output_tokens` 值非零，`model` 字符串与本次调用模型一致。若 usage 缺失，文件中无上述字段但文件写入正常（不报错）。

---

### req-026 · 上下文窗口占用实时指示器

**核心功能**：用户在 P3 输入框发送消息前，在输入区域附近实时显示当前**历史路径**的上下文占用。

> 指示器**只反映已落盘 atom 的历史消耗，不含当前输入框中的文字**。这是产品层的明确定义，避免用户误读。

**显示内容**：

```
[████░░░░░░] 2,048 / 200,000 · 1.0%   claude-sonnet-4-6
```

**状态颜色**：
- 0–70%：绿色（正常）
- 70–90%：橙色（注意）
- 90%+：红色（警告）+ 文字提示「上下文接近上限，建议在此节点开新分支」

**未知模型降级**：若当前模型不在常量表中，分母为 `undefined`，指示器显示「`2,048 tokens（上限未知）`」，不显示百分比和进度条，不报错。

**触发重算的时机**：
- 切换对话节点（currentPath 变化）
- 切换模型（分母变化）
- 不在用户输入时触发（用户输入不影响分子）

**数据读取策略**：token 字段缓存在前端 store 中（原子加载时读取），不在每次重算时触发磁盘读取。currentPath 变化时从 store 取缓存值求和，O(路径长度) 的内存操作。

**混合路径处理**：路径中部分 atom 有 token 数据、部分无（旧数据）时，仅对有数据的 atom 求和，在指示器旁注明「部分节点无数据，统计不完整」。

**P4 冲突处理**：req-026 为 P3 内部元素，与 P4 的 DecisionPanel 无冲突。

**设计决策 A：指示器位置**（Claude 自行决策，未经用户确认）

实现时选择了 A1（输入框上方嵌入行），未等待用户决策。已执行。用户后续在 v0.3.1 重新决策并修正为 A3 方案。

**验收标准**：
- 切换到对话路径（根→当前节点共 5 个 atom，当前节点已落盘）上所有 atom 均有 token 数据（每个 1000 input + 200 output）时，指示器显示 `6,000 / [模型上限] · X%`（5 × 1200 = 6000）；当前节点自身的 token 数计入（因为它已是已落盘 atom）
- 切换模型为 gemini-2.5-pro 时，分母变为 1,048,576
- 路径中无 atom 时，显示 `0 / [上限]`
- 90% 以上时出现文字警告

---

### req-027 · 画布 Token 分析视图

**核心功能**：在对话树（P2）中叠加节点级 token 标注，并提供整棵树维度的汇总分析面板。

#### 子功能 1：节点 Token 标注（P2 叠加层）

在 P2 对话节点树上显示轻量 token 标注。**设计决策 B（Claude 自行决策，未经用户确认）**：实现时选择了 B1（始终显示小徽章），未等待用户决策。已执行。用户后续在 v0.3.1 补充决策：保留 B1 默认显示，新增点击展开详情（非 hover）。

无论选择哪种模式，以下行为固定：
- **高消耗徽章**：相对于**当前路径**（非整棵树）平均值超过 1.5× 的节点，始终显示 ⚠ 标记（即使在折叠/关闭模式下也保留此警示）
- **无数据节点**：无 token 字段的旧 atom，显示「-」而非 0，不影响高消耗计算基准（无数据节点从平均值计算中排除）
- **数字格式**：超过 999 tokens 时以「1.2k」格式显示

**高消耗阈值计算**：路径平均值 = 路径中**有数据**的所有 atom 的总 tokens（input + output）之和 / 有数据的 atom 数量。

#### 子功能 2：Token 汇总分析面板

入口：P1 导航新增「Token 分析」图标，点击后 P4 切换为 Token 分析内容（与 DecisionPanel 同一个 P4 区域，通过 `currentMode` 决定 P4 渲染内容）。

面板内容：

| 维度 | 内容 |
|------|------|
| 本画布总消耗 | Input 总计 / Output 总计 / 合计（仅统计有数据的 atom，注明覆盖率「X/Y 个节点有数据」） |
| 按模型分布 | 每个模型的 input + output token 数及占比（CSS 纯实现条形图，不引入图表依赖） |
| 最贵节点 Top 5 | 按「input + output 总 tokens 降序」排列，显示 atom ID + 总 tokens；纯展示，不可点击导航 |
| 平均每节点 | 有数据节点的合计 / 有数据节点数量 |

**P4 共存策略**：P4 已有 DecisionPanel（v0.2）。导航图标点击「Token 分析」时，P4 切换到分析视图；有待决策事项时，决策徽章仍显示在 P1 角标，用户点击决策图标切换回 DecisionPanel。两者通过 `selectedView` 状态切换，不同时渲染。

#### 子功能 3：路径维度分析

选中 P2 节点后，P4 显示该路径（根 → 当前节点）的累积 token 统计，区别于整棵树视角。此为子功能 2 的路径下钻补充，共用同一个 P4 面板，根据选中节点动态切换展示范围。

**子功能 3 验收标准**：
- 在 P2 选中节点 D（处于路径 A→B→C→D），P4 显示该路径的累积消耗，数值等于路径上有数据的所有 atom 的 `input_tokens + output_tokens` 之和
- 切换选中节点到 E（同一树，不同路径），P4 立即更新为新路径的统计
- 路径上全无 token 数据时，P4 显示「此路径暂无 token 数据」

**设计决策 C：分析面板位置**（Claude 自行决策，未经用户确认）

实现时选择了 C1（P1 导航入口 → mode 切换 → P3 独立面板），未等待用户决策。已执行。用户后续在 v0.3.1 确认此方案，无需修改。

**子功能 2 验收标准**：
- 点击「Token 分析」图标，P4 切换到分析面板，显示当前画布的总消耗统计
- 使用了两种以上模型的画布，按模型分组条形图显示各自占比，总和为 100%（仅含有数据节点）
- Top 5 列表按总 tokens 降序排列
- 画布中全部为旧数据（无 token 字段）时，面板显示「当前画布暂无 token 数据，发送新消息后将自动采集」
- P4 切换到 Token 分析后，再点击决策图标可切换回 DecisionPanel

---

## 关键数据流

```
用户发送消息
    ↓
Tauri stream_ai（携带 model、messages 列表）
    ↓
sub2api → Claude API 返回 SSE 流
最后一条 SSE 消息包含 usage.input_tokens / usage.output_tokens
    ↓
ai-done 事件：{ atom_id, full_content, usage?: { input_tokens, output_tokens } }
    ↓
ChatView.tsx 接收
├── usage 存在 → write_qa_atom（附加 token 字段到 frontmatter）+ 更新前端 store 缓存（写入 token 数值）
└── usage 缺失 → write_qa_atom（不含 token 字段，正常写入内容）+ store 中该 atom 的 token 字段保持 undefined（不写入 0，避免污染求和统计）
    ↓
[实时] Context Indicator：从 store 读取 currentPath atom 的 token 缓存值，求和渲染
[历史] Token Analytics Panel：从 store 读取当前项目所有 atom 的 token 缓存值，汇总渲染
```

---

## 产品边界确认

**不做的事**：
- 不接入 tokenizer 做精确计数（近似值够用，精确值复杂度不划算）
- 不修改 sub2api 的任何配置（token 数据从 API 响应里取，非侵入式）
- 不做实时 token 预算控制（v0.3 只可见，不拦截）
- 不修改 v0.2 的 Agent 调度架构
- Top 5 节点不支持点击导航（纯展示）
- 指示器不计入当前输入框文字，只统计已落盘历史

**决策执行情况说明**：

议题 A/B/C 均在实现阶段由 Claude 自行选择默认方案执行，未等待用户决策。各方案见正文对应节点的"Claude 自行决策"标注。用户于 v0.3.1 重新决策并对 A/B 进行了修正，C 确认保留原方案。

---

## 版本一致性说明

v0.3 与产品方向的长期原则一致：
- **数据随内容走**：token 元数据写入 QA atom 文件（Obsidian 知识库），不依赖 sub2api 的孤立日志
- **Panel 职责分离**：分析面板作为 P4 内容类型之一，而非新增第五面板；与 DecisionPanel 通过 `selectedView` 状态切换，不同时渲染
- **用户保持控制权**：指示器是感知工具，不强制打断；分析视图按需打开，不常驻
- **不引入新的外部依赖**：条形图使用 CSS 纯实现，避免为简单统计引入 chart.js / recharts 等重量级库

---

## 修订记录

| 版本 | 日期 | 作者 | 说明 |
|------|------|------|------|
| v1 | 2026-05-18 | workbench-product | 初稿，含三个需求完整设计、三项待决策事项 |
| v2 | 2026-05-18 | workbench-product | review-agent 第 1 轮修复：错误处理路径、ai-done payload 契约、context_tokens_used 语义、model 字段格式统一、未知模型降级、P4 共存策略、指示器内容边界声明、Top 5 排序规则、⚠ 阈值计算方式、三个 req 验收标准、骤降笔误 |
| v3 | 2026-05-18 | workbench-product | review-agent 第 2 轮修复：context_tokens_used 与 input_tokens 关系说明、store 缺失 usage 时的写入规范（保持 undefined）、req-026 验收标准的 currentPath 边界明确、子功能 3 验收标准补全 |
