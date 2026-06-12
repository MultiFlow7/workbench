---
id: req-063
title: OSS 化改造 · 解耦个人化信息与发布产物
status: done
priority: high
source: 2026-06-08 · 准备首次发布 dmg 前的隐私扫描发现，确立"GitHub 发布物必须为通用开源产品，零个人信息"原则
created: 2026-06-08
version: v0.16
---

# req-063 · OSS 化改造 · 解耦个人化信息与发布产物

## 背景

2026-06-08 准备首次打包 mac dmg 发布到 GitHub Release 时，做了一次完整的隐私扫描，发现：

**核心原则确立**（用户表述）：
1. GitHub 上的包应该是适用于所有人的开源项目，而不是纯粹服务于个人的，也不应当泄露任何个人信息数据
2. 所有个人信息（包括本地任何有个人信息的配置）都应该是产品下载到本地后可以使用和配置的，也只保留到本地而非 GitHub

**当前不符合该原则的位置**（按风险等级）：

| 等级 | 位置 | 现状 | 后果 |
|---|---|---|---|
| 🔴 高 | [workbench/src/utils/paths.ts](../workbench/src/utils/paths.ts) 读 `VITE_VAULT_QA_PATH / VITE_VAULT_PROJECTS_PATH / VITE_VAULT_ROOT` | Vite 打包时把这三个 env 值**直接内联为字符串字面量**写进 renderer bundle | dmg 发布后，任何人解压 .app 都能看到打包者本地的 `/Users/<name>/...` 完整路径，暴露用户名、目录结构、知识库组织方式 |
| 🟡 中 | `workbench/.env.example` 含 `VITE_VAULT_*` 模板项 | 暗示这是"必须本地配置的环境变量"，但实际上不应通过 env 这条 build-time 通道走 | 误导新用户的配置方式，且鼓励"本地依赖 env"反模式 |
| 🟡 中 | 首次启动无任何 Vault 配置引导 | 新用户下载安装后没有任何提示，文件相关功能会因 `BASE_PATH = ''` 静默失败 | 开源产品可用性差 |

**已是正确做法、本次不需动**：
- `ai-service/.env`（含真 API key）已 gitignore + dmg 打包 `extraResources` 中 `!**/.env` 排除 ✅
- `VITE_BACKEND_URL` 在源码 4 处使用，默认值都是 `'http://localhost:8081'`，是 OSS 标准合理默认 ✅
- `electron-store` 已在仓库内使用（`electron/store/workspaceStore.ts`、`electron/sdk/SDKBridge.ts`），运行时本地配置基础设施齐全 ✅

## 目标

发布的 dmg / exe / AppImage 中**不包含任何打包者个人路径、用户名、知识库结构信息**。所有 Vault 相关路径在用户首次启动后由用户在本地配置，存储在 `electron-store` 管理的 `<app.getPath('userData')>/config.json` 中。

## 改动范围

### 1. 新增 vaultStore（main 进程）

仿照 [workbench/electron/store/workspaceStore.ts](../workbench/electron/store/workspaceStore.ts) 模式，新增 `workbench/electron/store/vaultStore.ts`：

```typescript
type Schema = {
  vaultRoot: string         // Vault 根目录绝对路径
  qaPath: string            // QA 子目录绝对路径
  projectsPath: string      // Projects 子目录绝对路径
}

// 同步 API
getVaultConfig(): Schema
setVaultConfig(partial: Partial<Schema>): void
isVaultConfigured(): boolean   // 三项至少需要 vaultRoot 非空
```

### 2. 新增 IPC channel

- `vault:get-config` → 返回 `Schema`
- `vault:set-config` → 接收 `Partial<Schema>`，持久化后广播给所有 renderer
- `vault:pick-folder` → 调用 Electron `dialog.showOpenDialog` 让用户选 vault 文件夹，自动 derive `qaPath = vaultRoot + '/QA'`、`projectsPath = vaultRoot + '/Projects'`（默认结构，可在设置中改）

### 3. 重写 paths.ts

[workbench/src/utils/paths.ts](../workbench/src/utils/paths.ts) 当前：

