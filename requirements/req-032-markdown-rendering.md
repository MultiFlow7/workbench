---
id: req-032
title: ChatView Markdown 渲染（对话内容格式化显示）
status: done
priority: high
source: CEO 需求打包 2026-05-20（用户报告对话显示问题触发）
created: 2026-05-20
version: v0.9
---

# req-032 · ChatView Markdown 渲染

## 需求描述

当前 `ChatView.tsx` 中，AI 回答和用户消息均以 `white-space: pre-wrap` 方式渲染纯文本。当 AI 回答中包含 Markdown 语法（如 `**bold**`、`# heading`、` ``` ` 代码块、`- 列表`、`| 表格 |` 等），这些符号以原始字符直接显示，影响可读性和信息密度。

当前渲染路径：

```tsx
<div className={`bubble bubble--${msg.role}`}>{msg.content}</div>
```

内容被直接插入 React 文本节点，无任何 Markdown 解析。

## 使用场景

- AI 回答涉及多步骤操作时（列表、编号），原始符号导致内容杂乱难读
- AI 回答包含代码片段时（代码块），等宽高亮缺失降低辨识度
- AI 回答使用表格对比信息时，原始管道符 `|` 排版混乱
- 标题层级（`#` / `##`）在长回答中帮助定位，原始符号无法提供视觉层次

## 验收标准

| 验收项 | 标准 |
|--------|------|
| **标题渲染** | `# H1` / `## H2` / `### H3` 正确渲染为对应 HTML heading，具备字号和粗细区分 |
| **粗体 / 斜体** | `**text**` 渲染为 `<strong>`，`*text*` 渲染为 `<em>` |
| **代码块** | ` ``` ` 围栏代码块渲染为等宽字体区块，行内代码 `` `code` `` 渲染为高亮 span |
| **无序 / 有序列表** | `- item` 和 `1. item` 正常渲染为 `<ul>` / `<ol>` |
| **表格** | GFM 标准表格渲染为 `<table>`，具备基本边框样式 |
| **用户消息不受影响** | `bubble--user` 气泡保持纯文本渲染，不对用户输入进行 Markdown 解析 |
| **Streaming 中不崩溃** | streaming 状态下的 `streamingText` 也经过 Markdown 渲染，不因不完整的 Markdown 语法导致渲染报错 |
| **安全性** | 渲染结果不存在 XSS 风险（使用受控渲染方案，禁用 raw HTML 或开启严格过滤） |

## 技术方向

### 推荐方案：react-markdown

引入 `react-markdown`（+ `remark-gfm` 插件支持表格、任务列表等 GFM 扩展）：

```tsx
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// AI 消息气泡
{msg.role === 'ai' ? (
  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
) : (
  msg.content  // 用户消息保持纯文本
)}
```

优点：React 原生组件，无 `dangerouslySetInnerHTML`，默认安全；生态成熟，支持自定义 component 映射。

### 备选方案：marked.js + DOMPurify

```tsx
import { marked } from 'marked'
import DOMPurify from 'dompurify'

<div
  dangerouslySetInnerHTML={{
    __html: DOMPurify.sanitize(marked(msg.content) as string)
  }}
/>
```

优点：包体积略小；缺点：需要手动 sanitize，增加维护负担，不推荐。

### 样式集成

- 在 `ChatView.css` 中为 `.bubble--ai` 内的 Markdown 元素添加样式（`h1~h3`、`code`、`pre`、`table`、`li` 等），确保与气泡整体风格一致（字体 Inter / JetBrains Mono，色彩 `--accent: #2563eb`）
- 代码块背景使用 `--bg: #f5f5f5`，避免与气泡背景混淆

## 数据埋点

不需要（纯前端渲染优化，无用户行为数据价值）。

如果后续引入「Markdown 渲染开关」（用户可切换原始模式），则记录 `markdown_render_toggle` 事件（`{enabled: boolean}`）。当前阶段默认开启，无开关，无需埋点。

## 与其他需求的关系

- 不依赖任何后端变更，纯前端改动
- 与 req-005（线性对话视图）共用 `ChatView.tsx`，修改范围限于消息气泡渲染层，不影响消息列表逻辑
- Streaming 渲染路径（`streamingText`）同样需要接入 Markdown 渲染，保持视觉一致性

## 讨论记录

**2026-05-20**：CEO 需求打包，用户反馈 AI 回答中 Markdown 语法以原始符号显示，影响日常使用体验。该问题在 ChatView.tsx 第 285 行处确认——`bubble--ai` 气泡直接渲染文本节点，无解析层。列为 v0.9 高优先级需求，随对话体验提升主题一并实现。
