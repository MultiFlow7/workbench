use std::{collections::HashMap, sync::Arc, time::{Duration, Instant}};

use chrono::Utc;
use serde_json::json;
use sqlx::SqlitePool;
use tokio::sync::{broadcast, Semaphore};
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::{
    context_builder::{write_event_log, ContextBuilder},
    decisions::{
        handlers::create_decision,
        DecisionOption, DecisionRecord, RiskLevel,
    },
    error::AppError,
    events::sse::{SseEvent, SseNotification},
    harness::hooks::{pre_hook_engineering_start, HarnessError},
    state_machine::{
        task::{AgentRole, AgentTask, TaskStatus, TaskType},
        token::TokenType,
        TaskFilter, StateMachine,
    },
};

/// v0.7: 自动调度器配置
pub struct DispatcherConfig {
    pub max_concurrent_agents: usize,
    pub poll_interval_secs: u64,
    pub agent_timeout_secs: u64,
}

pub struct AgentDispatcher {
    pub state_machine: Arc<StateMachine>,
    pub context_builder: Arc<ContextBuilder>,
    pub http_client: reqwest::Client,
    pub sub2api_key: String,
    pub sub2api_url: String,
    pub sse_tx: broadcast::Sender<SseEvent>,
    pub notify_tx: broadcast::Sender<SseNotification>, // v0.7
    pub agent_model: String,
    pub roles_dir: String, // v0.9 req-024
}

// v0.9 req-024: 角色级模型配置
#[derive(Debug, serde::Deserialize)]
struct RoleModelConfig {
    provider: Option<String>,
    model_id: Option<String>,
    api_endpoint: Option<String>,
    max_tokens: Option<u64>,
}

fn load_role_model_config(roles_dir: &str, role: &AgentRole) -> Option<RoleModelConfig> {
    let role_snake = match role {
        AgentRole::Ceo => "ceo",
        AgentRole::ProductAgent => "product_agent",
        AgentRole::ReviewAgent => "review_agent",
        AgentRole::TechnicalAgent => "technical_agent",
        AgentRole::QaAgent => "qa_agent",
    };
    let path = format!("{}/{}.yaml", roles_dir, role_snake);
    let content = std::fs::read_to_string(&path).ok()?;
    serde_yaml::from_str(&content).ok()
}

