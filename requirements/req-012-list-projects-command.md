---
id: req-012
title: list_projects 项目切换后端命令
status: done
priority: medium
source: implementation（实现先于文档，补录）
created: 2026-05-18
version: v0.1
---

# req-012 · list_projects 项目切换后端命令

## 需求描述

提供 `list_projects` Tauri Command，从本地 Obsidian vault 的 `07-AI知识库/L1-原始对话/Projects/` 目录读取项目元数据，供 P1 NavList 项目 section 展示。用户在 NavList 点击项目后，P2 对话树按该项目的 atomId 集合过滤，仅展示该项目相关的对话节点。

## 用户价值

- 将 Obsidian vault 中已有的项目标签体系引入工作台，无需重新维护一套项目分类。
- 项目切换后 P2 即时过滤，用户在管理多个并行项目时可快速聚焦，减少信息噪音。

## 验收标准

- [x] `list_projects` 命令读取 `07-AI知识库/L1-原始对话/Projects/` 目录下的文件
- [x] 返回结构包含：项目 id、项目名称、关联的 atomId 列表（或用于过滤的标识符）
- [x] 命令在目录不存在或为空时返回空列表，不报错
- [x] P1 NavList 项目 section 展示命令返回的项目名称列表
- [x] 点击项目条目后，P2 树视图仅展示该项目关联的对话节点
- [x] 点击「全部」或取消选中时，P2 恢复展示所有对话节点
- [x] `list_projects` 在 `tauri.conf.json` capability 中声明，遵循最小权限原则

## 实现说明

已在 v0.1 实现。`list_projects` 为 Tauri Rust Command，扫描 `Projects/` 目录，解析每个项目文件的 frontmatter 得到 atomIds 过滤条件，结果以 JSON 数组返回前端。前端在 Zustand store 中维护 `selectedProjectId`，P2 树组件订阅该字段并在渲染前对 atomId 列表执行过滤。默认 BASE_PATH 与 req-008 中的 QA 原子路径相同（`07-AI知识库/L1-原始对话`），Projects 目录为其子目录。

## 依赖

req-001（Tauri 骨架）、req-007（Zustand 状态管理层）、req-008（Tauri 本地文件命令，同一命令注册机制）、req-011（P1 NavList，消费本命令数据）
