use std::sync::Mutex;
use tokio_util::sync::CancellationToken;

pub struct StreamState {
    pub token: Mutex<Option<CancellationToken>>,
}

impl Default for StreamState {
    fn default() -> Self {
        Self { token: Mutex::new(None) }
    }
}
