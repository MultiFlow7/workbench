mod context_builder;
mod db;
mod decisions;
mod dispatcher;
mod error;
mod events;
mod harness;
mod routes;
mod sandbox;
mod state_machine;

use std::sync::Arc;

use axum::{
    routing::{delete, get, patch, post},
    Router,
};
use tokio::sync::broadcast;
use tower_http::cors::{Any, CorsLayer};
use tracing::{error, info};
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use context_builder::ContextBuilder;
use dispatcher::{AgentDispatcher, DispatcherConfig, run_auto_dispatcher};
use events::sse::{SseEvent, SseNotification};
use sqlx::SqlitePool;

#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub sub2api_key: String,
    pub sse_tx: broadcast::Sender<SseEvent>,
    pub notify_tx: broadcast::Sender<SseNotification>, // v0.7: 通知广播通道
    pub dispatcher: Arc<AgentDispatcher>,
}

#[tokio::main]
async fn main() {
    // Load .env if present (local dev)
    dotenvy::dotenv().ok();

    // Initialize tracing
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with(fmt::layer())
        .init();

    info!("工作台后端服务启动中...");

    // Read required environment variables
    let sub2api_key = std::env::var("SUB2API_KEY").unwrap_or_else(|_| {
        panic!(
            "SUB2API_KEY 环境变量未设置。请设置 SUB2API_KEY 后启动服务。\n\
             示例: SUB2API_KEY=your_key ./workbench-backend"
        )
    });

    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "/data/workbench/workbench.db".to_string());

    let agent_model = std::env::var("AGENT_MODEL")
        .unwrap_or_else(|_| "claude-opus-4-5".to_string());

    let roles_dir = std::env::var("ROLES_DIR")
        .unwrap_or_else(|_| "/data/workbench/roles".to_string());

    // v0.7: WORKSPACE_ROOT 用于 file_refs 路径解析
    let workspace_root = std::env::var("WORKSPACE_ROOT")
        .unwrap_or_else(|_| "/data/workbench".to_string());

    // PROJECTS_DIR: 用户项目根目录（sandbox 路径白名单的前缀）
    let projects_dir = std::env::var("PROJECTS_DIR")
        .unwrap_or_else(|_| "projects".to_string());

    let sub2api_url = std::env::var("SUB2API_URL")
        .unwrap_or_else(|_| "https://api.anthropic.com/v1/messages".to_string());

    info!("数据库路径: {}", database_url);
    info!("Agent 模型: {}", agent_model);
    info!("Roles 目录: {}", roles_dir);
    info!("Workspace 根目录: {}", workspace_root);
    info!("Projects 目录: {}", projects_dir);
    info!("LLM 端点: {}", sub2api_url);

    // Initialize DB
    let pool = db::init_db(&database_url).await;

    // Create SSE broadcast channel
    let (sse_tx, _) = broadcast::channel::<SseEvent>(128);

    // v0.7: Create notification broadcast channel
    let (notify_tx, _) = broadcast::channel::<SseNotification>(128);

    // Create context builder
    let context_builder = Arc::new(ContextBuilder::new(
        roles_dir.clone(),
        workspace_root,
        projects_dir.clone(),
    ));

    // Create state machine
    let state_machine = Arc::new(state_machine::StateMachine::new());

    // Create dispatcher
    let dispatcher = Arc::new(AgentDispatcher::new(
        state_machine.clone(),
        context_builder.clone(),
        sub2api_key.clone(),
        sub2api_url,
        sse_tx.clone(),
        notify_tx.clone(),
        agent_model,
        roles_dir,
        projects_dir,
    ));

    let state = AppState {
        db: pool.clone(),
        sub2api_key,
        sse_tx,
        notify_tx,
        dispatcher: dispatcher.clone(),
    };

    // v0.7: API key 检查，key 存在则启动 Dispatch Manager
    let api_key_available = std::env::var("ANTHROPIC_API_KEY")
        .or_else(|_| std::env::var("SUB2API_KEY"))
        .is_ok();

    if api_key_available {
        info!("[main] API key 已配置，启动 Dispatch Manager");
        let config = DispatcherConfig {
            max_concurrent_agents: std::env::var("MAX_CONCURRENT_AGENTS")
                .ok().and_then(|v| v.parse().ok()).unwrap_or(4),
            poll_interval_secs: std::env::var("DISPATCH_POLL_INTERVAL_SECS")
                .ok().and_then(|v| v.parse().ok()).unwrap_or(5),
            agent_timeout_secs: std::env::var("AGENT_TIMEOUT_SECS")
                .ok().and_then(|v| v.parse().ok()).unwrap_or(600),
        };
        tokio::spawn(run_auto_dispatcher(pool.clone(), dispatcher.clone(), config));
    } else {
        error!(
            "[main] ANTHROPIC_API_KEY / SUB2API_KEY 均未设置，Dispatch Manager 不启动。\
            任务将保持 Pending 状态，等待手动 /api/tasks/:id/dispatch 触发。"
        );
    }

    // Build CORS layer
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Build router
    let app = Router::new()
        // Health
        .route("/health", get(routes::health::health_handler))
        // Tasks
        .route("/api/tasks", post(routes::tasks::create_task))
        .route("/api/tasks", get(routes::tasks::list_tasks))
        // NOTE: /api/tasks/stats must be registered before /api/tasks/:task_id
        // to prevent Axum from treating "stats" as a task_id path segment
        .route("/api/tasks/stats", get(routes::tasks::get_task_stats))
        .route("/api/tasks/:task_id", get(routes::tasks::get_task))
        .route(
            "/api/tasks/:task_id/events",
            get(routes::tasks::get_task_events),
        )
        .route(
            "/api/tasks/:task_id/status",
            patch(routes::tasks::update_task_status),
        )
        .route(
            "/api/tasks/:task_id/dispatch",
            post(routes::tasks::dispatch_task),
        )
        // Agents registry
        .route("/agents/registry", get(routes::agents::list_agents_handler))
        .route("/agents/:role/doc", get(routes::agents::get_agent_doc_handler))
        // Tokens
        .route("/api/tokens", post(routes::tokens::issue_token))
        .route("/api/tokens/check", get(routes::tokens::check_token))
        .route("/api/tokens/:token_id", delete(routes::tokens::revoke_token))
        // Decisions
        .route(
            "/api/decisions",
            get(routes::decisions::list_decisions_handler),
        )
        .route(
            "/api/decisions/:decision_id",
            get(routes::decisions::get_decision_handler),
        )
        .route(
            "/api/decisions/:decision_id/resolve",
            post(routes::decisions::resolve_decision_handler),
        )
        // SSE events
        .route(
            "/api/events/stream",
            get(routes::events::sse_stream_handler),
        )
        // v0.7: SSE 通知层
        .route(
            "/sse/notifications",
            get(routes::notifications::notifications_sse_handler),
        )
        // v0.9 req-029: LLM 调用统计
        .route("/api/llm-stats", get(routes::llm_stats::llm_stats_handler))
        .layer(cors)
        .with_state(state);

    let addr = "0.0.0.0:8081";
    info!("工作台后端服务监听: {}", addr);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .unwrap_or_else(|e| panic!("无法监听 {}: {}", addr, e));

    axum::serve(listener, app)
        .await
        .unwrap_or_else(|e| panic!("服务器错误: {}", e));
}
