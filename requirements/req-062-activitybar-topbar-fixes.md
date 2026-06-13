---
id: req-062
title: ActivityBar 布局规范修正 + TopBar 运行状态 pill
status: done
priority: medium
source: 原型对比分析 · 2026-06-01 · ActivityBar/TopBar 与原型差距修正
created: 2026-06-01
version: v0.15.1
---

# req-062 · ActivityBar 布局规范修正 + TopBar 运行状态 pill

## 背景

对比 prototype-v0.15.html，ActivityBar 和 TopBar 有以下偏差：

1. **服务器状态按钮**：原型在 ActivityBar 最顶部有独立的服务器状态绿点按钮（点击弹出详情），当前实现位置或集成方式与原型不符
2. **底部双按钮**：原型底部有 settings 和 theme 两个独立按钮，当前实现可能缺少其一或混淆
3. **TopBar 运行状态**：原型 TopBar 有"Agent 运行中 · N 活跃"状态 pill，当前实现无此指示

## ActivityBar 目标布局

```
┌─────────┐
│ ⬡ server│  ← 顶部：服务器状态按钮（绿=在线/红=离线/灰=未配置）
│         │     点击弹出服务器详情面板
├─────────┤
│ 模式    │  ← 中部：chat / tools / console / decisions / analytics / dashboard
│ 切换    │     六个模式按钮（已有）
│ 按钮组  │
├─────────┤
│ 🌙 theme│  ← 底部：主题切换按钮（独立）
│ ⚙ set  │  ← 底部：设置按钮（独立）
└─────────┘
```

## TopBar 目标

- 有 Agent 任务运行时，TopBar 显示状态 pill：`Agent 运行中 · N 活跃`
- N 为当前活跃 Agent 数量
- 无活跃任务时 pill 不显示

## 验收标准

### ActivityBar
- [ ] 顶部有独立的服务器状态按钮，颜色反映在线/离线/未配置三态
- [ ] 点击服务器状态按钮弹出服务器详情（地址、连接状态、延迟等）
- [ ] 底部同时存在 theme 切换按钮和 settings 按钮，各自独立
- [ ] theme 按钮点击切换浅色/暗色，与 appearanceStore 联动（req-058 已实现）
- [ ] settings 按钮点击进入设置页

### TopBar
- [ ] 有活跃 Agent 时 TopBar 显示"Agent 运行中 · N 活跃" pill
- [ ] N 随活跃 Agent 数量实时更新
- [ ] 无活跃 Agent 时 pill 消失
