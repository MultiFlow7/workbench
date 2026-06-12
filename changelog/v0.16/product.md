---
version: v0.16
codename: OSS Decoupling
status: 发布收口中
doc_revision: 10
created: 2026-06-08
review_state: 通过
project: 工作台
tags:
  - 类型/规划文档
  - 主题/技术/工作台
  - 状态/发布收口中
---

# 产品规划 · v0.16 · OSS Decoupling · 解耦个人化信息与发布产物

## 版本概述

**一句话定位**：将所有个人化数据（vault 路径、用户名、本地目录结构）从打包产物中彻底剥离，让工作台成为一个真正"任何人都能下载即用"的开源产品。

**解锁目标**：本版本是 v0.15.1 dmg 首发的**唯一阻塞解除条件**。完成验收后，v0.15.1 + v0.16 可一并合入 main 并通过 GitHub Release 对外发布。在此之前，**任何 dmg / exe / AppImage 都不得推送到 GitHub Release**——否则违反核心原则。

---

## 核心原则（项目级长期约束）

> **OSS 零个人信息泄露原则**（2026-06-08 确立，本版本起作为不可逾越的项目级原则）
>
> 1. **GitHub 上的包应是适用于所有人的开源项目**，不是服务于个人的，不得泄露任何个人信息数据
> 2. **所有个人信息（包括本地任何含个人信息的配置）必须是用户下载到本地后自行配置的**，仅保留在本地，不进入 GitHub
>
> **执行准则**：
> - 任何 `VITE_*` 编译期注入变量绝不能含本地路径、用户名、私人 URL
> - 路径、vault 位置、API key、个人配置一律走运行期读取（electron-store / .env / 用户输入）
> - 发布前必扫 renderer build 产物（`workbench/out/renderer/assets/*.js`）确认无 `/Users/`、用户名等泄露
> - 仓库中 `.env*` 一律 gitignore，electron-builder `extraResources` 必须排除 `!**/.env`

v0.16 是这一原则的**首次系统性落地**。完成后，原则将固化为 CI verification step + 发布前 checklist，成为后续所有版本必须遵守的硬约束（详见「长期一致性说明」）。

---

## 需求范围

### 选入需求（唯一项）

| ID | 需求 | 优先级 | 状态 |
|----|------|--------|------|
| [req-063](../../requirements/req-063-oss-personal-info-decoupling.md) | OSS 化改造 · 解耦个人化信息与发布产物 | high | confirmed |

> **doc_revision 9 范围最终化**：本版本仅含 req-063 单需求，不再扩展任何衍生需求。原 doc_revision 5 新增的「R-6 Chat 输入框 Vault 文件夹按钮」已于本次（doc_revision 9）撤销——用户原意是切换任务工作目录（cwd）而非 Vault，两者是不同概念，已独立立项为 req-065 留待 v0.17。原 doc_revision 5 同时扩展、doc_revision 6 撤回的「Python sidecar API Key 透传」保持撤回状态。
>
> **历史记录**：doc_revision 5 曾扩展 R-6（Chat 输入框 Vault 文件夹按钮）+ Python sidecar key 透传。doc_revision 6 撤回 sidecar 扩展。doc_revision 9 进一步撤回 R-6 扩展。

### 范围声明：纯单一需求，不叠加

v0.16 **不叠加任何 in-progress 需求**。决策依据：

1. **首发阻塞优先**：v0.15.1 已完成开发并通过验收，发布唯一卡点就是 OSS 化改造。最短路径就是单一聚焦 req-063，让首版 GitHub Release 尽快可发。
2. **风险隔离**：req-063 涉及 paths.ts 重写、5 个消费方改造、新增 main 进程 store + IPC channel + renderer slice + Settings UI，本身已是一个完整的纵深改造。叠加任何其他需求都会放大回归风险。
3. **核心原则首次落地必须干净**：OSS 零个人信息泄露是项目级原则，本次落地的 CI verification step、发布前 checklist 必须由一个纯净版本来确立基准——任何叠加都会模糊"原则是否被严格执行"的判定。

### 未纳入本版本的 in-progress 需求

以下 6 个 in-progress 需求保留状态，待 v0.17 起按优先级重新规划：

| ID | 需求 | 当前状态 | 不纳入理由 |
|----|------|---------|----------|
| req-020 | 主对话保护前端（TopBar badge） | in-progress（v0.15 前端重建时一起完成）| 与 OSS 化改造无功能交叠，单独排期不增加发布耦合 |
| req-022 | Agent 沙盒（隔离执行环境） | in-progress（后端逻辑保留，继续完成）| 后端能力，与本版本前端/打包路径解耦无关 |
| req-023 | Harness 管控层 | in-progress（后端逻辑保留，继续完成）| 同上，后端独立推进 |
| req-024 | Agent 级别 LLM 配置 | in-progress（迁移后继续完成）| API key 管理已在 v0.15.1 P5 完成基础设施，按需后续 |
| req-032 | ChatView Markdown 渲染 | in-progress（前端重建时一起完成）| v0.15.1 req-060 已通过 Final Answer bubble 渲染消解大部分 in-progress 状态，剩余按需 |
| req-048 | 联网搜索工具 | in-progress（API 方案确认后另起版本）| 待方案确认，与发布阻塞解除无关 |

此外，req-022 / req-023 / req-024 / req-032 / req-048 以及 backlog 中的需求一并等待后续版本规划。

---

## 需求冲突与衍生

