# 工作台 (Workbench)

私人 AI 协作工作台。四面板桌面应用，支持对话分叉、多 Agent 调度、Token 成本追踪。

## 架构

```
workbench/      Tauri v2 + React 19 + TypeScript   桌面前端
backend/        Rust (Axum + SQLite)                业务逻辑 + Agent 调度
ai-service/     Python (FastAPI)                    LLM 路由 + 多模型适配
```

三个服务独立运行，前端通过 HTTP / WebSocket 与两个后端通信。

## 环境要求

| 服务 | 要求 |
|------|------|
| workbench | Node.js ≥ 18，Rust（[Tauri 前置依赖](https://v2.tauri.app/start/prerequisites/)） |
| backend | Rust ≥ 1.75 |
| ai-service | Python ≥ 3.11 |

## 快速开始

### 1. AI Service（LLM 路由层）

```bash
cd ai-service
cp .env.example .env        # 填入你的 API Key
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 2. Backend（业务 + Agent 调度）

```bash
cd backend
cargo run
# 默认监听 :3000
```

### 3. Workbench（桌面前端）

```bash
cd workbench
npm install
npm run tauri dev
```

## 开发文档

- `产品方向.md` — 长期产品意图与架构原则
- `原型设计意图.md` — 设计决策记录
- `requirements/` — 全局需求池
- `changelog/` — 各版本规划与发布记录
- `CLAUDE.md` — AI 辅助开发指南

## 当前版本

v0.13 — AI 工具层（多模型路由 + LLM Gateway）