```typescript
// ❌ build-time inline
export const BASE_PATH = import.meta.env.VITE_VAULT_QA_PATH ?? ''
export const PROJECTS_PATH = import.meta.env.VITE_VAULT_PROJECTS_PATH ?? ''
export const VAULT_PATH = import.meta.env.VITE_VAULT_ROOT ?? ''
export const toFilePath = (id: string): string => `${BASE_PATH}/${id}.md`
```

改造为运行时从 Zustand store 读取（store 在 App 启动时 IPC 拉一次）：

```typescript
// ✅ runtime read
import { useVaultStore } from '../store/vaultSlice'

export const useBasePath     = () => useVaultStore(s => s.qaPath)
export const useProjectsPath = () => useVaultStore(s => s.projectsPath)
export const useVaultPath    = () => useVaultStore(s => s.vaultRoot)

export const buildFilePath = (basePath: string, id: string): string =>
  basePath ? `${basePath}/${id}.md` : ''

// 兼容旧调用方的 fallback（仅在 Zustand store 外的非 React 上下文使用）
export const getVaultConfig = () => useVaultStore.getState()
```

### 4. 改造 5 个 paths.ts 消费方

| 文件 | 当前用法 | 改造方式 |
|---|---|---|
| [workbench/src/components/ChatView/ChatView.tsx:5](../workbench/src/components/ChatView/ChatView.tsx) | `import { toFilePath, VAULT_PATH, BASE_PATH }` | 改用 `useBasePath()` + `useVaultPath()` hook + `buildFilePath()` 函数 |
| [workbench/src/components/DetailPanel/DetailPanel.tsx:3](../workbench/src/components/DetailPanel/DetailPanel.tsx) | `import { toFilePath }` | 改 hook + buildFilePath |
| [workbench/src/hooks/useChatSend.ts:45](../workbench/src/hooks/useChatSend.ts) | `import { toFilePath, VAULT_PATH, BASE_PATH }` | 改 hook（在 hook 内组合）或在调用 useChatSend 处传 |
| [workbench/src/lib/agentEventDispatcher.ts:35](../workbench/src/lib/agentEventDispatcher.ts) | `import { toFilePath }` | 非 React 上下文，用 `getVaultConfig()` getter |
| [workbench/src/store/conversationSlice.ts:2](../workbench/src/store/conversationSlice.ts) | `import { BASE_PATH, PROJECTS_PATH }` | Zustand slice 内可直接 `useVaultStore.getState()` |

### 5. 新增 vaultSlice（renderer Zustand）

`workbench/src/store/vaultSlice.ts`：
- 应用启动时调用 `window.api.invoke('vault:get-config')` 一次，初始化 store
- 订阅 `vault:config-changed` IPC 事件，在 Settings 改路径时实时更新

### 6. Settings 面板新增"Vault 配置"

入口位置：`workbench/src/components/Settings/` 或对应 P3 设置视图，新增「Vault 路径」分区：

- 「Vault 根目录」字段 + 「选择文件夹」按钮 → 触发 `vault:pick-folder`
- 「QA 子目录」字段（默认 `vaultRoot + /QA`，可自定义）
- 「Projects 子目录」字段（同上）
- 「检测路径有效性」按钮 → 验证目录存在且可读
- 保存按钮 → 触发 `vault:set-config`

### 7. 首次启动 UX（**v0.16 规划阶段决策**）

候选方案（待 product.md 阶段定）：
- (A) 启动后强制弹窗 onboarding，选不了 vault 不能用主界面（类 Obsidian）
- (B) 不强制，未配置时文件相关功能 disabled + 顶部提示条引导去 Settings
- (C) 自动在 `~/Workbench-Vault` 创建默认 vault，开箱即用，高级用户可改

### 8. .env.example 清理

[workbench/.env.example](../workbench/.env.example) 删除以下三行（因不再走 env）：
```
# VITE_VAULT_ROOT=/path/to/your/vault
# VITE_VAULT_QA_PATH=/path/to/your/vault/qa
# VITE_VAULT_PROJECTS_PATH=/path/to/your/vault/projects
```

保留 `VITE_BACKEND_URL`（dev 环境覆盖端口的合理用途）。

### 9. README 更新

`workbench/README.md` 或根 `README.md` 增加 "First Launch · Vault Configuration" 章节，说明：
- 首次启动会引导选择 Vault 文件夹
- Vault 结构约定（根目录下 QA/ 和 Projects/ 子目录）
- 可在 Settings 中重新配置

