use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct TokenUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QAAtomMeta {
    pub id: String,
    pub prev: Option<String>,
    pub children: Vec<String>,
    pub summary: String,
    pub timestamp: String,
    // v0.3: token 使用量（旧 atom 无此字段时为 None）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<TokenUsage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_tokens_used: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window_limit: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QAAtom {
    pub meta: QAAtomMeta,
    pub question: String,
    pub answer: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EventLog {
    pub event: String,
    pub timestamp: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Message {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    pub id: String,
    pub name: String,
    pub root_branch_id: String,
    pub created_at: String,
    pub atom_ids: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NoteResult {
    pub title: String,
    pub path: String,
    pub excerpt: String,
}
