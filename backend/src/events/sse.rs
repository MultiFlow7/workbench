use axum::{
    extract::State,
    response::sse::{Event, KeepAlive, Sse},
};
use futures_util::stream::Stream;
use serde::{Deserialize, Serialize};
use std::{convert::Infallible, time::Duration};
use tokio::sync::broadcast;
use tokio_stream::{wrappers::BroadcastStream, StreamExt};

use crate::{
    state_machine::task::{DecisionRequest, TaskStatus},
    AppState,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SseEvent {
    TaskStatusChanged {
        task_id: String,
        new_status: TaskStatus,
        decision_request: Option<DecisionRequest>,
    },
    DecisionCreated {
        decision_id: String,
        count: i64,
    },
    DecisionResolved {
        decision_id: String,
        count: i64,
    },
    Heartbeat,
}

/// v0.7: 通知层专用事件类型（用于 /sse/notifications 端点）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SseNotification {
    TaskCompleted {
        task_id: String,
        role: String,
        title: String,
        summary: String,
        timestamp: String,
    },
    TaskFailed {
        task_id: String,
        role: String,
        title: String,
        error_brief: String,
        timestamp: String,
    },
    PipelineTriggered {
        rule_id: String,
        source_version: String,
        target_role: String,
        new_task_id: String,
        timestamp: String,
    },
    DecisionRequested {
        decision_id: String,
        task_id: String,
        risk_level: String,
        timestamp: String,
    },
}

pub fn new_broadcast() -> broadcast::Sender<SseEvent> {
    let (tx, _) = broadcast::channel(128);
    tx
}

pub async fn sse_handler(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = state.sse_tx.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|result| {
        match result {
            Ok(event) => {
                let json = serde_json::to_string(&event).unwrap_or_else(|e| {
                    tracing::error!("SSE 事件序列化失败: {}", e);
                    "{}".to_string()
                });
                let sse_event = Event::default().data(json);
                Some(Ok(sse_event))
            }
            Err(e) => {
                tracing::warn!("SSE 广播接收错误: {}", e);
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
