# Workbench · 工作台

[English](#english) | [中文](#中文)

---

## English

A personal AI collaboration desktop app. Four-panel interface with conversation branching, multi-agent dispatch, and token cost tracking.

### Architecture

```
┌─────────────┐    HTTP/WS    ┌─────────────────┐
│  workbench/ │ ────────────► │   backend/      │
│  Tauri + React             │   Rust · Axum   │
│  TypeScript  │              │   SQLite        │
└─────────────┘              └─────────────────┘
                                      │
                              HTTP    │
                                      ▼
                             ┌─────────────────┐
                             │  ai-service/    │
                             │  Python · FastAPI│
                             │  LLM Router     │
                             └─────────────────┘
                                      │
                          ┌───────────┴───────────┐
                       Claude   OpenAI   DeepSeek  Gemini
```

### Features

- **Four-panel layout** — Nav · Branch Structure · Chat · Detail
- **Conversation branching** — fork any message, navigate the full branch tree
- **Multi-agent dispatch** — task state machine, context builder, agent sandbox
- **Decision inbox** — non-blocking human approval queue for agent actions
- **Multi-model support** — Claude, OpenAI, DeepSeek, Gemini via unified API
- **Token analytics** — per-session cost tracking with prompt cache visibility

### Requirements

| Service | Requirement |
|---------|-------------|
| workbench | Node.js ≥ 18, Rust (see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)) |
| backend | Rust ≥ 1.75 |
| ai-service | Python ≥ 3.11 |

### Quick Start

**1. AI Service**
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

**3. Workbench (desktop app)**
```bash
cd workbench
npm install
npm run tauri dev
```

### Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and PRs are welcome.

### License

[Apache License 2.0](LICENSE)

---

## 中文

私人 AI 协作桌面应用。四面板界面，支持对话分叉、多 Agent 调度与 Token 成本追踪。

### 架构

```
┌──────────────────┐  HTTP/WS   ┌──────────────────┐
│   workbench/     │ ─────────► │    backend/      │
│   桌面前端        │            │    业务后端       │
│   Tauri + React  │            │    Rust · Axum   │
│   TypeScript     │            │    SQLite        │
└──────────────────┘            └──────────────────┘
                                         │
                                  HTTP   │
                                         ▼
                                ┌──────────────────┐
                                │   ai-service/    │
                                │   AI 路由层      │
                                │   Python · FastAPI│
                                └──────────────────┘
                                         │
                             ┌───────────┴───────────┐
                          Claude   OpenAI   DeepSeek  Gemini
```

### 核心功能

- **四面板布局** — 导航 · 分支结构 · 对话 · 详情
- **对话分叉** — 在任意节点分叉，在完整分支树中导航
- **多 Agent 调度** — 任务状态机、上下文构建器、Agent 沙盒
- **决策收件箱** — Agent 操作的非阻塞人工审批队列
- **多模型支持** — 通过统一接口接入 Claude、OpenAI、DeepSeek、Gemini
- **Token 分析** — 带 Prompt Cache 可视化的单次/累计成本追踪

### 环境要求

| 服务 | 要求 |
|------|------|
| workbench | Node.js ≥ 18，Rust（见 [Tauri 前置依赖](https://v2.tauri.app/start/prerequisites/)） |
| backend | Rust ≥ 1.75 |
| ai-service | Python ≥ 3.11 |

### 快速开始

**1. AI Service**
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

**3. Workbench（桌面应用）**
```bash
cd workbench
npm install
npm run tauri dev
```

### 参与贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)，欢迎提 Issue 和 PR。

### 许可证

[Apache License 2.0](LICENSE)
