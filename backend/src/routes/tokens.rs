use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::json;

use crate::{
    error::AppError,
    state_machine::{token::TokenType, StateMachine},
    AppState,
};

#[derive(Debug, Deserialize)]
pub struct IssueTokenRequest {
    pub token_type: String,
    pub target_id: String,
    pub issued_by: String,
}

#[derive(Debug, Deserialize)]
pub struct CheckTokenQuery {
    pub token_type: String,
    pub target_id: String,
}

fn parse_token_type(s: &str) -> TokenType {
    match s {
        "Deliverable" => TokenType::Deliverable,
        "Approved" => TokenType::Approved,
        "Mergeable" => TokenType::Mergeable,
        _ => TokenType::Deliverable,
    }
}

pub async fn issue_token(
    State(state): State<AppState>,
    Json(req): Json<IssueTokenRequest>,
) -> Result<impl IntoResponse, AppError> {
    let sm = StateMachine::new();
    let token_type = parse_token_type(&req.token_type);
    let token_id = sm
        .issue_token(&state.db, token_type, &req.target_id, &req.issued_by)
        .await?;
    Ok(Json(json!({"token_id": token_id})))
}

pub async fn check_token(
    State(state): State<AppState>,
    Query(query): Query<CheckTokenQuery>,
) -> Result<impl IntoResponse, AppError> {
    let sm = StateMachine::new();
    let token_type = parse_token_type(&query.token_type);
    let exists = sm
        .check_token(&state.db, token_type, &query.target_id)
        .await?;
    Ok(Json(json!({"exists": exists})))
}

pub async fn revoke_token(
    State(state): State<AppState>,
    Path(token_id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let sm = StateMachine::new();
    sm.revoke_token(&state.db, &token_id).await?;
    Ok((StatusCode::OK, Json(json!({"ok": true}))))
}
