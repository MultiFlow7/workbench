use axum::extract::State;
use axum::response::sse::{Event, KeepAlive, Sse};
use futures_util::stream::Stream;
use std::convert::Infallible;
use std::time::Duration;
use tokio_stream::{wrappers::BroadcastStream, StreamExt};

use crate::AppState;

pub async fn sse_stream_handler(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = state.sse_tx.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|result| {
        match result {
            Ok(event) => {
                let json = serde_json::to_string(&event).unwrap_or_else(|e| {
                    tracing::error!("SSE event serialize error: {}", e);
                    "{}".to_string()
                });
                Some(Ok(Event::default().data(json)))
            }
            Err(e) => {
                tracing::warn!("SSE broadcast recv error: {}", e);
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
