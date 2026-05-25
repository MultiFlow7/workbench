# Contributing / 贡献指南

[English](#english) | [中文](#中文)

---

## English

### Getting Started

1. Fork the repository and create a branch from `main`
2. Set up the development environment (see [README](README.md))
3. Make your changes with clear, focused commits
4. Open a pull request with a description of what you changed and why

### Branch Naming

```
feat/short-description     new feature
fix/short-description      bug fix
docs/short-description     documentation only
refactor/short-description code refactor without behavior change
```

### Commit Style

Use concise imperative messages:
```
add streaming support to ai-service
fix race condition in BranchTree render
```

### Pull Request

- Keep PRs focused — one logical change per PR
- Describe what changed and why in the PR body
- Link any related issues

### Reporting Issues

Open a GitHub Issue with:
- A clear title
- Steps to reproduce (for bugs)
- Expected vs actual behavior
- Environment info (OS, Rust/Node/Python versions)

---

## 中文

### 开始参与

1. Fork 本仓库，从 `main` 创建分支
2. 按照 [README](README.md) 配置开发环境
3. 提交清晰、聚焦的改动
4. 发起 Pull Request，说明改动内容和原因

### 分支命名

```
feat/简短描述     新功能
fix/简短描述      Bug 修复
docs/简短描述     仅文档改动
refactor/简短描述 不改变行为的重构
```

### 提交信息

使用简洁的祈使句：
```
add streaming support to ai-service
fix race condition in BranchTree render
```

### Pull Request 规范

- 保持 PR 聚焦——每个 PR 只包含一个逻辑改动
- 在 PR 描述中说明改了什么、为什么改
- 关联相关 Issue

### 报告问题

提 GitHub Issue 时请包含：
- 清晰的标题
- 复现步骤（Bug 类）
- 期望行为 vs 实际行为
- 环境信息（操作系统、Rust/Node/Python 版本）

---

Licensed under the [Apache License 2.0](LICENSE).
