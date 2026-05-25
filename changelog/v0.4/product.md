---
project: 工作台
version: v0.4
status: draft
doc_revision: 3
created: 2026-05-18
updated: 2026-05-18
author: workbench-product
---

# product.md · 工作台 v0.4

---

## 版本背景与目标

### 版本方向

**v0.4 的目标是将 token 消耗从「节点可见」升级为「时序可分析、成本可估算」，并为 LLM 调用链的自主可控奠定基础设施起点。**

v0.3 实现了三层 token 可见性（采集、实时指示、画布分析）。v0.4 引入跨画布、跨项目、跨时间维度的汇总仪表盘（req-028），同时启动 LLM 调用网关的透明代理阶段（req-029 Phase 1），让工作台在保留 sub2api 作为 fallback 的同时，开始获取第一手调用日志。

**为什么现在做这两件事？**

1. **成本可见**：v0.3 数据积累后，用户需要知道「这个月我在每个模型上花了多少」——这是每日决策（选哪个模型回答哪类问题）的直接输入。
2. **去第三方依赖起步**：sub2api 是从 GitHub 拉取的不透明 Docker 镜像，不支持深度定制。req-029 Phase 1 通过一个透明代理路由（不停用 sub2api）开始建设自有调用链的基础设施，同时为 v0.5 的完整替换积累实战经验。

### 版本边界

**本版本做**：
- req-028：Token 与成本时序仪表盘（核心功能）
- req-029 Phase 1：透明代理基础设施（Rust 后端 `/llm/proxy` 路由 + `llm_calls` SQLite 表）

**本版本不做**：
- Tauri 侧切换 `AI_ENDPOINT` 至自建 gateway → 推 v0.5（v0.4 Phase 1 仅建路由，不切流量；见下方「req-029 版本解读」）
- req-029 Phase 2（原生 SSE 流式转发）及 Phase 3（缓存、限流、多 key 轮转）→ 推 v0.5
- req-028 接入 `llm_calls` 实际账单数据 → v0.4 使用公开价格估算，v0.5 切换为 gateway 真实数据
- req-016（Agent 执行可视化）、req-019（Pipeline DAG）→ 推后续版本

> **req-029 版本解读**：req-029 规格书的「Phase 1」原文描述中包含「主对话路径通过 `/llm/proxy` 走」（切 Tauri 流量）。本版本采用更保守的解读：v0.4 Phase 1 仅建设 `/llm/proxy` 路由和 `llm_calls` 表（基础设施），Tauri 流量切换推入 v0.5。这一调整是为了降低 v0.4 风险面——一旦 Phase 2（SSE 流式转发）在 v0.5 就绪后，流量切换和 SSE 支持可一次性完成，避免 v0.4 切流量但 SSE 尚未支持导致的半成品状态。

### 选取理由

- **可演示**：v0.4 结束后，用户在 P1 切换到「仪表盘」模式，可以看到按天的 token 图表、各模型成本占比、以及「本月预估 $X.XX」的汇总卡片；Rust 后端同时建好 `llm_calls` 表，为 v0.5 切换数据源准备好基础设施。
- **数据就绪**：v0.3 开始写入 QA atom frontmatter 中的 token 字段，v0.4 正好有数据可以聚合展示。
- **阶段降险**：req-029 Phase 1 不改动任何现有调用路径，sub2api 照常运行；只是后端新开一个路由，失败影响范围为零。

---

## 功能设计

### req-028 · Token 与成本时序仪表盘

**核心功能**：独立仪表盘视图，汇总工作台当前项目 QA atom 目录下所有 atom 的 token 消耗历史，提供时序图表和成本估算。

#### 子功能 1：汇总卡片

仪表盘顶部固定显示四张数据卡片：

| 卡片 | 计算逻辑 |
|------|---------|
| 总 Token 消耗 | 所有有数据 atom 的 `input_tokens + output_tokens` 历史累计 |
| 日均消耗 | `Σ(最近 30 天中有记录的天的 token 总量) / 有记录天数`（仅对有数据的天求平均，不将无记录天按 0 计入分母） |
| 最活跃模型 | 历史累计 token 数最多的模型 ID |
| 最贵日期 | 估算成本最高的单日（对当日各模型分别套用价格公式后加总） |

