use futures_util::StreamExt;
use tauri::{command, AppHandle, Emitter, Manager};
use tokio_util::sync::CancellationToken;

use crate::stream_state::StreamState;

fn ai_service_url() -> String {
    std::env::var("AI_SERVICE_URL")
        .unwrap_or_else(|_| "http://localhost:8000/v1/chat".to_string())
}

fn parse_delta(line: &str) -> Option<String> {
    let data = line.strip_prefix("data: ")?;
    let val: serde_json::Value = serde_json::from_str(data).ok()?;
    if val["type"].as_str()? == "content_block_delta" {
        val["delta"]["text"].as_str().map(|s| s.to_string())
    } else {
        None
    }
}

fn parse_sse_error(line: &str) -> Option<String> {
    let data = line.strip_prefix("data: ")?;
    let val: serde_json::Value = serde_json::from_str(data).ok()?;
    val["error"].as_str().map(|s| s.to_string())
}

fn is_message_stop(line: &str) -> bool {
    if let Some(data) = line.strip_prefix("data: ") {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(data) {
            return val["type"].as_str() == Some("message_stop");
        }
    }
    false
}

fn parse_input_tokens(line: &str) -> Option<u32> {
    let data = line.strip_prefix("data: ")?;
    let val: serde_json::Value = serde_json::from_str(data).ok()?;
    if val["type"].as_str()? == "message_start" {
        val["message"]["usage"]["input_tokens"].as_u64().map(|n| n as u32)
    } else {
        None
    }
}

fn parse_output_tokens(line: &str) -> Option<u32> {
    let data = line.strip_prefix("data: ")?;
    let val: serde_json::Value = serde_json::from_str(data).ok()?;
    if val["type"].as_str()? == "message_delta" {
        val["usage"]["output_tokens"].as_u64().map(|n| n as u32)
    } else {
        None
    }
}

// --- Tool use event parsing ---

struct ToolUseState {
    index: usize,
    id: String,
    name: String,
    input_json: String,
}

fn parse_tool_use_start(line: &str) -> Option<(usize, String, String)> {
    let data = line.strip_prefix("data: ")?;
    let val: serde_json::Value = serde_json::from_str(data).ok()?;
    if val["type"].as_str()? == "content_block_start" {
        let block = &val["content_block"];
        if block["type"].as_str()? == "tool_use" {
            let index = val["index"].as_u64()? as usize;
            let id = block["id"].as_str()?.to_string();
            let name = block["name"].as_str()?.to_string();
            return Some((index, id, name));
        }
    }
    None
}

fn parse_input_json_delta(line: &str, expected_index: usize) -> Option<String> {
    let data = line.strip_prefix("data: ")?;
    let val: serde_json::Value = serde_json::from_str(data).ok()?;
    if val["type"].as_str()? == "content_block_delta"
        && val["index"].as_u64()? as usize == expected_index
    {
        let delta = &val["delta"];
        if delta["type"].as_str()? == "input_json_delta" {
            return delta["partial_json"].as_str().map(|s| s.to_string());
        }
    }
    None
}

fn is_tool_use_stop(line: &str) -> bool {
    if let Some(data) = line.strip_prefix("data: ") {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(data) {
            if val["type"].as_str() == Some("message_delta") {
                return val["delta"]["stop_reason"].as_str() == Some("tool_use");
            }
        }
    }
    false
}

macro_rules! remove_token {
    ($app:expr, $atom_id:expr) => {{
        let state = $app.state::<StreamState>();
        let mut lock = state.tokens.lock().unwrap();
        lock.remove($atom_id);
    }};
}

