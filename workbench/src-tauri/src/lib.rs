mod commands;
mod models;
mod stream_state;

use commands::{ai_stream, backend_client, event_log, execute_tool, projects, qa_atoms, settings, sse_client, vault};
use stream_state::StreamState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .manage(StreamState::default())
        .invoke_handler(tauri::generate_handler![
            qa_atoms::list_qa_atoms,
            qa_atoms::read_qa_atom,
            qa_atoms::write_qa_atom,
            qa_atoms::next_branch_id,
            vault::search_vault,
            event_log::write_event_log,
            ai_stream::stream_ai,
            ai_stream::cancel_stream,
            projects::list_projects,
            projects::create_project,
            projects::add_atom_to_project,
            backend_client::create_task,
            backend_client::dispatch_task,
            backend_client::list_decisions,
            backend_client::get_decision,
            backend_client::resolve_decision,
            backend_client::check_backend_health,
            backend_client::list_tasks,
            backend_client::get_task_stats,
            backend_client::get_token_stats_from_gateway,
            backend_client::get_backend_url,
            backend_client::list_capability_tokens,
            backend_client::create_capability_token,
            backend_client::revoke_capability_token,
            backend_client::get_llm_stats,
            sse_client::start_backend_sse,
            sse_client::stop_backend_sse,
            execute_tool::execute_tool,
            settings::read_settings,
            settings::write_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
