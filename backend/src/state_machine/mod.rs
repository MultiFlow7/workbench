pub mod task;
pub mod token;

use chrono::Utc;
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

use crate::error::AppError;
use task::{AgentRole, AgentTask, TaskStatus, TaskType};
use token::TokenType;

pub struct StateMachine;

#[derive(Debug, Default)]
pub struct TaskFilter {
    pub status: Option<String>,
    pub role: Option<String>,
    pub project: Option<String>,
}

impl StateMachine {
    pub fn new() -> Self {
        StateMachine
    }

    /// 创建任务，返回 task_id
    pub async fn create_task(
        &self,
        pool: &SqlitePool,
        task: AgentTask,
    ) -> Result<String, AppError> {
        let task_type_str = serde_json::to_string(&task.task_type)?
            .trim_matches('"')
            .to_string();
        let role_str = serde_json::to_string(&task.role)?
            .trim_matches('"')
            .to_string();
        let status_str = serde_json::to_string(&task.status)?
            .trim_matches('"')
            .to_string();

        sqlx::query(
            r#"
            INSERT INTO agent_tasks
                (task_id, task_type, role, status, project, version,
                 input_context, title, output, blocking_on, decision_request,
                 created_at, updated_at, file_refs, trigger_reason)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&task.task_id)
        .bind(&task_type_str)
        .bind(&role_str)
        .bind(&status_str)
        .bind(&task.project)
        .bind(&task.version)
        .bind(&task.input_context)
        .bind(&task.title)
        .bind(&task.output)
        .bind(&task.blocking_on)
        .bind(&task.decision_request)
        .bind(&task.created_at)
        .bind(&task.updated_at)
        .bind(&task.file_refs)
        .bind(&task.trigger_reason)
        .execute(pool)
        .await?;

        Ok(task.task_id)
    }

    /// 查询单个任务
    pub async fn get_task(
        &self,
        pool: &SqlitePool,
        task_id: &str,
    ) -> Result<AgentTask, AppError> {
        let row = sqlx::query(
            r#"
            SELECT task_id, task_type, role, status, project, version,
                   input_context, title, output, blocking_on, decision_request,
                   created_at, updated_at, file_refs, trigger_reason
            FROM agent_tasks WHERE task_id = ?
            "#,
        )
        .bind(task_id)
        .fetch_optional(pool)
        .await?;

        match row {
            None => Err(AppError::NotFound(format!("任务不存在: {}", task_id))),
            Some(r) => Ok(AgentTask {
                task_id: r.get("task_id"),
                task_type: parse_task_type(r.get::<&str, _>("task_type")),
                role: parse_agent_role(r.get::<&str, _>("role")),
                status: parse_task_status(r.get::<&str, _>("status")),
                project: r.get("project"),
                version: r.get("version"),
                input_context: r.get("input_context"),
                title: r.get("title"),
                output: r.get("output"),
                blocking_on: r.get("blocking_on"),
                decision_request: r.get("decision_request"),
                created_at: r.get("created_at"),
                updated_at: r.get("updated_at"),
                file_refs: r.get("file_refs"),
                trigger_reason: r.get("trigger_reason"),
            }),
        }
    }

