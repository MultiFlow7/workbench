use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use chrono::Utc;
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use uuid::Uuid;

use crate::{
    error::AppError,
    state_machine::{
        task::{AgentRole, AgentTask, TaskStatus, TaskType},
        TaskFilter, StateMachine,
    },
    AppState,
};

#[derive(Debug, Deserialize)]
pub struct CreateTaskRequest {
    pub task_type: String,
    pub role: String,
    pub project: String,
    pub version: String,
    pub input_context: String,
    pub title: Option<String>,
    pub file_refs: Option<Vec<String>>,   // v0.7: 文件引用路径列表
    pub trigger_reason: Option<String>,   // v0.7: 触发来源标识
}

#[derive(Debug, Deserialize)]
pub struct UpdateStatusRequest {
    pub status: String,
}

#[derive(Debug, Deserialize)]
pub struct ListTasksQuery {
    pub status: Option<String>,
    pub role: Option<String>,
    pub project: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DispatchRequest {
    pub documents: Option<HashMap<String, String>>,
}

fn parse_task_type(s: &str) -> TaskType {
    match s {
        "ProductPlanning" => TaskType::ProductPlanning,
        "Review" => TaskType::Review,
        "Engineering" => TaskType::Engineering,
        "Memory" => TaskType::Memory,
        _ => TaskType::Memory,
    }
}

fn parse_agent_role(s: &str) -> AgentRole {
    match s {
        "Ceo" => AgentRole::Ceo,
        "ProductAgent" => AgentRole::ProductAgent,
        "ReviewAgent" => AgentRole::ReviewAgent,
        "TechnicalAgent" => AgentRole::TechnicalAgent,
        "QaAgent" => AgentRole::QaAgent, // v0.7
        _ => AgentRole::Ceo,
    }
}

fn parse_task_status(s: &str) -> TaskStatus {
    match s {
        "Pending" => TaskStatus::Pending,
        "Running" => TaskStatus::Running,
        "Blocked" => TaskStatus::Blocked,
        "AwaitingDecision" => TaskStatus::AwaitingDecision,
        "Completed" => TaskStatus::Completed,
        "Failed" => TaskStatus::Failed,
        _ => TaskStatus::Pending,
    }
}

pub async fn create_task(
    State(state): State<AppState>,
    Json(req): Json<CreateTaskRequest>,
) -> Result<impl IntoResponse, AppError> {
    let task_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    // title: use provided value, or auto-generate from input_context (first 50 chars)
    let title = Some(req.title.unwrap_or_else(|| {
        let ctx = &req.input_context;
        let chars: String = ctx.chars().take(50).collect();
        chars
    }));

    // v0.7: file_refs Vec<String> → JSON string
    let file_refs_json: Option<String> = req.file_refs.and_then(|refs| {
        if refs.is_empty() {
            None
        } else {
            serde_json::to_string(&refs).ok()
        }
    });

    let task = AgentTask {
        task_id: task_id.clone(),
        task_type: parse_task_type(&req.task_type),
        role: parse_agent_role(&req.role),
        status: TaskStatus::Pending,
        project: req.project,
        version: req.version,
        input_context: req.input_context,
        title,
        output: None,
        blocking_on: None,
        decision_request: None,
        created_at: now.clone(),
        updated_at: now,
        file_refs: file_refs_json,        // v0.7
        trigger_reason: req.trigger_reason, // v0.7
    };

    let sm = StateMachine::new();
    let id = sm.create_task(&state.db, task).await?;

    Ok((StatusCode::OK, Json(json!({"task_id": id}))))
}

pub async fn list_tasks(
    State(state): State<AppState>,
    Query(query): Query<ListTasksQuery>,
) -> Result<impl IntoResponse, AppError> {
    let sm = StateMachine::new();
    let filter = TaskFilter {
        status: query.status,
        role: query.role,
        project: query.project,
    };
    let tasks = sm.list_tasks(&state.db, filter).await?;
    Ok(Json(tasks))
}

pub async fn get_task(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let sm = StateMachine::new();
    let task = sm.get_task(&state.db, &task_id).await?;
    Ok(Json(task))
}

pub async fn update_task_status(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
    Json(req): Json<UpdateStatusRequest>,
) -> Result<impl IntoResponse, AppError> {
    let new_status = parse_task_status(&req.status);
    let sm = StateMachine::new();

    // 验证状态迁移合法性：Completed / Failed 为终态，不可逆
    let current = sm.get_task(&state.db, &task_id).await?;
    let is_terminal = matches!(current.status, TaskStatus::Completed | TaskStatus::Failed);
    if is_terminal {
        return Err(AppError::InvalidInput(format!(
            "任务 {} 处于终态 {:?}，不允许迁移到 {:?}",
            task_id, current.status, new_status
        )));
    }

    sm.update_status(&state.db, &task_id, new_status.clone())
        .await?;

    let _ = state.sse_tx.send(crate::events::sse::SseEvent::TaskStatusChanged {
        task_id: task_id.clone(),
        new_status,
        decision_request: None,
    });

    Ok(Json(json!({"ok": true})))
}

pub async fn get_task_stats(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    // Query counts per status in one pass
    let rows = sqlx::query(
        r#"
        SELECT status, COUNT(*) as cnt
        FROM agent_tasks
        GROUP BY status
        "#,
    )
    .fetch_all(&state.db)
    .await?;

    let mut by_status: HashMap<String, i64> = HashMap::new();
    let mut total: i64 = 0;

    for row in &rows {
        use sqlx::Row;
        let status: String = row.get("status");
        let cnt: i64 = row.get("cnt");
        total += cnt;
        // Normalize status keys to lowercase-with-hyphen for frontend
        let key = match status.as_str() {
            "Pending" => "pending",
            "Running" => "running",
            "Blocked" => "blocked",
            "AwaitingDecision" => "awaiting-decision",
            "Completed" => "completed",
            "Failed" => "failed",
            _ => "unknown",
        };
        by_status.insert(key.to_string(), cnt);
    }

    // Ensure all known statuses are present (with 0 default)
    for key in &["pending", "running", "blocked", "awaiting-decision", "completed", "failed"] {
        by_status.entry(key.to_string()).or_insert(0);
    }

    Ok(Json(json!({
        "total": total,
        "by_status": by_status,
    })))
}

pub async fn get_task_events(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    use sqlx::Row;

    let rows = sqlx::query(
        r#"
        SELECT event_id, event_name, payload, created_at
        FROM ui_events
        WHERE json_extract(payload, '$.task_id') = ?
        ORDER BY created_at ASC
        "#,
    )
    .bind(&task_id)
    .fetch_all(&state.db)
    .await?;

    let events: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            let payload_str: String = row.get("payload");
            let payload: serde_json::Value =
                serde_json::from_str(&payload_str).unwrap_or_default();
            json!({
                "event_id": row.get::<String, _>("event_id"),
                "event_name": row.get::<String, _>("event_name"),
                "payload": payload,
                "created_at": row.get::<String, _>("created_at"),
            })
        })
        .collect();

    Ok(Json(json!(events)))
}

pub async fn dispatch_task(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
    Json(req): Json<DispatchRequest>,
) -> impl IntoResponse {
    let documents = req.documents.unwrap_or_default();
    let dispatcher = state.dispatcher.clone();
    let pool = state.db.clone();
    let task_id_clone = task_id.clone();

    tokio::spawn(async move {
        match dispatcher
            .dispatch(&pool, &task_id_clone, documents)
            .await
        {
            Ok(_) => {
                tracing::info!("[dispatch] task completed: {}", task_id_clone);
            }
            Err(e) => {
                tracing::error!("[dispatch] task failed: {}: {}", task_id_clone, e);
            }
        }
    });

    (StatusCode::ACCEPTED, Json(json!({"ok": true, "message": "dispatch started"})))
}