成本估算公式：`cost = (input_tokens / 1_000_000) × input_price + (output_tokens / 1_000_000) × output_price`

仪表盘顶部标注：「本月预估成本 $X.XX（基于公开价格，仅供参考）」

#### 子功能 2：时序图表

> **图表库选择待确认（见议题 D）**。以下行为与图表库选择无关，在所有方案中固定。

固定行为（无论议题 D 选哪种方案）：
- X 轴：日期（天 / 周 / 月，可切换）
- Y 轴：token 总量（input + output）
- 时间范围：最近 7 天 / 30 天 / 全部
- 多模型叠加：每个模型一条线（或一组柱），颜色区分
- 某天/周/月无数据时，该点不绘制（折线中断，不插值为 0）
- **多模型聚合规则**：token 历史总量排名前 3 的模型单独显示，其余合并为「其他」；正好 3 个模型时全部单独显示（不触发合并）；过滤器选中被合并进「其他」的模型后，该模型从「其他」中提取单独显示

#### 子功能 3：成本估算价格表

价格表 hardcode 在前端，v0.5 接入 gateway 真实账单数据后可覆盖。**所有 Model ID 格式与 v0.3 `MODEL_CONTEXT_LIMITS` 常量表 key 格式完全一致**（使用 sub2api 实际接收的 model 字段格式）：

| Model ID | input 价格（$/1M tokens） | output 价格（$/1M tokens） |
|----------|------------------------|--------------------------|
| gemini-2.5-pro | $1.25 | $10.00 |
| claude-opus-4-7 | $15.00 | $75.00 |
| claude-sonnet-4-6 | $3.00 | $15.00 |
| claude-haiku-4-5-20251001 | $0.80 | $4.00 |

> **注**：req-028 规格书中此模型写为 `claude-haiku-4-5`（无日期后缀），与 v0.3 `MODEL_CONTEXT_LIMITS` 常量表中的 `claude-haiku-4-5-20251001` 不一致。本文档以 v0.3 常量表格式为准（带日期后缀）；req-028 规格书中的 ID 应在 technical.md 阶段统一更新。

未知模型（不在价格表中）：token 数正常统计，成本显示「-」，不阻断其他模型的估算。

#### 子功能 4：过滤维度

用户可组合过滤，过滤器变化时图表和卡片即时更新：
- **按模型**：多选（默认全选）
- **按日期范围**：7 天 / 30 天 / 全部（与子功能 2 联动）
- **按项目**：若工作台支持多项目，按项目根目录过滤；v0.4 阶段只有单项目时此过滤器隐藏

**数据聚合位置**（见议题 E，待用户决策）

#### 数据来源与扫描范围

- **扫描起点**：当前工作台项目的 QA atom 目录（由 `workbench.db` 配置的项目根目录决定），不递归扫描 Obsidian Vault 其他笔记目录
- **扫描字段**：从每个 atom 的 frontmatter 提取 `model / input_tokens / output_tokens / created`
- 无 token 字段的旧 atom（req-025 上线前创建）：纳入 atom 总数统计，但不计入 token/成本数值，在卡片下方注明「X 个历史节点无 token 数据，未计入」
- 仪表盘全为旧数据时，图表区显示「暂无 token 数据，发送新消息后将自动采集」，卡片数值全部显示「-」

**验收标准**：

含图表方案（若议题 D 选 D1 Recharts 或 D2 CSS/SVG）：
- 含 5 个有 token 数据的 atom，分布在 3 天内、2 个模型，图表显示 3 个数据点（2 条线或 2 组柱）；汇总卡片显示正确的累计 token 数和成本估算（精确到小数点后 2 位）
- 切换时间粒度为「周」，横坐标变为周，数据按周聚合
- 切换时间粒度为「月」，横坐标变为月份（格式 YYYY-MM），数据按自然月聚合，跨年时正确显示年份
- 过滤到只看某一模型，图表只显示该模型，卡片数值更新

仅卡片方案（若议题 D 选 D3）：
- 以上图表相关项改为：卡片数值正确，无图表区域，有时间范围选择器影响卡片数值范围

所有方案共同：
- 全无 token 数据时，显示空数据提示，不报错
- 3 个模型中 1 个不在价格表，该模型成本显示「-」，其他 2 个模型成本正常显示