    /// 列出任务（支持过滤）
    pub async fn list_tasks(
        &self,
        pool: &SqlitePool,
        filter: TaskFilter,
    ) -> Result<Vec<AgentTask>, AppError> {
        let mut conditions = Vec::new();
        let mut binds: Vec<String> = Vec::new();

        if let Some(s) = &filter.status {
            conditions.push("status = ?");
            binds.push(s.clone());
        }
        if let Some(r) = &filter.role {
            conditions.push("role = ?");
            binds.push(r.clone());
        }
        if let Some(p) = &filter.project {
            conditions.push("project = ?");
            binds.push(p.clone());
        }

        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conditions.join(" AND "))
        };

        let sql = format!(
            r#"
            SELECT task_id, task_type, role, status, project, version,
                   input_context, title, output, blocking_on, decision_request,
                   created_at, updated_at, file_refs, trigger_reason
            FROM agent_tasks {}
            ORDER BY created_at DESC
            "#,
            where_clause
        );

        let mut query = sqlx::query(&sql);
        for b in &binds {
            query = query.bind(b);
        }

        let rows = query.fetch_all(pool).await?;

        let tasks = rows
            .into_iter()
            .map(|r| AgentTask {
                task_id: r.get("task_id"),
                task_type: parse_task_type(r.get::<&str, _>("task_type")),
                role: parse_agent_role(r.get::<&str, _>("role")),
                status: parse_task_status(r.get::<&str, _>("status")),
                project: r.get("project"),
                version: r.get("version"),
                input_context: r.get("input_context"),
                title: r.get("title"),
                output: r.get("output"),
                blocking_on: r.get("blocking_on"),
                decision_request: r.get("decision_request"),
                created_at: r.get("created_at"),
                updated_at: r.get("updated_at"),
                file_refs: r.get("file_refs"),
                trigger_reason: r.get("trigger_reason"),
            })
            .collect();

        Ok(tasks)
    }

    /// 更新任务状态
    pub async fn update_status(
        &self,
        pool: &SqlitePool,
        task_id: &str,
        new_status: TaskStatus,
    ) -> Result<(), AppError> {
        let status_str = serde_json::to_string(&new_status)?
            .trim_matches('"')
            .to_string();
        let now = Utc::now().to_rfc3339();

        let rows_affected = sqlx::query(
            r#"UPDATE agent_tasks SET status = ?, updated_at = ? WHERE task_id = ?"#,
        )
        .bind(&status_str)
        .bind(&now)
        .bind(task_id)
        .execute(pool)
        .await?
        .rows_affected();

        if rows_affected == 0 {
            return Err(AppError::NotFound(format!("任务不存在: {}", task_id)));
        }

        Ok(())
    }

    /// 更新任务输出
    pub async fn set_output(
        &self,
        pool: &SqlitePool,
        task_id: &str,
        output: &str,
    ) -> Result<(), AppError> {
        let now = Utc::now().to_rfc3339();

        sqlx::query(
            r#"UPDATE agent_tasks SET output = ?, updated_at = ? WHERE task_id = ?"#,
        )
        .bind(output)
        .bind(&now)
        .bind(task_id)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// 设置阻塞原因
    pub async fn set_blocking_on(
        &self,
        pool: &SqlitePool,
        task_id: &str,
        blocking_on: &str,
    ) -> Result<(), AppError> {
        let now = Utc::now().to_rfc3339();

        sqlx::query(
            r#"UPDATE agent_tasks SET blocking_on = ?, updated_at = ? WHERE task_id = ?"#,
        )
        .bind(blocking_on)
        .bind(&now)
        .bind(task_id)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// 颁发令牌，返回 token_id
    pub async fn issue_token(
        &self,
        pool: &SqlitePool,
        token_type: TokenType,
        target_id: &str,
        issued_by: &str,
    ) -> Result<String, AppError> {
        let token_id = Uuid::new_v4().to_string();
        let type_str = serde_json::to_string(&token_type)?
            .trim_matches('"')
            .to_string();
        let now = Utc::now().to_rfc3339();

        sqlx::query(
            r#"
            INSERT INTO capability_tokens (token_id, token_type, target_id, issued_at, issued_by)
            VALUES (?, ?, ?, ?, ?)
            "#,
        )
        .bind(&token_id)
        .bind(&type_str)
        .bind(target_id)
        .bind(&now)
        .bind(issued_by)
        .execute(pool)
        .await?;

        tracing::info!(
            "令牌颁发: type={}, target={}, id={}",
            type_str,
            target_id,
            token_id
        );
        Ok(token_id)
    }

    /// 查询令牌是否存在
    pub async fn check_token(
        &self,
        pool: &SqlitePool,
        token_type: TokenType,
        target_id: &str,
    ) -> Result<bool, AppError> {
        let type_str = serde_json::to_string(&token_type)?
            .trim_matches('"')
            .to_string();

        let count: i64 = sqlx::query_scalar(
            r#"SELECT COUNT(*) FROM capability_tokens WHERE token_type = ? AND target_id = ?"#,
        )
        .bind(&type_str)
        .bind(target_id)
        .fetch_one(pool)
        .await?;

        Ok(count > 0)
    }

    /// 撤销令牌
    pub async fn revoke_token(
        &self,
        pool: &SqlitePool,
        token_id: &str,
    ) -> Result<(), AppError> {
        sqlx::query(r#"DELETE FROM capability_tokens WHERE token_id = ?"#)
            .bind(token_id)
            .execute(pool)
            .await?;

        tracing::info!("令牌撤销: id={}", token_id);
        Ok(())
    }

    /// 扫描所有被 blocking_on 阻塞的任务，解除阻塞，返回解除的 task_id 列表
    pub async fn unblock_tasks_by_reason(
        &self,
        pool: &SqlitePool,
        blocking_reason: &str,
    ) -> Result<Vec<String>, AppError> {
        let now = Utc::now().to_rfc3339();

        // First get the task IDs that will be unblocked
        let rows = sqlx::query(
            r#"SELECT task_id FROM agent_tasks WHERE status = 'Blocked' AND blocking_on = ?"#,
        )
        .bind(blocking_reason)
        .fetch_all(pool)
        .await?;

        let ids: Vec<String> = rows.iter().map(|r| r.get::<String, _>("task_id")).collect();

        if !ids.is_empty() {
            // Update all matching tasks
            sqlx::query(
                r#"
                UPDATE agent_tasks
                SET status = 'Pending', blocking_on = NULL, updated_at = ?
                WHERE status = 'Blocked' AND blocking_on = ?
                "#,
            )
            .bind(&now)
            .bind(blocking_reason)
            .execute(pool)
            .await?;
        }

        Ok(ids)
    }

    /// 获取所有待处理决策数量
    pub async fn pending_decision_count(&self, pool: &SqlitePool) -> Result<i64, AppError> {
        let count: i64 = sqlx::query_scalar(
            r#"SELECT COUNT(*) FROM decisions WHERE resolved_at IS NULL"#,
        )
        .fetch_one(pool)
        .await?;
        Ok(count)
    }
}

pub fn parse_task_type(s: &str) -> TaskType {
    match s {
        "ProductPlanning" => TaskType::ProductPlanning,
        "Review" => TaskType::Review,
        "Engineering" => TaskType::Engineering,
        "Memory" => TaskType::Memory,
        _ => TaskType::Memory,
    }
}

pub fn parse_agent_role(s: &str) -> AgentRole {
    match s {
        "Ceo" => AgentRole::Ceo,
        "ProductAgent" => AgentRole::ProductAgent,
        "ReviewAgent" => AgentRole::ReviewAgent,
        "TechnicalAgent" => AgentRole::TechnicalAgent,
        "QaAgent" => AgentRole::QaAgent, // v0.7
        _ => AgentRole::Ceo,
    }
}

pub fn parse_task_status(s: &str) -> TaskStatus {
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

pub fn new_task_id() -> String {
    Uuid::new_v4().to_string()
}

pub fn now_rfc3339() -> String {
    Utc::now().to_rfc3339()
}
