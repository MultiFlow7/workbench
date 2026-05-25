# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目定位

**工作台**是一个私人 AI 工作台项目，目标是将三个现有前端交互统一在单一入口：
- **无限画布**（`01-Vibe项目区/无限画布交互`，React，v1.3）：对话交互、分叉节点、Streaming 卡片
- **控制平面**（`01-Vibe项目区/控制平面`，Phase 2a 待建）：工具池管理（囤/看/改）
- **执行层**（sub2api :8080，n8n :5678，API Layer :8000 待建）

## 当前阶段

**HTML 原型阶段**（2026-05-15）：只有 `prototype.html` 和规划文档，无实现代码。

下一个里程碑：用户认可原型后，按开发流程规范创建 `requirements/` → `changelog/v0.1/product.md` → `changelog/v0.1/technical.md`。

## 核心交互概念

### 四面板布局

```
[P1: 导航] [P2: 结构] [P3: 主工作区] [P4: 详情]
  52+200px    280px       flex-1         300px
```

各面板职责是排他的——P2 只渲染结构（树/列表），P3 只渲染内容，P4 只渲染只读详情。面板之间通过「选中状态事件」通信，不直接调用彼此渲染逻辑。

### 对话分叉的核心模型

对话树是有向树（A→B→{C,D}，C→{E,F}）。用户在 P2 点击节点 D，P3 展示从根到 D 的**完整线性历史**（A+B+D 的消息顺序拼接），不是卡片视图。

路径计算：`path(D) = [A, B, D]`，渲染时在节点间插入 branch-marker 分隔线。

### 三种工作模式

| 模式 | 触发 | P2 内容 | P3 内容 |
|------|------|---------|---------|
| 对话 | 导航图标 | 分支树 SVG | 线性 chatbot + 底部输入框 |
| 工具管理 | 导航图标 | 技能注册表卡片 | SKILL.md 胶水逻辑 + 调用顺序 |
| 控制台 | 导航图标 | 服务状态列表 | 执行终端 |

## 设计规范（已确认，代码阶段直接执行）

- **场景**：工具型 → Minimalist 变体
- **字体**：Inter（UI 文字）/ JetBrains Mono（代码/终端）
- **动效**：面板折叠等功能型过渡用 CSS `cubic-bezier(0.4,0,0.2,1)`；展示型过渡用 Spring `stiffness:400, damping:28`
- **色彩**：`--accent: #2563eb`，浅色主题，`--bg: #f5f5f5`，surface 白色
- **来源**：见 `原型设计意图.md §设计风格`

## 关键参考文件

开始任何技术规划前必读：
- `产品方向.md` — 长期意图和各面板职责边界
- `原型设计意图.md` — 设计决策记录 + 用户需要验证的问题清单
- `prototype.html` — 当前交互框架的可运行参考实现

相关上下游项目：
- `../无限画布交互/产品方向.md` — Canvas 的架构原则（LLM Adapter 层、Tool 插件化）
- `../控制平面/产品方向.md` — 控制平面的四个核心动作（囤/看/用/改）
- `../执行层调度器/系统地图·全景架构.md` — 全景四层架构（接入层/配置层/执行层/交互层）
- `../../agent-registry/registry.yaml` — 所有 Skill/Agent 注册条目

## 开发流程约定

遵循父仓库 `CLAUDE.md` 的完整规范：
- 需求 → `requirements/req-{N}-{描述}.md`
- 版本规划 → `changelog/v0.x/product.md`（先 review-agent 循环至 🔴=🟡=0，用户确认后）
- 技术规划 → `changelog/v0.x/technical.md`（同上，review-agent 循环）
- 发布 → `changelog/release/v0.x.0.md`

**review-agent 规则**：product.md 和 technical.md 各自独立循环，每次修复后必须再跑一轮确认，不能只修一轮就报告完成。`doc_revision` frontmatter 字段必须与修订记录表同步。
