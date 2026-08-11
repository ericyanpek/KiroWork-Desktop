use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;

use crate::acp_client::{emit_acp_status, AcpClient, InitializeResult};
use crate::error::{AppError, AppResult};
use crate::session_store::{self, ReplayMessage, SessionMeta};
use crate::workspace_scanner::{self, WorkspaceManifest};
use crate::workspace_watcher;

pub type AcpState = Arc<Mutex<Option<Arc<AcpClient>>>>;

pub fn acp_state() -> AcpState {
    Arc::new(Mutex::new(None))
}

async fn current_client(state: &State<'_, AcpState>) -> AppResult<Arc<AcpClient>> {
    let client = state.lock().await.clone().ok_or(AppError::SessionError {
        message: "acp not connected".into(),
    })?;
    if !client.is_alive() {
        return Err(AppError::AcpConnectionFailed {
            message: "kiro-cli ACP process exited; reconnect before continuing".into(),
        });
    }
    Ok(client)
}

#[tauri::command]
pub async fn acp_connect(
    app: AppHandle,
    state: State<'_, AcpState>,
) -> AppResult<InitializeResult> {
    let mut guard = state.lock().await;
    if guard.as_ref().is_some_and(|client| client.is_alive()) {
        return Err(AppError::AcpConnectionFailed {
            message: "already connected".into(),
        });
    }
    *guard = None;
    let (client, init) = AcpClient::spawn(app.clone()).await?;
    *guard = Some(Arc::new(client));
    emit_acp_status(&app, "connected", false, None);
    Ok(init)
}

#[tauri::command]
pub async fn acp_disconnect(app: AppHandle, state: State<'_, AcpState>) -> AppResult<()> {
    let client = state.lock().await.take();
    if let Some(client) = client {
        client.shutdown().await;
    }
    emit_acp_status(&app, "disconnected", false, None);
    Ok(())
}

