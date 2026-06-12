# Workbench · 工作台

[中文](#中文) | [English](#english)

---

## 中文

工作台是一个私人 AI 协作桌面应用。当前已实现基线为 `v0.15.1`：Electron 桌面前端、四面板工作区、ProcessTrace 执行时间线、对话分叉与本地服务接入已经可用。

`v0.16` 正在进行 OSS Decoupling 与发布治理收口，目标是解除 GitHub Release 首发阻塞；它尚未发布。

### 当前架构

```
┌──────────────────┐  HTTP/WS   ┌──────────────────┐
│   workbench/     │ ─────────► │    backend/      │
│   桌面前端        │            │    业务后端       │
│   Electron 33    │            │    Rust · Axum   │
│   React          │            │    SQLite        │
│   electron-vite 4│            │    默认 :8081     │
└──────────────────┘            └──────────────────┘
                                         │
                                  HTTP   │
                                         ▼
                                ┌──────────────────┐
                                │   ai-service/    │
                                │   AI 服务        │
                                │   Python · FastAPI│
                                │   默认 :8000     │
                                └──────────────────┘
                                         │
                             ┌───────────┴───────────┐
                          Claude   OpenAI   DeepSeek  Gemini
```

### 核心功能

- **四面板布局** — 导航 · 结构 · 主工作区 · 详情
- **对话分叉** — 选择任意分支节点后，在主工作区展示从根到该节点的完整线性历史
- **ProcessTrace 时间线** — 按 process / thinking / tool 三层查看执行过程
- **多模型接入** — 通过本地服务连接 Claude、OpenAI、DeepSeek、Gemini 等模型
- **本地 Vault** — 首次启动创建默认工作目录，并支持后续在设置中调整

### 环境要求

| 服务 | 要求 |
|------|------|
| `workbench/` | Node.js 18+、pnpm |
| `backend/` | Rust 1.75+ |
| `ai-service/` | Python 3.11+ |

桌面前端当前运行在 Electron 上，不需要安装桌面壳相关的 Rust 前置依赖。

### 快速开始

**1. AI service**

```bash
cd ai-service
cp .env.example .env        # 填入你的 API Key
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**2. Backend**

```bash
cd backend
cargo run
# 默认监听 :8081
```

**3. Workbench desktop**

```bash
cd workbench
pnpm install
pnpm dev
```

### 构建

```bash
cd workbench
pnpm build
```

发布包构建入口为 `pnpm dist:mac` 和 `pnpm dist:win`。v0.16 发布治理期间，正式发布前还需要通过个人路径扫描与发布检查。

### 参与贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。Issues 和 PRs 欢迎围绕当前发布治理边界提交。

### 许可证

[Apache License 2.0](LICENSE)

---

## English

Workbench is a personal AI collaboration desktop app. The current implemented baseline is `v0.15.1`: Electron desktop frontend, four-panel workspace, ProcessTrace execution timeline, conversation branching, and local service integration are available.

`v0.16` is in progress for OSS decoupling and release governance. Its goal is to unblock the first GitHub Release; it has not been released yet.

### Current Architecture

```
┌─────────────┐    HTTP/WS    ┌─────────────────┐
│  workbench/ │ ────────────► │   backend/      │
│  Electron 33│               │   Rust · Axum   │
│  React      │               │   SQLite        │
│  electron-vite 4            │   default :8081 │
└─────────────┘               └─────────────────┘
                                      │
                              HTTP    │
                                      ▼
                             ┌─────────────────┐
                             │  ai-service/    │
                             │  Python · FastAPI│
                             │  default :8000  │
                             └─────────────────┘
                                      │
                          ┌───────────┴───────────┐
                       Claude   OpenAI   DeepSeek  Gemini
```

### Features

- **Four-panel layout** — navigation, structure, main workspace, and details
- **Conversation branching** — select a branch node and view the full linear history from root to that node
- **ProcessTrace timeline** — inspect process, thinking, and tool execution layers
- **Multi-model integration** — connect Claude, OpenAI, DeepSeek, Gemini, and other models through local services
- **Local Vault** — create a default workspace on first launch and reconfigure it later in settings

### Requirements

| Service | Requirement |
|---------|-------------|
| `workbench/` | Node.js 18+, pnpm |
| `backend/` | Rust 1.75+ |
| `ai-service/` | Python 3.11+ |

The desktop frontend currently runs on Electron and does not require Rust prerequisites for the desktop shell.

### Quick Start

**1. AI service**

```bash
cd ai-service
cp .env.example .env        # fill in your API keys
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**2. Backend**

```bash
cd backend
cargo run
# listens on :8081 by default
```

**3. Workbench desktop**

```bash
cd workbench
pnpm install
pnpm dev
```

### Build

```bash
cd workbench
pnpm build
```

Release package entry points are `pnpm dist:mac` and `pnpm dist:win`. During v0.16 release governance, official releases must also pass the personal-path scan and release checks.

### Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and PRs are welcome within the current release-governance scope.

### License

[Apache License 2.0](LICENSE)
