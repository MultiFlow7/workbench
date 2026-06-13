---
version: v0.16.1
codename: Public Cleanliness Patch
status: planning
doc_revision: 4
created: 2026-06-13
review_state: 通过
draft_owner: desktop-platform + release-security + runtime-security
pending_owners: []
---

# 技术执行文档 · v0.16.1 · Public Cleanliness Patch

关联产品规划：[[changelog/v0.16.1/product]]
关联需求：[[requirements/req-066-public-cleanliness-patch]]

## 技术方案概述

v0.16.1 的技术核心是把「公开产品洁净度」从一次性人工审查，升级为可执行、可复查、可阻断发布的工程链路。本版本不新增 UI，不实现系统钥匙串，不实现完整 Agent Harness 权限系统；只做公开仓库、构建产物、默认配置与最低运行时泄露边界的治理。

```
Phase 0  基线审计与清理清单锁定
   ↓
Phase 1  文档公开边界收口
   ↓
Phase 2  Tauri 遗留清理
   ↓
Phase 3  Scanner / preflight 扩展
   ↓
Phase 4  最低运行时泄露防护
   ↓
Phase 5  CI / release 验证接线
   ↓
Phase 6  Git 历史清理（高风险，最后执行）
```

Phase 1-5 可在本分支上普通提交完成；Phase 6 涉及历史重写和 force push，必须在所有扫描规则稳定、工作区验证通过、用户确认执行窗口后再做。

### 边界扫描

| 边界类型 | v0.16.1 是否引入 | 说明 |
|---|---|---|
| 新执行者类型 | 否 | 仍是 Electron main / preload / renderer、Python ai-service、Node workbench server |
| 新外部依赖 | 否 | scanner / preflight 继续用 Node 内置模块实现，不引入 gitleaks / trufflehog |
| 新数据类别 | 是（受控） | 新增 scanner 配置：规则、private keywords、allowlist、forbidden file patterns |
| 新交互模式 | 否 | 不新增 UI；只调整文档、脚本、构建和运行时默认环境 |
| 不可逆操作 | 是（受控） | Git 历史重写放入 Phase 6，执行前必须备份 refs 并再次确认 |

### 关键技术决策

1. **Scanner 从单一脚本升级为配置驱动的审查器**：保留 `scan-personal-paths.mjs` 作为兼容 wrapper，新增统一入口 `scan-public-cleanliness.mjs`，读取配置文件，覆盖路径、公网 IP、疑似 secret、禁止文件、私人关键词、构建产物和打包资源。
2. **allowlist 配置化，不写在脚本常量里**：allowlist 每条必须有 `ruleId`、`path`、`reason`、`owner`，并提供 `expires` 或 `reviewedAt`，避免把豁免变成不可审查的黑洞。
3. **Tauri 遗留首选删除**：如果引用图确认 Electron 主路径不依赖 `src-tauri` 和 `@tauri-apps/*`，删除旧目录、script、依赖和 lockfile 中相关条目；如果删除遇到阻断，只允许短期隔离为 `legacy` 且清理敏感内容。
4. **API Key secure storage 不在本版本实现**：本版本只防止 key 出现在日志、错误、示例、build 和 scanner 漏洞中；钥匙串迁移另立需求。
5. **Agent env 采用全局安全默认值**：默认不全量继承 `process.env`；用 helper 生成最小 env，并显式注入 `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL`。不新增 per-agent 权限 UI。
6. **历史重写晚于代码治理**：先让 HEAD 和构建产物通过新 scanner，再用同一规则扫描历史并重写。重写后重新跑 clone/install/build/test/scan。
7. **`dev-token` 只允许开发态**：远程 server / production 模式不得静默使用默认 token；如果没有显式 `WORKBENCH_TOKEN`，必须拒绝远程监听或给出阻断级错误。

---

## Phase 0 · 基线审计与清理清单锁定

- [ ] **节点 0.1**：生成 HEAD 泄露基线清单
  - 扫描范围：tracked files，不含 ignored build / release / node_modules。
  - 命中类型：公网 IP、私人路径、私人关键词、疑似 secret、Tauri 当前态表述。
  - 输出：作为 `technical.md` 附录或本地审查记录输入，不把真实私人关键词写进公开正文。

