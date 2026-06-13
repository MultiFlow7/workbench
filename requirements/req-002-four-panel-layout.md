---
id: req-002
title: 四面板布局与折叠
status: done
priority: high
source: 产品方向.md（战略意图：四面板布局）
created: 2026-05-17
version: v0.1
---

# req-002 · 四面板布局与折叠

## 需求描述

实现 P1/P2/P3/P4 的四面板布局容器，P2 和 P4 支持折叠（折叠后显示 20px 薄条，点击展开）。面板宽度和可见性由配置对象管理，不硬编码在 CSS 中。

## 验收标准

- [ ] 四个面板按 P1(48px) / P2(260px) / P3(flex) / P4(320px) 排布
- [ ] P2 点击折叠 → 缩为 20px 薄条，薄条内显示展开指示器
- [ ] P4 点击折叠 → 缩为 20px 薄条，薄条内显示展开指示器
- [ ] 折叠/展开过渡动效：`cubic-bezier(0.4, 0, 0.2, 1)`，duration 250ms
- [ ] 面板宽度以配置对象表示，挂载在 Zustand store
- [ ] P3 始终可见（不可折叠），自动填充剩余宽度

## 设计约束（来自原型设计意图.md）

- 折叠后的薄条包含展开图标，不在 P3 里放额外的展开按钮
- 颜色：`#f5f5f5` 背景，`#ffffff` surface，`#2563eb` accent
- 字体：Inter（UI 文字）/ JetBrains Mono（代码区域）

## 依赖

req-001（Tauri 骨架）、req-007（Zustand 状态层）
