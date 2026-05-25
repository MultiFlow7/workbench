---
id: req-042
title: 内置工具集（读取本地文件 / 执行 Shell 命令 / 搜索 Vault）
status: planned
priority: high
source: product-planning
created: 2026-05-21
version: v0.11
---

# req-042 · 内置工具集

## 背景与目标

依赖 req-041 的 `execute_tool` 框架，v0.11 先内置 2-3 个能「感受到价值」的本地工具，让用户能在对话中体验 AI 真正干活的感觉。工具以 Rust 实现，在 `execute_tool` 的分发表中注册。

## 工具定义

### 工具 1：`read_file`

**用途**：读取本地文件内容，返回给 AI

**输入**：
```json
{ "path": "/absolute/path/to/file.md" }
```

**输出**：文件内容字符串（文本文件），超过 50KB 时截断并附注「（内容已截断，共 X 字节）」

**安全约束**：
- 仅允许读取 Obsidian vault 目录下的文件（路径白名单）
- 禁止读取系统文件（`/etc/`、`/usr/` 等路径前缀拒绝）

**待 CEO 确认**：路径白名单的范围——是限制在 vault 目录，还是允许用户在 Tauri 应用设置中配置可读目录？

---

### 工具 2：`run_shell`

**用途**：在本机执行 shell 命令，返回 stdout/stderr

**输入**：
```json
{ "command": "ls -la /path/to/dir" }
```

**输出**：`{ "stdout": "...", "stderr": "...", "exit_code": 0 }`

**安全约束**：
- 命令黑名单：禁止包含 `rm -rf`、`sudo`、`curl | sh`、`chmod 777` 等高危模式
- 执行超时：10s，超时后强制终止并返回超时错误
- 工作目录：固定为当前项目的 vault 路径，防止操作系统关键目录

**待 CEO 确认**：`run_shell` 是否默认开启？还是需要用户在设置中手动开启「允许 AI 执行 shell 命令」？这个工具风险最高，建议默认关闭，v0.11 在设置层面先占位。

---

### 工具 3：`search_vault`

**用途**：在 Obsidian vault 中全文搜索，返回匹配的文件路径和摘要片段

**输入**：
```json
{ "query": "tool calling 设计", "max_results": 5 }
```

**输出**：
```json
[
  { "path": "01-Vibe项目区/xxx.md", "snippet": "...匹配上下文..." },
  ...
]
```

**实现方式**：Rust 侧遍历 vault 目录，对 `.md` 文件做简单字符串包含匹配，返回前 N 条（不需要向量搜索，v0.11 用最简实现）

---

## 工具向 Claude API 的描述（tool schema）

每个工具需要以 JSON Schema 格式描述，在调用 `stream_ai` 时通过 `tools` 字段传给 Claude API。后端 `stream_ai` 需要支持接收 `tools` 参数并转发给 Claude API。

**待 CEO 确认**：后端 `stream_ai` 命令是否已支持 `tools` 参数传递，还是 v0.11 需要同步改造后端？

## 验收指标

| 验收项 | 标准 |
|--------|------|
| read_file 正确读取 | AI 请求读取文件，execute_tool 返回正确文件内容 |
| read_file 路径限制生效 | 尝试读取 vault 外路径，返回权限拒绝错误 |
| run_shell 执行命令 | AI 请求执行合法命令，返回正确 stdout/stderr |
| run_shell 黑名单拦截 | 包含 `rm -rf` 的命令被拒绝，返回安全错误提示 |
| run_shell 超时生效 | 超过 10s 的命令被强制终止 |
| search_vault 返回结果 | AI 请求搜索关键词，返回包含匹配路径和摘要的列表 |
| 工具 schema 传给 Claude | 调用 stream_ai 时携带 tools schema，Claude 能识别并在合适时机调用工具 |
