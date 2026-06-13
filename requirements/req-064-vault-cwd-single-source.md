---
id: req-064
title: workspace.cwd 与 vault.vaultRoot 合并为单源
status: dropped
priority: medium
source: 2026-06-08 · v0.16 technical.md 起草期间，desktop-platform 指出 workspace.cwd 与 vault.vaultRoot 在 electron-store 内构成"双源"，v0.16 维持双源 + 一次性同步策略，长期建议合并为单源
created: 2026-06-08
dropped: 2026-06-08
version: null
---

## ⚠️ 已 dropped（2026-06-08）

立项时基于「workspace.cwd 与 vault.vaultRoot 概念重叠」的判断。后续在 v0.16 QA 阶段澄清需求时确认：

- `vault.vaultRoot` = **应用级数据存储位置**（atom 文件 / project 文件存哪里）
- `workspace.cwd` = **会话级 AI 工作目录**（这次任务 Claude SDK 在哪个文件夹操作，类 Claude Code 启动时选 `cwd`）

两者是**根本不同的概念**，不应合并。应明确分离。

后续需求 req-065（任务 cwd 选择器）会显式服务 `workspace.cwd` 概念，与 vault 严格隔离。

---

## 原始内容（保留追溯）


# req-064 · workspace.cwd 与 vault.vaultRoot 合并为单源

## 背景

v0.16 引入 `vaultStore` 持有 `vaultRoot / qaSubdir / projectsSubdir / hasShownFirstLaunchToast`，但仓库中既有的 `workspaceStore` 已持有 `workspace.cwd`（v0.15.1 引入，作为后端 cwd 上下文）。

两者在概念上存在显著重叠：

- `workspace.cwd` 是后端 Claude Code SDK 工作目录上下文，影响 `query({cwd})`
- `vault.vaultRoot` 是前端 Vault 根目录，决定 atom 文件读写位置

v0.16 维持双源（两个 store 各自独立），通过启动时一次性同步（如果 vaultRoot 已配置且 workspace.cwd 为空，则 derive workspace.cwd = vaultRoot）来避免初始冲突，但运行期两者完全可漂移。

## 问题

- 用户在 Settings 改 vaultRoot 不会自动同步到 workspace.cwd，可能导致 atom 写入新 vault 但 Claude SDK 仍跑在旧 cwd
- 概念冗余：从产品视角看「工作仓库根目录」应该是单一概念
- 未来若引入更多上下文（如 git repo root），双源容易扩散为三源四源

## 目标

将 `workspace.cwd` 与 `vault.vaultRoot` 合并为单一字段（提议命名：`workspace.root`），使其同时服务：

1. Claude Code SDK 的 `cwd` 参数
2. atom 文件读写路径前缀
3. 未来其他需要"工作目录上下文"的场景

## 候选方案

| 方案 | 描述 | 权衡 |
|---|---|---|
| A | 删除 `vaultStore.vaultRoot`，全部用 `workspaceStore.cwd` | 改动小，但语义偏后端 |
| B | 删除 `workspaceStore.cwd`，全部用 `vaultStore.vaultRoot` | 语义偏前端，需改 SDKBridge |
| C | 引入新统一字段 `workspace.root`，旧字段一次性迁移并删除 | 最干净但改动最大 |

## 暂未规划版本

`version: null`，等候 v0.16 落地后实测 vault 与 cwd 漂移问题严重程度，再决定是否纳入 v0.17 或 v0.18。

## 关联

- 引出来源：v0.16 technical.md 起草期间 desktop-platform 的不确定项 3（CEO 已仲裁为 v0.16 维持双源）
- 上游需求：req-063 OSS 化改造（v0.16）
- 相关代码：`workbench/electron/store/workspaceStore.ts`、`workbench/electron/store/vaultStore.ts`（v0.16 新建）
