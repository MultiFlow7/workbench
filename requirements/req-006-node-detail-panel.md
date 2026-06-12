---
id: req-006
title: 节点详情面板（P4 只读）
status: done
priority: medium
source: 产品方向.md（P4 职责：上下文详情 + 渐进演化起点）
created: 2026-05-17
version: v0.1
---

# req-006 · 节点详情面板（P4 只读）

## 需求描述

Panel 4 是 v0.1 的只读详情区，响应 `store.selectAtom(id)`，调用 `read_qa_atom` 读取并展示当前选中节点的完整真实 QA 原子内容。是 P4 向「第二工作区」演化的第一步，v0.1 不支持编辑。

## 验收标准

- [ ] `store.selectAtom(id)` 触发 → 调用 `read_qa_atom` → 展示完整 QA 原子内容
- [ ] 展示字段：节点 ID / 时间戳 / 完整问题正文 / AI 回答全文 / 子节点数量
- [ ] P4 折叠时，展示内容不销毁（展开后恢复，不重新 fetch）
- [ ] 视觉风格与 P3 一致（字体、间距、颜色来自 CSS Variables）

## 演化标记

此实现为 v0.1 只读起点，v0.2 规划加入 Markdown 查看器，v0.3 加入编辑模式。实现时预留 `p4Mode: 'detail' | 'markdown' | 'editor'` 状态位，不实现但结构预留。

## 依赖

req-001、req-002（P4 挂载点）、req-004（P2 节点点击触发 selectAtom）、req-007（store）、req-008（read_qa_atom）