#[tauri::command]
pub async fn acp_status(state: State<'_, AcpState>) -> AppResult<&'static str> {
    let guard = state.lock().await;
    Ok(if guard.as_ref().is_some_and(|client| client.is_alive()) {
        "connected"
    } else {
        "disconnected"
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconnectResult {
    pub session: Option<Value>,
    pub cli_version: String,
    pub agent_capabilities: Value,
    pub compatibility_warning: Option<String>,
}

/// Rebuild the ACP process after an unexpected exit and, when an active
/// session is supplied, restore that session before reporting success.
/// Holding AcpState across the operation serializes concurrent retries.
#[tauri::command]
pub async fn reconnect_acp(
    app: AppHandle,
    state: State<'_, AcpState>,
    session_id: Option<String>,
    cwd: Option<String>,
    auto_approve: bool,
) -> AppResult<ReconnectResult> {
    emit_acp_status(&app, "reconnecting", true, None);

    let result: AppResult<ReconnectResult> = async {
        let load_params = reconnect_session_params(session_id.as_deref(), cwd.as_deref())?;
        let mut guard = state.lock().await;
        let client = if let Some(client) = guard.as_ref().filter(|client| client.is_alive()) {
            client.clone()
        } else {
            *guard = None;
            let (client, _) = AcpClient::spawn(app.clone()).await?;
            let client = Arc::new(client);
            *guard = Some(client.clone());
            client
        };

        client.set_auto_approve(auto_approve);
        let session = match load_params {
            Some(params) => Some(client.request("session/load", params).await?),
            None => None,
        };

        Ok(ReconnectResult {
            session,
            cli_version: client.cli_version().to_string(),
            agent_capabilities: client.agent_capabilities().clone(),
            compatibility_warning: client.compatibility_warning().map(str::to_string),
        })
    }
    .await;

    match &result {
        Ok(_) => emit_acp_status(&app, "connected", false, None),
        Err(error) => emit_acp_status(&app, "reconnect_failed", true, Some(error.to_string())),
    }
    result
}

fn reconnect_session_params(
    session_id: Option<&str>,
    cwd: Option<&str>,
) -> AppResult<Option<Value>> {
    match (session_id, cwd) {
        (Some(session_id), Some(cwd)) => Ok(Some(serde_json::json!({
            "sessionId": session_id,
            "cwd": cwd,
            "mcpServers": []
        }))),
        (None, None) => Ok(None),
        _ => Err(AppError::SessionError {
            message: "sessionId and cwd must both be provided when reconnecting a session".into(),
        }),
    }
}

#[tauri::command]
pub async fn session_new(state: State<'_, AcpState>, cwd: String) -> AppResult<Value> {
    let client = current_client(&state).await?;
    client
        .request(
            "session/new",
            serde_json::json!({ "cwd": cwd, "mcpServers": [] }),
        )
        .await
}

#[tauri::command]
pub async fn session_prompt(
    state: State<'_, AcpState>,
    session_id: String,
    prompt: Value,
) -> AppResult<Value> {
    let client = current_client(&state).await?;
    // Real protocol field is `prompt`, not `content` (DESIGN.md had it wrong).
    client
        .request_no_timeout(
            "session/prompt",
            serde_json::json!({ "sessionId": session_id, "prompt": prompt }),
        )
        .await
}

#[tauri::command]
pub async fn session_cancel(state: State<'_, AcpState>, session_id: String) -> AppResult<()> {
    let client = current_client(&state).await?;
    client
        .notify(
            "session/cancel",
            serde_json::json!({ "sessionId": session_id }),
        )
        .await
}

#[tauri::command]
pub async fn session_steer(
    state: State<'_, AcpState>,
    session_id: String,
    message: String,
) -> AppResult<Value> {
    let text = message.trim();
    if text.is_empty() {
        return Err(AppError::SessionError {
            message: "steering message cannot be empty".into(),
        });
    }
    let client = current_client(&state).await?;
    client
        .request("_session/steer", steering_params(&session_id, text))
        .await
}

fn steering_params(session_id: &str, message: &str) -> Value {
    serde_json::json!({
        "sessionId": session_id,
        "message": format!("<user_message>\n{message}\n</user_message>"),
    })
}

#[tauri::command]
pub async fn execute_command(
    state: State<'_, AcpState>,
    session_id: String,
    command: String,
    args: Option<Value>,
) -> AppResult<Value> {
    let command = command.trim();
    let name = command
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .trim_start_matches('/');
    if name.is_empty() {
        return Err(AppError::SessionError {
            message: "slash command cannot be empty".into(),
        });
    }
    let client = current_client(&state).await?;
    client
        .request(
            "_kiro.dev/commands/execute",
            command_params(&session_id, name, args),
        )
        .await
}

fn command_params(session_id: &str, command: &str, args: Option<Value>) -> Value {
    serde_json::json!({
        "sessionId": session_id,
        "command": {
            "command": command,
            "args": args.unwrap_or_else(|| serde_json::json!({})),
        },
    })
}

#[tauri::command]
pub async fn set_permission_mode(state: State<'_, AcpState>, auto_approve: bool) -> AppResult<()> {
    let client = current_client(&state).await?;
    client.set_auto_approve(auto_approve);
    Ok(())
}

#[tauri::command]
pub async fn respond_permission(
    state: State<'_, AcpState>,
    request_id: Value,
    option_id: Option<String>,
) -> AppResult<()> {
    let client = current_client(&state).await?;
    client.respond_permission(request_id, option_id).await
}

/// Switch the active session's model. Real ACP param key is `modelId`,
/// NOT `model` as DESIGN.md said. Returns the empty `{}` result from ACP.
#[tauri::command]
pub async fn set_model(
    state: State<'_, AcpState>,
    session_id: String,
    model_id: String,
) -> AppResult<Value> {
    let client = current_client(&state).await?;
    client
        .request(
            "session/set_model",
            serde_json::json!({ "sessionId": session_id, "modelId": model_id }),
        )
        .await
}

/// Switch the active session's agent mode. Real ACP param key is `modeId`.
#[tauri::command]
pub async fn set_mode(
    state: State<'_, AcpState>,
    session_id: String,
    mode_id: String,
) -> AppResult<Value> {
    let client = current_client(&state).await?;
    client
        .request(
            "session/set_mode",
            serde_json::json!({ "sessionId": session_id, "modeId": mode_id }),
        )
        .await
}

/// Read the title of a single session from disk, ignoring any lock file.
/// Used to refresh the sidebar entry for the active session after kiro-cli
/// writes its generated title at end-of-turn.
#[tauri::command]
pub async fn get_session_title(session_id: String) -> AppResult<Option<String>> {
    tokio::task::spawn_blocking(move || session_store::get_session_title(&session_id))
        .await
        .map_err(|e| AppError::Unknown {
            message: format!("spawn_blocking: {e}"),
        })?
}

/// Scan Kiro's configured session directory for resumable sessions. Pure disk I/O,
/// no ACP call, no AcpState lock.
#[tauri::command]
pub async fn list_persisted_sessions() -> AppResult<Vec<SessionMeta>> {
    tokio::task::spawn_blocking(session_store::list_sessions)
        .await
        .map_err(|e| AppError::Unknown {
            message: format!("spawn_blocking: {e}"),
        })?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadSessionResult {
    /// Full session state from ACP (same shape as session/new response minus
    /// sessionId). Frontend hydrates models/modes from here.
    pub session: Value,
    /// Messages parsed from the local jsonl. ACP session/load does NOT
    /// replay history over the wire — the jsonl file is the source of truth.
    pub replay: Vec<ReplayMessage>,
}

/// Resume a persisted session: restore kiro-cli's state via ACP session/load,
/// then read the local jsonl to reconstruct the message timeline.
#[tauri::command]
pub async fn load_session(
    state: State<'_, AcpState>,
    session_id: String,
    cwd: String,
) -> AppResult<LoadSessionResult> {
    let session_value = {
        let client = current_client(&state).await?;
        client
            .request(
                "session/load",
                serde_json::json!({
                    "sessionId": session_id,
                    "cwd": cwd,
                    "mcpServers": []
                }),
            )
            .await?
    };

    // jsonl parse runs off the Tokio runtime thread.
    let sid = session_id.clone();
    let replay = tokio::task::spawn_blocking(move || session_store::read_jsonl(&sid))
        .await
        .map_err(|e| AppError::Unknown {
            message: format!("spawn_blocking: {e}"),
        })??;

    Ok(LoadSessionResult {
        session: session_value,
        replay,
    })
}

/// Start watching `<path>/.kiro/` for changes. Emits `workspace-manifest-updated`
/// whenever files are added/modified/removed inside `.kiro/`.
#[tauri::command]
pub async fn watch_workspace(app: AppHandle, path: String) -> AppResult<()> {
    let root = std::path::PathBuf::from(&path);
    if !root.is_dir() {
        return Err(AppError::WorkspaceError {
            message: format!("not a directory: {path}"),
        });
    }
    workspace_watcher::start(app, root);
    Ok(())
}

/// Stop the active workspace watcher.
#[tauri::command]
pub async fn unwatch_workspace() -> AppResult<()> {
    workspace_watcher::stop();
    Ok(())
}

/// Read an arbitrary file as raw bytes. Used by image upload (InputBar)
/// where the path comes from Tauri's native file dialog — the user has
/// already granted consent by picking the file, so we don't gate on
/// capability scopes. Size-capped to 20 MiB to prevent a runaway blob
/// from wedging the renderer.
#[tauri::command]
pub async fn read_file_bytes(path: String) -> AppResult<Vec<u8>> {
    const MAX: u64 = 20 * 1024 * 1024;
    let meta = tokio::fs::metadata(&path)
        .await
        .map_err(|e| AppError::Unknown {
            message: format!("stat {path}: {e}"),
        })?;
    if meta.len() > MAX {
        return Err(AppError::Unknown {
            message: format!("file too large ({} bytes, max {MAX})", meta.len()),
        });
    }
    tokio::fs::read(&path).await.map_err(|e| AppError::Unknown {
        message: format!("read {path}: {e}"),
    })
}

#[tauri::command]
pub fn export_transcript(path: PathBuf, content: String) -> AppResult<()> {
    if !path.is_absolute() {
        return Err(AppError::WorkspaceError {
            message: "transcript export path must be absolute".into(),
        });
    }
    if content.len() > 16 * 1024 * 1024 {
        return Err(AppError::WorkspaceError {
            message: "transcript export exceeds 16 MiB".into(),
        });
    }
    std::fs::write(&path, content).map_err(|error| AppError::WorkspaceError {
        message: format!("write transcript {}: {error}", path.display()),
    })
}

/// Delete a session's `.json` and `.jsonl` files from `~/.kiro/sessions/cli/`.
/// Locked sessions are excluded by `list_sessions`, so this should never be
/// called for a live session. Runs on the blocking pool.
#[tauri::command]
pub async fn delete_session(session_id: String) -> AppResult<()> {
    tokio::task::spawn_blocking(move || session_store::delete_session(&session_id))
        .await
        .map_err(|e| AppError::Unknown {
            message: format!("spawn_blocking: {e}"),
        })?
}

/// Scan `<workspace>/.kiro/` for skills / mcp / steering configs.
/// Pure disk I/O, no ACP. Runs on the blocking pool.
#[tauri::command]
pub async fn scan_workspace(path: String) -> AppResult<WorkspaceManifest> {
    tokio::task::spawn_blocking(move || {
        let root = std::path::PathBuf::from(&path);
        if !root.is_dir() {
            return Err(AppError::WorkspaceError {
                message: format!("not a directory: {path}"),
            });
        }
        workspace_scanner::scan(&root)
    })
    .await
    .map_err(|e| AppError::Unknown {
        message: format!("spawn_blocking: {e}"),
    })?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn steering_payload_wraps_user_message() {
        assert_eq!(
            steering_params("session-1", "redirect"),
            json!({
                "sessionId": "session-1",
                "message": "<user_message>\nredirect\n</user_message>",
            })
        );
    }

    #[test]
    fn command_payload_uses_tui_command_object() {
        assert_eq!(
            command_params("session-1", "effort", Some(json!({ "level": "high" }))),
            json!({
                "sessionId": "session-1",
                "command": {
                    "command": "effort",
                    "args": { "level": "high" },
                },
            })
        );
        assert_eq!(
            command_params("session-1", "help", None)["command"]["args"],
            json!({})
        );
    }

    #[test]
    fn reconnect_payload_requires_a_complete_session_target() {
        assert_eq!(
            reconnect_session_params(Some("session-1"), Some("/tmp/project")).unwrap(),
            Some(json!({
                "sessionId": "session-1",
                "cwd": "/tmp/project",
                "mcpServers": [],
            }))
        );
        assert!(reconnect_session_params(None, None).unwrap().is_none());
        assert!(reconnect_session_params(Some("session-1"), None).is_err());
        assert!(reconnect_session_params(None, Some("/tmp/project")).is_err());
    }
}
