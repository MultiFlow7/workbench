# backend — 业务后端

Rust · Axum · SQLite 业务后端，负责 Agent 任务调度、会话管理、决策队列和 SSE 推送。

## 本地开发

```bash
cp .env.example .env   # 填入配置
cargo run
# 默认监听 :8081
```

## 环境变量

见 [`.env.example`](.env.example)，完整配置说明在其中。

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/api/tasks` | 创建 Agent 任务 |
| GET | `/api/tasks` | 任务列表 |
| GET | `/api/tasks/:id` | 任务详情 |
| GET | `/api/tasks/:id/events` | 任务事件流（SSE） |
| POST | `/api/tasks/:id/dispatch` | 手动触发任务 |
| GET | `/agents/registry` | 已注册 Agent 列表 |
| GET | `/agents/:role/doc` | Agent 角色文档 |
| GET | `/api/decisions` | 决策队列 |
| POST | `/api/decisions/:id/resolve` | 审批决策 |
| GET | `/api/events` | 全局事件流（SSE） |
| GET | `/api/notifications` | 通知流（SSE） |
| GET | `/api/llm-stats` | LLM 用量统计 |

## 依赖服务

运行前请确保 `ai-service/`（Python，`:8000`）已启动。

完整启动说明见项目根目录 [README](../README.md)。