**冲突**：无。本版本仅含 req-063 单需求，无版本内交叉冲突。

**衍生**：无。本版本所有附属工作（vaultStore、vaultSlice、Settings UI、首次启动 UX、CI verification、README 文档化）均已纳入 req-063 本身的「改动范围」或「设计方案」章节，未产生需要新立 req 的独立需求。

**已撤销的衍生（doc_revision 9）**：

- **R-6 · Chat 输入框上方 Vault 文件夹按钮**（doc_revision 5 引入，doc_revision 9 撤销）
  - 撤销原因：QA 阶段澄清，用户原意是「切换本次任务工作目录」（类 Claude Code 启动时选 cwd），并非 Vault 切换。Vault 与任务 cwd 是两个不同概念，强行合并会导致 UX 混淆。
  - 后续路径：已立 **req-065 · Chat 输入框任务 cwd 选择器**，留待 v0.17 单独规划。
  - **保留资产**：R-6 实现期间已产出的 `workbench/src/utils/pathDisplay.ts`（含 `truncateMiddle` / `getVaultFolderName` 纯函数）保留在仓库不删除，作为 req-065 的可复用基础设施。

- **Python sidecar API Key 透传**（doc_revision 5 引入，doc_revision 6 撤销，状态保持撤销）
  - chat 主路径维持 v0.15.1 现状（仅 Claude SDK），非 Claude 模型走工作台外路径。

**与 req-063 验收口径的差异（重要）**：

1. **CI verification 实现升级**：本 product.md 对 req-063 §10 做了升级——**将 grep 验证升级为 Node 脚本统一扫描**（详见「设计方案 · 5」与「长期一致性说明」）。technical.md 应以本文件为准，不再回退到 grep 实现。req-063 验收标准（§隐私零泄露）中提到的 grep 命令仅作历史记录，不再生效。

2. **vaultStore schema 字段命名升级**：req-063 §1 中字段名为 `qaPath` / `projectsPath`，在本 product.md 中升级为 **`qaSubdir` / `projectsSubdir`**（语义同时扩展为「相对子目录名（推荐）或绝对路径」，详见「设计方案 · 1」与「设计方案 · 3」）。technical.md 以本 product.md 字段名为准。

3. **首次启动 UX 决策落定**：req-063 §7 列出 A/B/C 三选项不预设，product.md 已拍板为方案 C + 轻量 toast（详见「首次启动 UX 详细规格」章节）。

4. **schema 新增字段**：本 product.md 在 req-063 §1 schema 基础上新增 `hasShownFirstLaunchToast: boolean` 字段，用于实现 toast lifecycle 一次。

5. **CI verification 落位调整**：req-063 §10 写 `.github/workflows/build.yml` 增加 verification step；本 product.md 进一步拍板该 step 调用统一 Node 脚本，并新增 `workbench/RELEASE.md` 作为发布前 checklist 落位。

---

## 设计方案

req-063 已就实现细节做了完整描述，本节从**用户视角**总结改造后的产品形态。

### 1. Vault 配置基础设施（不可见但底层关键）

工作台所有"文件位置"相关的设置（Vault 根目录、QA 子目录、Projects 子目录）从打包时写死，改为**用户在本地配置 + electron-store 持久化**。配置文件位于 `<app.getPath('userData')>/config.json`，与应用包完全分离。

**vaultStore schema（最终定义，technical.md 直接落地）**：

```ts
type VaultConfigSchema = {
  vaultRoot: string                 // Vault 根目录绝对路径
  qaSubdir: string                  // 相对子目录名（推荐，如 'QA'）或绝对路径
  projectsSubdir: string            // 相对子目录名（推荐，如 'Projects'）或绝对路径
  hasShownFirstLaunchToast: boolean // 首次启动 toast 是否已显示（lifecycle 一次）
}
```

> 字段命名以此处为准；req-063 §1 中的 `qaPath`/`projectsPath` 已升级为 `qaSubdir`/`projectsSubdir`（详见「需求冲突与衍生」§字段命名升级）。

### 2. 运行期读取替代编译期内联

旧实现：Vite 把 `VITE_VAULT_*` env 值在 build 时直接内联进 renderer JS bundle，导致打包者本地路径被永久写入产物。

新实现：renderer 通过 Zustand `vaultSlice` 在应用启动时一次性从 main 进程 IPC 拉取配置，所有消费方（ChatView / DetailPanel / useChatSend / agentEventDispatcher / conversationSlice）改为运行期从 store 读取。

**用户感知**：在 Settings 中修改 Vault 路径后，**无需重启应用即可生效**（Zustand 实时更新）。

### 3. 既有 SettingsPanel overlay 新增「Vault 配置」分区（置顶为第一分区）

**容器决策（doc_revision 9 修订）**：Vault 配置入口**复用 v0.15.1 已存在的 SettingsPanel overlay**——即通过 TopBar 齿轮按钮触发的浮层 Settings 弹窗（已含 API Keys / Theme / 服务器配置三分区）。**不新增独立 P3 Settings 视图**，避免与既有齿轮浮窗形成双入口 UX 割裂。

**设计原因**：原 doc_revision 1~8 规划新增 P3 SettingsView 工作模式，QA 阶段用户明确反馈「根目录这个需求统一放到原本的 setting 里面」，遂回归 v0.15.1 既有的 SettingsPanel overlay 作为统一配置入口。

**SettingsPanel overlay 分区顺序**（本版本起固化）：

