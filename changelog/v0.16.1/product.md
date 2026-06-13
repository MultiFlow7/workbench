---
version: v0.16.1
codename: Public Cleanliness Patch
status: planning
doc_revision: 2
created: 2026-06-13
review_state: 通过
project: 工作台
tags:
  - 类型/规划文档
  - 主题/技术/工作台
  - 状态/规划中
---

# 产品规划 · v0.16.1 · Public Cleanliness Patch

## 版本概述

**一句话定位**：v0.16.1 是一次公开产品洁净度补丁，清理私人痕迹、旧技术栈遗留和发布风险，建立仓库与发布产物的隐私门禁。

本版本不新增用户功能，不重做 UI，不扩展控制平面或执行层。它只回答一个问题：

> 工作台是否已经像一个可公开下载、可由任何用户自行配置的干净产品，而不是开发者个人工作环境的切片？

v0.16 解决了 Vault 路径进入打包产物的问题；v0.16.1 解决更宽的公开仓库洁净度问题：公开文档边界、Git 历史、Tauri 遗留、真实服务地址、疑似密钥、禁止入库文件、最低运行时泄露防护。

## 核心原则

本版本延续并收紧 v0.16 确立的 OSS 零个人信息泄露原则：

1. GitHub 仓库与发布包必须是适用于所有人的开源产品，不服务于单一开发者环境。
2. 所有个人信息、私人路径、真实服务器地址、API Key、本地文档结构和内部过程记录都不得进入公开仓库或发布产物。
3. 用户需要的私有配置必须在下载后由用户本地配置，并只保留在用户本地。
4. 公开仓库只保留产品级文档；内部评审记录、临时执行计划、自动化执行过程记录和私人记忆移入私有区。

## 需求范围

### 选入需求

| ID | 需求 | 优先级 | 状态 |
|----|------|--------|------|
| [req-066](../../requirements/req-066-public-cleanliness-patch.md) | 公开产品洁净度补丁 | critical | confirmed |

### 范围声明

v0.16.1 是单一治理版本，只包含 req-066。所有工作必须服务于公开产品洁净度，不得借机加入新功能。

## 已确认决策

| 编号 | 决策 | 产品含义 |
|---|---|---|
| D1 | 做完整公开产品洁净度补丁 | 不止扫 API Key，还清理文档、历史、技术栈表达和发布门禁 |
| D2 | 扩大泄露定义 | 个人工作方式、知识库结构、服务器地址、内部团队流程都算公开产品污染 |
| D3 | 公开仓库只保留产品级文档 | 内部评审记录、临时执行计划和自动化执行过程记录移私有区或不入 GitHub |
| D4 | 重写 Git 历史 | 在正式公开发布前清理历史中的公网 IP、私人结构和误提交痕迹 |
| D5 | 清理 Tauri 遗留 | 当前产品统一表达为 Electron；旧 Tauri 目录、依赖、脚本、文档引用不再污染仓库 |
| D6 | secure storage 后续单独做 | v0.16.1 只做 API Key 泄露治理，不实现系统钥匙串 |
| D7 | Agent Harness 权限系统后续单独做 | v0.16.1 只做最低 env 泄露防护，不做每 Agent 权限配置 |
| D8 | 扩展自研 scanner | 项目内建立符合工作台自身洁净标准的检查器 |
| D9 | 新增发布前检查 | 防止 `.env`、db、log、`记忆/`、release 产物进入 staging |

## 设计方案

### 1. 公开仓库内容净化

公开仓库内容分三类处理：

| 类型 | 处理方式 | 例子 |
|---|---|---|
| 产品级文档 | 保留并脱敏 | README、正式 requirements、release note、必要 changelog |
| 内部过程文档 | 移入私有区或不追踪 | 内部评审记录、自动化执行过程记录、临时执行计划 |
| 个人记忆 / 本地草稿 | 永不进入 GitHub | `记忆/`、`.env*`、本地对比 HTML、数据库、日志 |

清理标准：

- 文档不得出现真实公网 IP。
- 文档不得出现私人知识库结构关键词。
- 文档不得出现开发者本机路径或用户名。
- 文档不得暴露内部评审、内部决策过程或自动化执行流水，除非整理为产品级决策记录且已脱敏。

### 1.1 文档公开边界

v0.16.1 完成后，公开仓库只保留以下产品级材料：

| 文档类型 | 公开策略 | 要求 |
|---|---|---|
| 用户文档 | 保留 | README、安装说明、配置说明、故障排查必须干净、通用、可复现 |
| 法务 / 协作基础 | 保留 | LICENSE、CONTRIBUTING、PR 模板等不得含私人环境信息 |
| 正式需求索引 | 可保留 | `requirements/README.md` 与仍有产品价值的正式 req 可保留，但必须脱敏并使用当前 Electron 语义 |
| 发布记录 | 可保留 | release note 可保留，内容只描述用户可感知变化、迁移事项和验证结果 |
| 版本规划草案 | 默认移私有区 | `changelog/v*/product.md`、`technical.md` 仅在脱敏并被标记为产品级决策记录时可公开 |
| 内部过程记录 | 不公开 | 内部评审记录、自动化执行计划、临时执行记录、私人记忆和本地草稿不进入公开仓库 |

