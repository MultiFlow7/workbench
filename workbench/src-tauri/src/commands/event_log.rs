use std::fs;
use std::io::Write;
use std::path::PathBuf;
use tauri::command;

use crate::models::EventLog;

#[command]
pub fn write_event_log(event: EventLog) -> Result<(), String> {
    let home = std::env::var("HOME")
        .map_err(|_| "HOME env not set".to_string())?;
    let log_dir = PathBuf::from(home).join("Library/Logs/Workbench");

    fs::create_dir_all(&log_dir)
        .map_err(|e| format!("create log dir: {}", e))?;

    let log_file = log_dir.join("events.jsonl");
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file)
        .map_err(|e| format!("open log file: {}", e))?;

    let line = serde_json::to_string(&event)
        .map_err(|e| format!("serialize event: {}", e))?;
    writeln!(file, "{}", line)
        .map_err(|e| format!("write log: {}", e))
}
