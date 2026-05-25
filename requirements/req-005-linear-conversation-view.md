---
id: req-005
title: 线性对话视图（P3）
status: done
priority: high
source: 产品方向.md（核心动作：看/选；架构原则：对话线性化）
created: 2026-05-17
version: v0.1
---

# req-005 · 线性对话视图（P3）

## 需求描述

Panel 3 是线性 chatbot 界面，始终渲染从根节点到当前选中节点的完整路径消息。读取真实本地 QA 原子文件，接入真实 AI 流式回复（sub2api via Tauri HTTP Plugin），不使用 mock 数据。

## 验收标准

- [ ] 应用启动后 P3 显示最近一次对话路径的真实历史（从本地 QA 原子文件读取）
- [ ] `store.selectAtom(id)` 触发 → 计算根到该节点的路径 → 从本地逐个读取 QA 原子 → 刷新消息列表，无页面跳转
- [ ] 顶部面包屑：`根节点摘要 › ... › 当前节点摘要`（最多 3 级，多余折叠）
- [ ] 消息气泡区分：用户消息（右侧，accent 背景）/ AI 回复（左侧，surface 背景）
- [ ] 切换节点后自动滚动到底部
- [ ] 输入框发送消息 → 调用 `stream_ai` Tauri Command → token 逐字追加渲染
- [ ] 流式过程中显示打字动画，`streamingState` 为 `streaming`
- [ ] 用户点击停止 → Rust 中止请求，`streamingState` 切换为 `cancelled`
- [ ] AI 请求失败时显示错误提示 + 重试按钮，`streamingState` 为 `error`
- [ ] 流式完成后：本地生成新 QA 原子 .md 文件，P2 树追加新节点

## 路径计算

路径计算（根→当前节点，沿 `prev` wikilink 回溯）在 Zustand `conversationSlice` 完成，P3 只接收 `currentPath` 渲染，不自行计算。

## 依赖

req-001、req-002（P3 挂载点）、req-004（P2 节点点击触发 selectAtom）、req-007（路径计算 + streamingState）、req-008（read_qa_atom、write_qa_atom）、req-009（stream_ai）
