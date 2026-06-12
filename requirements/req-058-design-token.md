---
id: req-058
title: Design Token 全局 CSS 重构
status: done
priority: high
source: 架构决策 · 2026-05-28 · 参考 AgentOS token 体系，随 Electron 迁移重构前端视觉基础
created: 2026-05-28
version: v0.15
---

# req-058 · Design Token 全局 CSS 重构

## 背景

当前各组件 CSS 中颜色、间距、圆角、字号均为硬编码数值，散落在 20+ 个 CSS 文件中。后续要做暗色主题、紧凑/宽松布局、品牌调色，需要逐文件修改，风险高且容易遗漏。

借助 Electron 迁移重建前端的窗口，一次性建立全局 Design Token 体系。

## Token 体系

建立 `src/styles/tokens.css`，覆盖：色彩（语义色 + 状态色）、间距（4px 格点体系）、圆角、字号、字重、字体族、动效曲线和时长、阴影层级。

视觉语言参考 AgentOS 的 Design Token 实践，结合工作台现有 `--accent` / `--bg` 等已有定义对齐。

## 验收标准

- [ ] `src/styles/tokens.css` 建立，包含色彩、间距、圆角、字号、字重、字体、动效、阴影全套 token
- [ ] 所有组件 CSS 文件中的硬编码颜色值替换为 token 变量（允许极少数例外需注释说明）
- [ ] 所有硬编码间距值（px 数字）替换为 `--space-*` 变量
- [ ] 修改单个 token 值，全局视觉效果同步变化（回归验证）
- [ ] 现有功能视觉效果与修改前一致（无意外变色、错位）
