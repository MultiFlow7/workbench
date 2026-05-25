use futures_util::StreamExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const SSE_URL: &str = "http://43.135.174.27:8081/api/events/stream";

// Global stop flag; using OnceLock so we share one flag for the whole app lifetime.
static STOP_FLAG: std::sync::OnceLock<Arc<AtomicBool>> = std::sync::OnceLock::new();

fn stop_flag() -> Arc<AtomicBool> {
    STOP_FLAG
        .get_or_init(|| Arc::new(AtomicBool::new(false)))
        .clone()
}

#[tauri::command]
pub async fn start_backend_sse(app: AppHandle) -> Result<(), String> {
    let flag = stop_flag();
    // Reset stop flag in case stop_backend_sse was called before
    flag.store(false, Ordering::SeqCst);

    // Spawn so the command returns immediately (non-blocking)
    tokio::spawn(async move {
        sse_loop(app, flag).await;
    });

    Ok(())
}

#[tauri::command]
pub async fn stop_backend_sse(_app: AppHandle) -> Result<(), String> {
    let flag = stop_flag();
    flag.store(true, Ordering::SeqCst);
    Ok(())
}

async fn sse_loop(app: AppHandle, stop: Arc<AtomicBool>) {
    let mut backoff_secs: u64 = 1;

    loop {
        if stop.load(Ordering::SeqCst) {
            break;
        }

        let connected_ok = match connect_and_read(&app, &stop).await {
            Ok(_) => {
                // Stream ended cleanly — treat as disconnect and reconnect
                true
            }
            Err(e) => {
                eprintln!("[sse_client] connection error: {}", e);
                false
            }
        };

        if stop.load(Ordering::SeqCst) {
            break;
        }

        // Reset backoff on clean disconnect; increase on error
        if connected_ok {
            backoff_secs = 1;
        }

        // Exponential backoff: 1s → 2s → 4s → … → 30s max
        tokio::time::sleep(Duration::from_secs(backoff_secs)).await;
        if !connected_ok {
            backoff_secs = (backoff_secs * 2).min(30);
        }

        // Emit reconnected event so front-end can re-sync
        let reconnect_payload = serde_json::json!({ "type": "reconnected" });
        let _ = app.emit("backend-sse", reconnect_payload);
    }
}

async fn connect_and_read(
    app: &AppHandle,
    stop: &Arc<AtomicBool>,
) -> Result<(), String> {
    // No timeout for SSE streaming — connection stays open indefinitely
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("build client: {}", e))?;

    let resp = client
        .get(SSE_URL)
        .header("Accept", "text/event-stream")
        .send()
        .await
        .map_err(|e| format!("SSE connect: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("SSE HTTP {}", resp.status()));
    }

    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        if stop.load(Ordering::SeqCst) {
            break;
        }

        let bytes = chunk.map_err(|e| format!("SSE read error: {}", e))?;
        let text = String::from_utf8_lossy(&bytes);
        buffer.push_str(&text);

        // Process complete lines
        while let Some(newline_pos) = buffer.find('\n') {
            let line = buffer[..newline_pos].trim_end_matches('\r').to_string();
            buffer.drain(..=newline_pos);

            if let Some(data) = line.strip_prefix("data: ") {
                if data.is_empty() {
                    continue;
                }
                // Parse as JSON to validate, then emit as Value
                match serde_json::from_str::<serde_json::Value>(data) {
                    Ok(payload) => {
                        let _ = app.emit("backend-sse", payload);
                    }
                    Err(e) => {
                        eprintln!("[sse_client] invalid JSON in SSE data: {} — {}", e, data);
                    }
                }
            }
            // Lines starting with ":" are SSE comments (keep-alive), ignore them
        }
    }

    Ok(())
}
