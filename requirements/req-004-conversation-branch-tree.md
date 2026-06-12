---
id: req-004
title: 对话分支树（P2）
status: done
priority: high
source: 产品方向.md（核心动作：看/选）；原型设计意图.md（决策1：分叉可视化方案）
created: 2026-05-17
version: v0.1
---

# req-004 · 对话分支树（P2）

## 需求描述

Panel 2 在对话模式下展示对话的分支树结构，用 SVG 渲染节点和连线，支持点击节点触发 Panel 3 视角切换。读取真实本地 QA 原子文件（通过 `list_qa_atoms` Tauri Command），不使用 mock 数据。

## 数据来源

`list_qa_atoms(BASE_PATH)` Tauri Command 读取 `07-AI知识库/L1-原始对话/QA` 目录下全量 QA 原子，返回元数据列表。

## 数据模型（对齐无限画布 persistence.ts 格式）

```typescript
interface QAAtomMeta {
  id: string          // "0001-001"，文件名（不含 .md）
  prev: string | null // "[[0001-001]]" Obsidian wikilink；根节点为 null 或空字符串
  children: string[]  // ["[[0001-002]]", "[[0001-01-001]]"]
  summary: string     // question 前 50 字（渲染用，list_qa_atoms 解析时提取）
  timestamp: string
}
```

路径计算：从 `selectedAtomId` 沿 `prev` wikilink 向上回溯至根，得到有序路径数组。

## 验收标准

- [ ] SVG 树渲染：节点矩形（140×60px），cubic-bezier 连线
- [ ] 节点显示：摘要文字（最多 2 行）+ 时间戳
- [ ] Reingold-Tilford 布局算法，节点层间距 100px，同层 20px 间距
- [ ] 点击任意节点 → 触发 `store.selectAtom(id)` 到 Zustand store
- [ ] 当前选中节点有高亮态（border-color: accent）
- [ ] ≥10 个节点时自动压缩布局，防止超出 P2 宽度
- [ ] P2 可垂直滚动（节点数多时）
- [ ] 应用启动时自动加载全量 QA 原子（无项目过滤）
- [ ] 新 QA 原子写入后，`store.appendAtom()` 追加节点到树，无需全量重载

## 依赖

req-001、req-002（P2 挂载点）、req-007（selectAtom 事件总线）、req-008（list_qa_atoms）
