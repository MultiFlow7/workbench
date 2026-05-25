# workbench — 桌面前端

Tauri v2 + React 19 + TypeScript 桌面应用，工作台的用户界面层。

## 本地开发

```bash
npm install
npm run tauri dev
```

## 构建

```bash
npm run tauri build
```

## 依赖服务

启动前端前，请确保以下服务已运行：

- `backend/` — Rust 后端，默认端口 `:8081`
- `ai-service/` — Python AI 服务，默认端口 `:8000`

完整启动说明见项目根目录 [README](../README.md)。