- [ ] **节点 0.2**：生成 Tauri 引用图
  - 命令建议：
    - `rg -n "@tauri-apps|src-tauri|tauri|Tauri" workbench README.md requirements changelog`
    - `rg -n "start_backend_sse|backend-sse|stream_ai|cancel_stream|execute_tool" workbench/src workbench/electron workbench/src-tauri`
  - 完成标志：明确哪些是当前主路径引用、哪些是历史文档、哪些是可删遗留。

- [ ] **节点 0.3**：生成运行时泄露链路图
  - 覆盖：
    - renderer `localStorage` / `write_settings`
    - main `settingsKeys.ts`
    - `SDKBridge` env 注入
    - Node server runner env 注入
    - Python ai-service adapters / routers 日志
  - 完成标志：列出本版本要修的最低线和后续 secure storage / Harness 要承接的内容。

---

## Phase 1 · 文档公开边界收口

- [ ] **节点 1.1**：公开仓库文档分类
  - 保留：README、LICENSE、CONTRIBUTING、PR 模板、正式 release note、必要的脱敏需求索引。
  - 默认移私有区：内部评审记录、自动化执行过程记录、临时执行计划、私人记忆、本地对比 HTML。
  - 逐项判定：`requirements/`、`changelog/`、`docs/`、根目录中文规划文档。

- [ ] **节点 1.2**：未来态需求标题去旧技术栈
  - 已知项：`requirements/README.md` 中 planned `req-041` 改为“桌面主进程 tool executor”。
  - 继续扫描 planned / in-progress 需求，不能把 Tauri 描述成未来当前技术方案。
  - 历史 done 需求可保留“当时使用 Tauri”的事实，但必须避免真实公网 IP 和私人结构。

- [ ] **节点 1.3**：私人结构语义脱敏
  - 清理历史文档中的私人知识库结构、层级命名、原始对话归档路径。
  - 规则：公开正文只写中性描述；真实关键词进入 scanner 私有配置或本地审查记录。

- [ ] **节点 1.4**：公开文档最终收口
  - 每个规划文档必须被判定为：
    1. 公开保留并脱敏；
    2. 压缩为 release note；
    3. 迁移私有区并从公开 Git 移除。
  - 完成标志：公开仓库文档不暴露内部评审、内部决策、自动化执行过程或私人目录结构。

---

## Phase 2 · Tauri 遗留清理

- [ ] **节点 2.1**：删除 Tauri 当前入口
  - 目标文件：
    - `workbench/src-tauri/`
    - `workbench/package.json` script: `tauri`
    - `workbench/package.json` dependencies: `@tauri-apps/api`、`@tauri-apps/plugin-fs`、`@tauri-apps/plugin-opener`
    - `workbench/package.json` devDependencies: `@tauri-apps/cli`
    - `workbench/vite.config.ts` 中仅服务 Tauri dev/build 的注释和 `TAURI_DEV_HOST` 逻辑
    - `workbench/public/tauri.svg`
    - `workbench/src/App.css` 中未使用的模板 selector
  - 执行后运行 `pnpm install --lockfile-only` 更新 `pnpm-lock.yaml`。
  - 如删除 `vite.config.ts`，同步更新 `workbench/tsconfig.node.json` include。

- [ ] **节点 2.2**：清理 Electron 代码中的旧兼容注释
  - 目标：不让当前源码注释把 Tauri 表达为当前运行时。
  - 允许保留：迁移历史说明，但必须写成“旧兼容 / 迁移来源”，不能作为当前路径。

- [ ] **节点 2.3**：确认旧 IPC 退役状态
  - 当前 Electron main 中 `stream_ai` / `cancel_stream` / `execute_tool` 已显式 throw，`start_backend_sse` / `stop_backend_sse` 是 stub。
  - technical 执行时确认这些 stub 不再指向旧公网 SSE。
  - 若保留 stub，必须在注释中标明 retired / compatibility，不得含真实服务地址。
  - renderer 中遗留 `stream_ai` / `providerKey` 传参路径必须删除或改成不可执行兼容提示，避免未来误接回 generic IPC payload。

