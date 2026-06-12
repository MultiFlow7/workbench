---
id: req-038
title: 项目文件 Atom ID 解析 trim 修复（重启后画布空白）
status: done
priority: high
source: session-fix
created: 2026-05-21
version: v0.11
---

# req-038 · 项目文件 Atom ID 解析 trim 修复

## 问题根因

工作台使用 Rust 侧的 `parse_atom_ids` 函数从项目文件中提取 atom ID 列表。项目文件中以 `[[ id ]]` 格式（Obsidian wikilink 风格）存储 atom 引用，提取逻辑使用正则匹配 `[[...]]` 内的内容。

**Bug**：提取出的 ID 字符串未经过 `.trim()` 处理，导致提取结果带有前后空格（如 `" abc123 "` 而非 `"abc123"`）。

**后果链**：

1. 工作台重启后，前端从项目文件重新加载 atom 列表
2. 加载时用带空格的 ID 去磁盘查找对应的 `.md` 文件
3. 文件名不含空格，查找失败，atom 无法加载
4. 画布（BranchTree / ChatView）因无 atom 数据而显示空白

**症状**：应用第一次使用时正常（atom 在内存中），重启后打开同一项目，画布完全空白，对话历史消失。

## 修复方案

在 Rust 侧 `parse_atom_ids` 函数中，对正则匹配结果调用 `.trim()` 方法，去除 ID 首尾空白字符后再返回。

修复位置：`src-tauri/src/`（具体文件为包含 `parse_atom_ids` 的 Rust 模块），修改内容为在匹配组提取后追加 `.trim()` 调用。

## 验收指标

| 验收项 | 标准 |
|--------|------|
| 重启后 atom 正确加载 | 关闭并重启应用，打开已有项目，画布和对话历史正确显示，不出现空白 |
| ID 无多余空格 | 调试日志或测试中确认提取出的 atom ID 不含前后空格 |
| 回归：首次使用路径不受影响 | 新建对话、发送消息、查看树——全部正常，不因 trim 逻辑引入新问题 |

## 实现状态

代码层面已在本 session 完成修复（Rust `parse_atom_ids` 已加 `.trim()`），technical.md 阶段可直接标记为 done。
