---
version: v0.3.1
title: v0.3 UI 决策落地
status: in-progress
created: 2026-05-19
updated: 2026-05-19
base_version: v0.3
---

# v0.3.1 · UI 决策落地

## 版本定位

v0.3 实现阶段，议题 A/B/C 由 Claude 自行选择默认方案执行，未等待用户决策。本版本（v0.3.1）由用户正式决策，对 A/B 进行修正，C 确认保留。

---

## 决策记录

### 议题 A · ContextIndicator 位置（req-026）

**决策方**：用户  
**决策时间**：2026-05-19  
**原执行状态**：v0.3 中 Claude 自行选择 A1（输入框上方嵌入行），已执行

**用户决策**：
- 保留 A3 方案的 TopBar 右侧徽章显示（百分比 + 颜色，绿/橙/红）
- 另增：点击 P2 树节点后，P4 DetailPanel 展示该节点的 token 详情（输入、输出、模型、ctx%）
- 放弃 A1 的输入框嵌入行

**已执行**：ContextIndicator 重设计为 A3 badge，TopBar 渲染，DetailPanel 增加 token info 区块。

---

### 议题 B · P2 节点 Token 标注模式（req-027 子功能1）

**决策方**：用户  
**决策时间**：2026-05-19  
**原执行状态**：v0.3 中 Claude 自行选择 B1（始终显示小徽章），已执行

**用户决策**：
- 保留 B1 默认显示（token 徽章常驻，超平均 1.5× 显示 ⚠）
- 新增点击展开：点击 token 徽章区域展开行内详情卡（输入、输出、模型、相对平均倍数）
- 展开方式为**点击**，不是 hover

**已执行**：BranchTree 新增 expandedTokenId 状态，点击展开，e.stopPropagation() 确保不干扰 selectAtom。

---

### 议题 C · Token 汇总分析面板位置（req-027 子功能2）

**决策方**：用户确认  
**决策时间**：2026-05-19  
**原执行状态**：v0.3 中 Claude 自行选择 C1（P1 入口 → mode 切换 → P3 独立面板），已执行

**用户决策**：确认保留原方案，无需修改。

**无代码改动**：P1 NavIcons AnalyticsIcon → mode='analytics' → P3 渲染 TokenAnalyticsPanel，链路完整。

---

## 影响范围

| 文件 | 改动类型 | 决策来源 |
|------|---------|---------|
| `ContextIndicator.tsx` / `.css` | 重设计（A1 → A3 badge） | 用户决策 A |
| `TopBar.tsx` | 新增 ContextIndicator 渲染 | 用户决策 A |
| `DetailPanel.tsx` / `.css` | 新增 token info 区块 | 用户决策 A |
| `BranchTree.tsx` / `.css` | 新增点击展开 token 详情 | 用户决策 B |
| `ChatView.tsx` | 移除废弃的 model prop（兼容性修复） | review 发现 |
| — | 无改动 | 用户确认 C |
