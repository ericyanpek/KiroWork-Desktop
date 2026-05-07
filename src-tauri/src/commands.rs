use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;

use crate::acp_client::{AcpClient, CancelSender, InitializeResult};
use crate::error::{AppError, AppResult};
use crate::session_store::{self, ReplayMessage, SessionMeta};
use crate::workspace_scanner::{self, WorkspaceManifest};
use crate::workspace_watcher;

pub type AcpState = Arc<Mutex<Option<AcpClient>>>;
/// Separate state for cancel so it never blocks on an in-flight session/prompt.
pub type CancelState = Arc<Mutex<Option<CancelSender>>>;

pub fn acp_state() -> AcpState {
    Arc::new(Mutex::new(None))
}

pub fn cancel_state() -> CancelState {
    Arc::new(Mutex::new(None))
}

#[tauri::command]
pub async fn acp_connect(
    app: AppHandle,
    state: State<'_, AcpState>,
    cancel: State<'_, CancelState>,
) -> AppResult<InitializeResult> {
    let mut guard = state.lock().await;
    if guard.is_some() {
        return Err(AppError::AcpConnectionFailed {
            message: "already connected".into(),
        });
    }
    let (client, cancel_sender, init) = AcpClient::spawn(app).await?;
    *guard = Some(client);
    *cancel.lock().await = Some(cancel_sender);
    Ok(init)
}

#[tauri::command]
pub async fn acp_disconnect(
    state: State<'_, AcpState>,
    cancel: State<'_, CancelState>,
) -> AppResult<()> {
    let mut guard = state.lock().await;
    *guard = None; // Drop triggers `kill_on_drop(true)`.
    *cancel.lock().await = None;
    Ok(())
}

#[tauri::command]
pub async fn acp_status(state: State<'_, AcpState>) -> AppResult<&'static str> {
    let guard = state.lock().await;
    Ok(if guard.is_some() { "connected" } else { "disconnected" })
}

#[tauri::command]
pub async fn session_new(state: State<'_, AcpState>, cwd: String) -> AppResult<Value> {
    let mut guard = state.lock().await;
    let client = guard.as_mut().ok_or(AppError::SessionError {
        message: "acp not connected".into(),
    })?;
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
    let mut guard = state.lock().await;
    let client = guard.as_mut().ok_or(AppError::SessionError {
        message: "acp not connected".into(),
    })?;
    // Real protocol field is `prompt`, not `content` (DESIGN.md had it wrong).
    client
        .request_no_timeout(
            "session/prompt",
            serde_json::json!({ "sessionId": session_id, "prompt": prompt }),
        )
        .await
}

#[tauri::command]
pub async fn session_cancel(cancel: State<'_, CancelState>, session_id: String) -> AppResult<()> {
    let guard = cancel.lock().await;
    let sender = guard.as_ref().ok_or(AppError::SessionError {
        message: "acp not connected".into(),
    })?;
    sender.send_cancel(&session_id).await
}

/// Switch the active session's model. Real ACP param key is `modelId`,
/// NOT `model` as DESIGN.md said. Returns the empty `{}` result from ACP.
#[tauri::command]
pub async fn set_model(
    state: State<'_, AcpState>,
    session_id: String,
    model_id: String,
) -> AppResult<Value> {
    let mut guard = state.lock().await;
    let client = guard.as_mut().ok_or(AppError::SessionError {
        message: "acp not connected".into(),
    })?;
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
    let mut guard = state.lock().await;
    let client = guard.as_mut().ok_or(AppError::SessionError {
        message: "acp not connected".into(),
    })?;
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

/// Scan `~/.kiro/sessions/cli/` for resumable sessions. Pure disk I/O,
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
        let mut guard = state.lock().await;
        let client = guard.as_mut().ok_or(AppError::SessionError {
            message: "acp not connected".into(),
        })?;
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
