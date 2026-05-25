use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type, PartialEq)]
#[sqlx(type_name = "TEXT", rename_all = "PascalCase")]
pub enum TokenType {
    Deliverable,
    Approved,
    Mergeable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityToken {
    pub token_id: String,
    pub token_type: TokenType,
    pub target_id: String,
    pub issued_at: String,
    pub issued_by: String,
}