### 10. 构建验证

CI build.yml 增加一个 verification step：
```bash
grep -r "/Users/" workbench/out/ && exit 1 || echo "✓ no personal paths in build"
```
保证未来不会再次回归。

## 验收标准

### 隐私零泄露（**核心硬指标**）
- [ ] `pnpm build` 后，`grep -r "/Users/" workbench/out/` 返回空
- [ ] `pnpm build` 后，`grep -r "<打包者用户名>" workbench/out/` 返回空（注意排除 node_modules 偶然匹配）
- [ ] `pnpm dist:mac` 后，dmg 解压 → .app → renderer JS 中不含任何打包者个人路径
- [ ] CI build.yml 增加 verification step，防止回归

### 功能完整
- [ ] 重写 paths.ts 后，全量回归测试通过（`pnpm test`）
- [ ] 5 个原 paths.ts 消费方功能不退化（手动验收）
- [ ] Settings → Vault 配置 UI 可正常选目录、保存、读取
- [ ] 修改 Vault 路径后，无需重启应用即可生效（Zustand 实时更新）

### 首次启动体验
- [ ] 全新安装（清空 `<userData>/config.json`）后启动应用，根据 7. 决策的方案，引导用户配置 Vault
- [ ] 未配置时，文件相关功能有清晰的"请先配置"提示，不会静默失败或崩溃
- [ ] README 有清晰的首次配置文档

### 配置层正确性
- [ ] `workbench/.env.example` 不再含 `VITE_VAULT_*`
- [ ] `workbench/.env.local` 的 `VITE_VAULT_*` 即使存在也不影响运行（被新逻辑忽略）
- [ ] vault 配置文件位于 `<app.getPath('userData')>/config.json`，与应用包完全分离

## 影响范围

| 类别 | 文件 / 模块 | 改动量 |
|---|---|---|
| 新增 | `electron/store/vaultStore.ts` | 新文件 ~80 行 |
| 新增 | `electron/ipc/vault.ts`（IPC handler） | 新文件 ~50 行 |
| 新增 | `src/store/vaultSlice.ts` | 新文件 ~40 行 |
| 新增 | `src/components/Settings/VaultConfig.tsx` | 新文件 ~150 行 |
| 重写 | `src/utils/paths.ts` | 全文重写 ~30 行 |
| 改造 | 5 个消费方（ChatView / DetailPanel / useChatSend / agentEventDispatcher / conversationSlice） | 改 import + 局部 ~20 行 |
| 清理 | `workbench/.env.example` | -3 行 |
| 文档 | `workbench/README.md` | +30 行 |
| CI | `.github/workflows/build.yml` | +5 行 verification step |

## 风险与权衡

1. **paths.ts 从静态常量变 hook，可能漏改非 React 上下文的调用**
   - 缓解：保留 `getVaultConfig()` getter 兜底，code review 阶段重点 grep `import.*paths`

2. **electron-store 在 main 进程，renderer 需要 IPC 拉取，存在初始化竞态**
   - 缓解：在 App 顶层 `<VaultBootGate>` 组件，等 IPC 返回后再渲染主界面

3. **首次启动 UX 方案 A/B/C 选哪个影响产品定位**
   - 决策点放在 v0.16 product.md 规划阶段，本需求不预设

4. **既有用户（开发者本人）升级后 .env.local 的 VITE_VAULT_* 失效**
   - 缓解：vaultSlice 初始化时若 electron-store 为空且 `import.meta.env.VITE_VAULT_*` 非空，自动迁移一次（带 console 警告"即将弃用"）

## 关联

- 引出此需求的扫描记录：2026-06-08 对话「打包前隐私扫描」
- 父原则文件：本仓库根 `产品方向.md` 中"开源产品标准"章节（如已有），或本 req 首次确立
- 相关基础设施：[workbench/electron/store/workspaceStore.ts](../workbench/electron/store/workspaceStore.ts)、[workbench/electron/sdk/SDKBridge.ts](../workbench/electron/sdk/SDKBridge.ts)（已有 electron-store 用例）
- 阻塞动作：**v0.16 完成验收前，不应发布任何 dmg / exe 到 GitHub Release**（否则违反核心原则）