- [ ] **节点 2.4**：重命名旧平台角色表达
  - 已知项：`TaskTriggerForm.tsx` 中的 `tauri-platform` 改为 `desktop-platform` 或等价 Electron 中性命名。
  - 若存在历史任务数据兼容需求，显示层做旧值映射，不把旧技术栈作为当前选项暴露。

- [ ] **节点 2.5**：验证 Electron 主路径
  - 命令：
    - `cd workbench && ./node_modules/.bin/tsc --noEmit --pretty false`
    - `cd workbench && ./node_modules/.bin/vitest run`
    - `cd workbench && ./node_modules/.bin/electron-vite build`
    - `rg -n "@tauri-apps|src-tauri|tauri dev|tauri build|pnpm tauri|npm run tauri" workbench README.md requirements changelog`
  - 完成标志：删除 Tauri 后 Electron build 不退化。

---

## Phase 3 · Scanner / preflight 扩展

### 3.1 文件结构

新增：

```text
workbench/scripts/public-cleanliness.config.mjs
workbench/scripts/public-cleanliness.allowlist.json
workbench/scripts/scan-public-cleanliness.mjs
workbench/scripts/preflight-public-cleanliness.mjs
workbench/scripts/__tests__/scan-public-cleanliness.test.mjs
```

保留：

```text
workbench/scripts/scan-personal-paths.mjs
workbench/scripts/verify-dmg.sh
```

`scan-personal-paths.mjs` 改为兼容 wrapper，内部调用新 scanner 的 personal path 规则，避免旧 release checklist / workflow 断链。

### 3.2 规则集

- [ ] **节点 3.2.1**：personal path 规则
  - 复用 v0.16 三平台路径正则。
  - 扫描文本扩展名白名单，跳过二进制。

- [ ] **节点 3.2.2**：public IP 规则
  - 捕获 IPv4。
  - allow 默认排除：
    - `127.0.0.0/8`
    - `10.0.0.0/8`
    - `172.16.0.0/12`
    - `192.168.0.0/16`
    - `169.254.0.0/16`
    - `0.0.0.0`
    - 文档保留网段 `192.0.2.0/24`、`198.51.100.0/24`、`203.0.113.0/24`

- [ ] **节点 3.2.3**：secret pattern 规则
  - 覆盖：
    - OpenAI / Anthropic / Gemini 常见 key 形态
    - GitHub token
    - Slack token
    - AWS access key
    - `Authorization: Bearer ...`
    - PEM private key header
  - 示例 placeholder 不应被写成真实 key 形态；必要示例使用 `<your-api-key>`。

- [ ] **节点 3.2.4**：forbidden file 规则
  - staging / tracked files 禁止：
    - `.env`、`.env.local`
    - `*.db`、`*.sqlite`、`*.sqlite3`
    - `*.db-wal`、`*.db-shm`
    - `*.jsonl`、`*.log`
    - `workbench/release/**`
    - `workbench/out/**`
    - `记忆/**`
    - `node_modules/**`
    - `*.dmg`、`*.exe`、`*.AppImage`

- [ ] **节点 3.2.5**：private keywords 规则
  - 关键词来源：2026-06-13 审查发现项 + 用户确认不应公开的目录/流程词 + 配置文件新增项。
  - 公开仓库提交配置 schema、示例词表和中性规则名，不提交真实私人关键词明文。
  - scanner 必须支持显式加载受控私有配置，例如 `--private-config <path>` 或 `PUBLIC_CLEANLINESS_PRIVATE_CONFIG=<path>`。
  - 受控私有配置必须有版本号或内容摘要；Phase 0 / Phase 6 的审查记录记录使用的配置路径、版本或 SHA-256 摘要，但不把真实词写进公开文档。
  - 没有加载私有配置时，scanner 仍运行公开规则；发布前和历史重写前必须加载私有配置并在报告中显示“private keyword config loaded”。

### 3.3 扫描模式

`scan-public-cleanliness.mjs` 支持：

