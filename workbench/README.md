# workbench — 桌面前端

Electron 33 + React + electron-vite 4 + Claude Code SDK 桌面应用，工作台的用户界面层。

## 本地开发

```bash
pnpm install
pnpm dev
```

## 构建

```bash
pnpm build
```

## 依赖服务

启动前端前，请确保以下服务已运行：

- `backend/` — Rust 后端，默认端口 `:8081`
- `ai-service/` — Python AI 服务，默认端口 `:8000`

完整启动说明见项目根目录 [README](../README.md)。

## 首次启动与 Vault 配置

首次启动时，应用会自动在用户主目录下创建默认 vault：

```
~/Workbench-Vault/
├── QA/         # 问答类笔记
└── Projects/   # 项目类笔记
```

**Vault 结构约定**：默认使用根目录下的 `QA/` 和 `Projects/` 两个子目录。

**自定义旧目录**：如果你已有历史对话或项目目录，可在 Settings 的 Vault 配置中把 QA / Projects 分别改为绝对路径。未自定义时仍使用默认 `QA` / `Projects`。

**备用路径**：如果 `~/Workbench-Vault` 创建失败（例如权限问题或主目录不可写），应用会自动使用 Electron `userData` 目录下的 `Workbench-Vault/`（macOS 通常为 `~/Library/Application Support/workbench/Workbench-Vault/`），保证首次启动始终能拿到一个可用 vault。

**重新配置 Vault 路径**：可通过 Settings 重新配置 vault 根目录、QA 对话目录和 Projects 项目目录。配置变更后立即生效，原有 vault 内容不会自动迁移。

**开发环境 `.env.local` 兼容**：如果开发者本地 `.env.local` 中存在历史的 `VITE_VAULT_ROOT` / `VITE_VAULT_QA_PATH` / `VITE_VAULT_PROJECTS_PATH` 配置，首次启动时会一次性迁移到 electron-store 持久化存储中，并在控制台输出弃用警告。后续重启不再读取 `.env.local` 中的 vault 配置，请通过 Settings 管理。
