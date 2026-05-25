use std::fs;
use std::io::Write;
use std::path::Path;
use tauri::command;
use walkdir::WalkDir;

#[command]
pub fn next_branch_id(qa_dir: String) -> Result<String, String> {
    let max = fs::read_dir(&qa_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().into_string().ok()?;
            let id: u32 = name.splitn(2, '-').next()?.parse().ok()?;
            Some(id)
        })
        .max()
        .unwrap_or(0);
    Ok(format!("{:04}", max + 1))
}

use crate::models::{QAAtom, QAAtomMeta, TokenUsage};

#[derive(serde::Deserialize, Default)]
struct RawFrontmatter {
    id: String,
    #[serde(default)]
    prev: Option<String>,
    #[serde(default)]
    children: Vec<String>,
    #[serde(default)]
    timestamp: String,
    #[serde(default)]
    summary: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    input_tokens: Option<u32>,
    #[serde(default)]
    output_tokens: Option<u32>,
    #[serde(default)]
    context_tokens_used: Option<u32>,
    #[serde(default)]
    context_window_limit: Option<u32>,
}

fn split_frontmatter(content: &str) -> Option<(RawFrontmatter, String)> {
    let content = content.trim_start_matches('\u{feff}');
    if !content.starts_with("---\n") {
        return None;
    }
    let rest = &content[4..]; // skip "---\n"
    let close_pos = rest.find("\n---")?;
    let yaml_str = &rest[..close_pos];
    let after = &rest[close_pos + 4..]; // skip "\n---"
    let body = after.trim_start_matches('\n');
    let raw: RawFrontmatter = serde_yaml::from_str(yaml_str).ok()?;
    Some((raw, body.to_string()))
}

fn extract_section(body: &str, headers: &[&str]) -> String {
    const SECTION_DELIMITERS: &[&str] = &["## Q", "## A", "# 问题", "# 回答", "## 问题", "## 回答"];
    let mut lines: Vec<&str> = Vec::new();
    let mut in_section = false;
    for line in body.lines() {
        let trimmed = line.trim();
        if headers.iter().any(|h| trimmed == *h) {
            in_section = true;
            continue;
        }
        if in_section {
            // Only stop at recognized QA section delimiters, not at arbitrary markdown headings
            if SECTION_DELIMITERS.contains(&trimmed) {
                break;
            }
            lines.push(line);
        }
    }
    lines.join("\n").trim().to_string()
}

fn make_summary(question: &str) -> String {
    question.chars().take(50).collect()
}

#[command]
pub fn list_qa_atoms(conversation_dir: String) -> Result<Vec<QAAtomMeta>, String> {
    let path = Path::new(&conversation_dir);
    let mut atoms = Vec::new();

    for entry in WalkDir::new(path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map_or(false, |ext| ext == "md"))
    {
        let content = fs::read_to_string(entry.path())
            .map_err(|e| e.to_string())?;
        if let Some((raw, body)) = split_frontmatter(&content) {
            let file_id = entry.path()
                .file_stem()
                .and_then(|s| s.to_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| raw.id.clone());
            let question = extract_section(&body, &["## Q", "# 问题"]);
            let summary = raw.summary.filter(|s| !s.is_empty())
                .unwrap_or_else(|| make_summary(&question));
            let usage = match (raw.input_tokens, raw.output_tokens) {
                (Some(i), Some(o)) => Some(TokenUsage { input_tokens: i, output_tokens: o }),
                _ => None,
            };
            atoms.push(QAAtomMeta {
                id: file_id,
                prev: raw.prev.filter(|s| !s.is_empty()),
                children: raw.children,
                summary,
                timestamp: raw.timestamp,
                model: raw.model,
                usage,
                context_tokens_used: raw.context_tokens_used,
                context_window_limit: raw.context_window_limit,
            });
        }
    }

    Ok(atoms)
}

#[command]
pub fn read_qa_atom(file_path: String) -> Result<QAAtom, String> {
    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("read {}: {}", file_path, e))?;
    let (raw, body) = split_frontmatter(&content)
        .ok_or_else(|| format!("bad frontmatter in {}", file_path))?;
    let file_id = Path::new(&file_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| raw.id.clone());
    let question = extract_section(&body, &["## Q", "# 问题"]);
    let answer = extract_section(&body, &["## A", "# 回答"]);
    let summary = raw.summary.filter(|s| !s.is_empty())
        .unwrap_or_else(|| make_summary(&question));
    let usage = match (raw.input_tokens, raw.output_tokens) {
        (Some(i), Some(o)) => Some(TokenUsage { input_tokens: i, output_tokens: o }),
        _ => None,
    };
    Ok(QAAtom {
        meta: QAAtomMeta {
            id: file_id,
            prev: raw.prev.filter(|s| !s.is_empty()),
            children: raw.children,
            summary,
            timestamp: raw.timestamp,
            model: raw.model,
            usage,
            context_tokens_used: raw.context_tokens_used,
            context_window_limit: raw.context_window_limit,
        },
        question,
        answer,
    })
}

#[command]
pub fn write_qa_atom(file_path: String, atom: QAAtom) -> Result<(), String> {
    let prev_yaml = match &atom.meta.prev {
        Some(p) => format!("\"{}\"", p),
        None => "null".to_string(),
    };

    let children_str = if atom.meta.children.is_empty() {
        "children: []".to_string()
    } else {
        let items = atom
            .meta
            .children
            .iter()
            .map(|c| format!("  - \"{}\"", c))
            .collect::<Vec<_>>()
            .join("\n");
        format!("children:\n{}", items)
    };

    let token_yaml = if let Some(usage) = &atom.meta.usage {
        format!(
            "model: \"{}\"\ninput_tokens: {}\noutput_tokens: {}\ncontext_tokens_used: {}\ncontext_window_limit: {}\n",
            atom.meta.model.as_deref().unwrap_or(""),
            usage.input_tokens,
            usage.output_tokens,
            atom.meta.context_tokens_used.unwrap_or(0),
            atom.meta.context_window_limit.unwrap_or(0),
        )
    } else {
        String::new()
    };

    let content = format!(
        "---\nid: {}\nprev: {}\n{}\ntimestamp: \"{}\"\n{}status: done\n---\n\n## Q\n\n{}\n\n## A\n\n{}\n",
        atom.meta.id,
        prev_yaml,
        children_str,
        atom.meta.timestamp,
        token_yaml,
        atom.question,
        atom.answer,
    );

    // 原子写入：写临时文件 → rename，防止写入中途崩溃导致目标文件损坏
    let target = Path::new(&file_path);
    let tmp_path = target.with_file_name(format!(
        ".{}.tmp",
        target.file_name().and_then(|n| n.to_str()).unwrap_or("atom")
    ));
    {
        let mut f = fs::File::create(&tmp_path)
            .map_err(|e| format!("create tmp {}: {}", tmp_path.display(), e))?;
        f.write_all(content.as_bytes())
            .map_err(|e| format!("write tmp {}: {}", tmp_path.display(), e))?;
        f.flush()
            .map_err(|e| format!("flush tmp {}: {}", tmp_path.display(), e))?;
    }
    fs::rename(&tmp_path, target)
        .map_err(|e| {
            let _ = fs::remove_file(&tmp_path);
            format!("rename to {}: {}", file_path, e)
        })
}
