---
id: req-034
title: 新建项目入口（NavList 前端 + create_project 后端）
status: done
priority: high
source: user-report
created: 2026-05-21
version: v0.10
---

# req-034 · 新建项目入口（NavList 前端 + create_project 后端）

## 问题描述

用户在 NavList 中只能新建对话，没有办法新建项目。项目是大画布容器，对话是项目内的一条对话链，两者应各有独立的创建入口。

## 现状分析

`NavList.tsx` 目前只有一个「+ 新建对话」按钮。

后端已有 `list_projects` 命令（`invoke('list_projects', { projectsDir: PROJECTS_PATH })`），说明 Tauri 后端具备项目管理能力，项目目录结构已存在。

`ProjectMeta` 接口字段完备（id / name / rootBranchId / createdAt / atomIds），数据模型无需改动。

## 边界分析（desktop-platform 侧）

**待确认**：后端是否已有 `create_project` Tauri 命令。

- 若**已有**：前端直接调用 `invoke('create_project', { projectsDir, projectName })`，本需求为纯前端工作。
- 若**未有**：需要在 desktop-platform 新增 `create_project` 命令，实现：
  1. 在 `PROJECTS_PATH` 下创建项目目录（以 UUID 或时间戳命名）
  2. 写入项目元数据文件（`project.json`，包含 ProjectMeta 的各字段）
  3. 返回新建的 `ProjectMeta` 对象给前端

**本 product.md 假设后端已有（或本版本同步实现）`create_project` 命令**，desktop-platform 实现细节待 technical.md 阶段确认。

## 修复方向

### 前端：NavList 新增项目创建入口

1. 在 NavList「项目」section 标题旁，添加「+ 新建项目」按钮（与「新建对话」按钮样式对齐）
2. 点击后弹出内联输入框（inline input），用户输入项目名，按 Enter 确认 / Esc 取消
3. 确认后调用 `invoke('create_project', { projectsDir: PROJECTS_PATH, name: projectName })`
4. 成功后将新项目 append 到 `projects` 状态，自动选中该项目（`selectProject(newProject.id)`）
5. 失败时显示用户可见的错误提示，输入框不关闭，允许重试

### 用户流程

```
NavList「项目」section 标题 → 点击「+」→ 出现内联输入框
→ 输入项目名 → Enter → invoke('create_project') → 新项目出现在列表中 → 自动选中
```

### 与新建对话的关系

新建项目后，项目内无对话链；用户可在项目内进一步「新建对话」创建第一条对话链。两者入口独立，职责分明。

## 关键验收指标

| 验收项 | 标准 |
|--------|------|
| 创建入口可见 | NavList「项目」section 标题旁有「+」按钮，与「新建对话」按钮视觉一致 |
| 内联输入确认 | 点击「+」出现内联输入框；Enter 确认，Esc 取消；空名称无法提交 |
| 项目出现在列表 | 创建成功后，新项目立即出现在 NavList「项目」列表中，无需刷新 |
| 自动选中 | 新建成功后自动选中该项目，P2/P3 切换至该项目视图 |
| 错误处理 | `create_project` 失败时，内联输入框不关闭，显示错误提示，用户可修改后重试 |
| 不影响现有对话创建 | 「新建对话」按钮行为不变 |

## 讨论记录

- 2026-05-21：用户报告，工作台 v0.9 无新建项目入口。边界分析：后端 `create_project` 命令需在 technical.md 阶段确认是否已有，如未有则本版本同步新增。