1. **Vault 配置**（本版本新增 · 置顶）
2. API Keys（v0.15.1 已存在）
3. Theme（v0.15.1 已存在）
4. 服务器配置（v0.15.1 已存在）
5. 其他（如未来扩展）

> **置顶理由**：首次启动 toast 引导用户打开 SettingsPanel 配 Vault，置顶确保用户开浮窗即见，零寻找成本。

「Vault 配置」分区内含字段（**精简版，doc_revision 9 修订**）：

- 「Vault 根目录」字段 + 「选择文件夹」按钮（调用 Electron 原生文件夹选择对话框）
- 「检测路径有效性」按钮（验证目录存在且可读）
- 保存按钮（触发 `vault:set-config` IPC）

**砍掉的字段（doc_revision 9 修订）**：

- 「QA 子目录」字段：**不暴露给用户**，hardcode 默认 `QA`，对应 `<vaultRoot>/QA`
- 「Projects 子目录」字段：**不暴露给用户**，hardcode 默认 `Projects`，对应 `<vaultRoot>/Projects`
- **决策依据（用户原话）**：「子目录的调整，我不觉得用户会调整 QA 和 Projects」——子目录配置是过度设计，用户场景集中在改根目录，子目录命名约定固化即可。

> **schema 字段保留**：`vaultStore` 中 `qaSubdir` / `projectsSubdir` 字段**仍保留**（值为 hardcode 默认 `QA` / `Projects`，初始化时由 main 进程写入；用户不可见、不可改）。保留字段是为未来如需重新暴露时无需 schema 迁移；本版本仅在 UI 层不渲染对应输入框。

### 4. 配置入口文档化

`workbench/.env.example` 删除三行 `VITE_VAULT_*` 模板项（避免误导新用户走 env 反模式）。`workbench/README.md` 增加 "First Launch · Vault Configuration" 章节，说明 Vault 结构约定与重新配置方式。

### 5. 构建产物隐私验证（Node 脚本统一扫描）

CI `build.yml` 在 build 步骤后增加 verification step，调用统一的 Node 脚本对构建产物做跨平台隐私扫描。

**脚本位置**：`workbench/scripts/scan-personal-paths.mjs`

**实现要点**：
- 仅依赖 Node 18+ 内置 `fs` / `path` 模块，零外部依赖
- 扫描目标：**接受可选目录参数**，签名为 `node scan-personal-paths.mjs [targetDir]`；不传参数时默认扫描 `workbench/out/`；递归遍历目标目录下所有文件
- 检测 pattern（三平台用户家目录前缀）：
  - `/Users/`（macOS）
  - `C:\\Users\\`（Windows，注意脚本中以转义形式匹配）
  - `/home/`（Linux）
- 退出码语义：发现任一匹配 → 非零退出（CI fail）+ 输出命中文件路径与匹配片段；全部通过 → 退出码 0

**调用场景与对应参数**：

| 场景 | 命令 | 目的 |
|------|------|------|
| CI build artifacts | `node workbench/scripts/scan-personal-paths.mjs`（默认 `workbench/out/`） | build 后立即验证 |
| 本地预发 build | 同上 | 与 CI 一致 |
| dmg 解压后验证 | `node workbench/scripts/scan-personal-paths.mjs <解压目录>/Workbench.app/Contents/Resources` | 验证最终发布产物内嵌的 renderer JS |

**CI 调用**（`build.yml` step）：

```yaml
- name: Verify no personal paths in build artifacts
  run: node workbench/scripts/scan-personal-paths.mjs
```

**为何放弃 `grep`**：
- macOS / Linux / Windows 三 runner 的 grep 行为不一致，Windows 上的 grep 依赖 git-bash，环境脆弱
- Node 脚本是工作台技术栈原生工具，三平台行为完全一致，维护成本最低
- 同一份脚本服务 CI + 本地预发两种场景，避免脚本漂移

确保任何含本地路径的代码被引入时 CI 立即失败，防止原则被无意回归。

### 6. API Key 引导：明确不做（缺口 A 决策定档）

v0.16 **不加** API Key 首次启动引导。理由：v0.15.1 P5 已实现 Settings → API Keys 入口，对工具型用户而言入口足够直观，过度引导反而打断"开箱即用"的产品定位。新用户进 SettingsPanel overlay 自己找 API Key 设置即可。本版本「首次启动 UX」**仅做 Vault 引导，不涉 API Key 引导**——这是一个明确的产品边界。

---

## 首次启动 UX 详细规格（CEO 已拍板·方案 C + 轻量 toast）

### 决策定档

候选方案 A（强制 onboarding 弹窗）/ B（disabled + 提示条引导）/ C（自动创建默认 vault）中，**采纳方案 C 并增强**：

> **首次启动时，自动在 `~/Workbench-Vault` 创建默认 vault 目录（含 QA/ 和 Projects/ 子目录），开箱即用；同时弹一个非阻塞的轻量 toast 告知用户已创建位置，并提示可在 SettingsPanel overlay 中重新配置。**

### 决策依据

- 方案 A 学习成本高，对首次试用者不友好，违背"工作台是任何人下载即用"的 OSS 定位
- 方案 B 让新用户开屏即遭遇"功能 disabled"的负面体验，对初次印象不利
- 方案 C 让产品**默认即可用**，高级用户依然能在 Settings 中自定义；toast 解决"用户不知道默认位置在哪"的潜在困惑

### 触发条件与执行逻辑

