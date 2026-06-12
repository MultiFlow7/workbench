---
id: req-008
title: Tauri 本地文件命令（QA 原子 + Obsidian vault）
status: done
priority: high
source: 架构决策：Obsidian 内容走本地，服务器逻辑走服务器
created: 2026-05-17
version: v0.1
---

# req-008 · Tauri 本地文件命令

## 需求描述

所有需要读写本地文件的操作，通过 Tauri Rust Command 实现，前端不直接调用 `@tauri-apps/api/fs`。v0.1 需要的命令集：读取对话目录下所有 QA 原子文件、读取单个 QA 原子、写入新 QA 原子、搜索 Obsidian vault 关键词、写入本地埋点事件日志。

## Tauri Commands 清单（v0.1 所需）

```rust
// 读取某个对话目录下所有 QA 原子文件，返回 id/prev/summary/timestamp
list_qa_atoms(conversation_dir: String) -> Result<Vec<QAAtomMeta>, String>

// 读取单个 QA 原子完整内容（含完整 question/answer）
read_qa_atom(file_path: String) -> Result<QAAtom, String>

// 写入新 QA 原子文件（对话完成后持久化）
write_qa_atom(file_path: String, atom: QAAtom) -> Result<(), String>

// Obsidian vault 关键词搜索（用于 AI 工具调用）
search_vault(vault_path: String, keyword: String) -> Result<Vec<NoteResult>, String>

// 追加埋点事件到本地日志（~/Library/Logs/Workbench/events.jsonl）
write_event_log(event: EventLog) -> Result<(), String>
```

## QA 原子文件格式（对齐无限画布 persistence.ts 实际格式）

```markdown
---
id: "0001-001"
prev: ""
children: []
timestamp: "2026-05-17T10:30:00Z"
status: done
projects:
  - "[[Canvas]]"
executor: Local
---

# 问题

{用户问题}

# 回答

{AI 回答}
```

字段说明：
- `prev`：父节点文件名（Obsidian wikilink 格式 `[[0001-001]]`）；根节点在 YAML 文件中写空字符串 `""`，`list_qa_atoms` 解析时将 `""` 转换为 TypeScript `null`（与 req-007 类型定义 `prev: string | null` 对齐）
- `children`：子节点 wikilink 列表；新写入时为 `[]`，由父节点更新追加
- `status`：固定写 `done`（streaming 完成后才落盘）
- `projects`：`["[[Canvas]]"]`（v0.1 沿用无限画布项目标签，v0.2 再统一）
- `executor`：固定 `Local`

默认 BASE_PATH 示例：`/Users/<name>/Workbench-Vault/QA`

## 验收标准

- [ ] `list_qa_atoms` 能读取指定目录，返回元数据列表（不含完整对话内容）
- [ ] `read_qa_atom` 读取单个文件，解析 frontmatter + 正文
- [ ] `write_qa_atom` 写入文件，格式符合无限画布 QA 原子格式（`prev` wikilink、`status: done`、`projects`、`executor`）
- [ ] `search_vault` 按关键词全文搜索 vault 目录下所有 .md 文件
- [ ] `write_event_log` 追加 JSON 行到 `~/Library/Logs/Workbench/events.jsonl`，文件不存在时自动创建
- [ ] 所有 Command 声明在 `tauri.conf.json` capability 中，权限最小化
- [ ] QA 原子默认路径硬编码为 `07-AI知识库/L1-原始对话/QA`（绝对路径在运行时拼接）

## 依赖

req-001（Tauri 骨架）
