---
version: v0.16
codename: OSS Decoupling
status: 发布收口中
doc_revision: 12
created: 2026-06-08
review_state: 通过
draft_owner: tauri-platform（main+CI 章节）+ frontend-ui（renderer 章节）
pending_owners: []
---

# 技术执行文档 · v0.16 · OSS Decoupling · 解耦个人化信息与发布产物

关联产品规划：[[changelog/v0.16/product]]
关联需求：[[requirements/req-063-oss-personal-info-decoupling]]

> **本稿状态**：r0 由 tauri-platform 起草 main 进程 + CI/打包章节；r1 由 frontend-ui 填充 renderer 章节（R-1 ~ R-5）实现细节 + renderer 测试清单。本稿为 main+CI+renderer 三方完整版本，已通过 review-agent 循环；当前处于发布治理收口。
>
> **本稿规则**：所有字段命名以 product.md「设计方案 · 1」`vaultRoot / qaSubdir / projectsSubdir / hasShownFirstLaunchToast` 为准；req-063 原文 `qaPath / projectsPath` 不再使用。

---

## 技术方案概述

v0.16 的技术核心是**把所有打包期内联的个人化信息抽到运行期 IPC 拉取**，并通过 CI 静态扫描固化「OSS 零个人信息泄露」原则。改造横跨 5 个层面，按 product.md「架构方向」13 步依赖链转化为 3 个工作流并行推进：

```
工作流 A · 主进程数据层（tauri-platform）
  M-1 vaultStore         ──→  M-2 vault IPC  ──→  M-3 main 接线
                                                   │
                                                   ├─ M-4 默认 vault 自动创建
                                                   └─ M-5 .env.local 兼容迁移
                                                          │
                                                          ▼
                              （IPC 接口锁定后解锁 frontend-ui）
                                                          │
工作流 B · 渲染层（frontend-ui，本稿仅占位）                ▼
  R-1 vaultSlice  ──→  R-2 paths.ts 重写 + 消费方改造
                  ──→  R-3 VaultBootGate
                  ──→  R-4 SettingsPanel overlay · Vault 配置首分区（doc_rev 11 修订：从独立 SettingsView 改为复用 v0.15.1 既有 overlay）
                  ──→  R-5 FirstLaunchToast
                  ──→  R-6 ❌ 已撤销（doc_rev 11：功能定错为任务 cwd 切换，立项 req-065 v0.17）

工作流 C · 构建与 CI（tauri-platform，与 A/B 并行）
  CI-1 scan-personal-paths.mjs
  CI-2 build.yml verification step
  CI-3 三平台 runner 行为一致性验证
  CI-4 workbench/RELEASE.md
  CI-5 dmg 解包验证脚本
```

工作流 A 与 C 物理隔离（前者改 `workbench/electron/`，后者改 `workbench/scripts/` + `.github/workflows/`），可完全并行。工作流 B 依赖 A 的 M-2（IPC 契约锁定）后才能 unblock。

### 边界扫描（按 CLAUDE.md 规则）

| 边界类型 | v0.16 是否引入 | 说明 |
|---|---|---|
| 新执行者类型 | **否** | 仍是 main / renderer / preload 三方；CI runner 为已有 GitHub Actions 链路 |
| 新外部依赖 | **否** | electron-store 已在 v0.15 引入；扫描脚本仅依赖 Node 18+ 内置 `fs`/`path`/`os`；不新增 npm 包 |
| 新数据类别 | **是（受控）** | 引入 `vaultConfig` 持久化 schema（electron-store key），与现有 `workspace.cwd` 同一 store 文件、不同 key，互不污染；renderer 通过新建 `vaultSlice` 持有派生状态。**抽象路径**：electron-store 已是现有持久化抽象层，本次新增 key 完全复用其同步 API，不引入新抽象（参照 workspaceStore 模式） |
| 新交互模式 | **是（首次启动 toast）** | 首次启动 toast 是 v0.16 首次引入的「全局通知」UI 模式。product.md「风险与权衡 § 5」已拍板「新增 `<FirstLaunchToast>` 组件挂 App 顶层，不归 Settings/不归 P3，未来若引入统一通知系统再统一收编」。本版本不抽象通用 toast 框架，仅落地这一个组件 |

**结论**：本版本有一处受控的「新数据类别」边界（vaultConfig schema），按 product.md 已确立的 electron-store 抽象路径落地；toast UI 模式由 product.md 已拍板边界处理策略，无新决策点。

### 关键技术决策

1. **vaultStore 完全仿照 workspaceStore 模式**：单文件 `vaultStore.ts`、单 schema 类型、单 store 实例（lazy init）、暴露同步 get/set API；与 workspaceStore 共享同一 `<userData>/config.json` 文件（electron-store 默认 file），通过 **顶层 key 命名空间隔离**：workspaceStore 持有顶层扁平 key `'workspace.cwd'`（事实佐证 `workspace.cwd` 字面量作为 JS object key，最终落盘形态为 `{ "workspace.cwd": "..." }`，是字符串字面量含点号、不是嵌套对象）；vaultStore 持有顶层嵌套对象 key `vaultConfig`，最终落盘形态为 `{ "vaultConfig": { "vaultRoot": "...", "qaSubdir": "...", ... } }`。两个 store 实例互不冲突且语义清晰。这是 product.md「设计方案 · 1」+ 「架构方向 · 模块边界声明」的直接落地。

2. **vault IPC 走 4 个 channel 而非合并成 1 个**：`vault:get-config` / `vault:set-config` / `vault:pick-folder` / `vault:config-changed`（广播）。语义解耦——前三个是 request/response，第四个是 main → renderer 单向广播，承担「main 进程内部修改（如 .env 迁移、默认 vault 创建）后通知 renderer 重渲染」职责。**参照 v0.15 workspace IPC 已建立的 `workspace:setCwd` + `workspace:changed` 同款模式**，与现有约定一致。

3. **`hasShownFirstLaunchToast` 字段持久化在 main 进程**：product.md「Toast 复显标记字段」节明确该字段属于 electron-store `vaultConfig` 内嵌字段。renderer 只能通过 `vault:get-config` 读 / `vault:set-config` 写（partial merge），不在 renderer 端单独维护 localStorage 副本。理由：lifecycle 一次的语义需要跨进程一致，main 进程持久化是唯一权威源。

4. **`.env.local` 迁移在 main 进程完成而非 renderer**：M-5 节点在 main 进程启动阶段读取 `process.env.VITE_VAULT_*`（electron-vite dev 模式下注入），若 electron-store 为空则一次性写入 store；renderer 永远只看到 store 里的最终值。**理由**：① main 进程是 electron-store 唯一持有者，迁移逻辑天然属于 main；② renderer 跨 reload 时不重复触发迁移；③ 与 product.md「触发条件 1/2/3/4 短路判定」描述的"应用启动时"时序一致。

5. **默认 `~/Workbench-Vault` 创建权限失败时的 fallback**：product.md「风险与权衡」未列此细节，本 technical.md 拍板 fallback 策略为 `app.getPath('userData') + '/Workbench-Vault'`（与 config.json 同目录，权限保证）。**fallback 信息传递机制锁定**：
   - **方案选定：M-4 把 fallback 标记缓存在 main 进程内存模块变量**（如 `let __lastFallbackInfo: { used: boolean, reason: string } = { used: false, reason: '' }`），**不写入 vaultConfig schema**（避免污染持久化字段，且 fallback 是会话内的一次性信息，重启后由 M-4 重新评估）
   - **renderer 拿到 fallback 信息的两条通路**：
     1. **首次拉取**：M-2 `vault:get-config` handler 内 return `{ ...getVaultConfig(), __fallbackInfo: __lastFallbackInfo }`（在 IPC response 多带一个非持久化字段），R-1 vaultSlice 在 initVault 时把 `__fallbackInfo` 写入独立 slice 字段 `vaultFallbackInfo`
     2. **广播补偿**：M-3 在 `createWindow()` 完成后（即第一个 BrowserWindow 创建后）若 `__lastFallbackInfo.used === true` 立即触发一次 `broadcastVaultConfigChanged({ config, fallbackUsed: true, fallbackReason })`——确保 renderer 即使错过首次拉取也能在订阅中拿到
   - **R-4 Settings 显示 warning 条件**：`vaultFallbackInfo.used === true` 时在 Vault 分区顶部显示 `已使用 fallback 路径：{reason}` warning bar
   - **本决策不要求回写 product.md 风险章节**（CEO 已仲裁纳入 technical.md 决策范围）

6. **scan-personal-paths.mjs 设计为可独立运行的 CLI**：`node scan-personal-paths.mjs [targetDir]`，零外部依赖，递归遍历，命中即非零退出并输出文件路径 + 字节偏移 + 命中上下文 60 字符。`targetDir` 默认为 `workbench/out/`（相对脚本所在目录的上一级），dmg 解包验证场景手动传 Resources 路径。**与 product.md「设计方案 · 5」三平台行为完全一致**。

7. **CI verification step 落位**：在 `pnpm dist:mac` / `pnpm dist:win` 之前先跑 `pnpm build`（renderer + main 产物）→ 立刻跑 `node workbench/scripts/scan-personal-paths.mjs`，失败即 abort job。**理由**：dist 是耗时的 electron-builder 打包，先用便宜的 build + scan 卡住泄露问题，节约 CI 时长。

---

## 数据模型

### vaultStore Schema（electron-store key 命名空间）

完整 schema 定义（main 进程 `vaultStore.ts` 落地）：

```ts
type VaultConfigSchema = {
  vaultConfig: {
    vaultRoot: string                  // Vault 根目录绝对路径
    qaSubdir: string                   // 相对子目录名（推荐，如 'QA'）或绝对路径
    projectsSubdir: string             // 相对子目录名（推荐，如 'Projects'）或绝对路径
    hasShownFirstLaunchToast: boolean  // 首次启动 toast 是否已显示（lifecycle 一次）
  }
}
```

### 字段语义（严格对齐 product.md）

| 字段 | 类型 | 默认值 | 来源章节 |
|---|---|---|---|
| `vaultRoot` | string | `''`（未配置）| product.md 设计方案 · 1 |
| `qaSubdir` | string | `'QA'`（相对名）| product.md 设计方案 · 1 / 3 |
| `projectsSubdir` | string | `'Projects'`（相对名）| product.md 设计方案 · 1 / 3 |
| `hasShownFirstLaunchToast` | boolean | `false` | product.md Toast 复显标记字段 |

### Derived Path 派生规则（main 进程 + renderer 共用语义）

```ts
function deriveQaDir(config: VaultConfigSchema['vaultConfig']): string {
  if (isAbsolute(config.qaSubdir)) return config.qaSubdir
  return join(config.vaultRoot, config.qaSubdir)
}

function deriveProjectsDir(config: VaultConfigSchema['vaultConfig']): string {
  if (isAbsolute(config.projectsSubdir)) return config.projectsSubdir
  return join(config.vaultRoot, config.projectsSubdir)
}
```

**判定优先级**：绝对路径（`path.isAbsolute()`）高于相对名拼接。这是「相对子目录名（推荐）或绝对路径」语义的直接落地。

### 与现有 workspaceStore 的关系

- 同一 `<userData>/config.json` 文件，由 electron-store 默认管理
- 顶层 key 互不重叠：workspaceStore 写 `'workspace.cwd'`（顶层字符串字面量含点号，v0.15 已建）；vaultStore 写 `'vaultConfig'`（顶层嵌套对象，v0.16 新增）。落盘 JSON 形态：
  ```json
  {
    "workspace.cwd": "/Users/.../somewhere",
    "vaultConfig": {
      "vaultRoot": "/Users/.../Workbench-Vault",
      "qaSubdir": "QA",
      "projectsSubdir": "Projects",
      "hasShownFirstLaunchToast": true
    }
  }
  ```
- 两个 store 实例各自 lazy init，不互相依赖；future 不排除合并为单一 `appStore`，但 v0.16 不做

### 与 v0.15 `workspace.cwd` 的语义差异

- `workspace.cwd`：legacy 字段，v0.15 用于 fsGuard 越界保护的根锚点
- `vaultConfig.vaultRoot`：v0.16 引入，作为所有 QA/Projects/atom 读写的实际根

**过渡策略（M-4 节点细化）**：v0.16 不动 `workspace.cwd`（保持 fsGuard 行为兼容），但 vault IPC 与 fsGuard 之间需要建立一致性——若用户在 Settings 中重新选 vaultRoot 与已有 cwd 不同，触发一次 `setWorkspaceCwd(vaultRoot)` 同步（M-4 详述）。

---

## 实现节点

> 进度说明：原技术节点已由 req-063 实现分支基本落地；当前阶段转入 v0.16 发布治理收口，详见 docs/superpowers/specs/2026-06-11-v016-release-governance-design.md。

### 工作流 A · main 进程（节点 M-x）

- [x] **节点 M-1**：新建 `workbench/electron/store/vaultStore.ts`（对应需求：req-063 / vaultStore 基础设施）
  - 文件路径：`workbench/electron/store/vaultStore.ts`
  - 实现要点：
    1. 仿照 `workspaceStore.ts` 模式（lazy singleton + 同步 API）
    2. 单独 `Store<VaultStoreSchema>` 实例，与 workspaceStore 共享默认 `config.json` 文件
    3. 暴露同步 API：
       ```ts
       export function getVaultConfig(): VaultConfigSchema['vaultConfig']
       export function setVaultConfig(patch: Partial<VaultConfigSchema['vaultConfig']>): VaultConfigSchema['vaultConfig']
       export function isVaultConfigured(): boolean   // vaultRoot 非空
       export function markFirstLaunchToastShown(): void  // 等价于 setVaultConfig({ hasShownFirstLaunchToast: true })
       ```
    4. `defaults` 为：
       ```ts
       { vaultConfig: { vaultRoot: '', qaSubdir: 'QA', projectsSubdir: 'Projects', hasShownFirstLaunchToast: false } }
       ```
    5. `setVaultConfig` 实现 partial merge（读出整对象、合入 patch、写回），而非 electron-store 自带的 dot-notation 单字段写——避免 partial 覆盖时丢字段
  - 完成标志：
    - `vaultStore.ts` 单元测试通过（详见「测试清单 · 单元测试」段）
    - `tsc --noEmit` 零错误
    - getter 返回完整 schema 对象（含 hasShownFirstLaunchToast）

