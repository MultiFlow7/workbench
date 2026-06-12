---
id: req-028
title: Token 与成本时序仪表盘
status: done
priority: medium
source: 对话讨论 2026-05-18
created: 2026-05-18
version: v0.4
---

# req-028 · Token 与成本时序仪表盘

## 需求描述

以时间为主轴，汇总跨项目、跨模型的 token 消耗历史，提供可过滤的图表视图和成本估算。数据完全来自本地 QA atom frontmatter，是 sub2api 日志分析能力的工作台内化版本。

## 功能范围

### 1. 时序折线图

- X 轴：日期（天为粒度，可切换为周/月）
- Y 轴：token 总量（input + output）
- 支持按模型分组叠加（多线）
- 时间范围选择器：最近 7 天 / 30 天 / 全部

### 2. 成本估算

| 模型 | input 价格 | output 价格 |
|------|----------|-----------|
| gemini-2.5-pro | $1.25/1M | $10.00/1M |
| claude-opus-4-7 | $15/1M | $75/1M |
| claude-sonnet-4-6 | $3/1M | $15/1M |
| claude-haiku-4-5 | $0.80/1M | $4/1M |

- 价格表 hardcode，可配置扩展（v0.5 接入实际账单 API 后校正）
- 仪表盘顶部显示：「本月预估成本 $X.XX（基于公开价格，仅供参考）」

### 3. 过滤维度

- 按项目（工作台中每个项目对应一个对话树）
- 按模型
- 按日期范围
- 组合过滤

### 4. 汇总卡片

| 卡片 | 内容 |
|------|------|
| 总 token 消耗 | 历史累计 input + output |
| 日均消耗 | 最近 30 天均值 |
| 最活跃模型 | token 数最多的模型 |
| 最贵日期 | 估算成本最高的单日 |

## 数据来源

- 扫描所有项目的 QA atom frontmatter，提取 `model / input_tokens / output_tokens / created`（原有字段）
- 按日期 + 模型聚合，在前端或 Rust 后端计算（v0.4 视数据量决定）
- 历史数据无 token 字段的 atom（req-025 上线前创建的）统一标注「历史数据，token 未记录」，不纳入统计但不报错

## 实现位置

- **`DashboardView.tsx`**：新增仪表盘视图，通过 P1 导航切换（工作模式：控制台）
- **Rust 后端**：新增 `get_token_stats` 命令，扫描并聚合 atom frontmatter 数据，返回按日期+模型分组的统计 JSON
- 图表库：使用 Recharts（与现有 React 生态兼容）

## 与其他需求的关系

- 依赖 req-025（atom 写入 token 字段）
- 依赖 req-027（画布级分析，仪表盘提供跨画布时序视角）
- 为 req-029（LLM Gateway 内化）提供成本数据基线，替代 sub2api 日志分析

## 讨论记录

**2026-05-18**：用户要求「以时间为单位的每个 token 的消耗」。sub2api 已有这部分日志功能，但数据孤立于工作台。req-028 将这个能力内化，基于 QA atom frontmatter 数据本地计算，无需依赖 sub2api 日志系统。v0.4 实现基础版本，v0.5 在接入自建 LLM Gateway（req-029）后可引入实际账单数据校正成本估算。
