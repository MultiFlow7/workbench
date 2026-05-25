use std::collections::HashMap;
use std::time::Duration;

fn backend_url() -> String {
    std::env::var("BACKEND_URL")
        .unwrap_or_else(|_| "http://localhost:8081".to_string())
}

/// Node 10: 返回后端地址，供前端动态构造 EventSource URL，避免 hardcode
#[tauri::command]
pub async fn get_backend_url() -> Result<String, String> {
    Ok(backend_url())
}

fn make_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .expect("failed to build reqwest client")
}

/// Node 10 确认：task_req 为 serde_json::Value，前端新增的 file_refs / trigger_reason
/// 字段直接序列化透传到后端 /api/tasks，无需 Rust 侧改动。
#[tauri::command]
pub async fn create_task(task_req: serde_json::Value) -> Result<String, String> {
    let client = make_client();
    let url = format!("{}/api/tasks", backend_url());
    let resp = client
        .post(&url)
        .json(&task_req)
        .send()
        .await
        .map_err(|e| format!("create_task request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("create_task HTTP {}: {}", status, body));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("create_task parse failed: {}", e))?;

    let task_id = body
        .get("task_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("create_task: no task_id in response: {}", body))?;

    Ok(task_id)
}

#[tauri::command]
pub async fn dispatch_task(
    task_id: String,
    documents: HashMap<String, String>,
) -> Result<(), String> {
    let client = make_client();
    let url = format!("{}/api/tasks/{}/dispatch", backend_url(), task_id);
    let body = serde_json::json!({ "documents": documents });
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("dispatch_task request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("dispatch_task HTTP {}: {}", status, text));
    }

    Ok(())
}

#[tauri::command]
pub async fn list_decisions(filter: Option<String>) -> Result<Vec<serde_json::Value>, String> {
    let client = make_client();
    let mut url = format!("{}/api/decisions", backend_url());
    if let Some(f) = filter {
        url = format!("{}?filter={}", url, f);
    }
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("list_decisions request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("list_decisions HTTP {}: {}", status, text));
    }

    let list: Vec<serde_json::Value> = resp
        .json()
        .await
        .map_err(|e| format!("list_decisions parse failed: {}", e))?;

    Ok(list)
}

#[tauri::command]
pub async fn get_decision(decision_id: String) -> Result<serde_json::Value, String> {
    let client = make_client();
    let url = format!("{}/api/decisions/{}", backend_url(), decision_id);
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("get_decision request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("get_decision HTTP {}: {}", status, text));
    }

    let record: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("get_decision parse failed: {}", e))?;

    Ok(record)
}

#[tauri::command]
pub async fn resolve_decision(
    decision_id: String,
    resolution: String,
) -> Result<(), String> {
    let client = make_client();
    let url = format!("{}/api/decisions/{}/resolve", backend_url(), decision_id);
    let body = serde_json::json!({ "resolution": resolution });
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("resolve_decision request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("resolve_decision HTTP {}: {}", status, text));
    }

    Ok(())
}

#[tauri::command]
pub async fn check_backend_health() -> Result<bool, String> {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
    {
        Ok(c) => c,
        Err(_) => return Ok(false),
    };

    let url = format!("{}/health", backend_url());
    match client.get(&url).send().await {
        Ok(resp) => Ok(resp.status().is_success()),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
pub async fn list_tasks(
    status: Option<String>,
    role: Option<String>,
    project: Option<String>,
) -> Result<Vec<serde_json::Value>, String> {
    let client = make_client();
    let mut params: Vec<String> = Vec::new();
    if let Some(s) = status  { params.push(format!("status={}", s)); }
    if let Some(r) = role    { params.push(format!("role={}", r)); }
    if let Some(p) = project { params.push(format!("project={}", p)); }
    let url = if params.is_empty() {
        format!("{}/api/tasks", backend_url())
    } else {
        format!("{}/api/tasks?{}", backend_url(), params.join("&"))
    };
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("list_tasks request failed: {}", e))?;

    if !resp.status().is_success() {
        let status_code = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("list_tasks HTTP {}: {}", status_code, text));
    }

    let list: Vec<serde_json::Value> = resp
        .json()
        .await
        .map_err(|e| format!("list_tasks parse failed: {}", e))?;

    Ok(list)
}

#[tauri::command]
pub async fn get_task_stats() -> Result<serde_json::Value, String> {
    let client = make_client();
    let url = format!("{}/api/tasks/stats", backend_url());
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("get_task_stats request failed: {}", e))?;

    if !resp.status().is_success() {
        let status_code = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("get_task_stats HTTP {}: {}", status_code, text));
    }

    let stats: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("get_task_stats parse failed: {}", e))?;

    Ok(stats)
}

