---
id: req-066
title: 公开产品洁净度补丁
status: confirmed
priority: critical
source: 2026-06-13 · GitHub 公开仓库隐私/密钥/个人信息审查后，用户确认工作台必须成为任何用户下载都干净、通用、可配置的开源产品
created: 2026-06-13
version: v0.16.1
---

# req-066 · 公开产品洁净度补丁

## 背景

v0.16 已完成 Vault 路径从 build-time env 内联迁移到运行期配置，并建立了构建产物个人路径扫描。但 2026-06-13 进一步审查 GitHub 可见代码与本地发布边界后，确认 v0.16 仍只解决了第一层问题：构建产物中不含打包者个人路径。

当前公开产品洁净度仍存在更宽的风险面：

- Git tracked 文件中存在硬编码公网 IP（Tauri 遗留 SSE 客户端与旧需求文档）。
- 历史需求文档保留私人知识库结构语义，例如开发者本地知识库目录名、层级编号和原始对话归档路径。
- `src-tauri/`、Tauri script 与依赖仍留在仓库中，公开产品技术栈表达与当前 Electron 实现不一致。
- 内部评审记录、临时执行计划、自动化执行过程记录等内容不适合作为公开产品仓库的一部分。
- 现有 scanner 主要覆盖个人路径，尚未覆盖公网 IP、疑似密钥、禁止入库文件和私人知识库关键词。
- Agent 子进程环境变量透传存在最低安全线问题，完整 Harness 权限系统需后续独立规划。
- API Key secure storage 是独立本地安全能力，不纳入本补丁，但需要明确为后续需求，避免被误认为已解决。

用户确认的核心原则：

> GitHub 上的结果应当是任何一个用户下载和使用它都是最纯粹的干净产品。

因此，v0.16.1 定位为公开发布前的洁净度补丁，不新增功能，不重做 UI，只清理公开仓库、发布产物、默认配置与最低运行时泄露边界。

## 目标

让工作台公开仓库与发布产物达到更严格的 OSS 产品洁净度：

- 不暴露开发者个人路径、用户名、知识库结构、真实服务器地址、内部团队流程或真实密钥痕迹。
- 当前技术栈统一表达为 Electron，不再让 Tauri 遗留污染公开产品边界。
- 用户如需远程服务，必须部署自己的服务并在 Settings 中配置，不使用任何开发者真实服务器默认值。
- 建立项目内 scanner 与发布前检查，防止 `.env`、数据库、日志、release 产物、私人记忆或疑似 secret 误入 Git。
- 对 API Key secure storage 与 Agent Harness 权限系统做明确后续需求拆分，本版本只守住泄露治理最低线。

## 已确认决策

| 编号 | 决策 |
|---|---|
| D1 | v0.16.1 是完整公开产品洁净度补丁，不新增 UI 功能。 |
| D2 | 泄露定义扩大到个人工作方式、知识库结构、服务器地址、内部团队流程。 |
| D3 | 公开仓库只保留产品级文档，内部评审记录、临时执行计划和规划草稿移入私有区。 |
| D4 | 若仓库尚未正式对外发布，重写 Git 历史清理公网 IP、私人结构和误提交痕迹。 |
| D5 | 确认 Electron 已替代 Tauri 后，把 Tauri 遗留作为 v0.16.1 清理目标。 |
| D6 | API Key 系统钥匙串 / secure storage 不纳入 v0.16.1，另立需求；本版本只做泄露治理。 |
| D7 | Agent Harness 权限系统不纳入 v0.16.1，另立需求；本版本只做安全默认 env 泄露防护。 |
| D8 | 扩展项目内自研 scanner，覆盖个人路径、公网 IP、密钥形态、禁止文件、私人关键词、build/dmg/ai-service。 |
| D9 | 新增发布前检查，防止 `.env`、db、log、`记忆/`、release 产物进入 staging。 |

## 范围

### 1. 公开仓库内容净化

- 移除或私有化非产品级文档。
- 清理内部评审记录、自动化执行过程记录、临时执行计划和规划草稿等内部过程文档。
- 保留正式产品文档时，脱敏私人知识库结构、个人路径、真实服务器地址和内部执行流程。

### 2. Git 历史清理

- 在仓库尚未正式对外发布的前提下，重写 Git 历史。
- 清理历史中的公网 IP、私人路径语义、误提交痕迹、内部知识库结构关键词。
- 重写历史前必须保留备份分支或备份 refs，并在重写后重新验证 clone / install / build。
- 历史重写必须在用户确认后执行；重写完成且扫描通过前，不得创建公开 tag、GitHub Release 或发布包。

### 3. Tauri 遗留清理

- 确认 Electron 主路径不依赖 Tauri。
- 移除或隔离 `workbench/src-tauri/`、Tauri scripts、Tauri 依赖和相关过时文档。
- 清理旧 SSE / 硬编码公网 IP 链路。
- 当前产品叙述统一为 Electron 技术栈。

### 4. 服务地址洁净化

- 不保留真实公网 IP。
- 默认配置使用 localhost、placeholder 或用户自定义配置。
- 文档明确：远程服务由用户自行部署，并在 Settings 中配置 WebSocket 地址和 Bearer Token。