- [x] **节点 M-2**：新建 `workbench/electron/ipc/vault.ts`，注册 4 个 IPC channel（对应需求：req-063 / vault IPC channel）
  - 文件路径：`workbench/electron/ipc/vault.ts`
  - 设计：单独成文件而非塞进 `handlers.ts`（vault 是独立子域，与 fs/qa_atom/projects 解耦）
  - Channel 契约（**frontend-ui 必须严格按此实现 R-x**）：

    | Channel | 方向 | 入参 | 出参 | 副作用 |
    |---|---|---|---|---|
    | `vault:get-config` | renderer → main | 无 | `VaultConfigSchema['vaultConfig'] & { __fallbackInfo?: { used: boolean; reason: string } }`（完整 4 字段 + 边带 __fallbackInfo）| 无 |
    | `vault:set-config` | renderer → main | `patch: Partial<VaultConfigSchema['vaultConfig']>` | 更新后的完整对象 | 写 store + 广播 `vault:config-changed` |
    | `vault:pick-folder` | renderer → main | `options?: { title?: string }` | `string \| null`（用户取消返回 null）| 无（不写 store；由 renderer 拿到路径后再调 set-config）|
    | `vault:config-changed` | main → renderer（广播）| 无入参（由 main 触发）| `{ config: VaultConfigSchema['vaultConfig'], fallbackUsed?: boolean, fallbackReason?: string, triggerSource?: 'fresh-install' }` | 无 |

    > **边带字段说明**：`__fallbackInfo` 是 vault:get-config 的 IPC response 边带字段（非持久化、非 vaultConfig schema 内字段，仅当次响应有效），由 M-2 handler 调 M-4 暴露的 `getLastFallbackInfo()` 拼装；R-1 vaultSlice 在 initVault 时拆解写入瞬态 slice 字段 `vaultFallbackInfo`。`triggerSource` 仅在 M-4 条件 4 命中（全新安装，含 fallback 分支）后通过 M-3 补偿广播附带，值固定为 `'fresh-install'`；其他条件（1/2/3）不附带该字段，确保 R-5 toast 仅在场景 D 激活。

  - 实现要点：
    1. 提供 `export function registerVaultIpc(): void` 入口
    2. `vault:set-config` 实现内部：
       - 调 `const merged = setVaultConfig(patch)`（M-1 已声明 setVaultConfig 返回 merged 后的完整对象，IPC handler 直接 `return merged`）
       - 在 return 之前调 `broadcastVaultConfigChanged({ config: merged })`（封装一个内部辅助函数遍历 `BrowserWindow.getAllWindows()` 对每个 win 调 `win.webContents.send('vault:config-changed', payload)`，与 v0.15 handlers.ts L113 既有 `workspace:changed` 广播同款机制）
       - 注：renderer 同时通过 set-config 返回值与广播两次拿到同一份 config（前者是 IPC response，后者是订阅事件），R-1 vaultSlice 设计为幂等 `__applyVaultConfig`，重复 apply 无副作用
    3. `vault:pick-folder` 复用 `dialog.showOpenDialog` 模式（参照 handlers.ts L123 `dialog:pickFolder` 已有实现），title 默认 `'选择 Vault 根目录'`
    4. 所有 handler 加 try/catch；错误对前端有意义（如 `'vault config write failed: <message>'`），不暴露 Rust 风格内部栈
  - 完成标志：
    - 4 个 channel 全部注册
    - IPC 类型签名（preload `index.ts` 端 + window.d.ts 类型）由 frontend-ui R-1 节点对齐填充
    - 单元测试覆盖 partial merge + 广播触发（详见「测试清单 · 集成测试」段）

- [x] **节点 M-3**：main 启动序列接线 vault IPC（对应需求：req-063 / main 进程注册）
  - 修改文件：
    - `workbench/electron/main/index.ts`（新增 import + 在 `app.whenReady()` 内按顺序调用）
    - `workbench/electron/ipc/handlers.ts`（不动；vault IPC 走独立模块，handlers.ts 保持 legacy 通道集中地）
  - **事实对齐 v0.15 main 启动序列**（佐证 `workbench/electron/main/index.ts` L13-22 现有 import / L84 现有 `registerIpcHandlers()` 调用 / L68-80 现有 `ensureWorkspaceCwd(win)`）：当前 `app.whenReady()` 体内顺序为 `registerIpcHandlers()` → `createWindow()` → `ensureWorkspaceCwd(win)` → startAiService 等
  - 改动：
    1. 在既有 `import { hasPersistedWorkspaceCwd, registerIpcHandlers, setWorkspaceCwd } from '../ipc/handlers'` 同区追加：`import { registerVaultIpc } from '../ipc/vault'`（保持 import 分区不变）
    2. 在既有 `registerIpcHandlers()` 调用之后立即追加 `registerVaultIpc()`（顺序：先 handlers，再 vault；二者无依赖关系，仅约定 vault 放在最后便于将来独立抽离）
    3. **M-4 `ensureDefaultVault()` 时序锁定**：在 `registerVaultIpc()` 之后、`createWindow()` 之前 `await ensureDefaultVault()`——确保窗口创建时 vault store 已初始化完成（避免 R-3 VaultBootGate 拿到空对象）。**与既有 `ensureWorkspaceCwd(win)` 的关系**：既有 cwd 流程仍发生在 createWindow 之后（依赖 win 实例），v0.16 不动；vault 流程独立先于 window 完成，二者互不阻塞（cwd 与 vaultRoot 双源一致性问题归 M-4 §冲突处理段，见下）
    4. `app.whenReady().then(async () => { ... })` 内最终顺序为：`registerIpcHandlers()` → `registerVaultIpc()` → `await ensureDefaultVault()` → `createWindow()` → `ensureWorkspaceCwd(win)` → `startAiService(win)` → ...
  - 完成标志：
    - main 启动 console 无报错
    - 在 renderer DevTools 调 `window.api.invoke('vault:get-config')` 能正常返回完整 schema 对象
    - 既有 v0.15 启动序列功能（cwd dialog / sidecar / updater）零回归

- [x] **节点 M-4**：默认 vault 自动创建逻辑（对应需求：req-063 / 首次启动条件 3 + 4）
  - 文件路径：`workbench/electron/main/index.ts` 新增 `ensureDefaultVault()` 函数
  - 触发时机：`app.whenReady()` 内 `registerVaultIpc()` 之后立即调用（同步顺序：`registerIpcHandlers()` → `registerVaultIpc()` → `await ensureDefaultVault()` → `createWindow()`）
  - 判定逻辑（**严格对齐 product.md「触发条件与执行逻辑」表格的短路求值**）：
    ```
    1) electron-store 内 vaultConfig.vaultRoot 非空？
       → 是 → return（条件 1 命中，不触碰文件系统，不设置 triggerSource）
    2) process.env.VITE_VAULT_ROOT 非空？（dev 环境 .env.local 注入）
       → 是 → 调 M-5 迁移逻辑（M-5 内部调 setVaultConfig 写入三字段）→ return（条件 2 命中，不设置 triggerSource）
    3) os.homedir() + '/Workbench-Vault' 目录存在？
       → 是 → setVaultConfig({ vaultRoot: <该目录> })
            → 不存在的 QA/Projects 子目录补建（mkdir recursive，不动用户已有文件）
            → return（条件 3 命中，无 toast，不设置 triggerSource）
    4) 全新安装路径：
       → defaultRoot = os.homedir() + '/Workbench-Vault'
       → 尝试 mkdir defaultRoot/QA, defaultRoot/Projects（recursive）
       → 成功 → setVaultConfig({ vaultRoot: defaultRoot })
       → 失败（权限不足）→ fallback：app.getPath('userData') + '/Workbench-Vault'
                          重试 mkdir + setVaultConfig
                          同时设置 main 进程模块变量 __lastFallbackInfo = { used: true, reason: 'homedir mkdir failed: <err.code>' }
       → **凡命中条件 4（含 fallback 与不含 fallback 两种分支），设置 main 进程模块变量 __lastTriggerSource = 'fresh-install'**
       → 条件 4 命中后，hasShownFirstLaunchToast 字段保持 false（由 R-5 toast 渲染时置 true）
    ```
  - **triggerSource 单值约束**：本版本 `__lastTriggerSource` 仅有 `'fresh-install'` 一个值，对应条件 4；条件 1/2/3 严禁产生 triggerSource 字段（保持变量为 null），避免 R-5 在场景 A/B/C 误激活 toast。未来若新增其他来源类别需明确扩展枚举并同步更新 R-1 / R-5 渲染条件
  - **fallback 信息 + triggerSource 透传（与「关键技术决策 §5」对齐，本节点为产生侧）**：
    - M-4 模块内导出两个状态：
      - `let __lastFallbackInfo: { used: boolean, reason: string } = { used: false, reason: '' }` + `getLastFallbackInfo()` getter
      - `let __lastTriggerSource: 'fresh-install' | null = null` + `getLastTriggerSource()` getter
    - M-2 `vault:get-config` handler 调 `getLastFallbackInfo()` 并把字段附在 IPC response 上：`return { ...getVaultConfig(), __fallbackInfo: getLastFallbackInfo() }`（注意：__fallbackInfo 是 response 边带字段；triggerSource 不通过 get-config 返回，仅通过广播补偿）
    - M-3 在 `createWindow()` 完成后（拿到 win 实例）若 `getLastFallbackInfo().used === true || getLastTriggerSource() !== null` 立即触发一次补偿广播：
      ```ts
      win.webContents.send('vault:config-changed', {
        config: getVaultConfig(),
        ...(fallback.used ? { fallbackUsed: true, fallbackReason: fallback.reason } : {}),
        ...(source ? { triggerSource: source } : {}),
      })
      ```
      补偿 renderer 错过 initVault 的场景。**触发条件为两个 OR**（fallbackInfo OR triggerSource），避免「fresh-install 但 mkdir 一次性成功（无 fallback）」时遗漏 triggerSource 送达
  - **cwd / vaultRoot 双源一致性触发（接「关键技术决策 §7」过渡策略）**：M-4 命中条件 2 / 3 / 4（任意通过本节点写入 vaultRoot 的路径完成后；条件 2 由 M-5 内部 setVaultConfig 完成后回到 M-4 继续触发同步），若既有 `workspace.cwd` 持久化值与新 vaultRoot 不同（含一方为空），调一次 `setWorkspaceCwd(vaultRoot)` + `setPersistedCwd(vaultRoot)` 同步——确保 fsGuard 越界保护根锚点与 vault 一致。**例外**：条件 1（store 已有非空 vaultRoot）不触发，避免覆盖用户手动设置的 cwd
  - 注意：**M-4 不直接置 `hasShownFirstLaunchToast`**——置位是 R-5 toast 组件渲染时的副作用，main 进程仅准备好 vault 状态
  - 完成标志：
    - 4 种场景手动验证通过（详见「测试清单 · 场景测试」段）
    - 任一场景下不抛未捕获异常（fallback 路径全覆盖）
    - 场景 D fallback 触发后 renderer 在 200ms 内收到 fallback 信息（首次 get-config response 或紧随其后的广播二选一）

- [x] **节点 M-5**：`.env.local` 兼容迁移路径（对应需求：req-063 / 首次启动条件 2）
  - 文件路径：`workbench/electron/main/index.ts` 内新增 `migrateEnvVaultConfig()` 辅助函数（或抽到 `workbench/electron/store/vaultStore.ts` 内作为 store 模块的兼容接口）
  - 推荐落位：作为 `vaultStore.ts` 内的 `migrateFromEnv()` 导出函数，由 M-4 的条件 2 分支调用——保持 store 模块对自身演进策略的内聚
  - 实现要点：
    1. 读取 `process.env.VITE_VAULT_ROOT` / `process.env.VITE_VAULT_QA_PATH` / `process.env.VITE_VAULT_PROJECTS_PATH` 三个变量（**事实对齐既有 `.env.example` / `paths.ts` 字段名**——含 `_PATH` 后缀，不可省略）
    2. 仅当 electron-store 内 `vaultConfig.vaultRoot` 为空时执行迁移（再次校验，幂等）
    3. 把三个 env 值映射到 `{ vaultRoot, qaSubdir, projectsSubdir }`：
       - `VITE_VAULT_ROOT` → `vaultRoot`
       - `VITE_VAULT_QA_PATH` → `qaSubdir`（注：env 旧约定字段名含 `_PATH`，含义已是绝对路径；映射写入后由 paths.ts 派生规则识别为 absolute 直接使用）
       - `VITE_VAULT_PROJECTS_PATH` → `projectsSubdir`（同上）
       - 字段名「子目录」是产品文档为新用户的命名升级（推荐相对名场景），从 env 迁移而来的值通常是绝对路径，由 deriveQaDir/deriveProjectsDir 的「绝对路径优先」逻辑透明处理
    4. 写入 store
    5. 控制台输出**一次性弃用警告**：`[vault] VITE_VAULT_* env vars are deprecated and will be ignored in future versions. Migrated to electron-store.`（与 product.md 文案严格一致）
    6. **不删除** `.env.local` 文件（product.md 已明确「用户自身责任」）
  - 完成标志：
    - 场景 B（仅 `.env.local` 有 `VITE_VAULT_*`）启动后 console 含弃用警告
    - electron-store 内 `vaultConfig` 三字段写入正确
    - 二次启动不重复打印警告（store 非空时 M-4 命中条件 1 直接 return，根本不进入迁移分支）

---

### 工作流 C · CI / 打包（节点 CI-x）