当前开发流程仍允许在工作区内生成 product.md / technical.md 草案；但 v0.16.1 的交付验收必须包含一次公开边界收口：决定每个规划文档是公开保留、脱敏压缩为 release note，还是迁移到私有区。

### 2. Git 历史清理

由于用户确认若仓库尚未正式对外发布，可以重写 Git 历史，本版本将历史清理纳入范围。

产品要求：

- 重写前创建备份分支或备份 refs。
- 重写目标包含已确认的真实公网 IP、私人路径语义、私人知识库关键词和误提交痕迹。
- 重写后执行历史扫描，而不只扫描 HEAD。
- 重写后确认仓库可重新 clone、install、build。
- 历史重写必须在用户确认后执行；重写完成且扫描通过前，不得创建公开 tag、GitHub Release 或发布包。
- 若远端已有保护分支、协作者 clone 或已发布 tag，执行前必须先确认协作影响，并给出同步说明。

### 3. Tauri 遗留清理

当前事实：

- Electron 主路径已经通过 `window.api`、Electron IPC、LocalRunner / RemoteRunner 运行。
- Settings 中已有服务器配置入口，远程执行通过用户填写的 WebSocket 地址和 Bearer Token。
- Electron 主进程中的 `start_backend_sse` / `stop_backend_sse` 已是 stub。
- `workbench/src-tauri/` 仍保留旧 Rust/Tauri 代码，其中含硬编码公网 IP。
- `package.json` 仍保留 Tauri script 与依赖。

产品要求：

- 公开产品不再把 Tauri 表达为当前运行时。
- 如果技术规划确认无依赖，移除 `workbench/src-tauri/`、Tauri scripts 和 Tauri 依赖。
- 如因风险需要暂时保留，则必须隔离为 deprecated legacy，并清理所有敏感内容；但本版本首选删除。

### 4. 服务地址洁净化

默认值规则：

- 本地服务默认使用 `localhost` / `127.0.0.1`。
- 远程服务必须由用户部署并在 Settings 中配置。
- 文档示例使用 `ws://your-server:3001/ws/agent` 或 `<your-server>`。
- 不允许任何真实公网 IP 作为默认值、示例值或历史注释留在公开仓库。

### 5. Scanner 与发布前检查

新增或扩展项目内 scanner，覆盖以下规则：

| 规则 | 目的 |
|---|---|
| personal path | 捕获 `/Users/`、`/home/`、`C:\Users` |
| public IP | 捕获真实公网 IPv4，允许 localhost、私有网段、文档保留地址 |
| secret pattern | 捕获 API Key、token、private key、Authorization header |
| forbidden files | 捕获 `.env`、`.db`、`.sqlite`、`.jsonl`、日志、release 包进入 staging |
| private keywords | 捕获私人知识库结构关键词 |
| packaged resources | 扫描 `workbench/out`、dmg Resources、`ai-service` |

scanner 输出必须可读：

- 文件路径
- 命中规则
- 命中上下文
- 退出码

允许 allowlist，但 allowlist 必须显式记录理由，不能变成逃避扫描的黑洞。

`private keywords` 的来源必须可审查：

- 2026-06-13 隐私审查中发现的私人知识库结构词。
- 用户明确确认不应公开的路径片段、目录命名和内部流程词。
- 后续 scanner 配置文件中的新增词条。

关键词表和 allowlist 都必须进入可审查配置文件；每条 allowlist 必须说明命中内容、豁免原因和适用范围。

### 6. 最低运行时泄露防护

本版本不实现 API Key secure storage，但必须守住最低线：

- API Key 不出现在日志、错误输出、构建产物和示例文档里。
- Gemini 等把 key 放 URL query 的链路，错误日志不得输出完整含 key URL。
- `.env.example` 只包含 placeholder，不包含真实 key 形态到会被 scanner 误判的程度。

本版本不实现完整 Agent Harness 权限系统，但必须守住最低线：

- v0.16.1 只定义全局安全默认 env 策略：默认不全量继承 `process.env`，采用最小 allowlist 或明确敏感 denylist。
- 技术规划阶段必须说明该策略覆盖 LocalRunner / server runner 的哪一条执行链路。
- 不新增 per-agent 权限 UI，不新增权限模型配置。

## 不纳入范围

- API Key secure storage / 系统钥匙串。
- macOS Keychain、Windows Credential Manager、Linux Secret Service 集成。
- API Key 从旧 settings / localStorage 到钥匙串的迁移。
- Agent Harness 权限系统。
- 每个 Agent 的工具权限、目录权限、网络权限、env 权限配置。
- 新 UI 功能、Settings 重做、控制平面新能力。
- 远程执行架构重构。

