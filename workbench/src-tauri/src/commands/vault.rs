use std::fs;
use std::path::Path;
use tauri::command;
use walkdir::WalkDir;

use crate::models::NoteResult;

fn extract_excerpt(content: &str, keyword_lower: &str) -> String {
    let content_lower = content.to_lowercase();
    if let Some(byte_pos) = content_lower.find(keyword_lower) {
        let chars: Vec<char> = content.chars().collect();
        let char_pos = content[..byte_pos].chars().count();
        let start = char_pos.saturating_sub(50);
        let end = (char_pos + keyword_lower.chars().count() + 50).min(chars.len());
        chars[start..end].iter().collect::<String>().trim().to_string()
    } else {
        String::new()
    }
}

#[command]
pub fn search_vault(vault_path: String, keyword: String) -> Result<Vec<NoteResult>, String> {
    let path = Path::new(&vault_path);
    let keyword_lower = keyword.to_lowercase();
    let mut results = Vec::new();

    for entry in WalkDir::new(path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map_or(false, |ext| ext == "md"))
    {
        let content = fs::read_to_string(entry.path())
            .map_err(|e| e.to_string())?;

        if content.to_lowercase().contains(&keyword_lower) {
            let title = entry
                .path()
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            results.push(NoteResult {
                title,
                path: entry.path().to_string_lossy().to_string(),
                excerpt: extract_excerpt(&content, &keyword_lower),
            });
        }
    }

    Ok(results)
}
