use std::fs;
use std::path::Path;
use tauri::command;
use walkdir::WalkDir;

use crate::models::ProjectMeta;

#[derive(serde::Deserialize, Default)]
struct RawProjectFrontmatter {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(rename = "rootBranchId", default)]
    root_branch_id: String,
    #[serde(rename = "createdAt", default)]
    created_at: String,
}

fn split_project_frontmatter(content: &str) -> Option<(RawProjectFrontmatter, String)> {
    let content = content.trim_start_matches('\u{feff}');
    if !content.starts_with("---\n") {
        return None;
    }
    let rest = &content[4..]; // skip "---\n"
    let close_pos = rest.find("\n---")?;
    let yaml_str = &rest[..close_pos];
    let after = &rest[close_pos + 4..]; // skip "\n---"
    let body = after.trim_start_matches('\n');
    let raw: RawProjectFrontmatter = serde_yaml::from_str(yaml_str).unwrap_or_default();
    Some((raw, body.to_string()))
}

fn parse_atom_ids(body: &str) -> Vec<String> {
    let mut ids = Vec::new();
    let mut in_section = false;

    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed == "## 对话索引" {
            in_section = true;
            continue;
        }
        if in_section {
            // Stop at next heading
            if trimmed.starts_with("## ") || trimmed.starts_with("# ") {
                break;
            }
            // Extract [[...]] content
            if let Some(start) = trimmed.find("[[") {
                if let Some(end) = trimmed[start + 2..].find("]]") {
                    let id = trimmed[start + 2..start + 2 + end].trim();
                    if !id.is_empty() {
                        ids.push(id.to_string());
                    }
                }
            }
        }
    }

    ids
}

#[tauri::command]
pub fn create_project(
    projects_dir: String,
    name: String,
) -> Result<ProjectMeta, String> {
    use std::time::{SystemTime, UNIX_EPOCH};

    if name.trim().is_empty() {
        return Err("项目名称不能为空".to_string());
    }

    let projects_path = Path::new(&projects_dir);
    if !projects_path.exists() {
        fs::create_dir_all(projects_path)
            .map_err(|e| format!("无法创建项目目录: {}", e))?;
    }

    let file_path = projects_path.join(format!("{}.md", name.trim()));
    if file_path.exists() {
        return Err(format!("项目「{}」已存在", name.trim()));
    }

    // 生成 id：时间戳毫秒（简短、不依赖 uuid crate）
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let id = format!("proj-{}", millis);

    // ISO 8601 时间戳（使用 chrono）
    let created_at = chrono::offset::Utc::now().to_rfc3339();

    let content = format!(
        "---\nid: {}\nname: {}\nrootBranchId: \"\"\ncreatedAt: {}\n---\n\n## 对话索引\n\n",
        id, name.trim(), created_at
    );

    fs::write(&file_path, content)
        .map_err(|e| format!("写入项目文件失败: {}", e))?;

    Ok(ProjectMeta {
        id,
        name: name.trim().to_string(),
        root_branch_id: String::new(),
        created_at,
        atom_ids: vec![],
    })
}

#[tauri::command]
pub fn add_atom_to_project(
    projects_dir: String,
    project_name: String,
    atom_id: String,
) -> Result<(), String> {
    use std::io::Write;
    let file_path = Path::new(&projects_dir).join(format!("{}.md", project_name));
    if !file_path.exists() {
        return Err(format!("项目文件不存在: {}", project_name));
    }
    // 去重：已存在则跳过，避免重复追加
    let existing = fs::read_to_string(&file_path)
        .map_err(|e| format!("读取项目文件失败: {}", e))?;
    let already_exists = existing.lines().any(|line| {
        let t = line.trim();
        if let Some(start) = t.find("[[") {
            if let Some(end) = t[start + 2..].find("]]") {
                return t[start + 2..start + 2 + end].trim() == atom_id.as_str();
            }
        }
        false
    });
    if already_exists {
        return Ok(());
    }
    let entry = format!("- [[ {} ]]\n", atom_id);
    let mut file = fs::OpenOptions::new()
        .append(true)
        .open(&file_path)
        .map_err(|e| format!("打开项目文件失败: {}", e))?;
    file.write_all(entry.as_bytes())
        .map_err(|e| format!("写入项目文件失败: {}", e))?;
    Ok(())
}

#[command]
pub fn list_projects(projects_dir: String) -> Result<Vec<ProjectMeta>, String> {
    let path = Path::new(&projects_dir);
    let mut projects = Vec::new();

    for entry in WalkDir::new(path)
        .max_depth(1)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path().extension().map_or(false, |ext| ext == "md")
        })
    {
        let content = fs::read_to_string(entry.path())
            .map_err(|e| format!("read {}: {}", entry.path().display(), e))?;

        if let Some((raw, body)) = split_project_frontmatter(&content) {
            let atom_ids = parse_atom_ids(&body);
            projects.push(ProjectMeta {
                id: raw.id,
                name: raw.name,
                root_branch_id: raw.root_branch_id,
                created_at: raw.created_at,
                atom_ids,
            });
        }
    }

    Ok(projects)
}