#[tauri::command]
pub async fn get_token_stats_from_gateway(
    date_from: Option<String>,
    date_to: Option<String>,
) -> Result<Vec<serde_json::Value>, String> {
    let client = make_client();
    let mut parts: Vec<String> = Vec::new();
    if let Some(ref df) = date_from { parts.push(format!("date_from={}", df)); }
    if let Some(ref dt) = date_to   { parts.push(format!("date_to={}", dt));   }
    let url = if parts.is_empty() {
        format!("{}/llm/stats", backend_url())
    } else {
        format!("{}/llm/stats?{}", backend_url(), parts.join("&"))
    };

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("get_token_stats request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("get_token_stats HTTP {}: {}", status, text));
    }

    let data: Vec<serde_json::Value> = resp
        .json()
        .await
        .map_err(|e| format!("get_token_stats parse failed: {}", e))?;

    Ok(data)
}

/// v0.8: 列出 capability tokens，支持按 project/version/token_type/active_only/task_id 过滤
#[tauri::command]
pub async fn list_capability_tokens(
    filter: serde_json::Value,
) -> Result<Vec<serde_json::Value>, String> {
    let client = make_client();
    let mut params: Vec<String> = Vec::new();
    if let Some(p) = filter.get("project").and_then(|v| v.as_str()) {
        if !p.is_empty() {
            params.push(format!("project={}", p));
        }
    }
    if let Some(v) = filter.get("version").and_then(|v| v.as_str()) {
        if !v.is_empty() {
            params.push(format!("version={}", v));
        }
    }
    if let Some(t) = filter.get("token_type").and_then(|v| v.as_str()) {
        if !t.is_empty() {
            params.push(format!("token_type={}", t));
        }
    }
    if let Some(tid) = filter.get("task_id").and_then(|v| v.as_str()) {
        if !tid.is_empty() {
            params.push(format!("task_id={}", tid));
        }
    }
    if filter.get("active_only").and_then(|v| v.as_bool()) == Some(true) {
        params.push("active_only=true".to_string());
    }
    let url = if params.is_empty() {
        format!("{}/api/capability-tokens", backend_url())
    } else {
        format!(
            "{}/api/capability-tokens?{}",
            backend_url(),
            params.join("&")
        )
    };
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("list_capability_tokens request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("list_capability_tokens HTTP {}: {}", status, text));
    }

    let list: Vec<serde_json::Value> = resp
        .json()
        .await
        .map_err(|e| format!("list_capability_tokens parse failed: {}", e))?;

    Ok(list)
}

/// v0.8: 手动颁发 capability token（CEO 专属操作）
#[tauri::command]
pub async fn create_capability_token(
    req: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let client = make_client();
    let url = format!("{}/api/capability-tokens", backend_url());
    let resp = client
        .post(&url)
        .json(&req)
        .send()
        .await
        .map_err(|e| format!("create_capability_token request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("create_capability_token HTTP {}: {}", status, text));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("create_capability_token parse failed: {}", e))?;

    Ok(json)
}

/// v0.9 req-029: 获取 LLM 调用统计
#[tauri::command]
pub async fn get_llm_stats(days: u32) -> Result<serde_json::Value, String> {
    let client = make_client();
    let url = format!("{}/api/llm-stats?days={}", backend_url(), days);
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("get_llm_stats request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("get_llm_stats HTTP {}: {}", status, text));
    }

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("get_llm_stats parse failed: {}", e))?;

    Ok(data)
}

/// v0.8: 撤销指定 capability token
#[tauri::command]
pub async fn revoke_capability_token(
    token_id: String,
) -> Result<(), String> {
    let client = make_client();
    let url = format!(
        "{}/api/capability-tokens/{}",
        backend_url(), token_id
    );
    let resp = client
        .delete(&url)
        .send()
        .await
        .map_err(|e| format!("revoke_capability_token request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("revoke_capability_token HTTP {}: {}", status, text));
    }

    Ok(())
}