### 5. 密钥与敏感信息泄露治理

- 扫描已跟踪文件中的 API Key / token / password / private key 形态。
- 确认 `.env`、数据库、日志、usage jsonl、release 包不会进入 Git。
- 文档中不得出现真实 key、真实 token、真实服务凭据。

### 6. 最小运行时泄露防护

- v0.16.1 不实现完整 secure storage。
- 本版本必须避免 API Key 出现在日志、错误输出、构建产物和示例文档里。
- 本版本必须避免 Agent 子进程默认无脑继承完整敏感环境变量；至少建立安全默认策略或敏感 env 过滤策略。
- 本版本只定义全局安全默认 env 策略，不新增 per-agent 权限 UI 或权限模型配置。

### 7. Scanner / 发布前检查

- 扩展项目内 scanner 覆盖：
  - personal path：`/Users/`、`/home/`、`C:\Users`
  - 公网 IP
  - 密钥形态
  - `.env`、`.db`、`.sqlite`、`.jsonl`、日志、release 产物
  - 私人知识库关键词
  - build / dmg / ai-service 打包资源
- 新增 pre-release 或 preflight 检查入口。
- staging 中发现禁止项时失败并给出可读报告。
- 私人关键词表与 allowlist 必须进入可审查配置文件；allowlist 必须记录理由和适用范围。

## 不纳入范围

- 不新增 UI 功能。
- 不重做 Settings 页面。
- 不实现系统钥匙串 / secure storage。
- 不实现 API Key 迁移到 macOS Keychain / Windows Credential Manager / Linux Secret Service。
- 不实现完整 Agent Harness 权限系统。
- 不实现每个 Agent 的工具权限、目录权限、网络权限、env 权限配置。
- 不重构远程执行架构。
- 不新增控制平面、执行层或多 Agent 产品能力。

## 后续独立需求

### API Key secure storage

后续需求目标：

- 将 API Key 从明文 settings / localStorage 迁移到更安全的本地存储。
- 调研成熟开源桌面应用方案。
- 评估 Electron `safeStorage`、macOS Keychain、Windows Credential Manager、Linux Secret Service。
- 设计旧配置迁移、重置、失败 fallback 和跨平台行为。

### Agent Harness 权限系统

后续需求目标：

- 建立 Agent / Multi-Agent Harness 权限模型。
- 支持每个 Agent 配置工作目录、工具权限、环境变量、网络权限、读写权限。
- 对齐 Claude / Codex 类执行前权限选择体验。
- 区分纯对话模块和 Agent 执行模块的权限边界。

## 验收标准

- [ ] Git tracked files 不含真实公网 IP、私人绝对路径、私人知识库结构关键词。
- [ ] Git tracked files 不含 `.env`、真实数据库、日志、usage jsonl、release 包。
- [ ] 公开产品文档不暴露个人工作流、内部评审过程和私人目录结构。
- [ ] Git 历史扫描通过，不再出现已确认需要清理的公网 IP、私人路径、知识库结构关键词。
- [ ] 公开仓库不再把 Tauri 表达为当前运行时。
- [ ] 移除或隔离 Tauri 遗留后，Electron 主路径可正常开发、构建和启动。
- [ ] 默认服务地址不指向开发者真实服务器，示例配置使用 placeholder。
- [ ] scanner 能识别并阻止 personal path、公网 IP、疑似 key、禁止文件类型。
- [ ] scanner 覆盖源码、文档、构建产物和 ai-service 相关目录。
- [ ] 发布前检查失败时能指出文件和命中规则。
- [ ] API Key 不出现在日志、错误输出、构建产物和示例文档里。
- [ ] Agent 子进程执行链路应用全局安全默认 env 策略：默认不全量继承 `process.env`，采用最小 allowlist 或明确敏感 denylist。
- [ ] secure storage 和 Agent Harness 权限系统被明确记录为后续需求，而不是遗漏。

## 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 范围膨胀 | 容易从洁净度补丁变成 secure storage 或 Agent 权限系统建设 | product.md 明确不纳入范围，另立后续需求 |
| 历史重写风险 | force push 会影响已 clone 用户和已有 tag | 仅在正式公开发布前且用户确认后执行；先建备份 refs；重写后完整验证 |
| 文档误删风险 | 清理内部文档时可能误删仍有产品价值的正式需求记录 | 产品级文档保留并脱敏，内部过程文档移私有区 |
| Tauri 清理风险 | 旧目录删除可能影响残留脚本或依赖 | technical.md 阶段先做引用图，再删除 |
| Scanner 误报 | 示例 key、测试 fixture、公网 IP 文档说明可能误报 | 建立 allowlist 机制，allowlist 必须有理由 |
| Scanner 漏报 | 简单正则可能漏掉变体 secret | 组合规则 + 人工审查 + 后续可接 gitleaks |
| env 兼容性 | 过滤 `process.env` 可能影响 SDK、shell、代理配置 | v0.16.1 只做最小安全默认值，保留必要 env allowlist |
