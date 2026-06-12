---
id: req-060
title: ProcessTrace Chat 模式接入（方案B渲染体系）
status: done
priority: high
source: 原型对比分析 · 2026-06-01 · prototype-v0.15.html vs 当前实现差距对比
created: 2026-06-01
version: v0.15.1
---

# req-060 · ProcessTrace Chat 模式接入（方案B渲染体系）

## 背景

v0.15 中 `ProcessTrace.tsx` 已写好，但从未被 `App.tsx` 引用。Chat 模式下 P3 仍使用旧的 `ChatView`，导致原型设计的执行时间线形态缺失。

本需求将 ProcessTrace 接入 Chat 模式 P3，同时完善渲染细节使其与原型完全对齐。

## 渲染结构（方案B·分层）

每个 QA atom 在 P3 中的渲染顺序：

```
Q bubble（右对齐，主色填充）
    ↓
AI Process 折叠区（仅含工具调用的响应显示）
  ├── 思维链 group toggle（紫色，全展/全折）
  ├── 工具调用 group toggle（蓝色，全展/全折）
  └── 每轮：
        ├── Thinking block（可折叠，折叠态显示预览文字）
        └── Tool block 卡片（可折叠，展示 input / result）
    ↓
Final Answer bubble（左对齐，无外框，markdown 渲染）
    ↓
Token 统计行（in / out / cached / cost，紧凑内联）
```

## 关键规则

- **纯文字响应**：不显示 AI Process 折叠区，直接渲染 Final Answer bubble
- **默认状态**：过程展开 / 思维链展开 / 工具调用收起
- **切节点**：折叠状态重置为默认
- **存储对齐**：QA atom 的 `## Steps` 中 thinking / tool 数据随 atom 一起存（req-056 已实现）；本 req 负责消费该数据渲染历史视图
- **Markdown 渲染**：Final Answer 中需正确渲染 markdown（消解 req-032 in-progress 状态）

## 验收标准

- [ ] App.tsx 中 chat 模式使用 ProcessTrace，ChatView 不再作为主渲染器
- [ ] 含工具调用的响应渲染：Q bubble → AI Process → Final Answer → Token 统计
- [ ] 纯文字响应渲染：Q bubble → Final Answer（无 AI Process 区域）
- [ ] 思维链 group toggle 一次性折叠/展开所有 thinking block
- [ ] 工具调用 group toggle 一次性折叠/展开所有 tool card
- [ ] 单个 thinking block / tool card 可独立折叠（覆盖 group 设置）
- [ ] Thinking block 折叠态显示前 N 字预览文字
- [ ] Tool card 展示工具名 + 展开/收起 input 和 result
- [ ] Token 统计行显示 in / out / cached / cost 四项
- [ ] 历史节点打开时从 `## Steps` 完整还原，与运行时渲染一致
- [ ] 切换 P2 节点后折叠状态重置为默认值
- [ ] 旧 atom（无 `## Steps`）读取时降级显示，仅渲染 `## A`，不报错、不崩溃