---

### req-029 Phase 1 · 透明代理模式

**核心功能**：在 Rust 后端（43.135.174.27:8081）新增 `/llm/proxy` 路由，透明记录 LLM 调用数据到 SQLite `llm_calls` 表。v0.4 阶段 Tauri 仍通过 sub2api 发起 LLM 请求（不切换 `AI_ENDPOINT`），仅建设基础设施。

**新增 SQLite 表**（追加到现有 `workbench.db`）：

```sql
CREATE TABLE IF NOT EXISTS llm_calls (
    id            TEXT PRIMARY KEY,       -- UUID v4，每次请求生成新值（不幂等，重试产生新记录）
    ts            INTEGER NOT NULL,       -- 请求到达 /llm/proxy 路由的时刻，Unix timestamp ms
    model         TEXT NOT NULL,
    provider      TEXT NOT NULL,          -- 根据 model 字段自动推导：claude-* → "anthropic"，gemini-* → "google"，其他 → "unknown"
    input_tokens  INTEGER,               -- 响应 usage.input_tokens，缺失时为 NULL
    output_tokens INTEGER,               -- 响应 usage.output_tokens，缺失时为 NULL
    latency_ms    INTEGER,               -- 响应完成时刻 - ts（ms），即完整请求往返耗时
    qa_atom_id    TEXT,                  -- 关联到具体 QA atom（v0.4 阶段调用方可选传入，不强制）
    agent_role    TEXT                   -- Agent dispatch 时的角色名（v0.4 阶段调用方可选传入，不强制）
);
```

**`/llm/proxy` 路由行为**：
1. 接收来自调用方的请求（OpenAI 兼容格式，非流式）
2. 根据 `model` 字段推导 `provider`，转发至对应 provider 的原生 API（目标 URL 和 API key 来源见下方「Provider 配置」）
3. 响应返回后，从响应体提取 `usage` 字段，计算 `latency_ms`，插入 `llm_calls` 表
4. 将原始响应原封不动返回调用方（透明代理）

**Provider 配置**：
- **目标 URL**：hardcode 在 Rust 常量中（`anthropic: "https://api.anthropic.com/v1/messages"`，`google: "https://generativelanguage.googleapis.com/v1beta/..."`）
- **API Key**：从环境变量注入，`ANTHROPIC_API_KEY` / `GOOGLE_API_KEY`（与现有 `workbench.env` EnvironmentFile 同机制，v0.4 在 `/data/workbench/workbench.env` 中追加两个变量）
- v0.4 不支持运行时动态切换 provider 配置（推 v0.5 Phase 3）

**错误处理**：
- **provider API 返回 4xx/5xx**：`/llm/proxy` 原样透传错误码给调用方，不写入 `llm_calls`（失败调用不记录）
- **响应中 `usage` 字段缺失**：插入 `input_tokens=NULL, output_tokens=NULL` 的记录（不阻断响应返回）
- **SQLite 写入失败**：记录错误日志（`RUST_LOG=error`），响应正常返回给调用方（日志优先级低于响应可用性）

**v0.4 阶段不做**：
- 不切换 Tauri 的 `stream_ai` 路由（`AI_ENDPOINT` 不变，仍指向 sub2api）
- 不处理 SSE 流式响应（流式 SSE 转发推 Phase 2 / v0.5）
- 不实现缓存、限流、多 key 轮转
- sub2api 不停用，`/llm/proxy` 与现有调用链完全隔离

**`provider` 字段推导规则**：
- model 字符串以 `claude-` 开头 → `"anthropic"`
- model 字符串以 `gemini-` 开头 → `"google"`
- 其他 → `"unknown"`

**sub2api 关系**：Phase 1 是「并联」而非「替换」——`/llm/proxy` 与 sub2api 两个端点共存，互不影响。