## 后续需求占位

### req-067 · API Key 安全存储

后续目标：

- 调研成熟开源桌面应用的 API Key 存储方案。
- 评估 Electron `safeStorage`、macOS Keychain、Windows Credential Manager、Linux Secret Service。
- 设计旧配置迁移、失败 fallback、重置和跨平台行为。

### req-068 · Agent Harness 权限系统

后续目标：

- 建立 Agent / Multi-Agent Harness 权限模型。
- 支持每个 Agent 配置工作目录、工具权限、环境变量、网络权限、读写权限。
- 对齐 Claude / Codex 类执行前权限选择体验。

## 验收标准

### 仓库洁净度

- [ ] tracked files 不含真实公网 IP。
- [ ] tracked files 不含私人绝对路径。
- [ ] tracked files 不含私人知识库结构关键词。
- [ ] tracked files 不含 `.env`、数据库、日志、usage jsonl、release 产物。
- [ ] 公开产品文档不暴露内部评审、内部决策或自动化执行过程。
- [ ] 文档公开边界完成收口：每个规划文档都被判定为公开保留、脱敏压缩为 release note，或迁移私有区。

### 历史洁净度

- [ ] Git 历史扫描通过。
- [ ] 历史中不再出现已确认清理目标。
- [ ] 重写历史后仓库可正常 clone、install、build。
- [ ] 重写历史后且扫描通过前，不创建公开 tag、GitHub Release 或发布包。

### 技术栈一致性

- [ ] README / product docs 表达当前运行时为 Electron。
- [ ] Tauri 遗留已删除或隔离 deprecated，且无敏感信息。
- [ ] Electron 主路径开发、构建、启动正常。

### 配置与发布

- [ ] 默认服务地址不指向开发者真实服务器。
- [ ] 示例配置使用 placeholder。
- [ ] 用户可通过 Settings 配置自己的远程服务。
- [ ] build 产物和 dmg Resources 扫描通过。

### Scanner 门禁

- [ ] scanner 覆盖 personal path、公网 IP、疑似 key、禁止文件、私人关键词。
- [ ] scanner 可扫描源码、文档、build、dmg Resources、ai-service。
- [ ] pre-release / preflight 检查发现禁止项时失败。
- [ ] staging 中禁止文件被识别并阻断。

### 最低运行时安全线

- [ ] API Key 不出现在日志、错误输出、构建产物和示例文档。
- [ ] Agent 子进程执行链路应用全局安全默认 env 策略：默认不全量继承 `process.env`，采用最小 allowlist 或明确敏感 denylist。
- [ ] secure storage 与 Agent Harness 权限系统明确作为后续需求记录。

## 风险与权衡

| 风险 | 等级 | 说明 | 缓解 |
|---|---|---|---|
| 范围膨胀 | 高 | 容易滑向 secure storage 或 Harness 权限系统 | 本版本只做泄露治理，后续另立需求 |
| 历史重写影响协作 | 高 | force push 会影响已有 clone 和 tag | 仅在正式公开发布前执行；先建备份 refs |
| 文档误删 | 中 | 内部文档可能含有产品价值 | 产品级文档保留脱敏，内部过程移私有区 |
| Tauri 删除回归 | 中 | 旧脚本或依赖可能仍被引用 | technical.md 先做引用图，确认后删除 |
| scanner 误报 | 中 | 示例 key、测试 fixture、文档保留地址可能误报 | allowlist 必须有理由 |
| scanner 漏报 | 中 | 正则无法覆盖所有 secret 变体 | 组合规则 + 人工审查，后续可接 gitleaks |
| env 过滤破坏 SDK | 中 | 过滤过严可能影响工具和代理 | technical.md 定义最小 allowlist，保留必要系统变量 |

## 版本完成定义

v0.16.1 完成时，工作台应满足：

- 新用户看 GitHub 仓库时，只看到产品、安装、开发、配置和发布所需内容。
- 新用户不会看到开发者真实服务器、私人知识库结构、内部执行记录或本地路径。
- 发布者无法轻易把 `.env`、db、log、release 包或私人记忆误提交。
- Electron 是唯一清晰的当前技术栈。
- 后续安全能力已有清晰需求边界，不混入本补丁版本。

## 修订记录

| doc_revision | 日期 | 作者 | 说明 |
|---|---|---|---|
| 1 | 2026-06-13 | workbench-product | 初稿：根据用户决策 D1-D9 起草 v0.16.1 公开产品洁净度补丁范围 |
| 2 | 2026-06-13 | workbench-product | 修订第一轮 review 阻断项：公开措辞中性化；新增文档公开边界；补历史重写发布门禁；明确 private keywords 来源与 env 安全默认策略 |