应用启动时按以下顺序判定（**短路求值**：第一个命中的条件决定行为，后续条件不再检查）：

| 顺序 | 检查 | 行为 |
|------|------|------|
| 1 | `electron-store` 中 `vaultConfig.vaultRoot` 存在且非空 | 直接使用已有配置，无 toast，无任何引导 |
| 2 | `.env.local` 含 `VITE_VAULT_*`（老用户场景，**优先级高于条件 3**）| **迁移一次**：将 env 值写入 electron-store，控制台打印弃用警告"VITE_VAULT_* 已弃用，已迁移到 electron-store"；无 toast。此条件优先是为兼容开发者本人已有的 `.env.local` 配置，即使 `~/Workbench-Vault` 也存在也以 env 值为准 |
| 3 | `~/Workbench-Vault` 目录已存在（**仅判定目录存在，不强制要求含 QA/Projects 子目录**）| **仅引用不覆盖**：写入 electron-store 指向该目录；若 QA/ 或 Projects/ 子目录不存在则自动补建（不动用户已有文件），无 toast |
| 4 | 上述都不成立（全新安装）| 创建 `~/Workbench-Vault/QA/` 和 `~/Workbench-Vault/Projects/`，写入 electron-store，**显示轻量 toast** |

> **边界补充**：若用户在使用过程中通过 Settings 将 `vaultRoot` 清空再重启，等价于条件 1 不成立 → 重新走 2/3/4 判定。此时 `hasShownFirstLaunchToast` 字段值已为 true，即使重新落入条件 4 也**不再弹 toast**（lifecycle 一次的语义跨"清空再重设"依然成立）。这是有意为之，避免老用户被重复打扰。

> **各条件细节分布**：条件 2 的迁移行为细节见后续「条件 2 详细规则（env 迁移）」小节；条件 4 的 toast 字段置位逻辑见「Toast 复显标记字段」小节。

### Toast 规格

- **文案**：「已在 `~/Workbench-Vault` 创建默认 Vault · 可在 Settings 中重新配置」（doc_revision 9 修订：R-6 撤销后，引导路径回归至 SettingsPanel overlay）
  > **「Settings」指代说明**：文案中的「Settings」即 **v0.15.1 既有的 SettingsPanel overlay**（TopBar 齿轮按钮触发的浮层弹窗），并非独立视图。Toast 的「打开 Settings」快捷链接亦指向此 overlay 并定位到 Vault 配置分区。
- **样式**：非阻塞（不遮挡主界面），右下角浮现，使用 Design Token `--surface` / `--text-2` / `--bd`
- **行为**：自动 5 秒后淡出；可点击关闭按钮立即关闭；包含一个「打开 Settings」快捷链接，点击直接**打开 SettingsPanel overlay 并定位到 Vault 配置分区**（实现机制：通过 Zustand UI store 触发 `settingsPanelOpen: true` + `settingsActiveSection: 'vault'`，SettingsPanel 组件初始化时根据该字段滚动定位到对应分区）
- **频率**：**lifecycle 一次**（应用生命周期内仅显示一次）。下次启动不再出现（即使用户从未触发关闭/超时即退出应用）。Settings 内 Vault 分区的文案做兜底持续可见性保证。

### Toast 复显标记字段（electron-store schema 扩展）

为实现「lifecycle 一次」，向 electron-store schema 新增一个字段：

```ts
// electron-store schema 扩展
{
  vaultConfig: {
    vaultRoot: string,
    qaSubdir: string,
    projectsSubdir: string,
    // 新增字段：
    hasShownFirstLaunchToast: boolean   // 默认 false
  }
}
```

**字段语义与置位逻辑**：

| 时机 | hasShownFirstLaunchToast 行为 |
|------|------------------------------|
| 首次安装 / electron-store 新建 | 默认 `false` |
| 触发条件 1/2/3（已有配置 / env 迁移 / Workbench-Vault 已存在） | 不显示 toast；字段保持原值 |
| 触发条件 4（全新安装 · 自动创建默认 vault） | 检查字段：若为 `false`，显示 toast；**toast 开始显示的同时**立即将字段置 `true` 并写入 store |
| 后续任何启动 | 字段为 `true`，不再显示 toast |

> **置位时机说明**：toast 一旦渲染就立即置位，而非等待用户关闭或 5s 超时——避免应用在 toast 渲染窗口期内被强制退出导致下次启动重复弹出。

### 决策依据补记（Toast 复显策略）

> Toast 是**知情通知**（告知用户默认 Vault 位置），非**行动指令**（不需用户必须看到才能继续使用产品）。Settings 内 Vault 分区置顶且文案完整，确保用户即使错过 toast 也能在任何时候通过 Settings 了解和修改 Vault 配置。重复弹出反而是骚扰。

### 条件 2 详细规则（env 迁移）

`.env.local` 中 `VITE_VAULT_*` 的迁移仅在「electron-store 为空」时触发：

- 若 electron-store 已有配置，env 值**被忽略**（即使存在）
- 迁移完成后不删除 `.env.local` 文件（用户自身责任，避免误删用户其他配置）
- 控制台打印一次性警告：`[vault] VITE_VAULT_* env vars are deprecated and will be ignored in future versions. Migrated to electron-store.`

---

## 验收标准

### 1. 隐私零泄露（核心硬指标，任何一条不通过即版本不合格）

