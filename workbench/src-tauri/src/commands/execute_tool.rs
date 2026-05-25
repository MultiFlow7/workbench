use std::fs;
use std::path::Path;
use tauri::command;

use crate::commands::vault::search_vault;

const MAX_CHARS: usize = 8000;

fn get_vault_root() -> String {
    std::env::var("VAULT_ROOT").unwrap_or_default()
}

fn safe_truncate(s: String) -> String {
    if s.chars().count() <= MAX_CHARS {
        s
    } else {
        s.chars().take(MAX_CHARS).collect::<String>() + "\n…[truncated]"
    }
}

fn tool_read_file(path: &str) -> Result<String, String> {
    let canonical = std::fs::canonicalize(path)
        .map_err(|e| format!("无法解析路径: {}", e))?;
    let vault_root_str = get_vault_root();
    let vault_root = Path::new(&vault_root_str);
    if !vault_root_str.is_empty() && !canonical.starts_with(vault_root) {
        return Err(format!("路径超出 Vault 范围: {}", path));
    }
    let content = fs::read_to_string(&canonical)
        .map_err(|e| format!("读取文件失败: {}", e))?;
    Ok(safe_truncate(content))
}

fn tool_search_vault(keyword: &str, vault_path: &str) -> Result<String, String> {
    let results = search_vault(vault_path.to_string(), keyword.to_string())?;
    if results.is_empty() {
        return Ok(format!("未找到包含「{}」的笔记", keyword));
    }
    let lines: Vec<String> = results
        .iter()
        .take(20)
        .map(|r| format!("- {} ({})\n  {}", r.title, r.path, r.excerpt))
        .collect();
    Ok(lines.join("\n"))
}

#[command]
pub fn execute_tool(
    tool_name: String,
    tool_input: serde_json::Value,
) -> Result<String, String> {
    match tool_name.as_str() {
        "read_file" => {
            let path = tool_input["path"]
                .as_str()
                .ok_or("缺少 path 参数")?;
            tool_read_file(path)
        }
        "search_vault" => {
            let keyword = tool_input["keyword"]
                .as_str()
                .ok_or("缺少 keyword 参数")?;
            let vault_root = get_vault_root();
            let vault_path = tool_input["vault_path"]
                .as_str()
                .unwrap_or(&vault_root);
            tool_search_vault(keyword, vault_path)
        }
        "run_shell" => {
            Err("run_shell 工具已禁用".to_string())
        }
        _ => Err(format!("未知工具: {}", tool_name)),
    }
}
