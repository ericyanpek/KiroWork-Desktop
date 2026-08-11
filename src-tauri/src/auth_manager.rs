use std::process::Stdio;
use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, State};
use tokio::process::Command;
use tokio::sync::Mutex;

use crate::acp_client::AcpClient;
use crate::commands::AcpState;
use crate::error::{AppError, AppResult};
use crate::kiro_discovery;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum AuthStatus {
    #[serde(rename = "ok")]
    Ok {
        user: Option<String>,
        cli_version: String,
        agent_capabilities: Value,
        compatibility_warning: Option<String>,
    },
    #[serde(rename = "not_installed")]
    NotInstalled { message: String },
    #[serde(rename = "required")]
    Required { message: String },
}

#[tauri::command]
pub async fn check_auth(app: AppHandle, state: State<'_, AcpState>) -> AppResult<AuthStatus> {
    // 1. Discovery — error here is "kiro-cli not installed" (surfaced as a
    //    dedicated `not_installed` status rather than a hard error so the
    //    frontend can render the install guide).
    if let Err(AppError::KiroNotFound { message }) = kiro_discovery::find_kiro_cli() {
        return Ok(AuthStatus::NotInstalled { message });
    }

    // 2. Hold the state lock across the existence check AND the spawn so
    //    concurrent `check_auth` calls (e.g. StrictMode's dev-only double
    //    invocation) don't each spawn a kiro-cli child. Any second caller
    //    sees `Some(_)` and returns Ok.
    let mut guard = state.lock().await;
    if let Some(client) = guard.as_ref().filter(|client| client.is_alive()) {
        return Ok(AuthStatus::Ok {
            user: None,
            cli_version: client.cli_version().to_string(),
            agent_capabilities: client.agent_capabilities().clone(),
            compatibility_warning: client.compatibility_warning().map(str::to_string),
        });
    }
    *guard = None;
    match AcpClient::spawn(app).await {
        Ok((client, init)) => {
            *guard = Some(Arc::new(client));
            Ok(AuthStatus::Ok {
                user: None,
                cli_version: init.cli_version,
                agent_capabilities: init.agent_capabilities,
                compatibility_warning: init.compatibility_warning,
            })
        }
        Err(AppError::AuthRequired { message }) => Ok(AuthStatus::Required { message }),
        Err(AppError::KiroNotFound { message }) => Ok(AuthStatus::NotInstalled { message }),
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn trigger_login() -> AppResult<()> {
    let path = kiro_discovery::find_kiro_cli()?;
    // Spawn detached; kiro-cli login opens a browser for OAuth on its own.
    Command::new(&path)
        .arg("login")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| AppError::Unknown {
            message: format!("spawn `{} login`: {e}", path.display()),
        })?;
    Ok(())
}

// Unused but kept for symmetry and future use.
#[allow(dead_code)]
pub type AuthState = Mutex<Option<AuthStatus>>;
