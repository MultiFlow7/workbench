# v0.16 发布治理设计规格

日期：2026-06-11
负责人：workbench-ceo
项目：工作台
状态：待董事长审阅

## 决策

董事长选择方案三：v0.16 不只修复发布阻塞，还要把 req-063 OSS 化改造过程中暴露出的项目治理问题一并收口。

因此，v0.16 的收口目标从单纯隐私修复升级为首次公开发布基线：

```text
v0.16 = OSS Decoupling + 首次发布治理基线
```

但范围仍然必须克制。v0.16 不新增 req-063 之外的用户功能，不纳入 req-065 任务 cwd 选择器。

## 当前阶段

项目当前处于 v0.16 发布收口阶段。

已确认事实：

- 当前分支：`feature/req-063-vault-runtime-config`
- `workbench/package.json` 仍显示版本号 `0.15.1`
- v0.16 req-063 主体实现基本完成
- 尚无 `changelog/release/v0.16.0.md`
- 本地验证已通过：
  - `vitest run`：20 个测试文件，185 个测试
  - `tsc --noEmit`
  - `node scripts/scan-personal-paths.mjs`
  - `node scripts/__tests__/scan-personal-paths.test.mjs`：17 passed
- 根目录发布 workflow 仍缺少隐私扫描门禁
- 若干正式流程资产目前被 `.gitignore` 忽略

## 目标

1. 让 v0.16 满足 OSS 零个人信息泄露原则，可以安全发布。
2. 让真正 tag 触发的发布流程执行该原则，而不是只在无效 workflow 里写检查。
3. 建立清晰的流程资产追踪边界，区分正式项目文件和私人本地文件。
4. 更新公开文档，让新用户看到 Electron 时代的工作台，而不是旧 Tauri 说明。
5. 留下清楚的 release 记录，并为 v0.16.1 或 v0.17 标出后续边界。

## 非目标

以下内容不进入 v0.16：

- req-065 任务 cwd 选择器
- 新 UI 功能
- Rust 后端测试覆盖补齐
- Agent runtime hooks 的完整自动化
- 大规模历史 changelog 重写
- 完整删除所有 Tauri 遗留目录或脚本
- 新外部服务或新依赖

## 工作流

### A. 修正发布门禁

问题：

隐私扫描所在 workflow 是 `workbench/.github/workflows/build.yml`，但 GitHub Actions 只会读取仓库根目录 `.github/workflows`。真正 tag 发布使用的是 `.github/workflows/cd.yml`，它目前会直接构建并上传 release 产物，没有执行 v0.16 隐私扫描。

设计：

- 将 v0.16 build + scan 门禁迁移或复制到根目录 `.github/workflows/cd.yml`。
- 保持低成本步骤优先：
  1. 安装依赖
  2. `pnpm build`
  3. `node scripts/scan-personal-paths.mjs`
  4. `pnpm run dist:mac` 或 `pnpm run dist:win`
  5. 上传 release 产物
- 删除、迁移或明确标记 `workbench/.github/workflows/build.yml` 为无效，避免未来误以为它会被 GitHub 执行。
- 保留 `workbench/RELEASE.md` 作为人工发布 checklist。

成功标准：

- 根 CD workflow 在每个平台的 dist 步骤前都执行个人路径扫描。
- 子目录 workflow 不再制造“CI 已有门禁”的错误信心。

### B. 流程资产治理

问题：

`.gitignore` 当前忽略了 `requirements/`、`changelog/`、`产品方向.md`、`原型设计意图.md` 和 `prototype.html`。这与项目规则冲突，因为需求和 changelog 是正式流程资产。

设计：

- 停止忽略正式流程资产：
  - `requirements/`
  - `changelog/`
  - `产品方向.md`
  - `原型设计意图.md`
  - `prototype.html`
- 继续忽略私人和生成类资产：
  - `记忆/`
  - 本地 `.env*`
  - 构建产物
  - 数据库文件
  - `node_modules`
  - 临时对比 HTML 草稿
  - 不准备公开的本地团队或私人笔记
- 修改 ignore 规则后，必须先检查 `git status`，不能盲目 `git add .`。
- 只纳入 v0.16 发布和治理基线真正需要追踪的流程资产。

成功标准：

- 仓库可以有意识地追踪 requirements 和 changelog。
- 私人记忆、密钥、本地构建产物仍保持忽略。
- v0.16 PR 不会被无关本地文件淹没。

### C. 发布文档

问题：

项目尚无 v0.16 release note。部分文档仍描述旧 Tauri 启动路径或旧项目阶段。

设计：

- 新增 `changelog/release/v0.16.0.md`。
- 将 v0.16 product / technical 文档状态从规划中同步为发布收口状态，但不重写历史修订记录。
- 更新项目状态快照，让下一次 CEO 上岗能看到当前事实。
- 若 release acceptance 完成，同步更新 `requirements/README.md` 和 `req-063` 状态。
- 保持 req-065 为 v0.17 confirmed，不合并进 v0.16。

