use axum::{
    extract::Path,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

/// registry.yaml の agents エントリ構造
#[derive(Debug, Serialize, Deserialize, Clone)]
struct RegistryAgent {
    pub id: String,
    pub path: String,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub project: Option<String>,
}

/// registry.yaml トップレベル構造
#[derive(Debug, Deserialize)]
struct Registry {
    #[serde(default)]
    pub agents: Vec<RegistryAgent>,
}

/// 读取 registry.yaml，返回 agents 列表
fn load_registry() -> Result<Registry, String> {
    let registry_path = std::env::var("REGISTRY_PATH")
        .unwrap_or_else(|_| "../agent-registry/registry.yaml".to_string());

    let content = std::fs::read_to_string(&registry_path)
        .map_err(|e| format!("无法读取 registry.yaml ({}): {}", registry_path, e))?;

    serde_yaml::from_str::<Registry>(&content)
        .map_err(|e| format!("解析 registry.yaml 失败: {}", e))
}

/// GET /agents/registry
pub async fn list_agents_handler() -> Response {
    match load_registry() {
        Err(msg) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": msg})),
        )
            .into_response(),
        Ok(registry) => {
            let agents: Vec<serde_json::Value> = registry
                .agents
                .into_iter()
                .map(|a| {
                    json!({
                        "id": a.id,
                        "path": a.path,
                        "status": a.status.unwrap_or_else(|| "unknown".to_string()),
                        "description": a.description.unwrap_or_default(),
                    })
                })
                .collect();
            Json(json!(agents)).into_response()
        }
    }
}

/// GET /agents/:role/doc
pub async fn get_agent_doc_handler(Path(role): Path<String>) -> Response {
    let registry = match load_registry() {
        Err(msg) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": msg})),
            )
                .into_response();
        }
        Ok(r) => r,
    };

    // Find agent entry matching the role id
    let agent = registry.agents.iter().find(|a| a.id == role);

    match agent {
        None => (
            StatusCode::NOT_FOUND,
            Json(json!({
                "error": format!("未找到 agent: {}。请检查 registry.yaml 中的 id 字段。", role)
            })),
        )
            .into_response(),
        Some(agent) => {
            let registry_path = std::env::var("REGISTRY_PATH")
                .unwrap_or_else(|_| "../agent-registry/registry.yaml".to_string());

            // Resolve base dir of registry.yaml
            let registry_dir = std::path::Path::new(&registry_path)
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| std::path::PathBuf::from("."));

            let agent_dir = registry_dir.join(&agent.path);

            // Try AGENT.md first
            let agent_md_path = agent_dir.join("AGENT.md");
            if agent_md_path.exists() {
                match std::fs::read_to_string(&agent_md_path) {
                    Ok(content) => {
                        return (
                            StatusCode::OK,
                            [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
                            content,
                        )
                            .into_response();
                    }
                    Err(e) => {
                        return (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(json!({"error": format!("读取 AGENT.md 失败: {}", e)})),
                        )
                            .into_response();
                    }
                }
            }

            // Fallback: try agent-roster.md in the agent dir
            let roster_path = agent_dir.join("agent-roster.md");
            if roster_path.exists() {
                match std::fs::read_to_string(&roster_path) {
                    Ok(content) => {
                        return (
                            StatusCode::OK,
                            [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
                            content,
                        )
                            .into_response();
                    }
                    Err(_) => {}
                }
            }

            // Nothing found
            (
                StatusCode::NOT_FOUND,
                Json(json!({
                    "error": format!(
                        "Agent {} 的文档文件不存在 (已尝试 AGENT.md 和 agent-roster.md，路径: {})",
                        role,
                        agent_dir.display()
                    )
                })),
            )
                .into_response()
        }
    }
}
