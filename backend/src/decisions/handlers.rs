use chrono::Utc;
use sqlx::SqlitePool;
use tokio::sync::broadcast;
use tracing::{info, warn};

use crate::{
    error::AppError,
    events::sse::SseEvent,
    state_machine::{StateMachine, task::TaskStatus, token::TokenType},
};

use super::{DecisionOption, DecisionRecord, RiskLevel};

fn parse_risk_level(s: &str) -> RiskLevel {
    match s {
        "High" => RiskLevel::High,
        "Medium" => RiskLevel::Medium,
        _ => RiskLevel::Low,
    }
}

fn parse_agent_role(s: &str) -> crate::state_machine::task::AgentRole {
    use crate::state_machine::task::AgentRole;
    match s {
        "Ceo" => AgentRole::Ceo,
        "ProductAgent" => AgentRole::ProductAgent,
        "ReviewAgent" => AgentRole::ReviewAgent,
        "TechnicalAgent" => AgentRole::TechnicalAgent,
        _ => AgentRole::Ceo,
    }
}

fn row_to_decision(row: &sqlx::sqlite::SqliteRow) -> DecisionRecord {
    use sqlx::Row;
    let options_str: String = row.get("options");
    let options: Vec<DecisionOption> =
        serde_json::from_str(&options_str).unwrap_or_default();

    DecisionRecord {
        decision_id: row.get("decision_id"),
        task_id: row.get("task_id"),
        agent_role: parse_agent_role(row.get::<&str, _>("agent_role")),
        question: row.get("question"),
        options,
        risk_level: parse_risk_level(row.get::<&str, _>("risk_level")),
        created_at: row.get("created_at"),
        resolved_at: row.get("resolved_at"),
        resolution: row.get("resolution"),
    }
}

/// 创建决策记录
pub async fn create_decision(
    pool: &SqlitePool,
    sse_tx: &broadcast::Sender<SseEvent>,
    record: DecisionRecord,
) -> Result<String, AppError> {
    let options_json = serde_json::to_string(&record.options)?;
    let role_str = serde_json::to_string(&record.agent_role)?
        .trim_matches('"')
        .to_string();
    let risk_str = record.risk_level.to_string();

    sqlx::query(
        r#"
        INSERT INTO decisions
            (decision_id, task_id, agent_role, question, options, risk_level, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&record.decision_id)
    .bind(&record.task_id)
    .bind(&role_str)
    .bind(&record.question)
    .bind(&options_json)
    .bind(&risk_str)
    .bind(&record.created_at)
    .execute(pool)
    .await?;

    // Update task status to AwaitingDecision
    let sm = StateMachine::new();
    sm.update_status(pool, &record.task_id, TaskStatus::AwaitingDecision)
        .await?;

    // Count pending decisions
    let count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM decisions WHERE resolved_at IS NULL"#,
    )
    .fetch_one(pool)
    .await?;

    let _ = sse_tx.send(SseEvent::DecisionCreated {
        decision_id: record.decision_id.clone(),
        count,
    });

    // Also send TaskStatusChanged
    let _ = sse_tx.send(SseEvent::TaskStatusChanged {
        task_id: record.task_id.clone(),
        new_status: TaskStatus::AwaitingDecision,
        decision_request: None,
    });

    info!("[decisions] created: {}", record.decision_id);
    Ok(record.decision_id)
}

/// 列出决策（支持 "pending" / "resolved" / "all"）
pub async fn list_decisions(
    pool: &SqlitePool,
    filter: Option<&str>,
) -> Result<Vec<DecisionRecord>, AppError> {
    let sql = match filter {
        Some("pending") => {
            "SELECT * FROM decisions WHERE resolved_at IS NULL ORDER BY created_at DESC"
        }
        Some("resolved") => {
            "SELECT * FROM decisions WHERE resolved_at IS NOT NULL ORDER BY created_at DESC"
        }
        _ => "SELECT * FROM decisions ORDER BY created_at DESC",
    };

    let rows = sqlx::query(sql).fetch_all(pool).await?;
    let records = rows.iter().map(row_to_decision).collect();
    Ok(records)
}

/// 查询单个决策
pub async fn get_decision(
    pool: &SqlitePool,
    decision_id: &str,
) -> Result<DecisionRecord, AppError> {
    let row = sqlx::query(
        r#"SELECT * FROM decisions WHERE decision_id = ?"#,
    )
    .bind(decision_id)
    .fetch_optional(pool)
    .await?;

    match row {
        None => Err(AppError::NotFound(format!(
            "决策不存在: {}",
            decision_id
        ))),
        Some(r) => Ok(row_to_decision(&r)),
    }
}

/// 处理决策
pub async fn resolve_decision(
    pool: &SqlitePool,
    sse_tx: &broadcast::Sender<SseEvent>,
    decision_id: &str,
    resolution: &str,
) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();

    // 1. Update resolved_at and resolution
    let rows_affected = sqlx::query(
        r#"
        UPDATE decisions
        SET resolved_at = ?, resolution = ?
        WHERE decision_id = ? AND resolved_at IS NULL
        "#,
    )
    .bind(&now)
    .bind(resolution)
    .bind(decision_id)
    .execute(pool)
    .await?
    .rows_affected();

    if rows_affected == 0 {
        return Err(AppError::NotFound(format!(
            "决策不存在或已处理: {}",
            decision_id
        )));
    }

    // 2. Get the decision's task_id
    let record = get_decision(pool, decision_id).await?;
    let sm = StateMachine::new();

    // If approved, issue APPROVED token and unblock Engineering tasks
    if resolution == "approved" {
        // Get task to find technical_md_path from input_context
        let task = sm.get_task(pool, &record.task_id).await;
        match task {
            Ok(t) => {
                if let Some(technical_path) = t.technical_md_path_from_context() {
                    // Issue APPROVED token
                    sm.issue_token(pool, TokenType::Approved, &technical_path, "resolve_decision")
                        .await?;
                    info!(
                        "[decisions] APPROVED token issued for: {}",
                        technical_path
                    );

                    // Find and unblock Engineering tasks blocked on technical_not_approved
                    let unblocked = sm
                        .unblock_tasks_by_reason(pool, "technical_not_approved")
                        .await?;

                    for task_id in &unblocked {
                        info!("[decisions] unblocked task: {}", task_id);
                        let _ = sse_tx.send(SseEvent::TaskStatusChanged {
                            task_id: task_id.clone(),
                            new_status: TaskStatus::Pending,
                            decision_request: None,
                        });
                    }
                } else {
                    warn!(
                        "[decisions] no technical_md_path in input_context for task: {}",
                        record.task_id
                    );
                }
            }
            Err(e) => {
                warn!("[decisions] failed to get task {}: {}", record.task_id, e);
            }
        }
    }

    // 3. Count remaining pending decisions
    let count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM decisions WHERE resolved_at IS NULL"#,
    )
    .fetch_one(pool)
    .await?;

    let _ = sse_tx.send(SseEvent::DecisionResolved {
        decision_id: decision_id.to_string(),
        count,
    });

    info!("[decisions] resolved: {} -> {}", decision_id, resolution);
    Ok(())
}