成功标准：

- 读者可以判断 v0.16 是发布收口中或已发布，而不是仍停在候选阶段。
- release notes 说明交付范围、验证结果、已知残余风险和非目标。

### D. 公开 README 对齐

问题：

根 README 仍写 Tauri 和 `npm run tauri dev`，但当前应用已经是 Electron + electron-vite + pnpm。

设计：

- 将根 README 更新为 Electron 时代架构。
- 让中文 README 内容可以直接阅读，不依赖 `[中文]` 页内锚点。
- 根 README 只保留项目总览和快速开始。
- `workbench/README.md` 聚焦前端本地开发和首次启动 Vault 配置。
- 在文档中说明发布构建需要执行隐私扫描。

成功标准：

- 新用户看到正确的安装和开发命令。
- 中文内容是可直接阅读的 Markdown，不再依赖不稳定锚点。

### E. 验证与验收

问题：

本地自动化验证已经较强，但方案三扩大后，需要完整记录发布治理范围内的验收结果。

设计：

运行并记录：

- `cd workbench && ./node_modules/.bin/vitest run`
- `cd workbench && ./node_modules/.bin/tsc --noEmit`
- `cd workbench && ./node_modules/.bin/electron-vite build`
- `cd workbench && node scripts/scan-personal-paths.mjs`
- `cd workbench && node scripts/__tests__/scan-personal-paths.test.mjs`

人工或发布机检查：

- 首次启动场景 A：electron-store 已有配置
- 首次启动场景 B：旧 `.env.local` 迁移
- 首次启动场景 C：`~/Workbench-Vault` 已存在
- 首次启动场景 D：全新安装自动创建默认 vault，并且 toast 只显示一次
- `pnpm dist:mac` 后对生成 dmg 执行 `scripts/verify-dmg.sh`

成功标准：

- release notes 和 `workbench/RELEASE.md` 记录哪些检查已通过，哪些需要发布机补跑。
- 未运行的检查不能被宣称为已通过。

## Agent 职责

当前 Codex 主会话扮演 `workbench-ceo`。如果当前平台可用真实 sub-agent 工具，并且任务边界适合拆分，则按 Codex adapter 派发。如果不可用，CEO 可以在主会话直接执行，但必须保留同样的门禁。

建议分工：

- `workbench-product`：release notes、需求状态、changelog 状态、README 语言一致性。
- `tauri-platform`：根 CD workflow、打包 checklist、dmg 验证脚本。虽然名字仍是 tauri-platform，但按团队语义它负责桌面平台层。
- `review-agent`：独立审查范围是否失控、隐私门禁是否有效、`.gitignore` 边界是否正确、release 是否可发布。
- `qa-agent`：执行验收 checklist 并产出报告。
- `workbench-memory`：完成后更新项目状态快照。

## 实施顺序

1. 如董事长要求修改，先更新本设计。
2. 根据本设计创建 implementation plan。
3. 修正根 release workflow 和子目录 workflow 歧义。
4. 调整 `.gitignore` 治理边界。
5. 更新 release 文档和公开文档。
6. 运行自动化验证。
7. 完成人工或发布机 checklist；无法运行的项目必须记录为未完成。
8. 执行独立 review。
9. 更新项目记忆和状态快照。
10. 准备发布 handoff。

## 风险

### 范围膨胀

风险：治理工作可能扩展成完整仓库清理。

缓解：只处理直接影响 v0.16 发布安全、公开 onboarding 或流程资产可追踪性的治理项。

### 敏感文档暴露

风险：取消忽略流程目录后，可能把私人信息或私人笔记暴露进 Git。

缓解：暂存前必须检查文件列表。继续忽略 `记忆/`、`.env*`、本地草稿、数据库和生成产物。如果某个流程文档含私人信息，要么脱敏，要么暂不纳入本 PR，并说明原因。

### Workflow 漂移

风险：根 workflow 和子目录 workflow 未来再次分叉。

缓解：只保留根 workflows 作为有效 CI/CD 入口。若保留子目录 workflow，只能作为参考，并必须明确标记为无效；更推荐把有用内容迁移到根 workflow。

### 虚假发布信心

风险：`workbench/out` 扫描通过不等于最终 dmg 内容一定干净。

缓解：tag 发布前必须执行 `verify-dmg.sh`。如果当前 session 无法运行，release handoff 必须明确说明 v0.16 尚未 tag-ready。

## 审批门禁

本设计需要董事长确认后，才能进入 implementation plan。

确认即表示：

- v0.16 范围升级为包含发布治理。
- req-065 仍不进入 v0.16。
- CEO 可以基于本设计创建实施计划，并在上述边界内执行。