- [ ] `pnpm build` 后，运行 `node workbench/scripts/scan-personal-paths.mjs` 退出码为 0（无任何 `/Users/` / `C:\Users\` / `/home/` 匹配）
- [ ] `pnpm dist:mac` 后，dmg 解压 → .app → renderer JS 中不含任何打包者个人路径（同样调用 scan-personal-paths.mjs 验证 .app 解压后的 Resources/ 目录）
- [ ] CI `build.yml` 增加 verification step 调用 `node workbench/scripts/scan-personal-paths.mjs`，发现任一平台用户家目录前缀即 fail
- [ ] `workbench/scripts/scan-personal-paths.mjs` 文件存在、可独立运行，三平台行为一致
- [ ] 发布前 checklist（workbench/RELEASE.md 增加）明确列出：本地 scan 脚本 / CI verification / dmg 解压验证三项必过才能 tag

### 2. 功能完整

- [ ] 重写 `paths.ts` 后，全量回归测试通过（`pnpm test`）
- [ ] 5 个原 paths.ts 消费方（ChatView / DetailPanel / useChatSend / agentEventDispatcher / conversationSlice）功能不退化
- [ ] Settings → 「Vault 配置」UI 可正常选目录、保存、读取
- [ ] 修改 Vault 路径后，无需重启应用即可生效（Zustand 实时更新到所有消费方）
- [ ] 「检测路径有效性」按钮可正确判定目录存在/不存在/不可读三态

### 3. 首次启动体验（按四种触发场景验收）

每个场景验收前先按「初始条件」清理或预置环境，再启动应用观察结果。

- [ ] **场景 A**（electron-store 已有配置）
  - 初始条件：`<userData>/config.json` 含非空 `vaultConfig.vaultRoot`
  - 期望：启动后直接进入应用，无 toast，无引导
- [ ] **场景 B**（仅 `.env.local` 有 `VITE_VAULT_*`，优先级高于条件 3）
  - 初始条件：删除 `<userData>/config.json`；`workbench/.env.local` 含 `VITE_VAULT_ROOT=...` 等三项
  - 期望：自动迁移到 electron-store，控制台有弃用警告 `[vault] VITE_VAULT_* env vars are deprecated...`，无 toast；`config.json` 内 vault 字段被正确写入
- [ ] **场景 C**（仅 `~/Workbench-Vault` 已存在）
  - 初始条件：删除 `<userData>/config.json`；`.env.local` 不含 `VITE_VAULT_*`；`~/Workbench-Vault` 目录存在（QA/Projects 子目录可有可无）
  - 期望：仅引用不覆盖，写入 store；若 QA/ 或 Projects/ 不存在则自动补建（不动用户已有文件）；无 toast
- [ ] **场景 D**（全新安装）
  - 初始条件：删除 `<userData>/config.json`；删除 `~/Workbench-Vault`；`.env.local` 不含 `VITE_VAULT_*`
  - 期望：自动创建 `~/Workbench-Vault/QA/` 和 `~/Workbench-Vault/Projects/`，显示 toast，5 秒淡出；「打开 Settings」链接可打开 SettingsPanel overlay 并定位到 Vault 配置分区；`hasShownFirstLaunchToast` 字段在 toast 显示瞬间置为 `true`
- [ ] **场景 D 复显验证**：在场景 D 完成后立即重启应用（保留 `<userData>/config.json`），toast 不再出现
- [ ] 任何场景下，文件相关功能均不静默失败、不崩溃
- [ ] README 有清晰的 "First Launch · Vault Configuration" 章节

### 4. 配置层正确性

- [ ] `workbench/.env.example` 不再含 `VITE_VAULT_*` 三行
- [ ] `workbench/.env.local` 含 `VITE_VAULT_*` 时被新逻辑忽略（仅首次迁移使用一次）
- [ ] Vault 配置文件位于 `<app.getPath('userData')>/config.json`，与应用包完全分离
- [ ] electron-builder `extraResources` 配置确认排除 `!**/.env`（无回归）

### 5. SettingsPanel overlay Vault 配置分区（doc_revision 9 修订）

- [ ] Vault 配置分区出现在既有 SettingsPanel overlay 内**置顶**（在 API Keys / Theme / 服务器配置之上）
- [ ] 不存在独立 P3 SettingsView 视图入口（确认不引入新的 P3 工作模式枚举）
- [ ] 分区仅显示「Vault 根目录」+「检测路径有效性」+ 保存按钮三个控件
- [ ] QA 子目录输入框 / Projects 子目录输入框**不渲染**（用户不可见、不可改）
- [ ] vaultStore schema 中 `qaSubdir` / `projectsSubdir` 字段保留，默认值 `'QA'` / `'Projects'`（electron-store schema defaults 自动生效，UI 不暴露对应输入框）
- [ ] Toast「打开 Settings」链接可打开 SettingsPanel overlay 并定位到 Vault 分区

---

## 架构方向

### 实现顺序与模块依赖关系

本版本改造涉及 main 进程、IPC 层、renderer Zustand store、UI 组件、构建脚本五个层面。technical.md 应按以下依赖顺序拆解实现节点（每个节点完成后才能进入下一个）：

```
[1] main 进程 vaultStore
    │  workbench/electron/store/vaultStore.ts（新增）
    │  仿照 workspaceStore 模式，封装 electron-store 读写
    ▼
[2] IPC 层 vault channel
    │  workbench/electron/ipc/vault.ts（新增）
    │  暴露 vault:get-config / vault:set-config / vault:pick-folder
    ▼
