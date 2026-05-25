use std::collections::HashMap;

use crate::error::AppError;

pub fn product_direction_path(projects_dir: &str, project: &str) -> String {
    format!("{}/{}/产品方向.md", projects_dir, project)
}

pub fn requirements_readme_path(projects_dir: &str, project: &str) -> String {
    format!("{}/{}/requirements/README.md", projects_dir, project)
}

pub fn technical_md_path(projects_dir: &str, project: &str, version: &str) -> String {
    format!(
        "{}/{}/changelog/{}/technical.md",
        projects_dir, project, version
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
