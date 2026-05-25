use std::collections::HashMap;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tracing::{info, warn};
use uuid::Uuid;

use crate::{
    error::AppError,
    sandbox::validate_uploaded_docs,
    state_machine::task::{AgentRole, AgentTask},
};

#[derive(Debug, Serialize, Deserialize)]
pub struct ClaudePrompt {
    pub system: String,
    pub messages: Vec<ApiMessage>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ApiMessage {
    pub role: String,
    pub content: String,
}

pub struct ContextBuilder {
    pub roles_dir: String,
    pub workspace_root: String,
    pub projects_dir: String,
}

impl ContextBuilder {
    pub fn new(roles_dir: String, workspace_root: String, projects_dir: String) -> Self {
        ContextBuilder {
            roles_dir,
            workspace_root,
            projects_dir,
        }
    }

    pub async fn build(
        &self,
        task: &AgentTask,
        uploaded_docs: &HashMap<String, String>,
    ) -> Result<ClaudePrompt, AppError> {
        let build_start = Instant::now();
        let mut system_parts: Vec<String> = Vec::new();

        // 层 1: Role system prompt
        let role_prompt = self.load_role_system_prompt(&task.role).await;
        system_parts.push(role_prompt);

        // 层 2: Task state
        let task_state = self.format_task_state(task);
        system_parts.push(task_state);

        // 层 3: Relevant documents (uploaded_docs whitelist mode)
        let allowed = task.allowed_documents(&self.projects_dir);
        if allowed.is_empty() {
            info!("[context_builder] skipped: no allowed documents");
        } else {
            // Validate uploaded docs don't contain whitelist violations
            validate_uploaded_docs(uploaded_docs, &allowed)?;

            for doc_path in &allowed {
                if let Some(content) = uploaded_docs.get(doc_path) {
                    let doc_section = format!(
                        "## 文档: {}\n\n{}",
                        doc_path, content
                    );
                    system_parts.push(doc_section);
                    info!("[context_builder] injected document: {}", doc_path);
                } else {
                    warn!("[context_builder] doc not uploaded: {}", doc_path);
                }
            }
        }

        // 层 3b: file_refs 注入（v0.7 新增）
        self.inject_file_refs(task, &mut system_parts).await;

        // 层 4: Trigger context
        let trigger_context = self.format_trigger_context(task);
        if !trigger_context.is_empty() {
            system_parts.push(trigger_context);
        }

        // 层 5: Memory injection
        if let Some(memory_path) = task.memory_hint() {
            if let Some(memory_content) = uploaded_docs.get(&memory_path) {
                let memory_section = format!(
                    "## 记忆注入\n\n{}",
                    memory_content
                );
                system_parts.push(memory_section);
                info!("[context_builder] injected memory: {}", memory_path);
            } else {
                warn!("[context_builder] memory_hint not found in uploads: {}", memory_path);
            }
        }

        let system = system_parts.join("\n\n---\n\n");

        // Build messages from input_context
        let messages = self.build_messages(task);

        // Node 7 埋点：context_build_duration
        let build_ms = build_start.elapsed().as_millis() as u64;
        let context_tokens = (system.len() + messages.iter().map(|m| m.content.len()).sum::<usize>()) / 4;
        info!(
            "[context_builder] build completed: task_id={}, build_ms={}, context_tokens={}",
            task.task_id, build_ms, context_tokens
        );
        // 将埋点记录到 ui_events（由 dispatcher 写入，context_builder 只记录日志）
        let _ = (build_ms, context_tokens); // 供调度器使用的数据在此处可用

        Ok(ClaudePrompt { system, messages })
    }

    /// v0.7 新增：注入 file_refs 文件内容到 system context
    async fn inject_file_refs(&self, task: &AgentTask, system_parts: &mut Vec<String>) {
        let file_refs_json = match &task.file_refs {
            Some(s) if !s.is_empty() => s,
            _ => return,
        };

        let paths: Vec<String> = match serde_json::from_str(file_refs_json) {
            Ok(v) => v,
            Err(e) => {
                warn!(
                    "[context_builder] file_refs 解析失败 for task {}: {}",
                    task.task_id, e
                );
                return;
            }
        };

        for path in &paths {
            let full_path = format!("{}/{}", self.workspace_root, path);
            match tokio::fs::read_to_string(&full_path).await {
                Ok(content) => {
                    let section = format!("## 文档: {}\n\n{}", path, content);
                    system_parts.push(section);
                    info!("[context_builder] injected file_ref: {}", path);
                }
                Err(_) => {
                    let section = format!(
                        "## 文档: {}\n\n⚠️ 文件未找到: {}",
                        path, path
                    );
                    system_parts.push(section);
                    warn!("[context_builder] file_ref not found: {}", path);
                }
            }
        }
    }

