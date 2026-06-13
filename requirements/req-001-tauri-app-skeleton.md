---
id: req-001
title: Tauri 应用骨架
status: done
priority: high
source: 产品方向.md（架构决策：Tauri 桌面端）
created: 2026-05-17
version: v0.1
---

# req-001 · Tauri 应用骨架

## 需求描述

建立 Tauri + React + TypeScript 的项目骨架，确保应用可以在 macOS 上作为原生窗口运行。这是所有后续功能的基础层，不包含任何业务逻辑。

## 验收标准

- [ ] `pnpm tauri dev` 可以启动一个原生 macOS 窗口
- [ ] 窗口标题为「工作台」，初始尺寸 1440×900
- [ ] TypeScript 严格模式开启，无类型报错
- [ ] React + Zustand + Vite 基础配置就绪
- [ ] CSS Variables 设计 token 文件存在（颜色、字体、间距、动效参数）

## 技术约束

- Tauri v2（最新稳定版）
- React 18 + TypeScript 5
- Zustand（状态管理）
- Vite（构建工具）
- 不引入 CSS-in-JS 运行时

## 依赖

无前置依赖，为所有其他需求的基础。