```bash
node scripts/scan-public-cleanliness.mjs --tracked
node scripts/scan-public-cleanliness.mjs --tracked --ref HEAD
node scripts/scan-public-cleanliness.mjs --staged
node scripts/scan-public-cleanliness.mjs --history
node scripts/scan-public-cleanliness.mjs --history --all-refs
node scripts/scan-public-cleanliness.mjs --path out
node scripts/scan-public-cleanliness.mjs --path ../ai-service
node scripts/scan-public-cleanliness.mjs --dmg-resources /Volumes/<mounted-dmg>/WorkBench.app/Contents/Resources
```

实现约束：

- 命令默认从 `workbench/` 目录运行；从仓库根运行时使用 `node workbench/scripts/scan-public-cleanliness.mjs --path workbench/out`。
- tracked 模式用 `git ls-tree -r -z --name-only <ref>` 枚举并读取 blob，避免被本地未提交状态干扰。
- staged 模式用 `git diff --cached --name-only -z --diff-filter=ACMRT` 枚举并读取 `:path` blob。
- history 模式默认扫描当前分支历史；`--all-refs` 用于历史重写前后全量验证。
- forbidden file 规则在 staged / tracked / build / DMG resources 中都生效；`.env` 即使被内容扫描跳过也必须作为文件名风险报错。

输出字段：

- rule id
- severity
- file path
- line / byte offset
- context snippet
- allowlist reason（若被豁免）

退出码：

- `0`：无未豁免命中
- `1`：发现泄露风险
- `2`：输入或 IO 错误

---

## Phase 4 · 最低运行时泄露防护

- [ ] **节点 4.1**：新增 SDK env helper
  - 建议文件：`workbench/electron/sdk/safeEnv.ts`
  - API：
    ```ts
    export function buildSafeSdkEnv(overrides: Record<string, string | undefined>): Record<string, string>
    ```
  - 默认不全量继承 `process.env`。
  - 最小 allowlist 建议：
    - `PATH`
    - `HOME`
    - `USERPROFILE`
    - `TMPDIR` / `TEMP` / `TMP`
    - `SHELL`
    - `SystemRoot` / `WINDIR` / `ComSpec`
    - `LANG` / `LC_ALL` / `LC_CTYPE`
    - `SSL_CERT_FILE` / `SSL_CERT_DIR` / `NODE_EXTRA_CA_CERTS`
    - `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` 及小写变体
  - 显式注入：
    - `ANTHROPIC_API_KEY`
    - `ANTHROPIC_BASE_URL`

- [ ] **节点 4.1b**：新增敏感信息脱敏 helper
  - TypeScript 建议文件：`workbench/electron/security/redact.ts`
  - Python 建议文件：`ai-service/security/redact.py`
  - 覆盖：
    - `Authorization` / `Bearer ...`
    - `x-provider-key`
    - `api_key` / `key` / `token` / `password` / `secret`
    - URL query 中的 `key` / `token` / `api_key`
    - PEM private key header 后的内容
  - 单测必须覆盖 URL、header、普通错误字符串、嵌套对象。

- [ ] **节点 4.2**：SDKBridge 使用 safe env
  - 文件：`workbench/electron/sdk/SDKBridge.ts`
  - 替换当前 `Object.entries(process.env)` 全量复制。
  - 保持 `options.apiKey` / `options.baseUrl` 优先级。

- [ ] **节点 4.3**：server runner 使用 safe env
  - 文件：`workbench/server/src/sdk/runner.ts`
  - 替换当前 `{ ...process.env }`。
  - 注意 server 侧没有 renderer settings，API key 来源应仍由部署环境显式提供或后续 secure storage / server config 规划承接。

- [ ] **节点 4.4**：sidecar env 最小化评估
  - 文件：`workbench/electron/sidecar/aiService.ts`
  - 当前 sidecar spawn 也继承 `process.env`，但它不属于 Agent SDK 执行链路。
  - 本版本至少清理明显敏感变量或复用基础 allowlist + `PORT` / `HOST` / `PYTHONDONTWRITEBYTECODE`。
  - 若技术实现判断 sidecar 需要更多环境，必须在 technical 修订中列明原因。

