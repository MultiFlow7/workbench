use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("数据库错误: {0}")]
    DbError(#[from] sqlx::Error),

    #[error("调度错误: {0}")]
    DispatchError(String),

    #[error("Harness 错误: {0}")]
    HarnessError(String),

    #[error("未找到: {0}")]
    NotFound(String),

    #[error("沙盒违规: 文件路径不在白名单内: {path}")]
    SandboxViolation { path: String },

    #[error("JSON 序列化错误: {0}")]
    SerdeError(#[from] serde_json::Error),

    #[error("IO 错误: {0}")]
    IoError(#[from] std::io::Error),

    #[error("HTTP 请求错误: {0}")]
    ReqwestError(#[from] reqwest::Error),

    #[error("内部错误: {0}")]
    InternalError(String),

    #[error("非法输入: {0}")]
    InvalidInput(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, msg.clone()),
            AppError::SandboxViolation { path } => (
                StatusCode::FORBIDDEN,
                format!("沙盒违规: 文件路径不在白名单内: {}", path),
            ),
            AppError::DbError(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("数据库错误: {}", e),
            ),
            AppError::DispatchError(msg) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("调度错误: {}", msg),
            ),
            AppError::HarnessError(msg) => (
                StatusCode::FORBIDDEN,
                format!("Harness 错误: {}", msg),
            ),
            AppError::SerdeError(e) => (
                StatusCode::BAD_REQUEST,
                format!("JSON 序列化错误: {}", e),
            ),
            AppError::IoError(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("IO 错误: {}", e),
            ),
            AppError::ReqwestError(e) => (
                StatusCode::BAD_GATEWAY,
                format!("HTTP 请求错误: {}", e),
            ),
            AppError::InternalError(msg) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                msg.clone(),
            ),
            AppError::InvalidInput(msg) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                msg.clone(),
            ),
        };

        tracing::error!("AppError: {}", message);

        let body = Json(json!({
            "error": message
        }));

        (status, body).into_response()
    }
}