**验收标准**：
- 向 `POST http://43.135.174.27:8081/llm/proxy` 发送非流式 LLM 请求（`curl`），响应内容与直接调用 provider API 等价（相同 model + messages 的非流式响应）
- `llm_calls` 表中插入对应记录：`ts` 在请求发出前后 5 秒内，`model` 与请求中 model 字段一致，`input_tokens` 和 `output_tokens` 均为整数（可以为 0，但不为 NULL；若 provider 确实不返回 usage 则为 NULL）
- 模拟 provider 返回 500：`llm_calls` 表中无新增记录，`/llm/proxy` 返回 500 给调用方
- sub2api 正常运行（`curl localhost:8080/v1/models` 返回 200）
- Tauri 正常对话功能（stream_ai）不受 `/llm/proxy` 路由任何影响

---

## 关键数据流

### req-028 数据流

```
[数据来源]
工作台项目 QA atom 目录（.md 文件，本地磁盘）
    ↓
[聚合层]（根据议题 E 决策）
前端 JS 遍历 atom list → 按日期+模型分组 JSON
  或
Rust get_token_stats 命令 → 按日期+模型分组 JSON
    ↓
[展示层]
DashboardView.tsx
├── 汇总卡片（4 张）
├── 时序图表（图表库根据议题 D 决策）
└── 过滤器（模型/日期/项目）
```

### req-029 Phase 1 数据流

```
外部调用方（测试 curl / v0.5 切换后的 Tauri）
    ↓ POST /llm/proxy（非流式）
Axum 路由（workbench-backend:8081）
    ↓ 转发
Provider API（Anthropic / Google）
    ↓ 非流式响应
Axum 拦截 usage 字段，计算 latency_ms
    ↓ INSERT INTO llm_calls（UUID v4 id）
    ↓ 原响应透传
调用方
```

---

## 产品边界确认

**不做的事**：
- 不接入 sub2api 的日志系统（数据来自 atom frontmatter，与 sub2api 日志独立）
- 不实现「预算预警」（v0.4 只展示，不控制）
- 不做跨设备/云端同步（数据完全本地）
- 不为 `/llm/proxy` 实现身份认证（v0.4 阶段仅内网使用）
- req-028 的数据不来自 `llm_calls` 表（v0.5 才切换数据源）

**待用户决策的事项**（见附件 HTML 文件 ui-decisions.html）：
- **议题 D**：仪表盘图表库选择（D1 Recharts / D2 CSS+SVG 手写折线 / D3 仅卡片不做折线图）
- **议题 E**：数据聚合位置（E1 前端 JS 直接遍历 / E2 Rust 后端 `get_token_stats` 命令）

---

## 版本一致性说明

v0.4 与产品方向的长期原则一致：
- **数据随内容走**：req-028 仪表盘的数据来自 QA atom frontmatter（Obsidian 知识库），不依赖 sub2api 日志，与 v0.3 原则一致
- **渐进式迁移**：req-029 Phase 1 采用「并联透明」策略，不破坏现有调用链，符合「保留 fallback，阶段降险」的迁移原则
- **用户保持控制权**：仪表盘为独立视图（P1 导航切换），按需打开，不影响正常对话工作流
- **图表库决策**：是否引入 Recharts 是本版本的关键决策点（议题 D），由用户确认后再执行

---

## 修订记录

| 版本 | 日期 | 作者 | 说明 |
|------|------|------|------|
| v1 | 2026-05-18 | workbench-product | 初稿，含 req-028 完整功能设计、req-029 Phase 1 边界定义、两项待决策事项 |
| v2 | 2026-05-18 | workbench-product | review-agent 第 1 轮修复：B-01 req-029 版本解读歧义消除（明确 v0.4 不切流量）、B-02 llm_calls.id UUID v4 生成规则、B-03 ts 字段语义（请求到达时刻）和 latency_ms 计算公式、B-04 验收标准改为「整数可为 0 但不为 NULL」、B-05 日均消耗分母改为有记录天数、W-01 Model ID 格式统一声明、W-02 多模型聚合规则（前 3 单独/其余合并/过滤器提取）、W-03 月粒度验收标准补充、W-04 /llm/proxy 三条错误处理规则、W-05 扫描起点明确为工作台项目 QA atom 目录、W-06 验收标准按议题 D 分支 |
| v3 | 2026-05-18 | workbench-product | review-agent 第 2 轮修复：W-07 Haiku Model ID 格式差异显式注释（以 v0.3 带后缀格式为准，req-028 规格书待更新）、W-08 /llm/proxy Provider 配置补充（目标 URL hardcode + API Key 来源环境变量）|
