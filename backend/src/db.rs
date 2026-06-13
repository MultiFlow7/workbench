use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use tracing::info;

pub async fn init_db(db_path: &str) -> SqlitePool {
    // Ensure parent directory exists
    if let Some(parent) = std::path::Path::new(db_path).parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)
                .expect("无法创建数据库目录");
        }
    }

    let connection_string = format!("sqlite://{}?mode=rwc", db_path);

    let pool = SqlitePoolOptions::new()
        .max_connections(10)
        .connect(&connection_string)
        .await
        .unwrap_or_else(|e| panic!("无法连接数据库 {}: {}", db_path, e));

    // Enable WAL mode
    sqlx::query("PRAGMA journal_mode=WAL;")
        .execute(&pool)
        .await
        .expect("无法启用 WAL 模式");

    sqlx::query("PRAGMA synchronous=NORMAL;")
        .execute(&pool)
        .await
        .expect("无法设置 synchronous 模式");

    // Create tables
    create_tables(&pool).await;

    info!("数据库初始化完成: {}", db_path);
    pool
}

async fn create_tables(pool: &SqlitePool) {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS agent_tasks (
            task_id       TEXT PRIMARY KEY,
            task_type     TEXT NOT NULL,
            role          TEXT NOT NULL,
            status        TEXT NOT NULL,
            project       TEXT NOT NULL,
            version       TEXT NOT NULL,
            input_context TEXT NOT NULL,
            output        TEXT,
            blocking_on   TEXT,
            decision_request TEXT,
            created_at    TEXT NOT NULL,
            updated_at    TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .expect("无法创建 agent_tasks 表");

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS capability_tokens (
            token_id   TEXT PRIMARY KEY,
            token_type TEXT NOT NULL,
            target_id  TEXT NOT NULL,
            issued_at  TEXT NOT NULL,
            issued_by  TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .expect("无法创建 capability_tokens 表");

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS decisions (
            decision_id TEXT PRIMARY KEY,
            task_id     TEXT NOT NULL,
            agent_role  TEXT NOT NULL,
            question    TEXT NOT NULL,
            options     TEXT NOT NULL,
            risk_level  TEXT NOT NULL,
            created_at  TEXT NOT NULL,
            resolved_at TEXT,
            resolution  TEXT
        )
        "#,
    )
    .execute(pool)
    .await
    .expect("无法创建 decisions 表");

    // ALTER TABLE migration: add title column if not exists
    // SQLite does not support IF NOT EXISTS for ADD COLUMN, so we catch the error silently
    let _ = sqlx::query(
        "ALTER TABLE agent_tasks ADD COLUMN title TEXT"
    )
    .execute(pool)
    .await;

    // v0.7 migrations: add file_refs and trigger_reason columns
    let _ = sqlx::query("ALTER TABLE agent_tasks ADD COLUMN file_refs TEXT")
        .execute(pool)
        .await;

    let _ = sqlx::query("ALTER TABLE agent_tasks ADD COLUMN trigger_reason TEXT")
        .execute(pool)
        .await;

    // v0.7: ui_events 埋点表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS ui_events (
            event_id   TEXT PRIMARY KEY,
            event_name TEXT NOT NULL,
            payload    TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .expect("无法创建 ui_events 表");

    // v0.9 req-029: llm_calls 表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS llm_calls (
            id            TEXT PRIMARY KEY,
            model         TEXT NOT NULL,
            input_tokens  INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            duration_ms   INTEGER NOT NULL DEFAULT 0,
            called_at     TEXT NOT NULL,
            task_id       TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .expect("无法创建 llm_calls 表");

    tracing::info!("数据库表创建完成");
}
