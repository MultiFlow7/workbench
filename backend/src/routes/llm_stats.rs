// v0.9 req-029: GET /api/llm-stats?days=N
use axum::{
    extract::{Query, State},
    response::Json,
};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::AppState;

#[derive(Deserialize)]
pub struct LlmStatsQuery {
    pub days: Option<i64>,
}

pub async fn llm_stats_handler(
    State(state): State<AppState>,
    Query(params): Query<LlmStatsQuery>,
) -> Json<Value> {
    let days = params.days.unwrap_or(7).max(1);
    let since = Utc::now() - chrono::Duration::seconds(days * 86400);
    let since_str = since.to_rfc3339();

    // 总计聚合
    let row = sqlx::query_as::<_, (i64, i64, i64)>(
        "SELECT COUNT(*), COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0) \
         FROM llm_calls WHERE called_at >= ?",
    )
    .bind(&since_str)
    .fetch_one(&state.db)
    .await;

    let (total_calls, total_input_tokens, total_output_tokens) = match row {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("[llm_stats] query failed: {}", e);
            return Json(json!({
                "total_calls": 0,
                "total_input_tokens": 0,
                "total_output_tokens": 0,
                "by_model": []
            }));
        }
    };

    // 按 model 分组
    let by_model_rows = sqlx::query_as::<_, (String, i64, i64, i64)>(
        "SELECT model, COUNT(*), COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0) \
         FROM llm_calls WHERE called_at >= ? \
         GROUP BY model ORDER BY COUNT(*) DESC",
    )
    .bind(&since_str)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let by_model: Vec<Value> = by_model_rows
        .into_iter()
        .map(|(model, calls, input, output)| {
            json!({
                "model": model,
                "calls": calls,
                "input_tokens": input,
                "output_tokens": output,
            })
        })
        .collect();

    Json(json!({
        "total_calls": total_calls,
        "total_input_tokens": total_input_tokens,
        "total_output_tokens": total_output_tokens,
        "by_model": by_model
    }))
}
