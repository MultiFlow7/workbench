---
id: req-011
title: P1 NavList 项目与对话列表
status: done
priority: medium
source: implementation（实现先于文档，补录）
created: 2026-05-18
version: v0.1
---

# req-011 · P1 NavList 项目与对话列表

## 需求描述

P1 面板拆分为两个子栏：左侧 52px 固定图标栏（模式切换图标）和右侧 200px 可折叠列表栏（NavList）。NavList 展示三个 section：最近访问、对话、项目，为用户提供快速跳转入口。列表栏支持独立折叠，折叠后仅保留图标栏，不影响四面板其余部分的布局。

## 用户价值

- 将模式切换图标与内容列表合并在 P1，避免在多个区域寻找导航控件。
- 「项目」section 使 P2 对话树可按项目过滤，一键聚焦到当前工作上下文，减少在大量历史对话中的翻找成本。
- 列表栏可独立折叠，在专注写作时最小化 P1 占用的横向空间。

## 验收标准

- [x] P1 由 52px 图标栏 + 200px 列表栏两列组成，两列之间有视觉分隔线
- [x] 列表栏包含「最近」「对话」「项目」三个 section，各 section 有标题与内容列表
- [x] 列表栏可通过 TopBar 折叠按钮（或 P1 内置控件）折叠至隐藏，图标栏保持可见
- [x] 折叠/展开过渡动效与 req-002 面板折叠规范一致（cubic-bezier，250ms）
- [x] 各 section 内的条目支持点击选中，选中后 P2 联动响应
- [x] 项目 section 的条目来源于 `list_projects` 后端命令（见 req-012）
- [x] 未选中任何项目时，P2 展示全部对话；选中项目后，P2 按项目过滤

## 实现说明

已在 v0.1 实现。NavList 作为独立 React 组件嵌入 P1，通过 Zustand store 管理选中项目状态。「项目」section 在组件挂载时调用 `list_projects` Tauri Command 获取数据，结果缓存在 store 中。列表栏折叠状态存储在 store 的 `p1ListCollapsed` 字段，与 TopBar 折叠按钮双向绑定。

## 依赖

req-001（Tauri 骨架）、req-002（四面板布局）、req-003（模式切换导航）、req-007（Zustand 状态管理层）、req-012（项目列表后端命令）
