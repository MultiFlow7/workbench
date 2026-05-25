use serde::{Deserialize, Serialize};

use crate::sandbox::{product_direction_path, requirements_readme_path, technical_md_path};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type, PartialEq)]
#[sqlx(type_name = "TEXT", rename_all = "PascalCase")]
pub enum TaskType {
    ProductPlanning,
    Review,
    Engineering,
    Memory,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type, PartialEq)]
#[sqlx(type_name = "TEXT", rename_all = "PascalCase")]
pub enum AgentRole {
    Ceo,
    ProductAgent,
    ReviewAgent,
    TechnicalAgent,
    QaAgent, // v0.7 R-001 流水线规则自动触发测试任务使用
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type, PartialEq)]
#[sqlx(type_name = "TEXT", rename_all = "PascalCase")]
pub enum TaskStatus {
    Pending,
    Running,
    Blocked,
    AwaitingDecision,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTask {
    pub task_id: String,
    pub task_type: TaskType,
    pub role: AgentRole,
    pub status: TaskStatus,
    pub project: String,
    pub version: String,
    pub input_context: String,
    pub title: Option<String>,
    pub output: Option<String>,
    pub blocking_on: Option<String>,
    pub decision_request: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub file_refs: Option<String>,      // v0.7: JSON 数组字符串，存储文件路径列表
    pub trigger_reason: Option<String>, // v0.7: 记录任务触发来源，如 "manual" / "pipeline_rule:R-001"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecisionRequest {
    pub question: String,
    pub options: Vec<String>,
    pub risk_level: String,
    pub created_at: String,
    pub resolved_at: Option<String>,
}

impl AgentTask {
    /// 返回本次任务允许注入的文档路径白名单
    pub fn allowed_documents(&self) -> Vec<String> {
        match self.task_type {
            TaskType::Review => {
                let path = self.output_path_of_product_doc();
                if path.is_empty() {
                    vec![]
                } else {
                    vec![path]
                }
            }
            TaskType::ProductPlanning => vec![
                product_direction_path(&self.project),
                requirements_readme_path(&self.project),
            ],
            TaskType::Engineering => vec![technical_md_path(&self.project, &self.version)],
            _ => vec![],
        }
    }

    /// 从 input_context JSON 中解析 product_doc_path 字段
    pub fn output_path_of_product_doc(&self) -> String {
        if let Ok(ctx) = serde_json::from_str::<serde_json::Value>(&self.input_context) {
            if let Some(path) = ctx.get("product_doc_path").and_then(|v| v.as_str()) {
                return path.to_string();
            }
        }
        String::new()
    }

    /// 从 input_context JSON 中解析 memory_hint 字段
    pub fn memory_hint(&self) -> Option<String> {
        if let Ok(ctx) = serde_json::from_str::<serde_json::Value>(&self.input_context) {
            if let Some(hint) = ctx.get("memory_hint").and_then(|v| v.as_str()) {
                return Some(hint.to_string());
            }
        }
        None
    }

    /// 从 input_context JSON 中解析 technical_md_path 字段
    pub fn technical_md_path_from_context(&self) -> Option<String> {
        if let Ok(ctx) = serde_json::from_str::<serde_json::Value>(&self.input_context) {
            if let Some(path) = ctx.get("technical_md_path").and_then(|v| v.as_str()) {
                return Some(path.to_string());
            }
        }
        None
    }
}
