---
id: req-065
title: Chat 输入框任务 cwd 选择器（类 Claude Code 风格）
status: confirmed
priority: high
source: 2026-06-08 · v0.16 QA 阶段澄清 R-6 需求时识别。用户原意是"在输入框上方加个文件夹按钮，类似 Claude Code 启动时选 cwd"——选择本次对话/任务的工作目录，让 AI 知道在哪个文件夹操作。v0.16 R-6 被误解为 Vault 切换并已撤销，需求纯粹化后立此新 req。
created: 2026-06-08
version: ~
---

# req-065 · Chat 输入框任务 cwd 选择器

## 背景

v0.16 QA 阶段澄清需求时，用户明确表达：

> 输入框上方的文件夹按钮，我指的是任务或者项目本身的文件夹结构。就像是我在 Claude Code 当中选择在哪一个文件夹目录下和 Claude 对话，又或者说是让 Claude 帮我操作哪一个文件夹。

这与 `vault.vaultRoot`（应用级数据存储位置）是**根本不同的概念**：

| 概念 | 含义 | 频率 | 范围 |
|---|---|---|---|
| `vault.vaultRoot` | atom 文件 / project 文件存哪里 | 几乎不变（一年改一次） | 全局，应用级 |
| **`task.cwd`（本需求）** | 这次对话 AI 在哪个文件夹操作 | 每次任务可能换 | 会话级，单次任务 |

v0.16 已实装的 `workspaceStore.cwd`（v0.15.1 引入）是该概念的现状基础，但目前是**全局单一 cwd**（不是 per-conversation），用户感知差。

## 目标

让用户在 chat 输入框附近能快速选择「这次任务的工作目录」，类似 Claude Code 启动时的 cwd 行为。AI 调用工具（Bash / Read / Write / Glob 等）时基于该 cwd 解析路径。

## 候选设计方向

### 方向 A：会话级 cwd（per-conversation）

每个 chat 会话独立持有 cwd，切换会话自动切 cwd。

- 优点：不同任务并行不互相干扰
- 缺点：需要 conversationSlice schema 新增 cwd 字段，迁移既有会话

### 方向 B：全局 cwd（沿用 workspaceStore.cwd）

输入框文件夹按钮直接改 `workspaceStore.cwd`，所有会话共享。

- 优点：实装最快（复用既有 store）
- 缺点：并发任务互相干扰

### 方向 C：默认沿用全局 + 显式 override

新会话默认继承 `workspaceStore.cwd`，会话内可显式 override 为会话级 cwd。

- 优点：兼顾默认便利与并发独立
- 缺点：双 cwd 状态机复杂

**待后续 product.md 规划阶段评估。v0.17 中 cwd 只作为对话来源和 Handoff Packet 的上下文字段使用，不开发独立选择器 UI。**

## UI 规格（继承 v0.16 R-6 已通过 taste skill 审查的设计精神）

- 位置：chat 输入框**上方左侧**，紧贴输入框上沿
- 形态：图标（文件夹 SVG） + 行内短 label（当前 cwd 文件夹名）
- 配色：默认 `--text-secondary` muted；hover `--accent`
- tooltip：完整 cwd 路径，中部省略（头尾保留）
- 点击：触发系统原生文件选择器 → 选目录 → 保存 cwd
- 反馈：切换后 toast「任务工作目录已切换到 `<新路径>`」
- 可访问性：`aria-label="切换任务工作目录"`

## 影响范围（v0.16 已搭好的基础设施，本 req 可复用）

- `workbench/electron/store/workspaceStore.ts`（v0.15.1 已存在，含 cwd 字段）
- `workbench/electron/sdk/SDKBridge.ts`（已把 cwd 传给 Claude SDK `query({cwd})`）
- `workbench/src/utils/pathDisplay.ts`（v0.16 R-6 撤销时如果保留了 `truncateMiddle` / `getVaultFolderName` 可复用；如已删则重建）
- design-taste-frontend skill 审查结论可直接套用（按钮 9 项规格已通过）

## 与 vault 的明确边界

- 切 cwd **不** 切 vault：atom 文件仍写入 `vaultRoot/qaSubdir/` 路径
- 切 vault **不** 影响 cwd：cwd 由用户独立选择，与 vault 无关
- Settings UI 中两者放不同分区，不混淆

## 验收标准（待 product.md 阶段细化）

- [ ] 输入框上方按钮可一键切换任务工作目录
- [ ] 切换后 Claude SDK 在新目录下操作（Bash `pwd` / Read 相对路径都基于新 cwd）
- [ ] 切换不影响 vault（atom 文件继续存在 vault 下）
- [ ] tooltip / toast / 可访问性按 v0.16 R-6 已确立的设计规范

## 关联

- 引出来源：v0.16 R-6 误解纠正（CEO 2026-06-08 报告）
- 上游需求：req-063 OSS 化（v0.16，提供 vault 基础设施）
- 关联已撤销需求：req-064（vault/cwd 合并 - 已 dropped，因明确两者是不同概念）
- 关联代码：`workspaceStore.cwd`（v0.15.1 已实装的全局 cwd 基础）