- [ ] **节点 4.5**：Gemini URL key 错误脱敏
  - 文件：`ai-service/adapters/gemini.py`、`ai-service/routers/chat.py`
  - Gemini REST 优先把 key 从 URL query 移到 `x-goog-api-key` header。
  - 如果 provider 兼容性要求暂时保留 query，也必须确保日志、SSE 和 HTTP error detail 不输出包含 key 的完整 URL。
  - `ai-service/main.py` 的兼容路由也必须纳入同一脱敏链路。
  - 用户可见错误使用稳定分类：`Upstream HTTP error`、`Upstream connection error`、`Provider stream error`，不得拼接原始 `str(exc)`。

- [ ] **节点 4.6**：settings / localStorage 文档化边界
  - 当前 `settingsSlice.ts` 和 `settingsKeys.ts` 仍使用 localStorage + `~/.workbench/settings.json`。
  - 本版本不迁移 secure storage，只确保 scanner / 文档 / 日志不泄露 key。
  - Electron 写 `~/.workbench/settings.json` 后，在 POSIX 平台将权限收紧为 `0600`。
  - 后续需求 req-067 承接迁移。

- [ ] **节点 4.7**：远程 server 默认 token 安全化
  - 文件：`workbench/server/src/http/sessionsApi.ts`、`workbench/server/src/ws/agentSocket.ts` 及 server 启动配置。
  - `dev-token` 只允许开发态本地使用。
  - production / remote listen 模式没有显式 token 时必须失败或拒绝鉴权通过。

---

## Phase 5 · CI / release 验证接线

- [ ] **节点 5.1**：CI 增加 public cleanliness scan
  - `.github/workflows/ci.yml` 在 typecheck / test 后增加：
    - `pnpm run privacy:scan`
  - `privacy:scan` 调用 `node scripts/preflight-public-cleanliness.mjs --tracked`。
  - CI 不直接调用 scanner；`scan-public-cleanliness.mjs` 只作为 preflight 内部实现和人工诊断入口。
  - PR CI 不扫描 ignored build 产物。

- [ ] **节点 5.2**：CD 扩展扫描
  - `.github/workflows/cd.yml` 保留 build 后扫描。
  - 将 `scan-personal-paths.mjs` 升级或补充为统一 preflight：
    - `pnpm run privacy:scan:build`
  - `privacy:scan:build` 调用 `node scripts/preflight-public-cleanliness.mjs --build`，从 `workbench/` 目录扫描：
    - `out`
    - `../ai-service`
  - macOS build 上传 release 前必须执行 `./scripts/verify-dmg.sh <dmg>`，由该脚本 mount DMG 后调用新 scanner 扫 `Contents/Resources`。
  - CI/CD history scan 如需运行，checkout 必须使用 `fetch-depth: 0`；普通 PR 默认只扫 tracked HEAD。

- [ ] **节点 5.3**：本地 preflight
  - 新增 npm script：
    - `privacy:scan`
    - `privacy:scan:staged`
    - `privacy:scan:build`
  - 新增 `workbench/scripts/preflight-public-cleanliness.mjs` 聚合运行。
  - release checklist、CI/CD 和 npm scripts 只引用这个 preflight 入口，避免并行入口漂移。
  - `scan-public-cleanliness.mjs` 仍可手工运行，用于定位单条规则或历史重写前后的诊断，不作为 workflow 入口。

- [ ] **节点 5.4**：Release checklist 更新
  - 更新 `workbench/RELEASE.md`：
    - HEAD scan
    - staged scan
    - build scan
    - dmg Resources scan
    - history scan（执行历史重写前后）
    - 禁止 tag / release 门禁

---

## Phase 6 · Git 历史清理（高风险）

> Phase 6 不在普通代码实现中顺手执行。它必须在 Phase 1-5 完成、HEAD 扫描干净、用户确认执行窗口后进行。

- [ ] **节点 6.0**：历史重写准入检查
  - 必须先确认仓库尚未正式对外公开发布，或明确已有公开使用者的同步影响。
  - 必须列出远端、保护分支、已有 tag / release、协作者 clone 风险和处理策略。
  - 必须确认 Phase 1-5 已完成，且 tracked / staged / build / ai-service / DMG resources scan 通过。
  - 必须加载 private keyword 受控私有配置，并记录配置版本或 SHA-256 摘要。
  - 必须创建本地备份 refs 或 bundle。
  - force push、删除或重建 tag / release 前必须获得用户单独确认；不能把本规划确认视为执行确认。

