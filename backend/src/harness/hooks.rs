use sqlx::SqlitePool;
use thiserror::Error;
use tracing::{info, warn};

use crate::state_machine::{StateMachine, task::TaskStatus, token::TokenType};

#[derive(Debug, Error)]
pub enum HarnessError {
    #[error("产品文档尚未通过 review-agent 审查，technical agent 拒绝拉取: {path}")]
    DocumentNotDelivered { path: String },

    #[error("technical.md 尚未经 CEO 审批，工程 Agent 拒绝启动: {path}")]
    NotApproved { path: String },

    #[error("数据库错误: {0}")]
    DbError(#[from] crate::error::AppError),
}

/// pre-hook：检查 DELIVERABLE 令牌（review-agent 审查通过门）
pub async fn pre_hook_technical_intake(
    pool: &SqlitePool,
    task_id: &str,
    product_md_path: &str,
) -> Result<(), HarnessError> {
    let sm = StateMachine::new();

    let token_exists = sm
        .check_token(pool, TokenType::Deliverable, product_md_path)
        .await?;

    if !token_exists {
        warn!(
            "[harness] DocumentNotDelivered: task_id={}, path={}",
            task_id, product_md_path
        );
        sm.update_status(pool, task_id, TaskStatus::Blocked).await?;
        sm.set_blocking_on(pool, task_id, "product_doc_not_delivered")
            .await?;
        return Err(HarnessError::DocumentNotDelivered {
            path: product_md_path.to_string(),
        });
    }

    info!(
        "[harness] pre_hook_technical_intake: DELIVERABLE token found for {}",
        product_md_path
    );
    Ok(())
}

/// pre-hook：检查 APPROVED 令牌（技术审批门）
pub async fn pre_hook_engineering_start(
    pool: &SqlitePool,
    task_id: &str,
    technical_md_path: &str,
) -> Result<(), HarnessError> {
    let sm = StateMachine::new();

    let token_exists = sm
        .check_token(pool, TokenType::Approved, technical_md_path)
        .await?;

    if !token_exists {
        warn!(
            "[harness] NotApproved: task_id={}, path={}",
            task_id, technical_md_path
        );
        sm.update_status(pool, task_id, TaskStatus::Blocked).await?;
        sm.set_blocking_on(pool, task_id, "technical_not_approved")
            .await?;
        return Err(HarnessError::NotApproved {
            path: technical_md_path.to_string(),
        });
    }

    info!(
        "[harness] pre_hook_engineering_start: APPROVED token found for {}",
        technical_md_path
    );
    Ok(())
}