impl AgentDispatcher {
    pub fn new(
        state_machine: Arc<StateMachine>,
        context_builder: Arc<ContextBuilder>,
        sub2api_key: String,
        sse_tx: broadcast::Sender<SseEvent>,
        notify_tx: broadcast::Sender<SseNotification>,
        agent_model: String,
        roles_dir: String, // v0.9 req-024
    ) -> Self {
        AgentDispatcher {
            state_machine,
            context_builder,
            http_client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(180))
                .build()
                .expect("无法创建 HTTP 客户端"),
            sub2api_key,
            sub2api_url: "http://43.135.174.27:8080/v1/messages".to_string(),
            sse_tx,
            notify_tx,
            agent_model,
            roles_dir,
        }
    }

    /// 主调度函数（外部调用入口，含 pre-hook 和 post-hook）
    pub async fn dispatch(
        &self,
        pool: &SqlitePool,
        task_id: &str,
        uploaded_docs: HashMap<String, String>,
    ) -> Result<String, AppError> {
        // Step 1: 读取任务
        let task = self.state_machine.get_task(pool, task_id).await?;

        // Step 2 (pre): Engineering 任务 pre-hook
        if task.task_type == TaskType::Engineering {
            let technical_path = task
                .technical_md_path_from_context()
                .unwrap_or_else(|| {
                    crate::sandbox::technical_md_path(&task.project, &task.version)
                });

            match pre_hook_engineering_start(pool, task_id, &technical_path).await {
                Ok(()) => {
                    info!("[dispatcher] engineering pre-hook passed for {}", task_id);
                }
                Err(HarnessError::NotApproved { path }) => {
                    let msg = format!("HarnessError::NotApproved: {}", path);
                    error!("[dispatcher] {}", msg);
                    let _ = self.sse_tx.send(SseEvent::TaskStatusChanged {
                        task_id: task_id.to_string(),
                        new_status: TaskStatus::Blocked,
                        decision_request: None,
                    });
                    return Err(AppError::HarnessError(msg));
                }
                Err(e) => {
                    return Err(AppError::HarnessError(e.to_string()));
                }
            }
        }

        // Execute core dispatch
        let output = self.dispatch_core(pool, task_id, uploaded_docs).await?;

        // Step 7: Post-hook
        let completed_task = self.state_machine.get_task(pool, task_id).await?;

        // ReviewAgent post-hook
        if completed_task.role == AgentRole::ReviewAgent {
            self.post_hook_review_agent(pool, &completed_task).await;
        }

        // Trigger ceo-event for non-CEO agents
        if completed_task.role != AgentRole::Ceo {
            self.trigger_ceo_event(pool, &completed_task).await;
        }

        Ok(output)
    }

    /// 核心调度（无 pre/post hook，供内部复用）
    async fn dispatch_core(
        &self,
        pool: &SqlitePool,
        task_id: &str,
        uploaded_docs: HashMap<String, String>,
    ) -> Result<String, AppError> {
        let task = self.state_machine.get_task(pool, task_id).await?;
        let role_str = format!("{:?}", task.role);

        // Build prompt (with timing for context_build_duration埋点)
        let build_start = Instant::now();
        let prompt = self.context_builder.build(&task, &uploaded_docs).await?;
        let build_ms = build_start.elapsed().as_millis() as u64;
        let context_chars = prompt.system.len()
            + prompt.messages.iter().map(|m| m.content.len()).sum::<usize>();
        let context_tokens = (context_chars / 4) as u64;
        write_event_log(pool, "context_build_duration", json!({
            "task_id": task_id,
            "role": &role_str,
            "context_tokens": context_tokens,
            "build_ms": build_ms,
        })).await;

        // Update status to Running + SSE
        self.state_machine
            .update_status(pool, task_id, TaskStatus::Running)
            .await?;
        let _ = self.sse_tx.send(SseEvent::TaskStatusChanged {
            task_id: task_id.to_string(),
            new_status: TaskStatus::Running,
            decision_request: None,
        });

        // v0.9 req-024: 读取角色级模型配置，fallback 全局默认
        let role_cfg = load_role_model_config(&self.roles_dir, &task.role);
        let effective_url = role_cfg
            .as_ref()
            .and_then(|c| c.api_endpoint.as_deref())
            .filter(|s| !s.is_empty())
            .unwrap_or(&self.sub2api_url);
        let effective_model = role_cfg
            .as_ref()
            .and_then(|c| c.model_id.as_deref())
            .unwrap_or(&self.agent_model);
        let effective_max_tokens = role_cfg
            .as_ref()
            .and_then(|c| c.max_tokens)
            .unwrap_or(4096);

        info!(
            "[dispatcher] POST {} for task_id={}, role={:?}, model={}",
            effective_url, task_id, task.role, effective_model
        );

        let request_body = json!({
            "model": effective_model,
            "max_tokens": effective_max_tokens,
            "stream": false,
            "system": prompt.system,
            "messages": prompt.messages
        });

        let dispatch_start = Instant::now();
        let response = self
            .http_client
            .post(effective_url)
            .header("x-api-key", &self.sub2api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&request_body)
            .send()
            .await;

        let mut output_tokens_captured: u64 = 0;
        let mut input_tokens_captured: u64 = 0;
        let output_text = match response {
            Err(e) => {
                let duration_seconds = dispatch_start.elapsed().as_secs();
                error!("[dispatcher] HTTP error for task_id={}: {}", task_id, e);
                self.state_machine
                    .update_status(pool, task_id, TaskStatus::Failed)
                    .await
                    .ok();
                let _ = self.sse_tx.send(SseEvent::TaskStatusChanged {
                    task_id: task_id.to_string(),
                    new_status: TaskStatus::Failed,
                    decision_request: None,
                });
                write_event_log(pool, "agent_dispatch_failed", json!({
                    "task_id": task_id,
                    "role": &role_str,
                    "error_type": "http_error",
                    "duration_seconds": duration_seconds,
                })).await;
                write_event_log(pool, "main_conversation_protected", json!({
                    "task_id": task_id,
                    "main_chat_message_count_unchanged": true,
                })).await;
                return Err(AppError::DispatchError(format!("HTTP 请求失败: {}", e)));
            }
            Ok(resp) => {
                if !resp.status().is_success() {
                    let duration_seconds = dispatch_start.elapsed().as_secs();
                    let status = resp.status();
                    let body = resp.text().await.unwrap_or_default();
                    error!(
                        "[dispatcher] API error for task_id={}: status={}, body={}",
                        task_id, status, body
                    );
                    self.state_machine
                        .update_status(pool, task_id, TaskStatus::Failed)
                        .await
                        .ok();
                    let _ = self.sse_tx.send(SseEvent::TaskStatusChanged {
                        task_id: task_id.to_string(),
                        new_status: TaskStatus::Failed,
                        decision_request: None,
                    });
                    write_event_log(pool, "agent_dispatch_failed", json!({
                        "task_id": task_id,
                        "role": &role_str,
                        "error_type": "api_error",
                        "duration_seconds": duration_seconds,
                    })).await;
                    write_event_log(pool, "main_conversation_protected", json!({
                        "task_id": task_id,
                        "main_chat_message_count_unchanged": true,
                    })).await;
                    return Err(AppError::DispatchError(format!(
                        "API 响应错误: status={}",
                        status
                    )));
                }

                let resp_json: serde_json::Value = resp.json().await.map_err(|e| {
                    AppError::DispatchError(format!("响应解析失败: {}", e))
                })?;

                output_tokens_captured = resp_json
                    .get("usage")
                    .and_then(|u| u.get("output_tokens"))
                    .and_then(|t| t.as_u64())
                    .unwrap_or(0);

                input_tokens_captured = resp_json
                    .get("usage")
                    .and_then(|u| u.get("input_tokens"))
                    .and_then(|t| t.as_u64())
                    .unwrap_or(0);

                resp_json
                    .get("content")
                    .and_then(|c| c.get(0))
                    .and_then(|c| c.get("text"))
                    .and_then(|t| t.as_str())
                    .unwrap_or("")
                    .to_string()
            }
        };

        let duration_seconds = dispatch_start.elapsed().as_secs();

        // Write output + update status to Completed + SSE
        self.state_machine
            .set_output(pool, task_id, &output_text)
            .await?;
        self.state_machine
            .update_status(pool, task_id, TaskStatus::Completed)
            .await?;
        let _ = self.sse_tx.send(SseEvent::TaskStatusChanged {
            task_id: task_id.to_string(),
            new_status: TaskStatus::Completed,
            decision_request: None,
        });

        write_event_log(pool, "agent_dispatch_completed", json!({
            "task_id": task_id,
            "role": &role_str,
            "duration_seconds": duration_seconds,
            "output_tokens": output_tokens_captured,
        })).await;
        write_event_log(pool, "main_conversation_protected", json!({
            "task_id": task_id,
            "main_chat_message_count_unchanged": true,
        })).await;

        // v0.9 req-029: 写入 llm_calls 记录
        let duration_ms = dispatch_start.elapsed().as_millis() as u64;
        insert_llm_call(
            pool,
            task_id,
            effective_model,
            input_tokens_captured,
            output_tokens_captured,
            duration_ms,
        ).await;

        info!(
            "[dispatcher] task completed: task_id={}, output_len={}",
            task_id,
            output_text.len()
        );

        Ok(output_text)
    }

    /// ReviewAgent post-hook
    async fn post_hook_review_agent(&self, pool: &SqlitePool, task: &AgentTask) {
        let output = match &task.output {
            None => {
                warn!("[dispatcher] review-agent output is empty for task {}", task.task_id);
                return;
            }
            Some(o) => o.clone(),
        };

        // Parse passed field
        let passed = if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&output) {
            json_val
                .get("passed")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        } else {
            output.contains("\"passed\": true") || output.contains("\"passed\":true")
        };

        if passed {
            info!(
                "[dispatcher] review-agent passed=true for task {}",
                task.task_id
            );

            let product_md_path = task.output_path_of_product_doc();
            if product_md_path.is_empty() {
                warn!("[dispatcher] no product_doc_path in review task input_context");
                return;
            }

            match self
                .state_machine
                .issue_token(
                    pool,
                    TokenType::Deliverable,
                    &product_md_path,
                    "review_agent_post_hook",
                )
                .await
            {
                Ok(token_id) => {
                    info!(
                        "[dispatcher] DELIVERABLE token issued: {} for {}",
                        token_id, product_md_path
                    );
                }
                Err(e) => {
                    error!("[dispatcher] failed to issue DELIVERABLE token: {}", e);
                    return;
                }
            }

            match self
                .state_machine
                .unblock_tasks_by_reason(pool, "product_doc_not_delivered")
                .await
            {
                Ok(unblocked_ids) => {
                    for task_id in &unblocked_ids {
                        info!("[dispatcher] unblocked task: {}", task_id);
                        let _ = self.sse_tx.send(SseEvent::TaskStatusChanged {
                            task_id: task_id.clone(),
                            new_status: TaskStatus::Pending,
                            decision_request: None,
                        });
                    }
                }
                Err(e) => {
                    error!("[dispatcher] failed to unblock tasks: {}", e);
                }
            }
        } else {
            info!(
                "[dispatcher] review-agent passed=false for task {}",
                task.task_id
            );
        }
    }

    /// 触发 ceo-event 任务（non-recursive: calls dispatch_core internally）
    pub async fn trigger_ceo_event(&self, pool: &SqlitePool, finished_task: &AgentTask) {
        info!(
            "[dispatcher] triggering ceo-event for finished task: {}",
            finished_task.task_id
        );

        let ceo_input_context = json!({
            "trigger_reason": format!(
                "任务 {} ({:?}) 已完成",
                finished_task.task_id, finished_task.role
            ),
            "finished_task_id": finished_task.task_id,
            "finished_task_role": format!("{:?}", finished_task.role),
            "finished_task_output": finished_task.output.as_deref().unwrap_or(""),
            "user_message": format!(
                "任务 {} 已完成，任务输出：\n\n{}\n\n请判断是否需要用户决策。",
                finished_task.task_id,
                finished_task.output.as_deref().unwrap_or("(无输出)")
            )
        });

        let ceo_task_id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        let ceo_task = AgentTask {
            task_id: ceo_task_id.clone(),
            task_type: TaskType::Memory,
            role: AgentRole::Ceo,
            status: TaskStatus::Pending,
            project: finished_task.project.clone(),
            version: finished_task.version.clone(),
            input_context: ceo_input_context.to_string(),
            title: None,
            output: None,
            blocking_on: None,
            decision_request: None,
            created_at: now.clone(),
            updated_at: now,
            file_refs: None,
            trigger_reason: Some("ceo_event".to_string()),
        };

        match self.state_machine.create_task(pool, ceo_task).await {
            Ok(_) => info!("[dispatcher] ceo-event task created: {}", ceo_task_id),
            Err(e) => {
                error!("[dispatcher] failed to create ceo-event task: {}", e);
                return;
            }
        }

        // Use dispatch_core (no post-hooks, avoids recursion)
        match self.dispatch_core(pool, &ceo_task_id, HashMap::new()).await {
            Ok(output) => {
                info!(
                    "[dispatcher] ceo-event completed: {}, output_len={}",
                    ceo_task_id,
                    output.len()
                );
                self.handle_ceo_event_output(pool, &output, finished_task)
                    .await;
            }
            Err(e) => {
                error!(
                    "[dispatcher] ceo-event task failed: {}: {}",
                    ceo_task_id, e
                );
            }
        }
    }

    /// 处理 ceo-event 输出，若包含 decision_required 则创建决策
    async fn handle_ceo_event_output(
        &self,
        pool: &SqlitePool,
        output: &str,
        source_task: &AgentTask,
    ) {
        let decision_required =
            if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(output) {
                json_val
                    .get("decision_required")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
            } else {
                output.contains("\"decision_required\": true")
                    || output.contains("\"decision_required\":true")
            };

        if !decision_required {
            info!(
                "[dispatcher] ceo-event: no decision required for source task {}",
                source_task.task_id
            );
            return;
        }

        info!(
            "[dispatcher] ceo-event requires decision for source task {}",
            source_task.task_id
        );

        let (question, options, risk_level) =
            if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(output) {
                let d = json_val.get("decision");

                let question = d
                    .and_then(|d| d.get("question"))
                    .and_then(|q| q.as_str())
                    .unwrap_or("是否批准此技术方案？")
                    .to_string();

                let options: Vec<DecisionOption> = d
                    .and_then(|d| d.get("options"))
                    .and_then(|o| o.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|opt| {
                                Some(DecisionOption {
                                    key: opt.get("key")?.as_str()?.to_string(),
                                    label: opt.get("label")?.as_str()?.to_string(),
                                    description: opt
                                        .get("description")
                                        .and_then(|d| d.as_str())
                                        .map(|s| s.to_string()),
                                })
                            })
                            .collect()
                    })
                    .unwrap_or_else(default_decision_options);

                let risk = match d
                    .and_then(|d| d.get("risk_level"))
                    .and_then(|r| r.as_str())
                    .unwrap_or("Medium")
                {
                    "High" => RiskLevel::High,
                    "Low" => RiskLevel::Low,
                    _ => RiskLevel::Medium,
                };

                (question, options, risk)
            } else {
                (
                    "是否批准此技术方案？".to_string(),
                    default_decision_options(),
                    RiskLevel::Medium,
                )
            };

        let decision_id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        let record = DecisionRecord {
            decision_id: decision_id.clone(),
            task_id: source_task.task_id.clone(),
            agent_role: source_task.role.clone(),
            question,
            options,
            risk_level,
            created_at: now,
            resolved_at: None,
            resolution: None,
        };

        match create_decision(pool, &self.sse_tx, record).await {
            Ok(_) => info!(
                "[dispatcher] decision created: {} for source task {}",
                decision_id, source_task.task_id
            ),
            Err(e) => error!("[dispatcher] failed to create decision: {}", e),
        }
    }
}