- [x] **节点 CI-1**：新建 `workbench/scripts/scan-personal-paths.mjs`（对应需求：req-063 / Node 脚本统一扫描）
  - 文件路径：`workbench/scripts/scan-personal-paths.mjs`
  - 运行环境：Node 18+ 内置 `fs` / `path` / `process`，零外部依赖
  - CLI 签名：
    ```
    node scan-personal-paths.mjs [targetDir]
    ```
    - 不传参数 → 默认 `targetDir = path.resolve(__dirname, '..', 'out')`（即 `workbench/out/`）
    - 传参数 → 直接 `path.resolve(targetDir)`
  - 实现要点：
    1. 递归遍历 targetDir 下所有文件（`fs.readdirSync({ withFileTypes: true, recursive: true })` 或手写递归）
    2. 跳过二进制文件类型（按扩展名白名单：仅扫 `.js` / `.mjs` / `.cjs` / `.html` / `.css` / `.json` / `.txt` / `.md` / `.map`）
    3. 对每个文本文件读 utf-8 内容（大文件流式或一次性读；out/ 内 JS 通常 < 5MB，一次读可接受）
    4. 检测 patterns：
       ```js
       const patterns = [
         { name: 'macOS', regex: /\/Users\/[^/\s'"`)\]]+/g },
         { name: 'Windows', regex: /C:\\\\Users\\\\[^\\\s'"`)\]]+/g },
         { name: 'Linux', regex: /\/home\/[^/\s'"`)\]]+/g },
       ]
       ```
    5. 每个命中输出：`<相对路径>:<字节偏移> [<平台>] <命中上下文 60 字符>`
    6. 总命中数 > 0 → `process.exit(1)`；命中数 == 0 → `console.log('[scan] OK: no personal paths found in <targetDir>')` 后 `process.exit(0)`
  - **跨平台行为一致性保证**：脚本仅依赖 Node 内置 API，三平台行为完全一致（无 shell 调用、无 grep 依赖）
  - **白名单豁免**（防误报）：若需排除某些已知合法路径（如 nodejs 标准库引用），文档化在脚本头部 comment；初版不引入豁免，全命中即 fail
  - 完成标志：
    - 在含已知泄露样本的 fixture 上能精确定位（命中数 + 偏移 + 上下文）
    - 在 clean fixture 上退出码 0
    - 三平台（mac/win/linux）`node scan-personal-paths.mjs <fixture>` 输出一致

- [x] **节点 CI-2**：`.github/workflows/build.yml` 增加 verification step（对应需求：req-063 / CI verification）
  - 修改文件：`workbench/.github/workflows/build.yml`（注：仓库内有两份 build.yml，本节点修改的是 `workbench/.github/workflows/build.yml`，外层 `.github/workflows/cd.yml` 不属于本范围；如需同步更新外层，独立讨论）
  - 改动：在 `Build (macOS)` 和 `Build (Windows)` 步骤**之前**插入两个新 step：
    ```yaml
    - name: Build renderer + main artifacts
      working-directory: workbench
      run: pnpm build

    - name: Verify no personal paths in build artifacts
      working-directory: workbench
      run: node scripts/scan-personal-paths.mjs
    ```
  - 顺序设计：`pnpm build` → `scan` → `pnpm dist:mac/win`（dist 是 electron-builder 打包，耗时；先用便宜的 build + scan 卡住泄露）
  - 完成标志：
    - 含个人路径泄露的 commit push tag 时 CI 在 verification step 失败，不进入 dist
    - clean commit 在 verification step 通过，dist 步骤继续

- [x] **节点 CI-3**：验证三平台 runner 行为一致（对应需求：req-063 / 跨平台一致性）
  - 实施方式：本节点不是新代码，而是**验收任务**——
    1. 在 mac runner / win runner 上分别跑 verification step（CI-2 已接线）
    2. 局部 PR 引入一个合法的「无个人路径」commit，确认两平台均通过
    3. 局部 PR 引入一个 fixture 注入 `/Users/test/...` 字符串，确认两平台均 fail 且输出格式一致
  - 注意：build.yml 当前仅含 macos-latest + windows-latest 两 runner（无 linux）；linux 一致性由本地手动验证（在 macOS local 下用 docker 跑 node:18-alpine 镜像验证脚本输出，结果记录在 PR description）
  - 完成标志：
    - GitHub Actions 历史中至少一次「故意失败」+「故意通过」记录可追溯
    - linux 本地验证截图或 log 附在合并 PR 中

- [x] **节点 CI-4**：新建 `workbench/RELEASE.md`（对应需求：req-063 / 发布前 checklist）
  - 文件路径：`workbench/RELEASE.md`
  - 内容大纲（必含 product.md「长期一致性说明」要求的三项）：
    ```markdown
    # 工作台 · 发布前 Checklist

    每次打 `vX.Y.Z` tag 之前必须勾选完成下列检查项；任一项未过不得 tag。

    ## 1. 隐私零泄露三件套

    - [ ] 本地 `pnpm build` 后 `node workbench/scripts/scan-personal-paths.mjs` 退出码 0
    - [ ] CI build.yml verification step 在最新 commit 上通过
    - [ ] 本地 `pnpm dist:mac` 后，按 CI-5 步骤 attach dmg → 对 .app/Contents/Resources 跑 scan 脚本退出码 0

    ## 2. 功能完整性

    - [ ] 全量回归测试 `pnpm test` 通过
    - [ ] 三平台（mac/win/linux）首次启动 4 场景手动验证（详见 [v0.16 验收标准](changelog/v0.16/product.md#验收标准)）

    ## 3. 配置层

    - [ ] `workbench/.env.example` 不含 `VITE_VAULT_*` 三行
    - [ ] electron-builder `extraResources` 排除 `!**/.env`（无回归）
    ```
  - 完成标志：
    - 文件创建完成，被 v0.16 PR 合入 main
    - product.md「长期一致性说明 § 后续版本继承条款 § 3」可追溯到此文件

- [x] **节点 CI-5**：dmg 解包验证脚本（macOS local 验证流程）（对应需求：req-063 / dmg 解压验证）
  - 文件路径：可选——`workbench/scripts/verify-dmg.sh`（shell 脚本，仅 mac 用）或作为 `RELEASE.md` 内文档化的命令序列
  - 推荐落位：作为 `workbench/scripts/verify-dmg.sh` 落地，提升可复现性；同时在 `RELEASE.md` § 1 引用
  - 命令序列：
    ```bash
    #!/usr/bin/env bash
    # 用法：./scripts/verify-dmg.sh release/工作台-x.y.z.dmg
    set -e
    DMG_PATH="$1"
    MOUNT_POINT=$(hdiutil attach "$DMG_PATH" -nobrowse | grep '/Volumes/' | awk '{print $NF}')
    APP_PATH=$(find "$MOUNT_POINT" -name '*.app' -maxdepth 1 | head -1)
    RESOURCES="$APP_PATH/Contents/Resources"
    echo "[verify-dmg] scanning $RESOURCES"
    node "$(dirname "$0")/scan-personal-paths.mjs" "$RESOURCES"
    SCAN_EXIT=$?
    hdiutil detach "$MOUNT_POINT" -quiet
    exit $SCAN_EXIT
    ```
  - 平台限制：仅 macOS 可用（依赖 hdiutil）；Windows .exe 解包验证由 electron-builder 默认 NSIS 输出结构，可在后续版本扩展 `verify-exe.ps1`，**v0.16 不做**
  - 完成标志：
    - 脚本可在 macOS local 跑通
    - 在 RELEASE.md § 1 「dmg 解压验证」引用此脚本

---

### 工作流 B · renderer（节点 R-x · ⏳ 待 frontend-ui 填充）

> **本章节为接口契约骨架**。tauri-platform 在此锁定 frontend-ui 需要实现的 5 个节点的**标题、依赖、对接的 IPC 契约**；具体实现细节（组件文件结构、CSS、状态机派生、测试用例）由 frontend-ui 接手填充。
>
> **frontend-ui 接手前请确认**：M-2 IPC 4 channel 已完成 + 4 字段 schema 已锁定。

- [ ] **节点 R-1**（⏳ 待 frontend-ui 填充）：新建 `workbench/src/store/vaultSlice.ts`
  - **接口契约**：
    - 持有状态：`vaultConfig: VaultConfigSchema['vaultConfig'] | null`（null = IPC 未返回前的初始态）
    - 应用启动时通过 `window.api.invoke('vault:get-config')` 拉取一次，写入 slice
    - 订阅 `vault:config-changed` 广播，每次广播全量替换 vaultConfig 字段
    - 暴露 selector：`useVaultConfig()` / `useVaultRoot()` / `useQaDir()` / `useProjectsDir()`（后两者派生自 derivedQaDir/derivedProjectsDir 规则，见「数据模型」段）
    - 暴露 action：`async setVaultConfig(patch)` → 透传 `window.api.invoke('vault:set-config', patch)`
  - **R-1 解锁条件**：M-2 完成 + preload `window.api` 类型增补完成
  - **填充责任**：frontend-ui

- [ ] **节点 R-2**（⏳ 待 frontend-ui 填充）：重写 `workbench/src/utils/paths.ts` + 5 个消费方改造
  - **接口契约**：
    - 旧 paths.ts 移除所有 `import.meta.env.VITE_VAULT_*` 引用
    - 新 paths.ts 导出 hook 系：`useBasePath()` / `useProjectsPath()` / `useVaultPath()` 派生自 vaultSlice
    - 非 React 上下文兜底 getter：`getVaultConfigSnapshot()`（直接读 vaultSlice 当前快照）
    - 5 个消费方（ChatView / DetailPanel / useChatSend / agentEventDispatcher / conversationSlice）按 req-063 §4 表格逐一改 import
  - **R-2 解锁条件**：R-1 完成
  - **填充责任**：frontend-ui

- [ ] **节点 R-3**（⏳ 待 frontend-ui 填充）：新建 `<VaultBootGate>` 组件（接口契约骨架）
  - **接口契约**：
    - 挂在 App 入口组件顶层（按实际仓库结构落位，可能为 App.tsx 或 main.tsx 渲染层；实现阶段由 frontend-ui 自行扫描确认实际入口文件名），包裹主界面树
    - 等待 `vaultConfig !== null && vaultConfig.vaultRoot !== ''` 时才渲染 children
    - Loading 期间显示极简占位（product.md「不在本版本范围」明确：空白背景或一行 `Loading Vault config...` 文字，不做品牌 splash）
  - **依赖的 IPC**：通过 vaultSlice 间接消费 `vault:get-config` + `vault:config-changed`
  - **R-3 解锁条件**：R-1 完成
  - **填充责任**：frontend-ui

- [ ] **节点 R-4**（⏳ 待 frontend-ui 填充）：Settings 视图 + Vault 配置分区
  - **接口契约**：
    - Settings 视图作为 P3 工作模式（与对话/工具管理/控制台并列），P1 导航新增 / 复用「设置」入口
    - Vault 配置分区**置顶**（product.md「设计方案 · 3」固化）
    - 字段：vaultRoot（含「选择文件夹」按钮触发 `vault:pick-folder` IPC）/ qaSubdir / projectsSubdir
    - 「检测路径有效性」按钮：renderer 端直接 `await window.api.fsExists(path)` 便捷方法校验三个派生路径（沿用 v0.15.1 既有 preload API 约定，不引入 `invoke('fs:exists', ...)` 第二种风格）
    - **依赖（已就绪）**：preload 已暴露 `fsExists(path: string): Promise<boolean>`，事实佐证 `workbench/electron/preload/index.ts` L54（内部即调 `invoke('fs:exists', { path })`）；M-2 节点**不需要**再补 fsExists——本字段无需新增 IPC channel，复用 v0.15 既有 `fs:exists`
    - 保存按钮：触发 `vault:set-config` IPC（partial patch）
    - **`hasShownFirstLaunchToast` 字段不在 UI 暴露**（lifecycle 内部字段，用户不应感知）
    - **layoutSlice 工作模式枚举扩展（事实对齐 v0.15.1 仓库现状）**：实际字段名为 `currentMode`，setter 为 `setMode`（**非** `setP3Mode`，本 technical.md 全文统一使用真实符号名）。当前枚举为 `'chat' | 'tools' | 'console' | 'decisions' | 'analytics' | 'dashboard'`（v0.15 起累计 6 项），本节点在末尾追加 `'settings'` 形成 7 项；同步更新 `LayoutSlice` interface 的 `currentMode` 字段类型与 `setMode` 形参类型，含所有调用 `setMode(...)` 的位置（含 v0.15.1 既有 ActivityBar 切换入口与本版本 R-5 toast「打开 Settings」联动）。**事实佐证**：`workbench/src/store/layoutSlice.ts` L19 / L24 / L84
    - **settingsSlice 扩展（明确新增字段）**：本节点在既有 `SettingsSlice` interface（当前只持有 `apiKeys` / `cachingEnabled` 数据字段）追加：
      - 字段：`activeSection: 'vault' | 'apikey' | 'theme' | null`（初始 `null`）
      - action：`setActiveSection: (section: 'vault' | 'apikey' | 'theme' | null) => void`
      - **持久化策略：不持久化**（UI 锚点是会话内瞬态状态，不写 localStorage、不写 `write_settings`；下次冷启动复位为 null）。理由：toast 跳转/分区滚动只对当前会话有意义，跨重启再保留反而违反「无打扰」边界
      - `createSettingsSlice` 初始 state 增加 `activeSection: null`
  - **R-4 解锁条件**：R-1 完成；与 R-3 可并行
  - **填充责任**：frontend-ui

- [ ] **节点 R-5**（⏳ 待 frontend-ui 填充）：`<FirstLaunchToast>` 组件
  - **接口契约**：
    - 挂在 App 入口组件顶层（按实际仓库结构落位，可能为 App.tsx 或 main.tsx 渲染层；实现阶段由 frontend-ui 自行扫描确认实际入口文件名），与 VaultBootGate 同级
    - 渲染条件：`vaultConfig.vaultRoot === os.homedir() + '/Workbench-Vault'` 等价的「场景 D 命中」标记（实际通过 `hasShownFirstLaunchToast === false && 触发条件 4` 派生）
    - 渲染时**立即**调 `vault:set-config({ hasShownFirstLaunchToast: true })`（product.md「置位时机说明」严格对齐）
    - 文案 / 样式 / 行为：product.md「Toast 规格」节
    - 「打开 Settings」链接通过 UI store 切换 P3 模式 + 设置 `settingsActiveSection: 'vault'`
  - **依赖的 IPC**：`vault:set-config`
  - **R-5 解锁条件**：R-1 完成 + R-4 完成（依赖 settingsSlice.activeSection action）；与 R-3 可并行
  - **填充责任**：frontend-ui（r1 已填充，见下方完整实现章节）

<!-- 以下 R-1 ~ R-5 完整实现章节由 frontend-ui 在 r1 填充，覆盖上方接口契约骨架 -->

#### r1 填充 · R-1 ~ R-5 完整实现章节

> **跨节点共用类型导入约定**：所有 R-x 节点对 `VaultConfigSchema['vaultConfig']` 的类型引用，统一从 preload 暴露的 `window.api` 类型定义间接获取（或新建 `src/types/vault.ts` 复刻该类型，与 main 进程 `electron/store/vaultStore.ts` 保持单源对齐）。本 technical.md 推荐落位：**新建 `workbench/src/types/vault.ts`**，导出 `VaultConfig` 类型别名（即 `VaultConfigSchema['vaultConfig']`），main 与 renderer 各自从自身一侧导入，保证类型一致但模块物理隔离。

- [x] **节点 R-1 实现**：新建 `workbench/src/store/vaultSlice.ts` 并接入根 store
  - 文件路径：
    - 新建 `workbench/src/store/vaultSlice.ts`
    - 修改 `workbench/src/store/index.ts`（追加 VaultSlice 到 `StoreState` 并入 `useStore`）
    - 新建 `workbench/src/types/vault.ts`（导出 `VaultConfig` 类型别名）
  - 状态字段：
    ```ts
    interface VaultSlice {
      vaultConfig: VaultConfig | null   // null = IPC 未返回前的初始态（VaultBootGate 据此判定 loading）
      vaultConfigError: string | null   // 末次 IPC 调用错误信息（用于 Settings UI 显示，便于排错）
      // M-4 § fallback 信息透传：用于 R-4 Settings 显示 warning bar
      vaultFallbackInfo: { used: boolean; reason: string } | null   // null 表示尚未拿到信息（init 前）
      // R-5 § 条件来源标记：M-4 仅在条件 4（全新安装）命中时通过广播附带 'fresh-install'，
      // R-1 接收并写入此瞬态字段；R-5 据此判定是否激活 toast。其他场景为 null。
      lastVaultTriggerSource: 'fresh-install' | null
      initVault: () => Promise<void>    // 启动时调用一次，幂等
      setVaultConfig: (patch: Partial<VaultConfig>) => Promise<void>  // 透传 vault:set-config IPC
      __applyVaultConfig: (config: VaultConfig) => void  // 内部 action，仅被 IPC 广播订阅与 init 调用
      __applyFallbackInfo: (info: { used: boolean; reason: string }) => void  // 内部 action
      __applyTriggerSource: (source: 'fresh-install' | null) => void  // 内部 action
    }
    ```
  - 实现要点：
    1. **初始 state**：`vaultConfig: null`、`vaultConfigError: null`、`vaultFallbackInfo: null`、`lastVaultTriggerSource: null`
    2. **`initVault()` 实现**：
       - 幂等：若 `get().vaultConfig !== null` 直接 return（避免 React StrictMode 双调用 / hot reload 重复拉取）
       - 调用 `window.api.invoke<VaultConfig & { __fallbackInfo?: { used: boolean; reason: string } }>('vault:get-config')`，成功时拆解 `__fallbackInfo`：`set({ vaultConfig: config, vaultConfigError: null, vaultFallbackInfo: __fallbackInfo ?? { used: false, reason: '' } })`；catch 时 `set({ vaultConfigError: String(e) })`
       - 注意：M-3 已保证窗口创建时 main 进程 vault store 必非空，理论上 IPC 不会 reject；catch 仅为防御性兜底
       - initVault 本身**不设置 `lastVaultTriggerSource`**——该字段仅通过 vault:config-changed 广播补偿路径接收，避免普通启动（条件 1-3）误触发
    3. **`setVaultConfig(patch)` 实现**：
       - 调用 `window.api.invoke<VaultConfig>('vault:set-config', patch)`，成功后 `set({ vaultConfig: updated, vaultConfigError: null })`
       - 错误处理同上；UI 层（R-4）捕获 reject 后显示 inline error
       - 注意：M-2 的 `vault:set-config` handler 写完 store 后也会广播 `vault:config-changed`，本 slice 通过订阅广播也会再次收到同样 payload——此为预期幂等
    4. **`__applyVaultConfig(config)`**：纯 `set({ vaultConfig: config })`，用于广播订阅
    5. **广播订阅（统一走既有 `window.api.listen`，不引入新便捷方法）**：slice 模块加载时（即 `createVaultSlice` 内的副作用 init 函数）调用：
       ```ts
       window.api.listen<{
         config: VaultConfig;
         fallbackUsed?: boolean;
         fallbackReason?: string;
         triggerSource?: 'fresh-install';
       }>(
         'vault:config-changed',
         (event) => {
           const state = useStore.getState()
           state.__applyVaultConfig(event.payload.config)
           if (event.payload.fallbackUsed !== undefined) {
             state.__applyFallbackInfo({
               used: event.payload.fallbackUsed,
               reason: event.payload.fallbackReason ?? '',
             })
           }
           if (event.payload.triggerSource) {
             state.__applyTriggerSource(event.payload.triggerSource)
           }
         }
       )
       ```
       - **事实对齐 preload 现状**：`workbench/electron/preload/index.ts` L43-50 已暴露 `window.api.listen<T>(eventName, handler)`，handler 接收 `{ payload: T }`（与 Tauri listen 语义一致，v0.15 既有 `workspace:changed` 即用此通道）。**M-2 节点不需要在 preload 新增 `onVaultConfigChanged` 便捷方法**——v0.15 listen 通道已足够
       - listen 返回 `Promise<() => void>`（unsubscribe），在测试 teardown / hot reload 时清理；生产环境 App 生命周期内不取消
    6. **派生 selector hook 导出**（同文件内联）：
       ```ts
       export function useVaultConfig() { return useStore((s) => s.vaultConfig) }
       export function useVaultRoot() { return useStore((s) => s.vaultConfig?.vaultRoot ?? '') }
       export function useQaSubdir() { return useStore((s) => s.vaultConfig?.qaSubdir ?? 'QA') }
       export function useProjectsSubdir() { return useStore((s) => s.vaultConfig?.projectsSubdir ?? 'Projects') }
       export function useHasShownFirstLaunchToast() { return useStore((s) => s.vaultConfig?.hasShownFirstLaunchToast ?? false) }
       ```
    7. **非 React 上下文 getter**（同文件导出，供 R-2 paths.ts 的 getter 直接调用，避免在 agentEventDispatcher 等非组件中调 React hook）：
       ```ts
       export function getVaultConfigSnapshot(): VaultConfig | null {
         return useStore.getState().vaultConfig
       }
       ```
    8. **错误状态 selector**：`export function useVaultConfigError() { return useStore((s) => s.vaultConfigError) }`（R-4 Settings 用）
  - **App 入口组件启动调用**：在 App 入口组件（按实际仓库结构落位，可能为 `workbench/src/App.tsx` 或 `workbench/src/main.tsx` 渲染层；实现阶段由 frontend-ui 自行扫描确认实际入口文件名）添加 `useEffect(() => { useStore.getState().initVault() }, [])`——R-3 VaultBootGate 内挂载也可，二选一不重复（避免双调用，幂等已兜底）。**统一约定**：本节点选择在 **VaultBootGate 内 useEffect** 调用，App 入口组件不重复调
  - **`index.ts` 合入**：在 `StoreState` 类型并集追加 `& VaultSlice`，在 `create()` body 追加 `...createVaultSlice(...a)`
  - 完成标志：
    - `pnpm tsc --noEmit` 零错误
    - DevTools 中 `useStore.getState().vaultConfig` 在应用启动后非 null
    - 在 main 进程 console 调 `setVaultConfig({...})` 触发广播后，renderer store 字段实时更新（React DevTools 可见）
    - 单元测试 T-V016-R1.1 ~ R1.4 通过（详见「测试清单 · renderer 单元测试」）

- [x] **节点 R-2 实现**：重写 `workbench/src/utils/paths.ts` + 5 个消费方改造
  - **R-2.1 重写 `workbench/src/utils/paths.ts`**：
    - 删除：所有 `import.meta.env.VITE_VAULT_*` 引用 + `BASE_PATH` / `PROJECTS_PATH` / `VAULT_PATH` 三个静态常量 + 旧 `toFilePath(id)` 单参数函数
    - 新导出（hook 系 + getter 系 + 纯函数；路径派生规则严格对齐「数据模型 · Derived Path 派生规则」）：
      ```ts
      import { useStore } from '../store'
      import { getVaultConfigSnapshot } from '../store/vaultSlice'
      import type { VaultConfig } from '../types/vault'

      // 内部纯函数：派生 QA 目录绝对路径
      function deriveQaDir(config: VaultConfig | null): string {
        if (!config || !config.vaultRoot) return ''
        const sub = config.qaSubdir || 'QA'
        const isAbsolute = sub.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(sub)
        return isAbsolute ? sub : `${config.vaultRoot}/${sub}`
      }
      function deriveProjectsDir(config: VaultConfig | null): string {
        if (!config || !config.vaultRoot) return ''
        const sub = config.projectsSubdir || 'Projects'
        const isAbsolute = sub.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(sub)
        return isAbsolute ? sub : `${config.vaultRoot}/${sub}`
      }

      // React hook 系
      export function useVaultPath(): string {
        return useStore((s) => s.vaultConfig?.vaultRoot ?? '')
      }
      export function useBasePath(): string {
        return useStore((s) => deriveQaDir(s.vaultConfig))
      }
      export function useProjectsPath(): string {
        return useStore((s) => deriveProjectsDir(s.vaultConfig))
      }

      // 纯函数（不依赖 hook，可在非 React 上下文用）
      export function buildFilePath(basePath: string, id: string): string {
        if (!basePath || !id) return ''
        return `${basePath}/${id}.md`
      }

      // 非 React 上下文兜底（用于 agentEventDispatcher / conversationSlice 等）
      export function getVaultConfig(): VaultConfig | null {
        return getVaultConfigSnapshot()
      }
      export function getBasePath(): string {
        return deriveQaDir(getVaultConfigSnapshot())
      }
      export function getProjectsPath(): string {
        return deriveProjectsDir(getVaultConfigSnapshot())
      }
      export function getVaultPath(): string {
        return getVaultConfigSnapshot()?.vaultRoot ?? ''
      }

      // 兼容旧调用约定的纯函数（少数地方传 id 即可生成全路径，简化迁移）
      // 仅供 getter 上下文调用；React 组件应优先用 useBasePath() + buildFilePath()
      export function toFilePathFromSnapshot(id: string): string {
        return buildFilePath(getBasePath(), id)
      }
      ```
    - **设计说明**：导出双轨——hook 给 React 组件 / getter 给非 React 上下文。`buildFilePath(basePath, id)` 是纯函数，所有「id → 完整文件路径」拼接统一走它，路径分隔符固化为 `/`（与 v0.15 既有 `toFilePath` 行为一致；POSIX/Windows 兼容由 main 进程 `fs.readFile` 自动归一化处理）
    - **关键删除**：旧 `toFilePath(id)` 单参数函数**完全移除**——它依赖模块级 `BASE_PATH` 常量，在运行期模型下无法存在。消费方必须改为 `buildFilePath(basePath, id)`（双参数显式传入）或 `toFilePathFromSnapshot(id)`（在非 React 上下文兜底）
  - **R-2.2 ChatView.tsx 改造**（`workbench/src/components/ChatView/ChatView.tsx`）：
    - 删除 `import { toFilePath, VAULT_PATH, BASE_PATH } from '../../utils/paths'`
    - 改为 `import { useBasePath, useVaultPath, buildFilePath } from '../../utils/paths'`
    - 组件顶部 `const basePath = useBasePath(); const vaultPath = useVaultPath()`
    - 第 34 行 `description: \`Vault 根目录，默认 ${VAULT_PATH}\`` → 改为 `description: \`Vault 根目录，默认 ${vaultPath}\``
    - 第 91 / 209 / 356 / 545 行 `toFilePath(x)` → `buildFilePath(basePath, x)`
    - 第 521 行 `qaDir: BASE_PATH` → `qaDir: basePath`
    - **依赖追踪**：第 91 行在 useCallback / useEffect 内时需将 basePath 加入依赖数组
  - **R-2.3 DetailPanel.tsx 改造**（`workbench/src/components/DetailPanel/DetailPanel.tsx`）：
    - 删除 `import { toFilePath } from '../../utils/paths'`
    - 改为 `import { useBasePath, buildFilePath } from '../../utils/paths'`
    - 组件顶部 `const basePath = useBasePath()`
    - 第 30 行 `filePath: toFilePath(selectedAtomId)` → `filePath: buildFilePath(basePath, selectedAtomId)`
    - useEffect 依赖加 basePath
  - **R-2.4 useChatSend.ts 改造**（`workbench/src/hooks/useChatSend.ts`）：
    - 删除 `import { toFilePath, VAULT_PATH, BASE_PATH } from '../utils/paths'` 与 `void VAULT_PATH`
    - 改为 `import { useBasePath, useVaultPath, buildFilePath } from '../utils/paths'`
    - hook 顶部 `const basePath = useBasePath(); const vaultPath = useVaultPath()`（vaultPath 当前用于工具 schema 默认值，保留以备未来用）
    - 第 82 / 162 / 293 行 `toFilePath(x)` → `buildFilePath(basePath, x)`
    - 第 275 行 `qaDir: BASE_PATH` → `qaDir: basePath`
    - 第 53-54 行 `void VAULT_PATH` 注释移除
    - **非 React 上下文边界**：useChatSend 是 hook，本身在 React 上下文；但内部若有 `useCallback` 派生的工厂函数被传给非 React 模块（如直接传给 worker / agentEventDispatcher），传入时需把 basePath 一并 closure 捕获——按需检查
  - **R-2.5 agentEventDispatcher.ts 改造**（`workbench/src/lib/agentEventDispatcher.ts`，非 React 上下文）：
    - 删除 `import { toFilePath } from '../utils/paths'`
    - 改为 `import { toFilePathFromSnapshot } from '../utils/paths'`
    - 第 369 行 `return toFilePath(atomId)` → `return toFilePathFromSnapshot(atomId)`
    - **comment 字面量同步更新**：
      - 第 359 行注释含 `toFilePath` 字面量 → 改为 `toFilePathFromSnapshot`
      - 第 360 行注释含 `VITE_VAULT_QA_PATH` 字面量 → 改为 `vaultConfig.qaSubdir`（同步删除「指向 `07-AI知识库/L1-原始对话/QA`」这种打包者个人路径的 historical context；或在该位置改写为「`vaultConfig.qaSubdir`（运行期由用户配置）」）
      - 第 365 行同上 `toFilePath` → `toFilePathFromSnapshot`
    - **运行期保证**：dispatcher 在 vaultConfig 初始化之后才会被触发（VaultBootGate 保证），snapshot 必非 null；防御性 `toFilePathFromSnapshot` 内部已通过 `getBasePath()` 兜底返回空字符串
    - **与 OSS 零泄露原则的交叉验证**：comment 第 360 行原含「07-AI知识库」字符串本身**不是用户家目录前缀**，扫描脚本不会命中；但保留它在 dispatcher 注释中违背了 OSS 化精神。本次清理直接消除该字面量，与 scan-personal-paths.mjs 「严格大于宽松」初版策略一致
  - **R-2.6 conversationSlice.ts 改造**（`workbench/src/store/conversationSlice.ts`，Zustand slice 内部）：
    - 删除 `import { BASE_PATH, PROJECTS_PATH } from '../utils/paths'`
    - 改为 `import { getBasePath, getProjectsPath } from '../utils/paths'`
    - 第 112 行 `conversationDir: BASE_PATH` → `conversationDir: getBasePath()`
    - 第 186 / 193 / 205 行 `projectsDir: PROJECTS_PATH` → `projectsDir: getProjectsPath()`
    - **设计偏移说明（与 req-063 §4「Zustand slice 内可直接 useVaultStore.getState()」偏离）**：本 technical.md 选择**统一走 paths.ts 的 getter 包装层（`getBasePath()/getProjectsPath()` 内部已调 `getVaultConfigSnapshot()`）**，不让消费方直接读 store 结构。理由：① paths.ts 是 vault 派生路径的唯一权威源，把 deriveQaDir / deriveProjectsDir 派生规则封闭在 paths.ts 一处，未来 schema 字段名/派生规则变更只改 paths.ts；② 消费方不依赖 store 结构，反过来允许 vaultSlice 内部自由重构；③ 与 R-2.5 agentEventDispatcher.ts 的 `toFilePathFromSnapshot` 同款模式，统一非 React 上下文调用风格
    - **运行期保证**：所有 `getBasePath()/getProjectsPath()` 调用都发生在 slice action 内（非模块加载时），保证 vaultSlice 已 init；防御性内部已对 null 兜底
  - **R-2.7 测试文件 mock 更新**：
    - `workbench/src/components/ChatViewV2/__tests__/QABlock.test.tsx` 第 20-21 行的 `vi.mock('../../utils/paths', ...)` 旧 mock key（`BASE_PATH` / `PROJECTS_PATH`）替换为新导出：暴露 `getBasePath: () => '/mock/base'`、`getProjectsPath: () => '/mock/projects'`、`buildFilePath: (b, i) => \`${b}/${i}.md\``、`useBasePath: () => '/mock/base'`、`useProjectsPath: () => '/mock/projects'` 等按测试需求
    - `workbench/src/store/__tests__/conversationSlice.test.ts` 第 11-12 行同上更新 mock
    - 其他测试文件如 grep 出 `BASE_PATH|PROJECTS_PATH|VAULT_PATH|toFilePath` 字面量也一并替换
  - 完成标志：
    - `pnpm tsc --noEmit` 零错误（旧常量删除后无遗漏引用）
    - `pnpm test` 全量通过（包括上述两个 mock 文件更新后的测试）
    - 手动启动 dev：选定 atom、读取详情、发送消息、创建分叉 4 个核心路径无回归
    - grep 全仓 `import.meta.env.VITE_VAULT_` 命中数为 0
    - grep 全仓 `\bBASE_PATH\b|\bPROJECTS_PATH\b|\bVAULT_PATH\b|\btoFilePath\b` 命中数为 0（test mock 内的 mock key 可保留，但不应再有静态常量引用）

- [x] **节点 R-3 实现**：新建 `<VaultBootGate>` 组件
  - 文件路径：`workbench/src/components/VaultBootGate.tsx`（新建）
  - 修改文件：App 入口组件（按实际仓库结构落位，可能为 `workbench/src/App.tsx` 或 `workbench/src/main.tsx` 渲染层；实现阶段由 frontend-ui 自行扫描确认实际入口文件名），在 App 根渲染中包裹 VaultBootGate
  - 组件签名与逻辑（实现伪代码）：
    ```tsx
    import { useEffect } from 'react'
    import { useStore } from '../store'
    import { useVaultConfig, useVaultConfigError } from '../store/vaultSlice'

    export function VaultBootGate({ children }: { children: React.ReactNode }) {
      const config = useVaultConfig()
      const error = useVaultConfigError()

      useEffect(() => {
        // 幂等：vaultSlice.initVault 内部已有 vaultConfig !== null 短路
        useStore.getState().initVault()
      }, [])

      if (config === null) {
        return (
          <div
            role="status"
            aria-live="polite"
            className="vault-boot-gate-loading"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100vh',
              color: 'var(--text-2)',
              fontFamily: 'var(--font-ui)',
              fontSize: '14px',
              background: 'var(--bg)',
            }}
          >
            {error ? `Vault 配置加载失败：${error}` : 'Loading Vault config...'}
          </div>
        )
      }
      // config 非 null 即放行；vaultRoot 即使为空（极端 M-4 fallback 失败）也允许进入，
      // 让用户能进 Settings 手动配置（避免死锁）
      return <>{children}</>
    }
    ```
  - **挂载位置**：App 入口组件渲染树最外层（按实际仓库结构落位，可能为 App.tsx 或 main.tsx 渲染层；实现阶段由 frontend-ui 自行扫描确认）
    ```tsx
    return (
      <VaultBootGate>
        <FirstLaunchToast />
        <MainLayout />
      </VaultBootGate>
    )
    ```
  - **Loading UI 边界**（product.md「不在本版本范围」明确）：
    - 不做 splash 屏 / 启动动画 / 品牌 logo / loading spinner
    - 仅一行文字 + 居中 + 主题色背景
    - 错误态显示明确错误信息（便于用户截图反馈），不弹 modal
  - **可访问性**：`role="status"` + `aria-live="polite"` 让屏幕阅读器宣告 loading 状态
  - 完成标志：
    - 启动应用瞬间可观察到 Loading 文字闪现（mock IPC 慢响应 / 测试时延迟 IPC 返回可固定观察到）
    - IPC 返回后渲染主界面，无白屏 / 闪烁
    - 组件单元测试 T-V016-R3.1 / R3.2 通过

- [❌] **节点 R-4 实现** · **已撤销**（v0.16 doc_rev=11 / 2026-06-08 用户决策，详见 [[changelog/v0.16/product]] doc_rev=9）：
  > **撤销原因**：用户在 QA 阶段澄清「Vault 配置统一放到原本的 setting 里面」——即既有 NavIcons SettingsPanel overlay（齿轮按钮弹窗，v0.15.1 实装，含 API Keys / Theme / 服务器配置），不再新建独立 P3 视图。
  > **撤销范围**：
  >   - 删除 `workbench/src/components/Settings/SettingsView.tsx`（独立视图容器）
  >   - 撤销 layoutSlice `currentMode` 的 'settings' 枚举扩展（回到 6 项）
  >   - 撤销 settingsSlice `activeSection` 字段；替换为 `settingsPanelOpen: boolean` + `settingsActiveSection: 'vault' | 'apikey' | 'theme' | null`（双字段：前者控制 SettingsPanel overlay 可见性，后者控制分区锚点；供 R-5 联动）
  > **保留资产**：`VaultConfig.tsx` 组件仍在，但重塑为简化版（仅 vault 根目录字段，砍 QA/Projects 子目录 UI）并塞入 NavIcons SettingsPanel overlay 首分区，详见后续 commit `feat(v0.16): Vault 配置塞进 SettingsPanel overlay 作为首分区`。
  > **替代节点见下方 R-4'**；下方原 R-4 实现章节归档不删，作为决策考古资料。

- [x] **节点 R-4' 实现**（doc_rev=11 替代节点）：Vault 配置塞进 SettingsPanel overlay 首分区
  - **设计来源**：product.md doc_rev=10「设计方案 · 3 既有 SettingsPanel overlay 新增「Vault 配置」分区（置顶为第一分区）」+「验收标准 · 5 SettingsPanel overlay Vault 配置分区」
  - **文件改动**：
    - 修改 `workbench/src/components/SettingsPanel.tsx`（v0.15.1 既有 overlay 容器，齿轮按钮触发）：在既有分区（API Keys / Theme / 服务器配置）**之上**插入 Vault 配置分区作为首项
    - 复用 `workbench/src/components/Settings/VaultConfig.tsx`（R-4 归档章节已建组件），但重塑为简化版：
      - **保留字段**：`vaultRoot` 输入框 + 「选择文件夹」按钮（触发 `vault:pick-folder` IPC）+ 「检测路径有效性」按钮 + 保存按钮
      - **删除字段（UI 不渲染）**：qaSubdir input / projectsSubdir input（hardcode 默认 `'QA'` / `'Projects'` 由 electron-store schema defaults 自动生效，vaultStore 内字段保留，UI 不暴露）
      - 表单校验：仅 `vaultRoot.trim() !== ''` 一项
  - **分区顺序固化**（与 product.md L144-150 严格对齐）：
    1. **Vault 配置**（本节点新增 · 置顶）
    2. API Keys（v0.15.1 已存在）
    3. Theme（v0.15.1 已存在）
    4. 服务器配置（v0.15.1 已存在）
  - **settingsSlice 双字段扩展**（替代 doc_rev 5~10 的 `activeSection` 单字段）：
    - `settingsPanelOpen: boolean`（初始 false，控制 SettingsPanel overlay 整体可见性；FirstLaunchToast「打开 Settings」联动 set true）
    - `settingsActiveSection: 'vault' | 'apikey' | 'theme' | null`（初始 null，控制分区锚点；SettingsPanel 组件初始化时根据该字段 scrollIntoView 到对应分区）
    - 两字段均**不持久化**（UI 锚点是会话内瞬态状态，与原 R-4 归档节点 activeSection 持久化策略一致）
    - action：`setSettingsPanelOpen(open)` / `setSettingsActiveSection(section)`
  - **FirstLaunchToast 联动改动（影响 R-5 实现）**：
    - 原 R-5 实现 L955-960 `store.setMode('settings')` + `store.setActiveSection('vault')` 同步替换为：
      ```ts
      store.setSettingsPanelOpen(true)
      store.setSettingsActiveSection('vault')
      ```
    - 不再切换 layoutSlice.currentMode（保持当前工作模式不变，仅弹出 overlay）
  - **完成标志**：
    - SettingsPanel overlay 内 Vault 配置分区出现在首位（DOM 顺序 + 视觉顺序均置顶）
    - 不存在独立 P3 SettingsView 视图（layoutSlice currentMode 枚举回到 6 项，无 'settings'）
    - qaSubdir / projectsSubdir 输入框 DOM 不渲染（对应 product.md 验收 §5 第 4 条 + T-V016-R4'.4 回归用例）
    - vaultStore 内 qaSubdir / projectsSubdir 字段值在初始化时被 electron-store schema defaults 自动写为 `'QA'` / `'Projects'`（M-1 节点 L177 已声明）
    - FirstLaunchToast 「打开 Settings」点击后 SettingsPanel overlay 弹出 + 自动滚动到 Vault 分区
    - `pnpm test` 通过（含 T-V016-R4'.1~R4'.4 替代用例）
  - **测试用例**（替代原 T-V016-R4.1~R4.6）：
    - **T-V016-R4'.1** SettingsPanel overlay 分区顺序：渲染 SettingsPanel，断言子分区 DOM 顺序为 Vault → API Keys → Theme → 服务器配置
    - **T-V016-R4'.2** VaultConfig 简化字段渲染：渲染 VaultConfig，断言 DOM 含 `vault-root` input + 「选择文件夹」按钮 + 「检测路径有效性」按钮 + 保存按钮；**断言不含** `qa-subdir` / `projects-subdir` 任何 input
    - **T-V016-R4'.3** VaultConfig 校验仅 vaultRoot 必填：清空 vault-root 后点保存，DOM 含 `Vault 根目录不能为空` 错误；填入任意值后保存成功
    - **T-V016-R4'.4** settingsSlice 双字段联动：调 `setSettingsPanelOpen(true)` + `setSettingsActiveSection('vault')`，断言 store 字段值正确；spy SettingsPanel scrollIntoView 被调用 ID `settings-section-vault`
    - **T-V016-R4'.5** FirstLaunchToast「打开 Settings」联动：点击链接后 spy `setSettingsPanelOpen('true')` + `setSettingsActiveSection('vault')` 各被调用一次；layoutSlice.setMode **不被调用**（验证不切 P3 模式）

- [x] **节点 R-4 实现**（历史归档 · 已撤销，见上方说明）：Settings 视图 + 「Vault 配置」分区（置顶）
  - 新建文件：`workbench/src/components/Settings/VaultConfig.tsx`
  - 修改文件：`workbench/src/components/Settings/SettingsView.tsx`（如已存在则插入分区为第一项；不存在则同时新建容器）
  - **Settings 视图容器（SettingsView）实现要点**（若 v0.15 / v0.15.1 已有则只插入分区）：
    - 作为 P3 主工作区的一种工作模式（与对话 / 工具管理 / 控制台并列）
    - 分区顺序固化：[1] VaultConfig（置顶 · 本节点新增）→ [2] API Keys（v0.15.1 已有）→ [3] Theme（v0.15.1 已有）→ [4] 其他
    - 支持 `settingsActiveSection?: string` prop / store 字段（来自 settingsSlice），初始化时若值为 `'vault'` 则 scrollIntoView 到 VaultConfig 锚点（`id="settings-section-vault"`）
    - **settingsSlice 扩展**：新增 `activeSection: 'vault' | 'apikey' | 'theme' | string | null` 字段 + `setActiveSection(section)` action；初始 null
  - **VaultConfig 组件实现要点**（核心代码骨架）：
    ```tsx
    import { useState, useEffect } from 'react'
    import { useVaultConfig, useVaultConfigError } from '../../store/vaultSlice'
    import { useStore } from '../../store'

    export function VaultConfig() {
      const config = useVaultConfig()
      const error = useVaultConfigError()
      // 受控表单本地态（与 store 解耦，保存时才透写 store）
      const [vaultRoot, setVaultRoot] = useState(config?.vaultRoot ?? '')
      const [qaSubdir, setQaSubdir] = useState(config?.qaSubdir ?? 'QA')
      const [projectsSubdir, setProjectsSubdir] = useState(config?.projectsSubdir ?? 'Projects')
      const [formError, setFormError] = useState<string | null>(null)
      const [validating, setValidating] = useState(false)
      const [validateResult, setValidateResult] = useState<string | null>(null)
      const [saving, setSaving] = useState(false)

      // config 外部变化（IPC 广播 / 多窗口同步）时刷新本地态
      useEffect(() => {
        if (config) {
          setVaultRoot(config.vaultRoot)
          setQaSubdir(config.qaSubdir)
          setProjectsSubdir(config.projectsSubdir)
        }
      }, [config])

      async function handlePickFolder() {
        const result = await window.api.invoke<string | null>('vault:pick-folder', {
          title: '选择 Vault 根目录',
        })
        if (result) setVaultRoot(result)
      }

      function validateForm(): string | null {
        if (!vaultRoot.trim()) return 'Vault 根目录不能为空'
        if (qaSubdir.includes('..')) return 'QA 子目录不能含 ".." 段'
        if (projectsSubdir.includes('..')) return 'Projects 子目录不能含 ".." 段'
        return null
      }

      async function handleValidate() {
        const err = validateForm()
        if (err) { setValidateResult(`表单错误：${err}`); return }
        setValidating(true)
        setValidateResult(null)
        try {
          const isAbsoluteQa = qaSubdir.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(qaSubdir)
          const isAbsoluteProj = projectsSubdir.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(projectsSubdir)
          const qaDir = isAbsoluteQa ? qaSubdir : `${vaultRoot}/${qaSubdir}`
          const projDir = isAbsoluteProj ? projectsSubdir : `${vaultRoot}/${projectsSubdir}`
          const targets = [
            { label: 'Vault 根目录', path: vaultRoot },
            { label: 'QA 目录', path: qaDir },
            { label: 'Projects 目录', path: projDir },
          ]
          const results: string[] = []
          for (const t of targets) {
            const exists = await window.api.fsExists(t.path)
            results.push(`${exists ? '✓' : '✗'} ${t.label}：${t.path}`)
          }
          setValidateResult(results.join('\n'))
        } catch (e) {
          setValidateResult(`检测失败：${String(e)}`)
        } finally {
          setValidating(false)
        }
      }

      async function handleSave() {
        const err = validateForm()
        if (err) { setFormError(err); return }
        setFormError(null)
        setSaving(true)
        try {
          await useStore.getState().setVaultConfig({
            vaultRoot: vaultRoot.trim(),
            qaSubdir: qaSubdir.trim() || 'QA',
            projectsSubdir: projectsSubdir.trim() || 'Projects',
          })
        } catch (e) {
          setFormError(`保存失败：${String(e)}`)
        } finally {
          setSaving(false)
        }
      }

      return (
        <section id="settings-section-vault" className="settings-section vault-config">
          <h2>Vault 配置</h2>
          <div className="form-row">
            <label htmlFor="vault-root">Vault 根目录</label>
            <input id="vault-root" type="text" value={vaultRoot} readOnly />
            <button type="button" onClick={handlePickFolder}>选择文件夹</button>
          </div>
          <div className="form-row">
            <label htmlFor="qa-subdir">QA 子目录</label>
            <input
              id="qa-subdir"
              type="text"
              value={qaSubdir}
              onChange={(e) => setQaSubdir(e.target.value)}
              placeholder="相对子目录名（推荐）或绝对路径"
            />
          </div>
          <div className="form-row">
            <label htmlFor="projects-subdir">Projects 子目录</label>
            <input
              id="projects-subdir"
              type="text"
              value={projectsSubdir}
              onChange={(e) => setProjectsSubdir(e.target.value)}
              placeholder="相对子目录名（推荐）或绝对路径"
            />
          </div>
          <div className="form-actions">
            <button type="button" onClick={handleValidate} disabled={validating}>
              {validating ? '检测中...' : '检测路径有效性'}
            </button>
            <button type="button" onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
          {formError && <div className="form-error" role="alert">{formError}</div>}
          {validateResult && <pre className="validate-result">{validateResult}</pre>}
          {error && <div className="store-error">最近一次 IPC 错误：{error}</div>}
        </section>
      )
    }
    ```
  - **样式 Token 引用**（不写新 Token，仅复用 v0.15 已有）：
    - 文本：`--text-1` / `--text-2`
    - 边框：`--bd`
    - 表面：`--surface`
    - 输入框 / 按钮：复用 v0.15 既有 Settings 表单样式类（如 `.settings-section` / `.form-row`）
  - **`hasShownFirstLaunchToast` 字段不在 UI 暴露**——product.md 明确约束，本节点不渲染该字段
  - **`fsExists` 便捷方法**：v0.15.1 既有 preload API 约定（renderer 端已有 `window.api.fsExists(path)` 调用，见 paths.ts 消费方），本节点统一使用该便捷方法形式（不引入 `invoke('fs:exists', ...)` 第二种风格）。**兜底**：若 tauri-platform 在 M-2 实现时发现 v0.15.1 并未暴露 `fsExists`，由 M-2 在 preload 同步补齐 `fsExists(path: string): Promise<boolean>`
  - **「打开 Settings」联动入口**（R-5 toast 触发后需要滚动到本分区）：
    - VaultConfig 容器加 `id="settings-section-vault"`
    - SettingsView 监听 `activeSection` 变化触发 `document.getElementById('settings-section-vault')?.scrollIntoView()`
  - 完成标志：
    - 表单可填写、选目录、保存、读取
    - 表单校验：vaultRoot 为空时点保存显示错误；子目录含 `..` 时同样
    - 「检测路径有效性」点击后显示三行结果
    - 保存后 Zustand store 实时更新，所有消费方（ChatView / DetailPanel）立即生效（无需重启）
    - Settings 内 Vault 分区置顶（首屏可见）
    - 组件单元测试 T-V016-R4.1 ~ R4.4 通过

- [x] **节点 R-5 实现**：`<FirstLaunchToast>` 组件
  - 文件路径：`workbench/src/components/FirstLaunchToast.tsx`（新建）
  - 挂载位置：App 入口组件渲染树（按实际仓库结构落位，可能为 App.tsx 或 main.tsx 渲染层；实现阶段由 frontend-ui 自行扫描确认），VaultBootGate 内部、主界面之前
    ```tsx
    <VaultBootGate>
      <FirstLaunchToast />
      <MainLayout />
    </VaultBootGate>
    ```
  - 组件实现要点：
    ```tsx
    import { useEffect, useState, useRef } from 'react'
    import { useVaultConfig } from '../store/vaultSlice'
    import { useStore } from '../store'

    const TOAST_AUTO_DISMISS_MS = 5000  // product.md 「Toast 规格」自动 5 秒淡出

    export function FirstLaunchToast() {
      const config = useVaultConfig()
      // 「本会话内已激活」锁：一旦在本次进程内决定显示 toast，
      // 即使后续 store 中 hasShownFirstLaunchToast 被置位 true（广播回来），
      // 也不能让组件因 store 字段反转而立即 unmount——
      // 否则 toast 几乎在 IPC 广播返回的瞬间消失，「自动 5 秒淡出」做不到。
      const activatedRef = useRef(false)
      const [visible, setVisible] = useState(false)

      // 渲染决策来源（仅在 activatedRef 未触发前依赖 store；触发后由 visible 主导）：
      // 关键：必须同时验证「条件 4 命中（全新安装）」语义——
      // 仅 hasShownFirstLaunchToast === false 不足（场景 B / C 该字段也是 false 但 product.md 明确不弹 toast）。
      // 通过 lastVaultTriggerSource === 'fresh-install' 判定来源（M-4 广播时附带，R-1 vaultSlice 接收并写入瞬态字段）。
      const triggerSource = useStore((s) => s.lastVaultTriggerSource)
      const shouldActivate =
        !activatedRef.current &&
        config !== null &&
        config.hasShownFirstLaunchToast === false &&
        triggerSource === 'fresh-install'

      useEffect(() => {
        if (!shouldActivate) return
        activatedRef.current = true
        setVisible(true)
        useStore.getState().setVaultConfig({ hasShownFirstLaunchToast: true }).catch((e) => {
          console.error('[FirstLaunchToast] 置位失败:', e)
          // IPC 失败也不重弹本会话（activatedRef 已锁）；下次启动 store 为 false 会再弹一次
        })
        const timer = setTimeout(() => setVisible(false), TOAST_AUTO_DISMISS_MS)
        return () => clearTimeout(timer)
      }, [shouldActivate])

      // 仅当从未激活也不应激活 + 不可见时返回 null。
      // 已激活后 visible 单独主导生命周期，不受 store 字段反转影响。
      if (!activatedRef.current && !shouldActivate) return null
      if (!visible) return null

      const vaultRoot = config?.vaultRoot ?? ''

      function handleOpenSettings() {
        const store = useStore.getState()
        // 事实对齐 layoutSlice.ts L24/L84：setter 真实名为 setMode，枚举本版本扩展 'settings'
        store.setMode('settings')
        // settingsSlice.activeSection 由 R-4 节点扩展；toast 不需要类型守卫，
        // R-4 完成是 R-5 的硬依赖（R-5 解锁条件已声明 R-1 即可，但语义上 setActiveSection 由 R-4 落地，
        // 二者必须由 frontend-ui 在同一 PR 中同时合入，文档不再使用 typeof 守卫绕过编译期）
        store.setActiveSection('vault')
        setVisible(false)
      }

      return (
        <div
          role="status"
          aria-live="polite"
          className="first-launch-toast"
          style={{
            position: 'fixed',
            right: '24px',
            bottom: '24px',
            zIndex: 9999,
            background: 'var(--surface)',
            color: 'var(--text-1)',
            border: '1px solid var(--bd)',
            borderRadius: '8px',
            padding: '12px 16px',
            maxWidth: '420px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            fontFamily: 'var(--font-ui)',
            fontSize: '13px',
            lineHeight: '1.5',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
          }}
        >
          <div style={{ flex: 1 }}>
            已在 <code>{vaultRoot}</code> 创建默认 Vault，可在{' '}
            <button
              type="button"
              onClick={handleOpenSettings}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--accent)',
                cursor: 'pointer',
                padding: 0,
                font: 'inherit',
                textDecoration: 'underline',
              }}
            >
              Settings → Vault 配置
            </button>
            {' '}中重新设定。
          </div>
          <button
            type="button"
            onClick={() => setVisible(false)}
            aria-label="关闭通知"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-2)',
              fontSize: '16px',
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        </div>
      )
    }
    ```
  - **lifecycle 一次保证机制（三道防线，修订为「激活锁 + 本地可见态」双轨）**：
    1. 跨重启权威源：`config.hasShownFirstLaunchToast` 持久化字段决定**是否进入本次激活流程**（store 为 true 则永不再激活）
    2. 本会话激活锁：`activatedRef`（useRef，跨 re-render 持久但跨 unmount 不持久）一旦置 true，后续 store 字段变化不再回退 toast 可见性——彻底避免「IPC 广播回来 → store 字段反转 → shouldShow 变 false → toast 立即 unmount」的悖论。toast 仅由 `visible` 本地态控制 lifecycle（5s 定时器或手动关闭）
    3. StrictMode 双 useEffect 防御：useEffect 内 `shouldActivate` 已含 `!activatedRef.current` 守卫，二次调用直接 return
    4. IPC 失败兜底：IPC reject 时 `activatedRef` 仍为 true，本会话不再弹；下次启动 store 中 hasShown 仍为 false 会再弹一次（M-4 已保证只有场景 D 才会落到这里，正常路径不会陷入无限循环）
  - **UI store 联动契约**（与 R-4 SettingsView 配合，事实对齐 layoutSlice.ts 现状）：
    - `layoutSlice.setMode(mode)`：切换工作模式（v0.15.1 既有；本版本 R-4 将枚举从 6 项扩展为 7 项 `'chat' | 'tools' | 'console' | 'decisions' | 'analytics' | 'dashboard' | 'settings'`）
    - `settingsSlice.setActiveSection(section: 'vault' | 'apikey' | 'theme' | null)`：设置 Settings 默认锚点（**R-4 内新增**；R-5 强依赖此 action 存在）
    - **依赖关系修订**：R-5 解锁条件由「R-1 完成」追加「R-4 完成（settingsSlice.activeSection 字段已 expose）」；两节点可并行开发，但 R-5 PR 不得在 R-4 PR 合入前单独 merge
  - **样式说明**：内联 style 是最小落地（避免与既有 CSS 命名冲突）；后续可抽到 `workbench/src/styles/toast.css` 用 Design Token，本节点不强制
  - 完成标志：
    - 场景 D 首次启动后弹 toast、5s 自动消失
    - 立即重启：toast 不再出现
    - 点「打开 Settings」：P3 切换到 settings 模式 + scroll 定位到 Vault 分区
    - 强制关闭按钮可立即 dismiss
    - 组件单元测试 T-V016-R5.1 ~ R5.4 通过

- [❌] **节点 R-6 实现** · **已撤销**（v0.16 doc_rev=11 / 2026-06-08 用户决策，详见 [[changelog/v0.16/product]] doc_rev=9）：
  > **撤销原因**：用户在 QA 阶段澄清——R-6 输入框上方文件夹按钮的「原意」是**任务 cwd 切换**（类 Claude Code 的工作目录切换），不是 vault 切换。当前 v0.16 实现把它误做成了 vault 切换，功能定位错误。
  > **撤销范围**：
  >   - 删除输入框 Vault 按钮组件及其单测
  >   - `ChatView.tsx` 移除对应按钮挂载、工具栏 div 与 import
  >   - `ChatView.css` 移除 `.chat-input-toolbar` 样式
  > **保留资产**：`workbench/src/utils/pathDisplay.ts` 纯函数（`truncateMiddle` / `getVaultFolderName`）及其单测，服务 req-065「任务 cwd 选择器」（v0.17 候选），文件头注释已标注。
  > **后续承接**：[[requirements/req-065-task-cwd-selector]] 接 v0.17 重新设计任务 cwd 切换控件（语义与 vault 切换完全独立）。
  > **历史归档摘要**：原 R-6 曾规划为输入框上方 Vault 文件夹按钮，但该方向已撤销，不纳入 v0.16 交付或验收。req-065 将在后续版本重新承接“任务 cwd 选择器”语义；仅 `workbench/src/utils/pathDisplay.ts` 作为可复用资产保留。

- [x] **节点 R-6 历史归档摘要**（已撤销，不纳入 active scope）：
  - 不交付输入框 Vault 按钮 UI。
  - 不保留 R-6 active 测试清单或验收项。
  - 不进入 v0.16 风险矩阵、依赖图或里程碑统计。
  - `pathDisplay.ts` 纯函数资产保留，供 req-065 后续复用。

---

## 测试清单

### 单元测试（main + CI 部分先写）

- [ ] **T-V016-U1** vaultStore 默认值：未写入任何 config 时调 `getVaultConfig()` 返回 `{ vaultRoot: '', qaSubdir: 'QA', projectsSubdir: 'Projects', hasShownFirstLaunchToast: false }`
- [ ] **T-V016-U2** vaultStore partial merge：先调 `setVaultConfig({ vaultRoot: '/tmp/v1' })`，再调 `setVaultConfig({ qaSubdir: 'Notes' })`，最后 `getVaultConfig()` 必须同时含 vaultRoot 与 qaSubdir 更新值（不丢字段）
- [ ] **T-V016-U3** isVaultConfigured：vaultRoot 为空 / 非空两态分别返回 false / true
- [ ] **T-V016-U4** markFirstLaunchToastShown：调用后 `getVaultConfig().hasShownFirstLaunchToast === true`
- [ ] **T-V016-U5** scan-personal-paths.mjs 命中：fixture 含 `/Users/example/test.txt` 字符串，扫描后退出码 1 + stdout 含路径 + 字节偏移
- [ ] **T-V016-U6** scan-personal-paths.mjs 通过：clean fixture 无任何匹配，扫描后退出码 0
- [ ] **T-V016-U7** scan-personal-paths.mjs 三平台 pattern：fixture 同时含 `/Users/` `C:\\Users\\` `/home/` 三种字符串，扫描后均被识别（输出含三个 `[platform]` 标记）

### 集成测试

- [ ] **T-V016-I1** IPC channel 完整链路：mock BrowserWindow + ipcRenderer，模拟 renderer 调 `vault:get-config` → main handler → vaultStore → 返回值；断言 4 字段 schema 完整
- [ ] **T-V016-I2** vault:set-config 触发广播：在测试环境下调 set-config → 监听所有 BrowserWindow 的 `vault:config-changed` 事件，断言被触发且 payload 含 config 完整对象
- [ ] **T-V016-I3** vault:pick-folder mock：mock `dialog.showOpenDialog` 返回 `{ canceled: false, filePaths: ['/test/path'] }`，断言 IPC 返回字符串而非 null
- [ ] **T-V016-I4** vault:pick-folder 用户取消：mock 返回 `{ canceled: true }`，断言 IPC 返回 null

### 平台兼容测试

- [ ] **T-V016-P1** mac runner 上 scan 脚本通过 fixture 套件（在 GitHub Actions 历史可追溯）
- [ ] **T-V016-P2** win runner 上 scan 脚本通过 fixture 套件（同上）
- [ ] **T-V016-P3** linux 本地 docker（node:18-alpine）上 scan 脚本输出与 mac 一致

### 构建产物零泄露测试

- [ ] **T-V016-B1** `pnpm build` 后 `workbench/out/` 跑 scan 退出码 0
- [ ] **T-V016-B2** `pnpm dist:mac` 后 dmg 解压跑 verify-dmg.sh 退出码 0

### 首次启动场景测试（M-4 节点）

- [ ] **T-V016-S1**（场景 A · electron-store 已有）：预置 `<userData>/config.json` 含非空 vaultRoot 且 `hasShownFirstLaunchToast: true`，启动后不弹 toast、不创建文件、vaultConfig 与预置一致；FirstLaunchToast 组件 DOM 不渲染
- [ ] **T-V016-S2**（场景 B · 仅 .env.local）：清空 config.json、设 `process.env.VITE_VAULT_ROOT` / `VITE_VAULT_QA_PATH` / `VITE_VAULT_PROJECTS_PATH` 三项，启动后 config.json 内 vaultConfig 三字段被正确写入 + console 含弃用警告；hasShownFirstLaunchToast 字段保持初值 false（M-5 不动 toast 字段）；FirstLaunchToast 组件 DOM 不渲染（render 时 store 仍为初始未 init 态 → BootGate 等 init → init 拿到 vaultRoot 非空，但场景 B 命中条件 2 不在 R-5 渲染条件内，因 R-5 的 shouldActivate 需要「条件 4 命中」语义；本场景需在 FirstLaunchToast 内额外检查或在 store 内增加来源字段——见下方 §条件来源标记 实现要点）
- [ ] **T-V016-S3**（场景 C · ~/Workbench-Vault 已存在）：清空 config.json、确保 `~/Workbench-Vault` 目录存在（QA/Projects 子目录可有可无），启动后仅引用 vault 目录、缺失的子目录被自动补建、用户原有文件不被覆盖、无 toast；FirstLaunchToast 组件 DOM 不渲染
- [ ] **T-V016-S4**（场景 D · 全新安装）：清空 config.json、删除 `~/Workbench-Vault`，启动后 `~/Workbench-Vault/QA/` 和 `~/Workbench-Vault/Projects/` 被自动创建；FirstLaunchToast 组件 DOM 渲染；store 内 `hasShownFirstLaunchToast` 在 toast 渲染后被置 true
- [ ] **T-V016-S4-rerun**（场景 D 跨重启复显验证）：S4 完成后立即重启应用（保留 `<userData>/config.json`），FirstLaunchToast 组件 DOM 不再渲染；store 内 `hasShownFirstLaunchToast === true`（持久化生效）
- [ ] **T-V016-S5**（场景 D fallback）：mock `~/Workbench-Vault` mkdir 抛 EACCES，断言 fallback 路径 `app.getPath('userData')/Workbench-Vault` 被创建；M-2 `vault:get-config` response 含 `__fallbackInfo.used === true`；M-3 在 createWindow 后触发的补偿广播 payload 含 `fallbackUsed: true / fallbackReason: 'homedir mkdir failed: EACCES' / triggerSource: 'fresh-install'`；R-1 vaultSlice `vaultFallbackInfo.used === true` 且 `lastVaultTriggerSource === 'fresh-install'`
- [ ] **T-V016-S6**（条件来源标记隔离验证）：分别预置场景 A/B/C/D 初始条件，断言 vaultSlice 内 `lastVaultTriggerSource` 在场景 A/B/C 启动后保持 null，仅场景 D 下变为 `'fresh-install'`——保证 R-5 仅在场景 D 激活（产品验收语义「条件 1/2/3 无 toast、仅条件 4 弹 toast」的端到端验证）

### renderer 单元测试（R-1 / R-2）

- [ ] **T-V016-R1.1** vaultSlice 初始 state：`useStore.getState().vaultConfig === null`、`vaultConfigError === null`
- [ ] **T-V016-R1.2** vaultSlice initVault 拉取：mock `window.api.invoke('vault:get-config')` 返回完整 4 字段对象，调 `initVault()` 后 `useStore.getState().vaultConfig` 与 mock 返回值深相等
- [ ] **T-V016-R1.3** vaultSlice initVault 幂等：连续两次调 initVault，`window.api.invoke` 只被调用一次（mock 计数）
- [ ] **T-V016-R1.4** vaultSlice setVaultConfig partial：mock IPC 返回合并后的完整对象，调 `setVaultConfig({ qaSubdir: 'Notes' })` 后 store 的 `vaultConfig.qaSubdir === 'Notes'` 且其他三字段保留
- [ ] **T-V016-R1.5** vaultSlice 广播订阅：模拟 `window.api.onVaultConfigChanged` listener 被触发，断言 `useStore.getState().vaultConfig` 被替换为 payload.config
- [ ] **T-V016-R1.6** getVaultConfigSnapshot 非 React 调用：先 init 写入 mock config，外部 import `getVaultConfigSnapshot` 调用返回与 store 字段相等的对象（用于验证非 React 上下文兜底）
- [ ] **T-V016-R1.7** vaultSlice IPC 失败：mock invoke 抛错，`vaultConfigError` 字段被设为错误信息字符串，`vaultConfig` 保持 null
- [ ] **T-V016-R2.1** paths.ts buildFilePath 纯函数：`buildFilePath('/tmp/qa', 'qa-123')` 返回 `/tmp/qa/qa-123.md`
- [ ] **T-V016-R2.2** paths.ts buildFilePath 空值兜底：`buildFilePath('', 'qa-123')` 与 `buildFilePath('/tmp/qa', '')` 均返回 `''`
- [ ] **T-V016-R2.3** paths.ts buildFilePath 含特殊字符 id：`buildFilePath('/tmp/qa', 'qa-2026-06-08-001')` 行为正确（不做 URL 编码 / 不丢字符）
- [ ] **T-V016-R2.4** paths.ts deriveQaDir 相对子目录：mock config `{ vaultRoot: '/v', qaSubdir: 'QA', ... }`，`getBasePath()` 返回 `/v/QA`
- [ ] **T-V016-R2.5** paths.ts deriveQaDir 绝对子目录：mock config `{ vaultRoot: '/v', qaSubdir: '/abs/notes', ... }`，`getBasePath()` 返回 `/abs/notes`（绝对路径优先）
- [ ] **T-V016-R2.6** paths.ts Windows 绝对路径识别：mock config `{ vaultRoot: 'C:\\v', qaSubdir: 'D:\\notes', ... }`，`getBasePath()` 返回 `D:\\notes`
- [ ] **T-V016-R2.7** paths.ts getter null 兜底：`useStore.setState({ vaultConfig: null })` 后 `getBasePath()` 返回 `''`，不抛错
- [ ] **T-V016-R2.8** useBasePath React 订阅：使用 React Testing Library renderHook，初始返回 mock basePath，store 中 `__applyVaultConfig` 触发后 hook 返回值更新

### renderer 组件测试（R-3 / R-4 / R-5）

- [ ] **T-V016-R3.1** VaultBootGate loading 分支：mock vaultConfig=null，render 后 DOM 含 `Loading Vault config...` 文本，children 不渲染
- [ ] **T-V016-R3.2** VaultBootGate 放行分支：mock vaultConfig 非 null，render 后 DOM 不含 loading 文本，children 正常渲染
- [ ] **T-V016-R3.3** VaultBootGate 错误态：mock vaultConfig=null + vaultConfigError='IPC failed'，DOM 显示错误信息
- [ ] **T-V016-R3.4** VaultBootGate useEffect 触发 initVault：render 后 `useStore.getState().initVault` 被调用一次
- [ ] **T-V016-R4.1** VaultConfig 表单初始化：mock vaultConfig 非 null，render 后三个 input 显示对应值
- [ ] **T-V016-R4.2** VaultConfig 校验 vaultRoot 空：清空 vault-root 输入后点保存，DOM 含 `Vault 根目录不能为空` 错误
- [ ] **T-V016-R4.3** VaultConfig 校验子目录含 `..`：输入 `../etc` 到 qa-subdir 点保存，DOM 含 `QA 子目录不能含 ".." 段` 错误
- [ ] **T-V016-R4.4** VaultConfig 「选择文件夹」联动：mock `vault:pick-folder` 返回 `/picked/path`，点击按钮后 vaultRoot input 显示 `/picked/path`
- [ ] **T-V016-R4.5** VaultConfig 「检测路径有效性」：mock `window.api.fsExists` 返回 true / false 混合，validate-result pre 标签内显示三行结果（✓/✗ 标记）
- [ ] **T-V016-R4.6** VaultConfig 保存触发 setVaultConfig：填好三字段点保存，断言 `useStore.getState().setVaultConfig` 被调用，参数与 input 值一致
- [ ] **T-V016-R5.1** FirstLaunchToast 渲染条件：mock vaultConfig 含 `hasShownFirstLaunchToast: false`，render 后 toast DOM 存在
- [ ] **T-V016-R5.2** FirstLaunchToast 不渲染条件：mock vaultConfig 含 `hasShownFirstLaunchToast: true`，render 后 toast DOM 不存在
- [ ] **T-V016-R5.3** FirstLaunchToast 渲染即置位：spy `useStore.getState().setVaultConfig`；在 `act(async () => { render(<FirstLaunchToast />); await Promise.resolve() })` 内 render（确保 useEffect 副作用与 microtask 已 flush），随后断言 spy 恰被调用一次、参数为 `{ hasShownFirstLaunchToast: true }`（验证「置位时机」严格对齐）
- [ ] **T-V016-R5.4** FirstLaunchToast 自动 dismiss：jest fake timer 推进 5000ms 后，toast DOM 被卸载
- [ ] **T-V016-R5.5** FirstLaunchToast 手动关闭：点击 `×` 按钮立即不渲染
- [ ] **T-V016-R5.6** FirstLaunchToast 「打开 Settings」联动：mock layoutSlice.setP3Mode + settingsSlice.setActiveSection action，点击链接后两个 action 各被调用一次，参数为 `'settings'` 和 `'vault'`

### renderer 集成测试

- [ ] **T-V016-R-I1** vaultSlice ↔ paths.ts 联动：触发 store `__applyVaultConfig({ vaultRoot: '/v2', qaSubdir: 'qa2', ... })` 后，`getBasePath()` 返回 `/v2/qa2`（验证 store 单源派生）
- [ ] **T-V016-R-I2** Settings 保存 → 广播 → ChatView 实时生效：用 React Testing Library 渲染 Settings + ChatView 双组件树，Settings 保存后 ChatView 内 `useBasePath()` 返回值同步更新（验证无需重启）
- [ ] **T-V016-R-I3** VaultBootGate → ChildComponent IPC mock 时序：模拟 IPC 延迟 100ms 返回，断言 100ms 前 loading 文本可见、100ms 后 children 渲染（验证启动竞态被 BootGate 兜底）

### renderer 端到端测试（如有 e2e 基础设施 / 可由人工验证替代）

- [ ] **T-V016-R-E1** 首次启动场景 D 全链路：清空 config.json + 删除 `~/Workbench-Vault` → 启动应用 → 观察 BootGate loading → 主界面 + toast 显示 → 5s 自动消失 → Settings 内 Vault 分区置顶可见
- [ ] **T-V016-R-E2** Settings 修改 vault 后 ChatView 立即生效：启动应用 → Settings 选另一个目录保存 → 切回对话模式 → 创建新 atom，文件写入到新路径下（验证无需重启）
- [ ] **T-V016-R-E3** lifecycle 一次跨重启：场景 D toast 显示后立即重启 → toast 不再出现（验证持久化字段权威）

---

## 风险与缓解（main + CI 侧）

| # | 风险 | 缓解 |
|---|---|---|
| 1 | electron-store 在 main 进程，renderer IPC 拉取存在初始化竞态 | 通过 R-3 `<VaultBootGate>` 兜底（等 IPC 返回再渲染主界面）；同时 M-3 接线顺序固化为 `registerVaultIpc → ensureDefaultVault → createWindow`，确保窗口创建时 store 必非空 |
| 2 | 默认 `~/Workbench-Vault` mkdir 权限不足 | M-4 fallback 到 `app.getPath('userData')/Workbench-Vault` + 广播 `fallbackUsed: true` + Settings 显示 warning（R-4 实现）；fallback 路径权限由 Electron 保证可写 |
| 3 | `.env.local` 迁移影响开发者本人 | M-5 仅打印一次性弃用警告 + 不删除 `.env.local`；store 非空时迁移幂等不重复触发；product.md 已确认「用户自身责任」 |
| 4 | scan-personal-paths.mjs 误报（合法路径被命中） | 初版不做 allowlist，覆盖全平台用户家目录前缀即 fail；若实际遇到合法误报（如 nodejs runtime 内置字符串），在脚本头部 comment 文档化加 allowlist 抑制；保持「严格大于宽松」的初版策略 |
| 5 | CI verification step 影响发布速度 | scan 脚本设计为「先 build 再 scan 再 dist」，build + scan 一起 < 1min；dist 是耗时部分（5-10min），失败时不进入 dist 节约时长 |
| 6 | electron-builder 打包后 dmg 内 renderer JS 可能含异常字符串泄露（非 build 阶段引入） | CI-5 dmg 解包验证 + RELEASE.md checklist 双重保险；每次 release 必跑 verify-dmg.sh |
| 7 | workspace.cwd 与 vaultRoot 语义重叠造成 fsGuard 双源 | M-4 完成时若 vaultRoot 与已持久化 cwd 不同，触发一次 `setWorkspaceCwd(vaultRoot)` 同步；v0.17+ 视情况合并语义（v0.16 不做） |

R-6 相关风险已随撤销移出本版本范围；任务 cwd 切换风险由 req-065 后续承接。

---

## 依赖与里程碑

### 节点优先级依赖图

```
工作流 A（main）：
  M-1 (vaultStore) → M-2 (vault IPC) ──┐  锁定 IPC 契约后 unblock R-1
                        │              │
                        ▼              ▼
                    M-3 (main 接线)   工作流 B 全部解锁
                        │
                        ├─ M-4 (默认 vault 创建，依赖 M-3 + 调 M-5)
                        └─ M-5 (env 迁移，依赖 vaultStore 已 init)

工作流 C（CI，与 A 物理隔离，可完全并行）：
  CI-1 (扫描脚本) ──→ CI-2 (build.yml) ──→ CI-3 (三平台验证)
  CI-4 (RELEASE.md) ──→ CI-5 (verify-dmg.sh)，独立路径
```

**硬依赖**：M-1 → M-2 → M-3；M-3 → M-4；M-5 可与 M-4 并行
**软依赖**：CI-2 需 CI-1；CI-3 需 CI-2；CI-5 需 CI-1；其余 CI 节点独立
**跨工作流握手点**：M-2 完成后（IPC 4 channel 接口签名锁定），frontend-ui 启动 R-x 实现

**R-6 依赖状态**：R-6 已撤销，无当前依赖；任务 cwd 选择器由 req-065 后续重新设计。

### 里程碑

| 里程碑 | 完成条件 | 预估顺序 |
|---|---|---|
| MS-A | M-1 + M-2 完成（IPC 契约锁定）| 优先级最高，frontend-ui 阻塞解除 |
| MS-B | M-3 + M-4 + M-5 完成 | main 进程 vault 闭环 |
| MS-C | CI-1 + CI-2 完成（CI verification 上线）| 与 MS-A/B 并行 |
| MS-D | CI-3 + CI-5 + CI-4 完成（发布前 checklist 闭环）| MS-C 之后 |
| MS-E | R-1 ~ R-5 完成 + renderer 相关测试通过 | 依赖 MS-A；由 frontend-ui 主导 |
| MS-F | 发布 v0.16 tag + dmg/exe 通过 GitHub Release | 所有 MS 完成 + 人工验收 |

---

## 关联信息

| 字段 | 内容 |
|---|---|
| 开发分支 | `feature/v0.16-oss-decoupling`（基于 v0.15.1 PR 合并后的 main 切出，待 v0.15.1 合并）|
| 目标合并分支 | `main` |
| 启动命令 | `cd workbench && pnpm dev` |
| 测试命令 | `cd workbench && pnpm test` / `pnpm tsc --noEmit` / `node scripts/scan-personal-paths.mjs` |
| 关联产品文档 | [[changelog/v0.16/product]] |
| 关联需求 | [[requirements/req-063-oss-personal-info-decoupling]] |
| 复用 v0.15 模块 | `workspaceStore.ts` 模式 / `handlers.ts` IPC 注册模式 / `dialog.showOpenDialog` 链路 / electron-store v11 |
| 新建模块 | `vaultStore.ts` / `vault.ts` (IPC) / `scan-personal-paths.mjs` / `verify-dmg.sh` / `RELEASE.md` / `src/types/vault.ts` (类型别名) / `vaultSlice.ts` (R-1) / paths.ts 重写 (R-2) / `VaultBootGate.tsx` (R-3) / `Settings/VaultConfig.tsx` (R-4) / `FirstLaunchToast.tsx` (R-5) / `utils/pathDisplay.ts`（保留资产，供 req-065 复用，不纳入 v0.16 active UI） |
| 复用既有模块 | 无 R-6 active 复用项 |
| Token 复用 | Settings overlay / toast 样式复用 v0.15 已有 Design Token（`--surface` / `--text-2` / `--bd` / `--accent`）|
| 无变更项 | 数据 schema（atom frontmatter / `## Steps` / `## Intervention`）/ 后端 API / SDK 调用链 / fsGuard 越界逻辑（除 M-4 同步触发）/ npm 依赖包列表（不新增）|
| 副产物清理 | `workbench/src/lib/agentEventDispatcher.ts` comment 字面量（`VITE_VAULT_QA_PATH` / `07-AI知识库/L1-原始对话/QA` 等 historical context 注释），属 R-2.5 节点 OSS 化精神延伸；不进 scan-personal-paths.mjs 扫描范围但代码 review 阶段必清理 |
| 前置假设 | v0.15.1 已合并 main；本版本基于 v0.15.1 tag 切出；electron-store v11 + electron-vite 链路可用 |

---

## CEO 待仲裁项

1. **M-4 fallback 路径决策**：默认 vault 创建失败时 fallback 到 `app.getPath('userData')/Workbench-Vault`——此细节 product.md「风险与权衡」未明确，本 technical.md 自行拍板。是否需要回写 product.md 风险章节？
2. **scan-personal-paths.mjs 误报抑制策略**：初版不做 allowlist；若实际遇到 nodejs runtime 内置字符串（如 source map 中的 `/Users/runner/` GitHub Actions 路径），是否需要预置抑制规则？建议在 CI-3 验证阶段实际跑一次后再决策。
3. **workspace.cwd 与 vaultRoot 合并时点**：v0.16 维持 fsGuard 双源（cwd + vaultRoot 各自存在），仅在 M-4 触发一次同步。是否在 v0.17 显式合并为单源？此为 product.md「不在本版本范围」未涵盖的边界——CEO 决定是否需要 backlog 立 req。

---

## 修订记录

| 稿次 | 日期 | 主要变化 |
|---|---|---|
| r0 | 2026-06-08 | tauri-platform 起草 main + CI 章节完整内容（M-1 ~ M-5 共 5 节点 + CI-1 ~ CI-5 共 5 节点 + 单元测试 7 用例 + 集成测试 4 用例 + 平台兼容 3 用例 + 构建零泄露 2 用例 + 场景测试 5 用例 + 风险 7 项）；renderer 章节（R-1 ~ R-5）以接口契约骨架占位，待 frontend-ui 接手填充；3 项 CEO 待仲裁项标记 |
| r1 | 2026-06-08 | frontend-ui 填充 R-1 ~ R-5 完整实现章节（renderer 工作流 5 个实现节点 · 共 31 个 checkbox 子项：R-1 拆 2 子项含 8 实现要点 + 完成标志、R-2 拆 7 子项 R-2.1 ~ R-2.7 + 完成标志、R-3 拆 1 子项含组件实现 + 完成标志、R-4 拆 1 子项含 SettingsView 容器扩展 + VaultConfig 组件 + 完成标志、R-5 拆 1 子项含组件实现 + 三道防线 + 完成标志）；新增 `src/types/vault.ts` 类型别名约定；新增 renderer 单元测试 15 例（R-1 × 7 + R-2 × 8）+ renderer 组件测试 15 例（R-3 × 4 + R-4 × 6 + R-5 × 6）+ renderer 集成测试 3 例 + renderer e2e 3 例（合计 36 个测试用例）；更新 MS-E 里程碑统计与新建模块清单 |
| 2 | 2026-06-08 | frontend-ui | CEO 仲裁回写：fsExists 便捷方法 / layoutSlice 扩展归 R-4 / App 入口泛指语言 |
| 3 | 2026-06-08 | auto-review (Round 1) | 修复 5 项 🔴 + 9 项 🟡：① layoutSlice 字段名 / setter / 枚举对齐 v0.15.1 仓库现状（currentMode / setMode / 6→7 项含 decisions/analytics/dashboard）；② settingsSlice.activeSection 字段明确为新增 + 不持久化 + 初始 null；③ fsExists 便捷方法已就绪、删除「M-2 补齐」猜测；④ vault:config-changed 订阅统一走既有 `window.api.listen`，不引入 onVaultConfigChanged；⑤ M-3 接线段事实对齐既有 v0.15 启动序列（registerIpcHandlers → registerVaultIpc → ensureDefaultVault → createWindow → ensureWorkspaceCwd），明确 cwd 与 vault 共存的时序与触发；⑥ vaultStore schema 命名空间扁平/嵌套形式锁定为「workspace.cwd 顶层字符串字面量 + vaultConfig 顶层嵌套对象」；⑦ M-2 vault:set-config 内部 return setVaultConfig() 返回值 + 触发广播；⑧ fallback 信息透传机制锁定（main 内存模块变量 + IPC response 外字段 + createWindow 后补偿广播 + R-1 vaultFallbackInfo 字段 + R-4 warning bar）；⑨ M-5 env 字段名补齐 _PATH 后缀（事实对齐既有 paths.ts）；⑩ R-2.6 与 req-063 §4 设计偏移说明（统一走 paths.ts getter 包装层）；⑪ R-2.5 dispatcher comment 第 360 行 VITE_VAULT_QA_PATH 字面量同步清理；⑫ T-V016-R5.3 补 act + microtask flush；⑬ R-5 lifecycle 一次悖论修复（activatedRef 激活锁 + visible 本地态主导，避免广播回来 unmount）；⑭ 引入 lastVaultTriggerSource 'fresh-install' 标记，让 R-5 仅在条件 4 命中时激活 toast（场景 B/C/A 均不弹）；新增 T-V016-S4-rerun 跨重启复显测试 + S2/S3/S4 补 toast DOM 断言；R-1 vaultSlice 字段扩展 vaultFallbackInfo / lastVaultTriggerSource + __apply* 内部 action |
| 4 | 2026-06-08 | auto-review (Round 2) | 修复 8 项 🟡（无 🔴）：① M-2 channel 契约表补 vault:get-config 出参 __fallbackInfo 边带、vault:config-changed payload triggerSource 字段；② M-4 判定逻辑显式标注「条件 4 设置 __lastTriggerSource='fresh-install' / 条件 1/2/3 严禁产生 triggerSource」；③ M-4 fallback/triggerSource 透传段加 __lastTriggerSource 状态、补偿广播触发条件改为 fallback OR triggerSource 两路 OR；④ cwd / vaultRoot 双源同步条件「3/4/5」笔误修正为「2/3/4」（含 M-5 内部 setVaultConfig 完成后回到 M-4 触发同步）；⑤ 新增 T-V016-S6 条件来源标记隔离验证；⑥ 把上一轮塞进测试段的「§条件来源标记」实现说明移出测试段，分散到 M-4 / R-1 / R-5 各节点；⑦ T-V016-S5 断言补 triggerSource + lastVaultTriggerSource 同步成立；⑧ 关联信息段「副产物清理」追加 agentEventDispatcher comment 字面量清理项 |
| 5 | 2026-06-08 | auto-review (Round 3) | 复核通过：🔴=0、🟡=0；六维度全部通过（接口契约一致性 / 依赖图正确性 / 实现节点完备性 / 可验收性 / 与既有代码现状契合度 / 风险与缓解可操作性）；triggerSource & fallbackInfo 全链路（产生→传输→接收→消费）跨节点闭环；事实对齐 layoutSlice/settingsSlice/preload/handlers/main 启动序列全程校验通过；review_state 改为「通过」 |
| 6 | 2026-06-08 | tauri-platform | 增补 M-6 节点（Python sidecar API Key 透传：buildSidecarEnv 翻译 + spawn env 注入 + kill-respawn 重启 + write_settings 联动），更新依赖图（M-6 独立路径与 M-2/3/4/5 并行）/ 测试清单（新增 T-V016-M6.1 ~ M6.14 共 14 个测试用例 含单元/集成/平台兼容/安全/dmg 端到端）/ 风险章节（新增 #8-11 sidecar 重启窗口期、win 编码、store 读失败、providerType schema 降级），对齐 product.md doc_rev=5 范围扩展（设计方案 · 6 / 验收标准 · 5）。事实佐证既有现状：sidecar spawn 唯一位置 aiService.ts:141-151；Python provider 已实现 env fallback（anthropic_provider.py:25 等四处）；v0.15.1 settingsKeys.ts 已建 apiKeys 数组 schema；review_state 改为「未 review」；pending_owners 重新为 [frontend-ui（R-6 节点）] |
| 7 | 2026-06-08 | tauri-platform | 用户最终决策撤回 M-6（Python sidecar API Key 透传）：删除关键决策§8 / 实现节点M-6.1~M-6.6 / 测试T-V016-M6.* / 风险#8-11 / 依赖图M-6路径 / MS-B'；恢复 5 个 M 节点形态；为 frontend-ui 接 R-6 留干净状态 |
| 8 | 2026-06-08 | frontend-ui | 增补 R-6 节点（ChatInputVaultButton：图标+label+muted/accent+完整路径中部省略tooltip+vault:pick-folder IPC+切换 toast+边界 case），补 R-6 测试用例 16 个（pathDisplay 纯函数 × 8 + ChatInputVaultButton 组件 × 8 + 人工 e2e × 1）+ 依赖图更新（R-6 与 R-2~R-5 完全并行，复用 R-1 + M-2 既有契约不要求改写）+ 风险条目 #8-#10（跨 session 切 vault 串扰 / tooltip 小屏遮挡 / R-5/R-6 视觉重叠各自决策）+ 关联信息追加 pathDisplay.ts 与 ChatInputVaultButton.tsx 新建模块；对齐 product.md doc_rev=6 R-6 设计规格；事实佐证既有现状：notificationsSlice.addToast + TopBar autoDismiss 3s + NavIcons 内联 SVG 模式 + ChatView.tsx L750 输入框容器结构 + vaultSlice useVaultRoot/setVaultConfig action（v0.16 doc_rev=7 已落地） |
| 9 | 2026-06-08 | auto-review (Round 1) | 修复 1 项 🔴：sidecar 撤销 + R-6 增补后跨文档 cross-reference 失同步——技术方案概述工作流 B 图中「R-6 Chat 输入框 VaultPickerButton（doc_rev 5 新增，product.md「设计方案 · 7」）」改为「R-6 Chat 输入框 ChatInputVaultButton（doc_rev 5 新增，product.md「设计方案 · 6」）」。同步纠正：①组件名 VaultPickerButton 是 doc_rev 5 起草时的旧名，doc_rev 8 R-6 节点落地正式名为 ChatInputVaultButton；②章节号 §7 是 sidecar 占 §6 时的位置，sidecar 撤销后 R-6 顺位前移至 §6。其他全文（R-6 节点实现 / 测试 / 风险 / 关联信息）名称与章节号均已正确，无其他修订点 |
| 10 | 2026-06-08 | auto-review (Round 2) | 复核通过：🔴=0、🟡=0；sidecar 实质内容（M-6 章节 / buildSidecarEnv 实现 / T-V016-M6.* 测试 / sidecar 风险条目 / 依赖图 sidecar 分支）全部干净删除，仅修订记录第 6/7 行保留历史；R-6 接口契约与 R-1 / M-2 + product.md 设计规格 9 项一一对齐；M-1~M-5 + CI-1~CI-5 + R-1~R-5 未受波及；review_state 改为「通过」 |
| 11 | 2026-06-08 | frontend-ui | QA 阶段用户决策大调整：① 撤销 R-4 SettingsView（独立 P3 视图）→ 改塞进既有 NavIcons SettingsPanel overlay 作为首分区；② 撤销 R-6 ChatInputVaultButton（功能定错，原意是任务 cwd 切换非 vault 切换，已立 req-065 走 v0.17）；③ 砍 QA/Projects 子目录 UI（用户不会调），hardcode 默认值 'QA'/'Projects' 保留在 vaultStore，UI 不暴露；④ `pathDisplay.ts` 纯函数保留服务 req-065，文件头注释已标注；⑤ layoutSlice 撤销 'settings' 模式枚举，settingsSlice 撤销 `activeSection` 改为 `settingsPanelOpen: boolean` + `settingsActiveSection: 'vault'/'apikey'/'theme'/null`（双字段：前者控制 overlay 可见性，后者控制分区锚点，FirstLaunchToast「打开 Settings」联动同时 set 两字段）；⑥ FirstLaunchToast 单测 T-V016-R5.6 同步更新断言；⑦ VaultConfig.test.tsx 重写覆盖简化后字段 + 新增「QA/Projects 字段不应渲染」回归用例。验证：pnpm test 185/185 通过（用例数从前一版 195 减少 10 = R-6 ChatInputVaultButton 单测 8 个 + VaultConfig.test 3 个旧用例 - 1 个新增），pnpm build + scan-personal-paths 干净（修复 placeholder 触发 `/Users/me/` 误报），pnpm tsc --noEmit 干净。review_state 改回「未 review」等 CEO 短循环 review |
| 12 | 2026-06-09 | review-agent | 修复 doc_rev=11 的 2 项 🔴 + 1 项 🟡：① L37-42 技术方案概述工作流 B 图同步 R-4 措辞（独立 SettingsView → SettingsPanel overlay 首分区）+ R-6 撤销标记（❌）；② 在 R-4 ❌ 撤销段后增补 R-4' 替代实施节点（文件改动 / 分区顺序 / settingsSlice 双字段 / FirstLaunchToast 联动改动 / 完成标志 / 5 个新测试用例 T-V016-R4'.1~R4'.5）；③ R-4 ❌ 撤销说明同步双字段命名（settingsPanelOpen + settingsActiveSection），与 product.md doc_rev=10 L248 严格对齐 |
