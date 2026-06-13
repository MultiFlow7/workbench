---
id: req-056
title: QA 原子全量执行步骤存储
status: done
priority: high
source: 架构决策 · 2026-05-28 · 修复 context 重建缺陷 + 支持 ProcessTrace 历史回溯
created: 2026-05-28
version: v0.15
---

# req-056 · QA 原子全量执行步骤存储

## 背景

当前 QA atom 只持久化最终 answer 文字。工具调用的中间步骤（轮次、工具调用详情、工具结果、思考块）不存储，导致两个结构性问题：

1. **ProcessTrace 历史回放缺少数据**：历史节点打开时只能显示最终文字，无法回溯执行过程
2. **含工具调用的节点分叉时 context 不完整**：Claude API 要求 messages 包含完整的工具调用历史；当前实现从历史节点分叉时，API 收到的 messages 缺少工具调用中间消息，行为不可预测

## 存储格式（MD，追加 `## Steps` section）

```markdown
## Steps

### Round 1

**Thinking**
AI 的思考内容（如有）

**Tool: read_file**
- Input: `{"path": "src/index.ts"}`
- Result: `文件内容...`

**Tool: bash**
- Input: `{"cmd": "find . -name *.ts"}`
- Result: `23 个匹配文件...`

### Round 2

**Tool: read_file**
- Input: `{"path": "src/store/conversationSlice.ts"}`
- Result: `...`
```

## 向后兼容

现有 MD atom 文件无 `## Steps` section。读取时降级为只显示 `## A` 内容，不报错，不破坏现有数据。

结构升级（MD → MD+JSON 边车）推迟到后续版本。

## 验收标准

- [ ] SDK 执行过程中，每个 thinking 块写入 `## Steps`
- [ ] 每个工具调用（名称 + input + result）写入对应 Round
- [ ] 多轮工具调用按 Round N 分组存储
- [ ] ai-done 时文件写入完整，`## Steps` 在 `## A` 之前
- [ ] 从含 Steps 的历史节点分叉时，messages 包含完整工具调用历史，API 响应正常
- [ ] 旧格式（无 Steps）的 atom 打开正常，无报错