// v0.9 req-029: 写入 llm_calls 表
async fn insert_llm_call(
    pool: &SqlitePool,
    task_id: &str,
    model: &str,
    input_tokens: u64,
    output_tokens: u64,
    duration_ms: u64,
) {
    let id = Uuid::new_v4().to_string();
    let called_at = Utc::now().to_rfc3339();
    let _ = sqlx::query(
        "INSERT INTO llm_calls (id, model, input_tokens, output_tokens, duration_ms, called_at, task_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(model)
    .bind(input_tokens as i64)
    .bind(output_tokens as i64)
    .bind(duration_ms as i64)
    .bind(&called_at)
    .bind(task_id)
    .execute(pool)
    .await;
}

fn default_decision_options() -> Vec<DecisionOption> {
    vec![
        DecisionOption {
            key: "approve".to_string(),
            label: "批准".to_string(),
            description: None,
        },
        DecisionOption {
            key: "reject".to_string(),
            label: "拒绝".to_string(),
            description: None,
        },
    ]
}

/// v0.7: 自动调度主循环（tokio background task）
/// 调用方（main.rs）须在 spawn 前完成 API key 检查。
pub async fn run_auto_dispatcher(
    pool: SqlitePool,
    dispatcher: Arc<AgentDispatcher>,
    config: DispatcherConfig,
) {
    info!(
        "[auto_dispatcher] 启动，poll={}s，max_concurrent={}，timeout={}s",
        config.poll_interval_secs, config.max_concurrent_agents, config.agent_timeout_secs
    );

    let semaphore = Arc::new(Semaphore::new(config.max_concurrent_agents));
    let timeout_secs = config.agent_timeout_secs;

    let mut task_interval = tokio::time::interval(Duration::from_secs(config.poll_interval_secs));
    let mut r001_interval = tokio::time::interval(Duration::from_secs(30));

    loop {
        tokio::select! {
            _ = task_interval.tick() => {
                // 查询所有 Pending 任务
                let pending = match dispatcher.state_machine.list_tasks(
                    &pool,
                    TaskFilter { status: Some("Pending".to_string()), role: None, project: None },
                ).await {
                    Ok(tasks) => tasks,
                    Err(e) => {
                        error!("[auto_dispatcher] list_tasks failed: {}", e);
                        continue;
                    }
                };

                for task in pending {
                    let permit = match semaphore.clone().try_acquire_owned() {
                        Ok(p) => p,
                        Err(_) => {
                            info!("[auto_dispatcher] 并发上限已满，任务 {} 等待下一轮", task.task_id);
                            continue;
                        }
                    };

                    let d = dispatcher.clone();
                    let p = pool.clone();
                    let task_id = task.task_id.clone();
                    let title = task.title.clone().unwrap_or_else(|| task_id.clone());
                    let role = format!("{:?}", task.role);
                    let queue_wait_seconds: u64 = chrono::DateTime::parse_from_rfc3339(
                        &task.created_at
                    )
                    .map(|t| {
                        (Utc::now() - t.with_timezone(&Utc))
                            .num_seconds()
                            .max(0) as u64
                    })
                    .unwrap_or(0);

                    tokio::spawn(async move {
                        let _permit = permit; // 释放 semaphore 在 task 完成后
                        info!("[auto_dispatcher] 接取任务: {}", task_id);
                        write_event_log(&p, "agent_dispatch_triggered", json!({
                            "task_id": &task_id,
                            "role": &role,
                            "queue_wait_seconds": queue_wait_seconds,
                        })).await;

                        let result = tokio::time::timeout(
                            Duration::from_secs(timeout_secs),
                            d.dispatch(&p, &task_id, HashMap::new()),
                        ).await;

                        match result {
                            Ok(Ok(output)) => {
                                info!("[auto_dispatcher] 任务完成: {}", task_id);
                                let now = Utc::now().to_rfc3339();
                                let summary = output.chars().take(100).collect::<String>();
                                let _ = d.notify_tx.send(SseNotification::TaskCompleted {
                                    task_id: task_id.clone(),
                                    role,
                                    title,
                                    summary,
                                    timestamp: now,
                                });
                                // 刷新任务列表信号
                                let _ = d.sse_tx.send(SseEvent::TaskStatusChanged {
                                    task_id,
                                    new_status: TaskStatus::Completed,
                                    decision_request: None,
                                });
                            }
                            Ok(Err(e)) => {
                                error!("[auto_dispatcher] 任务失败: {}: {}", task_id, e);
                                let now = Utc::now().to_rfc3339();
                                let _ = d.notify_tx.send(SseNotification::TaskFailed {
                                    task_id: task_id.clone(),
                                    role,
                                    title,
                                    error_brief: e.to_string().chars().take(200).collect(),
                                    timestamp: now,
                                });
                            }
                            Err(_) => {
                                error!("[auto_dispatcher] 任务超时: {}", task_id);
                                let now = Utc::now().to_rfc3339();
                                let _ = d.notify_tx.send(SseNotification::TaskFailed {
                                    task_id: task_id.clone(),
                                    role,
                                    title,
                                    error_brief: format!("任务超时（{}s）", timeout_secs),
                                    timestamp: now,
                                });
                            }
                        }
                    });
                }
            }

            _ = r001_interval.tick() => {
                check_r001_rule(&pool, &dispatcher).await;
            }
        }
    }
}

/// v0.7: R-001 流水线规则 — 检测 technical.md 100% 完成，自动创建 qa-agent 任务
async fn check_r001_rule(pool: &SqlitePool, dispatcher: &AgentDispatcher) {
    // 扫描所有任务，查找已完成的 Engineering 任务所在的 project/version
    let all_tasks = match dispatcher.state_machine.list_tasks(pool, TaskFilter::default()).await {
        Ok(t) => t,
        Err(e) => {
            error!("[r001] list_tasks failed: {}", e);
            return;
        }
    };

    // 收集已完成 Engineering 任务的 project+version 组合（去重）
    let mut completed_versions: std::collections::HashSet<(String, String)> =
        std::collections::HashSet::new();
    for task in &all_tasks {
        if task.task_type == TaskType::Engineering && task.status == TaskStatus::Completed {
            completed_versions.insert((task.project.clone(), task.version.clone()));
        }
    }

    for (project, version) in completed_versions {
        // 防重复触发：检查该 project+version 是否已有非 Failed 的 QaAgent 任务
        let already_triggered = all_tasks.iter().any(|t| {
            t.role == AgentRole::QaAgent
                && t.project == project
                && t.version == version
                && t.status != TaskStatus::Failed
        });

        if already_triggered {
            continue;
        }

        info!("[r001] 触发 QaAgent 任务 for {}/{}", project, version);

        let now = Utc::now().to_rfc3339();
        let task_id = Uuid::new_v4().to_string();
        let input = format!(
            "请对项目 {} 版本 {} 的 technical.md 执行验收测试，输出测试报告。",
            project, version
        );

        let qa_file_refs = serde_json::to_string(
            &vec![format!("changelog/{}/technical.md", version)]
        ).ok();

        let qa_task = AgentTask {
            task_id: task_id.clone(),
            task_type: TaskType::Engineering,
            role: AgentRole::QaAgent,
            status: TaskStatus::Pending,
            project: project.clone(),
            version: version.clone(),
            input_context: input,
            title: Some(format!("QA 验收测试 {}/{}", project, version)),
            output: None,
            blocking_on: None,
            decision_request: None,
            created_at: now.clone(),
            updated_at: now.clone(),
            file_refs: qa_file_refs,
            trigger_reason: Some("pipeline_rule:R-001".to_string()),
        };

        match dispatcher.state_machine.create_task(pool, qa_task).await {
            Ok(_) => {
                info!("[r001] QaAgent 任务已创建: {}", task_id);
                write_event_log(pool, "pipeline_rule_triggered", json!({
                    "rule_id": "R-001",
                    "source_version": &version,
                    "target_role": "qa-agent",
                    "new_task_id": &task_id,
                })).await;
                let _ = dispatcher.notify_tx.send(SseNotification::PipelineTriggered {
                    rule_id: "R-001".to_string(),
                    source_version: version,
                    target_role: "QaAgent".to_string(),
                    new_task_id: task_id,
                    timestamp: now,
                });
            }
            Err(e) => error!("[r001] 创建 QaAgent 任务失败: {}", e),
        }
    }
}