[3] renderer vaultSlice
    │  workbench/src/store/vaultSlice.ts（新增）
    │  应用启动时 IPC 拉取配置；订阅 vault:config-changed 事件
    ▼
[4] paths.ts 重写
    │  workbench/src/utils/paths.ts（全文重写）
    │  导出 useBasePath/useProjectsPath/useVaultPath hook + buildFilePath/getVaultConfig 工具
    ▼
[5] 5 个消费方改造
    │  ChatView / DetailPanel / useChatSend / agentEventDispatcher / conversationSlice
    │  按 req-063 §4 表格逐一改 import
    ▼
[6] VaultBootGate 组件
    │  workbench/src/components/VaultBootGate.tsx（新增）
    │  挂在 App 顶层，等 vaultSlice IPC 返回后再渲染主界面，避免子组件读到空路径（缓解风险 §2）
    ▼
[7] 首次启动判定逻辑
    │  在 main 进程或 vaultSlice 初始化时实现「触发条件 1/2/3/4」短路判定（详见「首次启动 UX」章节）
    ▼
[8] SettingsPanel overlay 新增 Vault 配置分区（doc_revision 9 修订）
    │  workbench/src/components/Settings/VaultConfig.tsx（新增 · 注入既有 SettingsPanel overlay）
    │  不新建独立 P3 SettingsView 工作模式
    │  分区置顶在 API Keys / Theme / 服务器配置之上
    │  仅渲染「Vault 根目录」+「检测路径有效性」两控件；QA/Projects 子目录输入框不暴露
    ▼
[9] FirstLaunchToast 组件
    │  workbench/src/components/FirstLaunchToast.tsx（新增）
    │  挂 App 顶层，根据 hasShownFirstLaunchToast 决定是否渲染
    │  「打开 Settings」链接打开 SettingsPanel overlay 并定位到 Vault 分区
    ▼
[10] 构建脚本与 CI 集成
    │  workbench/scripts/scan-personal-paths.mjs（新增）
    │  .github/workflows/build.yml 增加 verification step
    │  workbench/.env.example 清理 VITE_VAULT_* 三行
    ▼
[11] 文档化
       workbench/README.md（新增 First Launch 章节）
       workbench/RELEASE.md（新建，发布前 checklist）
