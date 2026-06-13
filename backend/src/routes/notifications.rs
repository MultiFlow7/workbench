use axum::{
    extract::State,
    response::sse::{Event, KeepAlive, Sse},
};
use futures_util::stream::Stream;
use std::{convert::Infallible, time::Duration};
use tokio_stream::{wrappers::BroadcastStream, StreamExt};

use crate::AppState;

/// GET /sse/notifications — 全应用常驻通知 SSE 端点（v0.7）
pub async fn notifications_sse_handler(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = state.notify_tx.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|result| {
        match result {
            Ok(notification) => {
                let json = serde_json::to_string(&notification).unwrap_or_else(|e| {
                    tracing::error!("[notifications] 事件序列化失败: {}", e);
                    "{}".to_string()
                });
                let sse_event = Event::default().data(json);
                Some(Ok(sse_event))
            }
            Err(e) => {
                tracing::warn!("[notifications] 广播接收错误: {}", e);
                None
            }
        }
    });

    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(30))
            .text("keep-alive"),
    )
}