#[command]
pub async fn stream_ai(
    app: AppHandle,
    messages: Vec<serde_json::Value>,
    model: String,
    atom_id: String,
    system: Option<String>,
    tools: Option<serde_json::Value>,
    caching: Option<bool>,
    provider_key: Option<String>,
) -> Result<(), String> {
    let cancel = CancellationToken::new();
    {
        let state = app.state::<StreamState>();
        let mut lock = state.tokens.lock().unwrap();
        lock.insert(atom_id.clone(), cancel.clone());
    }

    let mut request_body = serde_json::json!({
        "model": model,
        "max_tokens": 4096,
        "stream": true,
        "messages": messages,
        "caching": caching.unwrap_or(false),
    });
    if let Some(sys) = system {
        if !sys.is_empty() {
            request_body["system"] = serde_json::Value::String(sys);
        }
    }
    if let Some(t) = tools {
        request_body["tools"] = t;
    }

    // bypass system proxy (e.g. http_proxy=127.0.0.1:7890) for localhost ai-service
    let client = reqwest::Client::builder()
        .no_proxy()
        .build()
        .unwrap_or_default();
    let mut req = client
        .post(&ai_service_url())
        .header("content-type", "application/json");
    if let Some(ref key) = provider_key {
        if !key.is_empty() {
            req = req.header("x-provider-key", key.as_str());
        }
    }

    let response = match req.json(&request_body).send().await {
        Ok(r) => r,
        Err(e) => {
            let user_msg = if e.to_string().contains("Connection refused")
                || e.to_string().contains("connection refused")
            {
                "AI 服务未连接，请先启动 ai-service（uvicorn main:app）".to_string()
            } else {
                e.to_string()
            };
            remove_token!(app, &atom_id);
            let _ = app.emit("ai-error", serde_json::json!({ "atom_id": atom_id, "error": user_msg }));
            return Err(user_msg);
        }
    };

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        remove_token!(app, &atom_id);
        let _ = app.emit("ai-error", serde_json::json!({ "atom_id": atom_id, "error": format!("HTTP {}: {}", status, body) }));
        return Err(format!("HTTP {}: {}", status, body));
    }

    let mut full_content = String::new();
    let mut input_tokens: Option<u32> = None;
    let mut output_tokens: Option<u32> = None;
    let mut done_emitted = false;
    let mut pending_tool: Option<ToolUseState> = None;
    let mut stream = response.bytes_stream();

    macro_rules! emit_done {
        () => {
            if !done_emitted {
                done_emitted = true;
                let _ = app.emit("ai-done", serde_json::json!({
                    "atom_id": atom_id,
                    "full_content": full_content,
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                }));
            }
        };
    }

    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                remove_token!(app, &atom_id);
                let _ = app.emit("ai-cancelled", serde_json::json!({ "atom_id": atom_id }));
                return Ok(());
            }
            chunk = stream.next() => {
                match chunk {
                    None => {
                        emit_done!();
                        remove_token!(app, &atom_id);
                        return Ok(());
                    }
                    Some(Err(e)) => {
                        remove_token!(app, &atom_id);
                        let _ = app.emit("ai-error", serde_json::json!({ "atom_id": atom_id, "error": e.to_string() }));
                        return Err(e.to_string());
                    }
                    Some(Ok(bytes)) => {
                        let text = String::from_utf8_lossy(&bytes);
                        for line in text.lines() {
                            if let Some(n) = parse_input_tokens(line) {
                                input_tokens = Some(n);
                            }
                            if let Some(n) = parse_output_tokens(line) {
                                output_tokens = Some(n);
                            }
                            if let Some(delta) = parse_delta(line) {
                                full_content.push_str(&delta);
                                let _ = app.emit("ai-token", serde_json::json!({ "atom_id": atom_id, "text": delta }));
                            }
                            if let Some(err) = parse_sse_error(line) {
                                remove_token!(app, &atom_id);
                                let _ = app.emit("ai-error", serde_json::json!({ "atom_id": atom_id, "error": err }));
                                return Err(err);
                            }
                            if let Some((idx, id, name)) = parse_tool_use_start(line) {
                                pending_tool = Some(ToolUseState {
                                    index: idx,
                                    id,
                                    name,
                                    input_json: String::new(),
                                });
                            }
                            if let Some(ref mut tool) = pending_tool {
                                if let Some(chunk) = parse_input_json_delta(line, tool.index) {
                                    tool.input_json.push_str(&chunk);
                                }
                            }
                            if is_tool_use_stop(line) {
                                if let Some(tool) = pending_tool.take() {
                                    let parsed_input: serde_json::Value =
                                        serde_json::from_str(&tool.input_json)
                                            .unwrap_or(serde_json::Value::Null);
                                    let _ = app.emit("ai-tool-call", serde_json::json!({
                                        "atom_id": atom_id,
                                        "tool_use_id": tool.id,
                                        "tool_name": tool.name,
                                        "tool_input": parsed_input,
                                    }));
                                }
                                remove_token!(app, &atom_id);
                                return Ok(());
                            }
                            if is_message_stop(line) {
                                emit_done!();
                                remove_token!(app, &atom_id);
                                return Ok(());
                            }
                        }
                    }
                }
            }
        }
    }
}

#[command]
pub async fn cancel_stream(app: AppHandle, atom_id: String) -> Result<(), String> {
    let state = app.state::<StreamState>();
    let mut lock = state.tokens.lock().unwrap();
    if atom_id.is_empty() {
        for (_, token) in lock.iter() {
            token.cancel();
        }
        lock.clear();
    } else if let Some(token) = lock.remove(&atom_id) {
        token.cancel();
    }
    Ok(())
}