    async fn load_role_system_prompt(&self, role: &AgentRole) -> String {
        let role_filename = match role {
            AgentRole::ReviewAgent => "review_agent.md",
            AgentRole::ProductAgent => "product_agent.md",
            AgentRole::TechnicalAgent => "technical_agent.md",
            AgentRole::Ceo => "ceo_event.md",
            AgentRole::QaAgent => "qa_agent.md", // v0.7
        };

        let file_path = format!("{}/{}", self.roles_dir, role_filename);

        match tokio::fs::read_to_string(&file_path).await {
            Ok(content) => {
                info!("[context_builder] loaded role prompt from {}", file_path);
                content
            }
            Err(_) => {
                warn!(
                    "[context_builder] role file not found: {}, using embedded default",
                    file_path
                );
                self.embedded_default_prompt(role)
            }
        }
    }

    fn embedded_default_prompt(&self, role: &AgentRole) -> String {
        match role {
            AgentRole::ReviewAgent => {
                "你是 review-agent，负责系统性检查产品文档和技术文档，输出审查报告，字段：passed(bool) + review_report(string)。\n\n审查完成后，请以 JSON 格式返回：{\"passed\": true/false, \"review_report\": \"...\"}".to_string()
            }
            AgentRole::ProductAgent => {
                "你是 product-agent，负责起草产品规划文档，参考产品方向和需求池。".to_string()
            }
            AgentRole::TechnicalAgent => {
                "你是 technical-agent，负责按 technical.md 节点执行工程实现。".to_string()
            }
            AgentRole::Ceo => {
                "你是 CEO，处理后台任务完成事件，若需用户决策输出 decision_required:true 和 DecisionRecord JSON。\n\n若需要用户决策，请以如下格式输出：\n```json\n{\n  \"decision_required\": true,\n  \"decision\": {\n    \"question\": \"...\",\n    \"options\": [{\"key\": \"approve\", \"label\": \"批准\", \"description\": \"...\"}, {\"key\": \"reject\", \"label\": \"拒绝\", \"description\": \"...\"}],\n    \"risk_level\": \"Medium\"\n  }\n}\n```".to_string()
            }
            AgentRole::QaAgent => {
                // v0.7: QaAgent 默认 prompt
                "你是 qa-agent，根据 technical.md 测试清单执行验收测试，输出测试报告。".to_string()
            }
        }
    }

    fn format_task_state(&self, task: &AgentTask) -> String {
        let status_str = serde_json::to_string(&task.status)
            .unwrap_or_default()
            .trim_matches('"')
            .to_string();
        let type_str = serde_json::to_string(&task.task_type)
            .unwrap_or_default()
            .trim_matches('"')
            .to_string();
        let role_str = serde_json::to_string(&task.role)
            .unwrap_or_default()
            .trim_matches('"')
            .to_string();

        format!(
            "## 任务状态\n\n- task_id: {}\n- type: {}\n- role: {}\n- status: {}\n- project: {}\n- version: {}",
            task.task_id, type_str, role_str, status_str, task.project, task.version
        )
    }

    fn format_trigger_context(&self, task: &AgentTask) -> String {
        if let Ok(ctx) = serde_json::from_str::<serde_json::Value>(&task.input_context) {
            if let Some(reason) = ctx.get("trigger_reason").and_then(|v| v.as_str()) {
                return format!("## 触发原因\n\n{}", reason);
            }
        }
        String::new()
    }

    fn build_messages(&self, task: &AgentTask) -> Vec<ApiMessage> {
        // Extract user message from input_context if present
        if let Ok(ctx) = serde_json::from_str::<serde_json::Value>(&task.input_context) {
            if let Some(user_msg) = ctx.get("user_message").and_then(|v| v.as_str()) {
                return vec![ApiMessage {
                    role: "user".to_string(),
                    content: user_msg.to_string(),
                }];
            }
            // For ceo-event, inject the finished task's output
            if let Some(finished_output) = ctx.get("finished_task_output").and_then(|v| v.as_str()) {
                return vec![ApiMessage {
                    role: "user".to_string(),
                    content: format!(
                        "后台任务已完成，任务输出如下：\n\n{}\n\n请根据以上内容判断是否需要用户决策。",
                        finished_output
                    ),
                }];
            }
        }

        // Default: use a generic prompt based on task type
        let content = format!(
            "请按照你的角色职责执行任务。任务类型: {}, 项目: {}, 版本: {}",
            serde_json::to_string(&task.task_type)
                .unwrap_or_default()
                .trim_matches('"')
                .to_string(),
            task.project,
            task.version
        );

        vec![ApiMessage {
            role: "user".to_string(),
            content,
        }]
    }
}

/// v0.7 辅助函数：写入 ui_events 埋点（供 dispatcher 使用）
pub async fn write_event_log(
    pool: &sqlx::SqlitePool,
    event_name: &str,
    payload: serde_json::Value,
) {
    let event_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let payload_str = payload.to_string();

    let result = sqlx::query(
        "INSERT INTO ui_events (event_id, event_name, payload, created_at) VALUES (?, ?, ?, ?)",
    )
    .bind(&event_id)
    .bind(event_name)
    .bind(&payload_str)
    .bind(&now)
    .execute(pool)
    .await;

    if let Err(e) = result {
        tracing::warn!("[ui_events] 写入失败 {}: {}", event_name, e);
    }
}
