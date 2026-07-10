# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 项目定位

**工作台不是「四面板 GUI + 一些 Agent 功能」，而是为超级个体打造的个人协调层 / AgentOS 方向。** 产品三层结构：

```text
User Command Interface（GUI / Chat / Command Palette …）
        ↓
协议层 / 协调层（command · event · state · decision · permission · trace）
        ↓
Agent Command Interface（CLI / MCP / SDK / API / Browser automation …）
```

**四条定位原则**（完整版见 `产品方向v2.1.md`）：

1. **协议是内核，产品是协调层的显化**——不把「协议」当对外产品名，但功能的事实以协议层为准。
2. **执行组织单位是版本，阶段是边界地图**——版本可为可感知功能引入少量下一阶段概念，但必须标注「为什么本版需要它」，不得把阶段二完整产品化。
3. **四面板是 UCI 的一种形态，不是产品本体**——GUI 不承载业务真相。
4. **刹车原则**——协议事实必须被某个版本的可感知功能逼出来；没有功能逼出来的协议默认推迟。

**当前 Agent Team** 具开发者 / 用户 / 实验对象三重身份，**不是产品内置 Agent 列表**；产品沉淀的是它们协作产生的协议事实、Trace、Permission、Decision、Handoff，而非具体角色。

**边界校准（2026-06-18）**：Agent Runtime 与沙盒、MCP、CLI / SDK、Browser Automation、工具权限等同属基础设施层，通过 Agent Command Interface 服务 Agent；当前开发工作台的 Agent Team 是一组使用这些基础设施的 Agent 用户，已剥离为 `../Agent团队打造/teams/workbench-agent-team/` 项目群。工作台只吸收其中被验证、被版本功能逼出来、对超级个体协调多执行体也成立的通用协议事实。详细边界见 `docs/工作台-AgentRuntime-AgentTeam边界.md`。

> 日常方向锚点：`产品方向v2.1.md`。方向底稿：`docs/工作台产品方向·协调层战略与三阶段边界.md`（人类维护，非默认必读）。
> 下方「当前 GUI / UCI 实现参考 / 设计规范」描述的是当前 UCI 的显化形态与实现细节，可作 UI / 实现参考，不等于产品本体定义。

## 当前阶段

实现进度、已发布版本、待收口项以 `产品方向v2.1.md` 的「当前实现进度快照」为准；需求状态以 `requirements/README.md`、发布验证以 `changelog/release/` 为准。本文不内嵌版本快照，避免入口文档随版本漂移。

## 当前 GUI / UCI 实现参考

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

以下是 v0.1–v0.15 形成的 GUI 工作模式，用作当前 UCI 实现参考；后续规划仍需先回到协议层定义事实。

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

开始任何规划前必读：
- `产品方向v2.1.md` — 当前产品方向执行版（UCI / 协调层 / ACI；旧四面板方向已归为历史 UCI 参考）

做 UCI / GUI / 交互相关规划时再读：
- `原型设计意图.md` — 设计决策记录 + 用户需要验证的问题清单
- `prototype.html` — 当前交互框架的可运行参考实现

相关上下游项目：
- `../无限画布交互/产品方向.md` — Canvas 的架构原则（LLM Adapter 层、Tool 插件化）
- `../控制平面/产品方向.md` — 控制平面的四个核心动作（囤/看/用/改）
- `../执行层调度器/系统地图·全景架构.md` — 全景四层架构（接入层/配置层/执行层/交互层）
- `../../agent-registry/registry.yaml` — 所有 Skill/Agent 注册条目

## 开发流程约定

遵循父仓库 `AGENTS.md` 的完整规范：
- 需求 → `requirements/req-{N}-{描述}.md`
- 版本规划 → `changelog/v0.x/product.md`（先 review-agent 循环至 🔴=🟡=0，用户确认后）
- 技术规划 → `changelog/v0.x/technical.md`（同上，review-agent 循环）
- 发布 → `changelog/release/v0.x.0.md`

**公开边界必须进入 CEO / 版本规划默认流程**：每个版本的 product.md 必须说明本版本是否跨越 workspace boundary → publication boundary。只要涉及本地真实资料、外部对话导入、个人路径、配置、日志、发布包或 GitHub 同步，就必须在规划中列出扫描、脱敏、local-only 隔离、allowlist 审核和发布阻断项。该流程由 CEO 负责推进，不依赖工程 Agent 临时记忆。

**review-agent 规则**：product.md 和 technical.md 各自独立循环，每次修复后必须再跑一轮确认，不能只修一轮就报告完成。`doc_revision` frontmatter 字段必须与修订记录表同步。

## GitHub 工作流规范

### 分支命名

| 类型 | 格式 | 示例 |
|------|------|------|
| 功能开发 | `feature/req-{N}-{描述}` | `feature/req-029-llm-gateway` |
| 需求关联修复 | `fix/req-{N}-{描述}` | `fix/req-020-token-refresh` |
| 紧急修复 | `fix/{描述}` | `fix/backend-crash-on-empty-dag` |
| 维护 / 重构 | `chore/{描述}` | `chore/update-dependencies` |

### PR 规范

- 每个 PR 对应一个需求（`req-{N}`）或一个独立修复
- PR body 中写 `closes #issue编号` 关联 GitHub Issue
- 禁止直接 push to main，所有改动必须走 PR

### 版本发布

- tag 格式：`vX.Y.Z`（例：`v0.9.0`）
- **tag 触发 CD 部署，不是每次 merge main 都部署**
- 打 tag 的前提：本版本所有 PR 已 merge、人工验收通过
- 打 tag / GitHub Release 前必须完成 publication boundary 检查：至少运行 staged/tracked/build 隐私扫描；涉及历史清理或公开仓库首次发布时，history 扫描和是否需要历史重写必须由 CEO 上报用户确认