// ── Unit tests ────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use tokio_util::sync::CancellationToken;

    // ── SSE line parsers ──────────────────────────────────────────────────────

    #[test]
    fn parse_delta_returns_text() {
        let line = r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}"#;
        assert_eq!(parse_delta(line), Some("Hello".to_string()));
    }

    #[test]
    fn parse_delta_ignores_non_delta_type() {
        let line = r#"data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}"#;
        assert_eq!(parse_delta(line), None);
    }

    #[test]
    fn parse_delta_ignores_non_data_prefix() {
        let line = "event: ping";
        assert_eq!(parse_delta(line), None);
    }

    #[test]
    fn parse_sse_error_extracts_error_field() {
        let line = r#"data: {"error":"overloaded_error"}"#;
        assert_eq!(parse_sse_error(line), Some("overloaded_error".to_string()));
    }

    #[test]
    fn parse_sse_error_returns_none_when_absent() {
        let line = r#"data: {"type":"content_block_delta"}"#;
        assert_eq!(parse_sse_error(line), None);
    }

    #[test]
    fn is_message_stop_true() {
        let line = r#"data: {"type":"message_stop"}"#;
        assert!(is_message_stop(line));
    }

    #[test]
    fn is_message_stop_false_for_other_types() {
        let line = r#"data: {"type":"message_delta"}"#;
        assert!(!is_message_stop(line));
    }

    #[test]
    fn parse_input_tokens_extracts_from_message_start() {
        let line = r#"data: {"type":"message_start","message":{"usage":{"input_tokens":42}}}"#;
        assert_eq!(parse_input_tokens(line), Some(42));
    }

    #[test]
    fn parse_input_tokens_none_for_wrong_type() {
        let line = r#"data: {"type":"message_delta","usage":{"output_tokens":10}}"#;
        assert_eq!(parse_input_tokens(line), None);
    }

    #[test]
    fn parse_output_tokens_extracts_from_message_delta() {
        let line = r#"data: {"type":"message_delta","usage":{"output_tokens":77}}"#;
        assert_eq!(parse_output_tokens(line), Some(77));
    }

    #[test]
    fn parse_output_tokens_none_for_wrong_type() {
        let line = r#"data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}"#;
        assert_eq!(parse_output_tokens(line), None);
    }

    #[test]
    fn parse_tool_use_start_extracts_fields() {
        let line = r#"data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tid_abc","name":"read_file"}}"#;
        assert_eq!(
            parse_tool_use_start(line),
            Some((1, "tid_abc".to_string(), "read_file".to_string()))
        );
    }

    #[test]
    fn parse_tool_use_start_ignores_text_block() {
        let line = r#"data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}"#;
        assert_eq!(parse_tool_use_start(line), None);
    }

    #[test]
    fn parse_input_json_delta_matches_index() {
        let line = r#"data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"file"}}"#;
        assert_eq!(parse_input_json_delta(line, 1), Some("file".to_string()));
    }

    #[test]
    fn parse_input_json_delta_rejects_wrong_index() {
        let line = r#"data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"file"}}"#;
        assert_eq!(parse_input_json_delta(line, 2), None);
    }

    #[test]
    fn is_tool_use_stop_true() {
        let line = r#"data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}"#;
        assert!(is_tool_use_stop(line));
    }

    #[test]
    fn is_tool_use_stop_false_for_end_turn() {
        let line = r#"data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}"#;
        assert!(!is_tool_use_stop(line));
    }

    // ── StreamState cancel logic ──────────────────────────────────────────────

    #[test]
    fn cancel_specific_atom_leaves_others_running() {
        let mut tokens = HashMap::new();
        let t1 = CancellationToken::new();
        let t2 = CancellationToken::new();
        tokens.insert("a1".to_string(), t1.clone());
        tokens.insert("a2".to_string(), t2.clone());

        if let Some(tok) = tokens.remove("a1") {
            tok.cancel();
        }

        assert!(t1.is_cancelled(), "a1 should be cancelled");
        assert!(!t2.is_cancelled(), "a2 should still be running");
        assert_eq!(tokens.len(), 1);
    }

    #[test]
    fn cancel_all_cancels_every_token_and_clears_map() {
        let mut tokens = HashMap::new();
        let t1 = CancellationToken::new();
        let t2 = CancellationToken::new();
        tokens.insert("a1".to_string(), t1.clone());
        tokens.insert("a2".to_string(), t2.clone());

        for (_, tok) in tokens.iter() {
            tok.cancel();
        }
        tokens.clear();

        assert!(t1.is_cancelled());
        assert!(t2.is_cancelled());
        assert!(tokens.is_empty());
    }

    #[test]
    fn cancel_nonexistent_atom_is_noop() {
        let mut tokens: HashMap<String, CancellationToken> = HashMap::new();
        let t1 = CancellationToken::new();
        tokens.insert("a1".to_string(), t1.clone());

        tokens.remove("nonexistent");

        assert!(!t1.is_cancelled(), "unrelated token must not be affected");
        assert_eq!(tokens.len(), 1);
    }

    #[test]
    fn cancel_specific_removes_token_from_map() {
        let mut tokens = HashMap::new();
        let t1 = CancellationToken::new();
        tokens.insert("a1".to_string(), t1.clone());

        if let Some(tok) = tokens.remove("a1") {
            tok.cancel();
        }

        assert!(tokens.is_empty(), "token must be removed after cancel");
    }
}
