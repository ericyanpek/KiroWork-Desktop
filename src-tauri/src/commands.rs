use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;

use crate::acp_client::{AcpClient, InitializeResult};
use crate::error::{AppError, AppResult};

pub type AcpState = Arc<Mutex<Option<AcpClient>>>;

pub fn acp_state() -> AcpState {
    Arc::new(Mutex::new(None))
}

#[tauri::command]
pub async fn acp_connect(
    app: AppHandle,
    state: State<'_, AcpState>,
) -> AppResult<InitializeResult> {
    let mut guard = state.lock().await;
    if guard.is_some() {
        return Err(AppError::AcpConnectionFailed {
            message: "already connected".into(),
        });
    }
    let (client, init) = AcpClient::spawn(app).await?;
    *guard = Some(client);
    Ok(init)
}

#[tauri::command]
pub async fn acp_disconnect(state: State<'_, AcpState>) -> AppResult<()> {
    let mut guard = state.lock().await;
    *guard = None; // Drop triggers `kill_on_drop(true)`.
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
        .request(
            "session/prompt",
            serde_json::json!({ "sessionId": session_id, "prompt": prompt }),
        )
        .await
}

#[tauri::command]
pub async fn session_cancel(state: State<'_, AcpState>, session_id: String) -> AppResult<()> {
    let mut guard = state.lock().await;
    let client = guard.as_mut().ok_or(AppError::SessionError {
        message: "acp not connected".into(),
    })?;
    // session/cancel is a notification (no response awaited).
    client
        .notify("session/cancel", serde_json::json!({ "sessionId": session_id }))
        .await
}
