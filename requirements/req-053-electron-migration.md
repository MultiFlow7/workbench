---
id: req-053
title: Electron 迁移（从 Tauri）
status: done
priority: critical
source: 架构决策 · 2026-05-28 · 支持 macOS+Windows 双端
created: 2026-05-28
version: v0.15
---

# req-053 · Electron 迁移（从 Tauri）

## 背景

Tauri 最初选择的前提是「追求轻量、只做 macOS」。现在两个前提均已变化：需要支持 macOS + Windows 双端，包体积不关键。

当前 Tauri Rust 层实际执行的全部是 I/O 密集操作（文件读写、HTTP 转发、SSE 流转发），Rust 的 CPU 计算优势在这里没有用武之地。迁移到 Electron 后：

- Rust IPC → TypeScript IPC（代码量减少约一半）
- SSE bug workaround 和触摸板手势修正的 Rust 代码直接删除（Chromium 原生处理）
- AI 辅助编程质量提升（TypeScript 训练数据更充足）
- macOS + Windows 渲染引擎统一（Chromium），无跨平台测试包袱

## 迁移范围

**需要替换**：Tauri `#[command]` → `ipcMain.handle()`；`tauri-plugin-fs` → Node.js `fs`；`AppHandle` 事件 → `webContents.send()`；Python sidecar 启动方式。

**完全不动**：Python ai-service（HTTP 接口不变）、React 组件（90%+ 不涉及 IPC）、Zustand Store、业务逻辑。

**附带工作**：配置 `electron-updater` 自动更新；配置 macOS + Windows 代码签名/公证。

## 验收标准

- [ ] Tauri 依赖完全移除，项目改用 Electron + electron-builder
- [ ] 所有原 `invoke()` 调用点替换为 `ipcRenderer.invoke()`
- [ ] Python ai-service 通过 `child_process.spawn` 启动，打包后可用
- [ ] macOS 构建产物正常运行
- [ ] Windows 构建产物正常运行（基础冒烟测试通过）
- [ ] `electron-updater` 集成，自动更新流程可用
