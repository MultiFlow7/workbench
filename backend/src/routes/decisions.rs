use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::json;

use crate::{
    decisions::handlers::{get_decision, list_decisions, resolve_decision},
    error::AppError,
    AppState,
};

#[derive(Debug, Deserialize)]
pub struct ListDecisionsQuery {
    pub filter: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ResolveRequest {
    pub resolution: String,
}

pub async fn list_decisions_handler(
    State(state): State<AppState>,
    Query(query): Query<ListDecisionsQuery>,
) -> Result<impl IntoResponse, AppError> {
    let decisions = list_decisions(&state.db, query.filter.as_deref()).await?;
    Ok(Json(decisions))
}

pub async fn get_decision_handler(
    State(state): State<AppState>,
    Path(decision_id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let decision = get_decision(&state.db, &decision_id).await?;
    Ok(Json(decision))
}

pub async fn resolve_decision_handler(
    State(state): State<AppState>,
    Path(decision_id): Path<String>,
    Json(req): Json<ResolveRequest>,
) -> Result<impl IntoResponse, AppError> {
    resolve_decision(&state.db, &state.sse_tx, &decision_id, &req.resolution).await?;
    Ok(Json(json!({"ok": true})))
}
