use std::collections::HashMap;

use crate::error::AppError;

pub fn product_direction_path(project: &str) -> String {
    format!("01-Vibe项目区/{}/产品方向.md", project)
}

pub fn requirements_readme_path(project: &str) -> String {
    format!("01-Vibe项目区/{}/requirements/README.md", project)
}

pub fn technical_md_path(project: &str, version: &str) -> String {
    format!(
        "01-Vibe项目区/{}/changelog/{}/technical.md",
        project, version
    )
}

/// 验证 uploaded_docs 中不包含白名单外的路径
pub fn validate_uploaded_docs(
    uploaded: &HashMap<String, String>,
    allowed: &[String],
) -> Result<(), AppError> {
    for path in uploaded.keys() {
        if !allowed.contains(path) {
            return Err(AppError::SandboxViolation {
                path: path.clone(),
            });
        }
    }
    Ok(())
}
