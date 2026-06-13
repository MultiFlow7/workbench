pub mod handlers;

use serde::{Deserialize, Serialize};

use crate::state_machine::task::AgentRole;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum RiskLevel {
    Low,
    Medium,
    High,
}

impl std::fmt::Display for RiskLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RiskLevel::Low => write!(f, "Low"),
            RiskLevel::Medium => write!(f, "Medium"),
            RiskLevel::High => write!(f, "High"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecisionOption {
    pub key: String,
    pub label: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecisionRecord {
    pub decision_id: String,
    pub task_id: String,
    pub agent_role: AgentRole,
    pub question: String,
    pub options: Vec<DecisionOption>,
    pub risk_level: RiskLevel,
    pub created_at: String,
    pub resolved_at: Option<String>,
    pub resolution: Option<String>,
}