- [ ] **节点 6.1**：创建备份 refs
  - 建议：
    - `git branch backup/pre-v0161-history-cleanup`
    - `git bundle create ../workbench-pre-v0161-history-cleanup.bundle --all`
  - 如需远端备份，先推送到私有或受控远端。

- [ ] **节点 6.2**：历史扫描
  - 使用 `scan-public-cleanliness.mjs --history` 或等价脚本。
  - 输出历史命中清单，但不得把真实私人关键词写入公开文档正文。

- [ ] **节点 6.3**：历史重写
  - 工具候选：
    - `git filter-repo`（优先，如可用）
    - `git filter-branch`（不推荐，仅兜底）
  - 重写目标：
    - 真实公网 IP
    - 私人路径语义
    - 误提交敏感文件
    - 私人知识库结构关键词

- [ ] **节点 6.4**：重写后复验
  - 命令：
    - `git log --all -S <sanitized-target>` 的等价复核
    - `node scripts/scan-public-cleanliness.mjs --history --all-refs`
    - fresh clone
    - `pnpm install --frozen-lockfile`
    - `pnpm exec tsc --noEmit`
    - `pnpm test`
    - `pnpm build`

- [ ] **节点 6.5**：远端同步门禁
  - 重写完成且扫描通过前，不打 tag，不创建 GitHub Release，不上传发布包。
  - 若需要 force push，执行前向用户报告影响与同步方式。

---

## 验证清单

| 类别 | 命令 / 检查 | 期望 |
|---|---|---|
| TypeScript | `cd workbench && pnpm exec tsc --noEmit` | 通过 |
| Unit tests | `cd workbench && pnpm test` | 通过 |
| Build | `cd workbench && pnpm build` | 通过 |
| Scanner tests | `cd workbench && node scripts/__tests__/scan-public-cleanliness.test.mjs` | 通过 |
| HEAD preflight | `cd workbench && pnpm run privacy:scan` | 0 命中 |
| Staged preflight | `cd workbench && pnpm run privacy:scan:staged` | 0 命中 |
| Build preflight | `cd workbench && pnpm run privacy:scan:build` | `out` 与 `../ai-service` 0 命中 |
| DMG scan | `cd workbench && ./scripts/verify-dmg.sh <dmg>` | 0 命中 |
| History diagnostic scan | `cd workbench && node scripts/scan-public-cleanliness.mjs --history` | 0 命中 |
| Full history scan | `cd workbench && node scripts/scan-public-cleanliness.mjs --history --all-refs --private-config <private-config>` | 0 命中 |
| Redaction tests | 构造 `?key=fake-secret` / `Bearer fake-secret` / `AWS_SECRET_ACCESS_KEY` | 输出不含原值 |
| Safe env tests | 输入含 `GITHUB_TOKEN`、`OPENAI_API_KEY`、`AWS_SECRET_ACCESS_KEY` | 输出不含这些变量 |

## 修订记录

| doc_revision | 日期 | 作者 | 说明 |
|---|---|---|---|
| 1 | 2026-06-13 | desktop-platform + release-security + runtime-security | 初稿：按 req-066 / product.md 拆分公开洁净度技术执行阶段 |
| 2 | 2026-06-13 | desktop-platform + release-security + runtime-security | 合并 Tauri、scanner、runtime security 分工调查：补充 DMG 门禁、safe env、脱敏、dev-token 与旧 IPC 清理验收 |
| 3 | 2026-06-13 | workbench-review 修复 | 强化历史重写准入门禁；明确 private keyword 受控私有配置机制；统一 scanner cwd 与 preflight 入口；补充代理 env allowlist |
| 4 | 2026-06-13 | workbench-review 修复 | 固定 CI/CD 与 release checklist 统一走 preflight 入口；明确 scanner 仅作内部实现和人工诊断入口；统一 build 扫描 cwd |
