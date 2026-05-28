use std::collections::HashMap;
use std::sync::Mutex;
use tokio_util::sync::CancellationToken;

pub struct StreamState {
    pub tokens: Mutex<HashMap<String, CancellationToken>>,
}

impl Default for StreamState {
    fn default() -> Self {
        Self { tokens: Mutex::new(HashMap::new()) }
    }
}
