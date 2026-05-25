use std::fs;
use std::path::PathBuf;
use tauri::command;

fn settings_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home)
        .join(".config")
        .join("workbench")
        .join("settings.json")
}

#[command]
pub fn read_settings() -> String {
    fs::read_to_string(settings_path()).unwrap_or_else(|_| "{}".to_string())
}

#[command]
pub fn write_settings(data: String) -> Result<(), String> {
    let path = settings_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, data).map_err(|e| e.to_string())
}