```

### v0.16 范围最终调整（doc_revision 9）

本版本经历用户 QA 阶段的范围撤回，最终实现节点从 12 项精简为 11 项。撤销内容：

| 撤销节点 | 原编号 | 撤销原因 |
|---|---|---|
| Chat 输入框上方 Vault 按钮（R-6） | 原 [11] | 功能定错（用户原意是任务 cwd 切换，非 Vault 切换），已独立立项 req-065 留待 v0.17 |
| 独立 P3 SettingsView 工作模式 | 原 [8] 子项 | 用户决策统一放回 v0.15.1 既有的 SettingsPanel overlay，避免双入口 UX 割裂 |
| QA/Projects 子目录 UI 字段 | 原 [8] 子项 | 用户判断「不会调整 QA 和 Projects」，hardcode 默认值即可 |

撤销后实现顺序的依赖链保持完整：[1]→[2]→[3]→[4]→[5]→[6]→[7]→[8]→[9]→[10]→[11]，无悬空节点。

### 模块边界声明

- **main 进程独占持久化**：所有 vault 配置的读写最终走 electron-store，renderer 不直接触达文件系统（renderer 只发 IPC）
- **renderer 单数据源**：所有路径消费方统一从 `vaultSlice` 读取，禁止再有第二条路径来源（如 sessionStorage / 本地变量缓存）
- **toast 与 Settings 解耦**：toast 是全局通知组件，挂 App 顶层；SettingsPanel 是 v0.15.1 已存在的 overlay 浮层；二者通过 UI store 的 `settingsPanelOpen` + `settingsActiveSection` 联动，不直接相互调用

### 长期一致性说明

#### 本版本如何固化「OSS 零个人信息泄露」原则

| 固化机制 | 落地位置 | 长期效果 |
|---------|---------|---------|
| CI verification step（Node 脚本统一扫描） | `.github/workflows/build.yml` 调用 `node workbench/scripts/scan-personal-paths.mjs` | 任何含 `/Users/` / `C:\Users\` / `/home/` 的回归在 CI 阶段即失败，三平台 runner 行为一致，开发者无法 merge |
| 扫描脚本本身 | `workbench/scripts/scan-personal-paths.mjs`（Node 18+ 内置 fs/path） | 同一份脚本服务 CI + 本地预发，无脚本漂移；新协作者本地也能跑出与 CI 一致的结果 |
| 发布前 checklist | `workbench/RELEASE.md`（本版本新建） | 每次 tag 前必走的检查清单，含本地 scan 脚本 / CI 状态 / dmg 解压验证三项；与 README（面向用户的入门文档）解耦，专门承载发布流程 |
| paths.ts 运行期读取模式 | `workbench/src/utils/paths.ts` 重写 | 所有路径消费方走 runtime hook，任何想"图省事内联 env"的代码改动会立刻在 review 阶段被识别 |
| `.env.example` 不含个人路径变量 | `workbench/.env.example` 清理 | 新协作者照模板配置不会引入打包期 env 反模式 |
| README 文档化 | `workbench/README.md` First Launch 章节 | 用户与协作者对 vault 配置机制有明确认知 |

#### 与产品方向的一致性核对

| 产品方向原则 | v0.16 体现 |
|------------|----------|
| 工作台是面向所有人的开源工具 | 本版本首次让发布产物真正具备"通用性"——任何下载者都能用，且不暴露打包者隐私 |
| 个人化信息留在本地 | electron-store 落在 `<userData>/config.json`，与应用包分离，符合"配置即数据，数据归用户"的边界 |
| 面板职责排他 | Settings → Vault 配置分区属于全局配置入口，不侵入 P2/P3/P4 渲染逻辑 |
| 内容单元可序列化 | Vault 配置作为运行期 store 状态，与 atom 文件无任何编译期耦合 |
| 不引入「分散注意力」的独立控件 | 首次启动 toast 非阻塞、自动淡出、可一键直达 Settings，符合"按需出现，不打扰" |

#### 后续版本继承条款

v0.17 起，所有版本规划必须遵守以下硬条款：

1. **不得新增任何编译期注入个人路径的 `VITE_*` env 变量**
2. **任何新的"本地配置"必须走 electron-store 或运行期机制**
3. **每次 tag 前必跑「发布前 checklist」**（含 `scan-personal-paths.mjs` 本地扫描 / CI 状态 / dmg 解压验证三项）
4. **如发现任何机制可能违反 OSS 零泄露原则，必须在 product.md 规划阶段提前讨论**

---

## 风险与权衡

### 来自 req-063 §风险与权衡（原文继承）

1. **paths.ts 从静态常量变 hook，可能漏改非 React 上下文的调用**
   - 缓解：保留 `getVaultConfig()` getter 作为非 React 上下文兜底；code review 阶段重点 grep `import.*paths`；technical.md 阶段需明确 5 个消费方的改造方式逐一对应
2. **electron-store 在 main 进程，renderer 需要 IPC 拉取，存在初始化竞态**
   - 缓解：在 App 顶层增加 `<VaultBootGate>` 组件，等 IPC 返回后再渲染主界面（避免子组件读到空 vault 路径）
3. **首次启动 UX 方案选择影响产品定位**
   - 已由 CEO 决策定档为方案 C + toast，本版本无此风险残留
4. **既有用户（开发者本人）升级后 `.env.local` 的 `VITE_VAULT_*` 失效**
   - 缓解：vaultSlice 初始化时若 electron-store 为空且 env 非空，自动迁移一次（带 console 弃用警告，未来版本可移除迁移逻辑）

### CEO 视角补充

5. **toast 实现位置可能引发组件归属争议**
   - **拍板**：工作台当前尚无全局通知体系（v0.16 是首次引入 toast），本版本选「新增 `<FirstLaunchToast>` 组件挂在 App 顶层（与 VaultBootGate 同级），不归 Settings、不归 P3」。若未来某版本引入统一的全局通知系统，再统一收编。
   - 边界提醒：toast 是"全局通知"而非"P2/P3/P4 内容"，不要污染面板职责
6. **`~/Workbench-Vault` 在不同平台的路径差异**
   - macOS: `/Users/<name>/Workbench-Vault`；Linux: `/home/<name>/Workbench-Vault`；Windows: `C:\Users\<name>\Workbench-Vault`
   - 必须使用 Node `os.homedir()` 而非硬编码；technical.md 阶段需明确跨平台一致性测试
7. **CI verification step 跨平台一致性**
   - 已由 CEO 仲裁定档为「Node 脚本统一扫描」（`workbench/scripts/scan-personal-paths.mjs`），三平台 runner 行为完全一致，规避 Windows grep 依赖 git-bash 的脆弱性（详见「设计方案 · 5」与「长期一致性说明」）。本项不再是风险残留
8. **toast 复显策略**
   - 已由 CEO 仲裁定档为「lifecycle 一次」，通过 `vaultConfig.hasShownFirstLaunchToast` 字段实现（详见「首次启动 UX · Toast 复显标记字段」章节）。本项不再是风险残留，列在此处仅为决策追溯

---

## 不在本版本范围

### 保留 in-progress 状态、待后续版本规划

- **req-020** 主对话保护前端（TopBar badge）
- **req-022** Agent 沙盒（隔离执行环境）
- **req-023** Harness 管控层
- **req-024** Agent 级别 LLM 配置
- **req-032** ChatView Markdown 渲染（v0.15.1 已部分消解）
- **req-048** 联网搜索工具

### 已立项 v0.17

- **req-065 · 任务 cwd 选择器（已立项 v0.17）**：用户原意是切换本次对话/任务的工作目录（类 Claude Code 启动时选 cwd），并非 Vault 切换。doc_revision 5 引入的 R-6 在 v0.16 QA 阶段澄清后撤销并独立立项，目的是分离「vault（应用级存储位置，几乎不变）」与「cwd（会话级任务目录，每次可能换）」两个不同概念，避免概念混淆。req-065 详见 `requirements/req-065-task-cwd-selector.md`。

### 已撤销立项

- **req-064 · Vault/cwd 单一来源（已 dropped · 2026-06-08 dropped）**：曾尝试将 vault 与 cwd 合并为同一字段统一管理，最终判定二者是不同概念不应合并，已于 2026-06-08 dropped。req-065 已分离立项。

### 明确不做的衍生工作

- **多 vault 切换支持**：本版本只做单 vault 配置；多 vault 切换待 v0.17+ 视需求确认
- **Vault 配置导入/导出**：本版本只做本地存储；跨设备同步、配置导出不在范围
- **Vault 目录结构强校验**：本版本「检测路径有效性」仅校验目录存在 + 可读，不强制约束子目录命名；用户自定义路径不报错
- **API Key OSS 化扫描**：v0.15.1 已通过 `extraResources` 排除 `.env`，本版本不再二次处理；后续版本如需在 CI 中加 API key 泄露扫描，另立 req
- **`.env.local` 自动清理**：本版本仅迁移 env 值到 store，不自动删除 `.env.local` 文件（用户责任）
- **VaultBootGate loading UI 精致化**：本版本 `<VaultBootGate>` 等 IPC 返回期间仅显示极简占位（空白背景或一行 `Loading Vault config...` 文字），不做 splash 屏 / 启动动画 / 品牌 logo 展示。这些视觉精致化交由后续版本视需求处理

---

## 修订记录

| 版本 | 日期 | 修订人 | 说明 |
|------|------|--------|------|
| 0 | 2026-06-08 | workbench-product | 初稿；纯 req-063 单需求版本；首次启动 UX 采纳方案 C + 轻量 toast；固化「OSS 零个人信息泄露」为项目级长期原则 |
| 1 | 2026-06-08 | workbench-product | CEO 仲裁回写：Settings Vault 分区置顶；toast lifecycle 一次；CI 改用 Node 扫描脚本 |
| 2 | 2026-06-08 | auto-review (Round 1) | 修复 5 项 🔴 + 8 项 🟡：补「需求冲突与衍生」+「架构方向」一级章节；拍板发布前 checklist 落位 `workbench/RELEASE.md`；scan 脚本接口加 targetDir 可选参数；首次启动场景 2 与 3 的判定优先级与边界明确化；Settings 视图归属 P3 工作模式；Vault 子目录字段语义（相对/绝对）；toast 跳 Settings 实现机制约束；场景验收补充初始条件 + 复显验证；同步 grep→Node 脚本升级声明 |
| 3 | 2026-06-08 | auto-review (Round 2) | 修复 1 项 🔴 + 4 项 🟡：vaultStore schema 字段命名升级（qaPath→qaSubdir）在「需求冲突与衍生」明示覆盖 req-063；「设计方案 · 1」补完整 schema 块；「迁移逻辑详细规则」改名「条件 2 详细规则」并加导览；删除「Settings 入口位置」重复段；toast 全局通知归属拍板（新增组件，未来统一收编）；「不在本版本范围」补 VaultBootGate loading UI 边界 |
| 4 | 2026-06-08 | auto-review (Round 3) | 复核通过：🔴=0、🟡=0；六维度全部通过；review_state 改为「通过」 |
| 5 | 2026-06-08 | workbench-product | CEO 接纳用户反馈 + taste 审查：缺口 A 明确不做引导；缺口 B 加 Python sidecar key 透传；新增 R-6 chat 输入框 Vault 文件夹按钮（图标+label+muted/accent+完整路径 tooltip）；toast 文案微调指向新按钮 |
| 6 | 2026-06-08 | workbench-product | 用户最终决策撤回 sidecar key 透传范围扩展：chat 主路径维持 Claude SDK 现状，非 Claude 模型走工作台外路径；删除设计方案§6 / 验收标准§5 / 架构方向[11]Python sidecar 全部相关章节；R-6 文件夹按钮保留不动 |
| 7 | 2026-06-08 | auto-review (Round 1) | 修复 3 项 🔴：① sidecar 撤销残留 cross-reference 修正——「设计方案 · 7」全部改为「设计方案 · 6」（L50 / L87 两处，R-6 章节因 sidecar §6 删除已顺位前移至 §6）；② 架构方向 [11] R-6 文件路径与 technical.md 同步——`Chat/VaultPickerButton.tsx` 改为 `ChatView/ChatInputVaultButton.tsx`（CEO 锁定决策为 ChatInputVaultButton 节点，目录对齐 v0.15 既有 components/ChatView/）；③ 同步补充 R-6 新建 `utils/pathDisplay.ts` 与「复用 notificationsSlice.addToast」实现细节，与 technical.md R-6.1/R-6.3/R-6.5 三处节点一致 |
| 8 | 2026-06-08 | auto-review (Round 2) | 复核通过：🔴=0、🟡=0；sidecar 实质内容（M-6 / buildSidecarEnv / api-key 透传 / T-V016-M6.*）全部干净删除（仅修订记录保留历史）；R-6 跨文档 cross-reference 全部对齐（组件名 ChatInputVaultButton / 文件路径 ChatView/ChatInputVaultButton.tsx / 辅助文件 utils/pathDisplay.ts / 章节引用「设计方案 · 6」）；review_state 改为「通过」 |
| 9 | 2026-06-08 | workbench-product | 用户 QA 阶段决策：撤销 R-4 SettingsView 改为 SettingsPanel overlay 首分区 + 撤销 R-6 ChatInputVaultButton（功能定错，已立 req-065 走 v0.17）+ 砍 QA/Projects 子目录 UI；req-064 已 dropped（vault 与 cwd 是不同概念不应合并）；pathDisplay.ts 资产保留服务 req-065 复用；review_state 改为「未 review」待新一轮 review-agent |
| 10 | 2026-06-09 | review-agent | 复核 doc_rev=9 修订 5 项 🟡：toast 文案备注 / L345 hardcode 描述精化 / req-065 措辞已立项 / 多 vault 措辞 / req-064 dropped 日期 |
