---
id: req-057
title: 中断干预模型（PreToolUse + 干预记录）
status: done
priority: high
source: 架构决策 · 2026-05-28 · 利用 SDK PreToolUse Hook 支持用户在执行过程中介入
created: 2026-05-28
version: v0.15
---

# req-057 · 中断干预模型

## 背景

用户希望能在 AI 执行过程中介入，补充新信息或纠正方向——而不必等到 AI 给出最终答案后才能反馈。

Claude Code SDK 的 PreToolUse Hook 提供了自然的介入点：在每个工具调用执行前可以暂停 agent loop，等待用户操作。

## 交互流程

```
用户点击「暂停」
    ↓
PreToolUse Hook：当前工具执行完毕后暂停 agent loop
    ↓
P3 显示内联干预卡片：「AI 已暂停，请补充说明」
    ↓
用户输入补充内容 → 点击「继续执行」
    ↓
SDK 将补充内容注入 messages，恢复 agent loop
    ↓
AI 携带补充信息继续执行至完成
```

## QA 原子完整性设计

干预记录与执行步骤写入同一个 atom，保持原子自解释性：

```
原始问题（Q）
  + 中断前已完成的执行步骤（Steps）
  + 用户干预记录（Intervention section）
  + 最终答案（A）
= 一个可自解释的完整上下文单元
```

## 干预 UI 入口规则

| 任务类型 | UI 位置 | 理由 |
|---------|---------|------|
| 对话任务（P3 发起） | P3 内联干预卡片 | 不打断对话上下文，就地处理 |
| 后台任务（Agent 自主） | Decision Inbox（req-018） | 多任务并发时集中审批 |

## 验收标准

- [ ] 对话执行中「暂停」按钮可用，点击后 agent loop 在当前工具完成后暂停
- [ ] P3 显示内联干预输入卡片，支持多行文本输入
- [ ] 用户提交补充内容后 agent loop 恢复，AI 回答包含补充信息的影响
- [ ] 干预记录写入 QA atom `## Intervention` section（时机 + 用户补充内容）
- [ ] 干预后的最终答案写入 `## A`，atom 完整自解释
- [ ] 后台任务的干预请求出现在 Decision Inbox，审批后恢复执行
