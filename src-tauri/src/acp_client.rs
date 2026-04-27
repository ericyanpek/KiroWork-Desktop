use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::oneshot;

use crate::error::{AppError, AppResult};
use crate::kiro_discovery;

/// Wire-level response from `initialize`. Uses `camelCase` to match the ACP JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeResult {
    pub protocol_version: i32,
    pub agent_capabilities: Value,
    #[serde(default)]
    pub auth_methods: Vec<Value>,
    pub agent_info: Value,
}

/// Resolution sent through the pending map. `Ok(result)` for a successful
/// JSON-RPC response, `Err(AppError)` for a JSON-RPC error (with auth-like
/// messages mapped to `AuthRequired`).
type PendingResult = Result<Value, AppError>;

pub struct AcpClient {
    _child: Child,
    stdin: ChildStdin,
    pending: Arc<DashMap<u64, oneshot::Sender<PendingResult>>>,
    next_id: AtomicU64,
}

impl AcpClient {
    /// Spawn `kiro-cli acp -a` and perform the `initialize` handshake.
    ///
    /// `-a` auto-approves all tool permission requests (matches the plan's
    /// Phase 1 "Auto Accept" permission mode). We MUST NOT pass `-v`: verbose
    /// tracing writes to stdout and would corrupt the line-delimited JSON-RPC
    /// stream we parse.
    pub async fn spawn(app: AppHandle) -> AppResult<(Self, InitializeResult)> {
        let path = kiro_discovery::find_kiro_cli()?;
        tracing::info!(path = %path.display(), "spawning kiro-cli acp");

        let mut child = Command::new(&path)
            .args(["acp", "-a"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| AppError::AcpConnectionFailed {
                message: format!("failed to spawn {}: {e}", path.display()),
            })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AppError::AcpConnectionFailed {
                message: "child stdin not piped".into(),
            })?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AppError::AcpConnectionFailed {
                message: "child stdout not piped".into(),
            })?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| AppError::AcpConnectionFailed {
                message: "child stderr not piped".into(),
            })?;

        let pending: Arc<DashMap<u64, oneshot::Sender<PendingResult>>> = Arc::new(DashMap::new());

        tokio::spawn(reader_loop(stdout, pending.clone(), app.clone()));
        tokio::spawn(stderr_loop(stderr));

        let mut client = Self {
            _child: child,
            stdin,
            pending,
            next_id: AtomicU64::new(0),
        };

        let init_value = client
            .request(
                "initialize",
                json!({
                    "protocolVersion": 1,
                    "clientCapabilities": {
                        "fs": { "readTextFile": true, "writeTextFile": true },
                        "terminal": false,
                    },
                    "clientInfo": {
                        "name": "kiro-cowork-desktop",
                        "version": env!("CARGO_PKG_VERSION"),
                    }
                }),
            )
            .await?;

        let init: InitializeResult = serde_json::from_value(init_value).map_err(|e| {
            AppError::AcpConnectionFailed {
                message: format!("bad initialize result: {e}"),
            }
        })?;

        Ok((client, init))
    }

    /// Send a JSON-RPC request and await the matching response.
    pub async fn request(&mut self, method: &str, params: Value) -> AppResult<Value> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.insert(id, tx);

        let frame = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        let mut line = serde_json::to_vec(&frame)?;
        line.push(b'\n');
        self.stdin.write_all(&line).await.map_err(|e| AppError::AcpConnectionFailed {
            message: format!("write to child stdin: {e}"),
        })?;
        self.stdin
            .flush()
            .await
            .map_err(|e| AppError::AcpConnectionFailed {
                message: format!("flush child stdin: {e}"),
            })?;

        match tokio::time::timeout(Duration::from_secs(120), rx).await {
            Err(_) => {
                self.pending.remove(&id);
                Err(AppError::AcpTimeout {
                    message: format!("{method} timed out"),
                })
            }
            Ok(Err(_)) => Err(AppError::AcpConnectionFailed {
                message: format!("{method}: reader dropped before response"),
            }),
            Ok(Ok(result)) => result,
        }
    }

    /// Fire-and-forget notification (no `id`, no response awaited).
    #[allow(dead_code)]
    pub async fn notify(&mut self, method: &str, params: Value) -> AppResult<()> {
        let frame = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        });
        let mut line = serde_json::to_vec(&frame)?;
        line.push(b'\n');
        self.stdin.write_all(&line).await?;
        self.stdin.flush().await?;
        Ok(())
    }
}

async fn reader_loop(
    stdout: ChildStdout,
    pending: Arc<DashMap<u64, oneshot::Sender<PendingResult>>>,
    app: AppHandle,
) {
    let mut lines = BufReader::new(stdout).lines();
    loop {
        match lines.next_line().await {
            Ok(Some(line)) => {
                if line.trim().is_empty() {
                    continue;
                }
                let msg: Value = match serde_json::from_str(&line) {
                    Ok(v) => v,
                    Err(e) => {
                        tracing::warn!(err = %e, line = %line, "non-JSON line on acp stdout");
                        continue;
                    }
                };
                dispatch(msg, &pending, &app);
            }
            Ok(None) => {
                tracing::info!("acp stdout closed");
                break;
            }
            Err(e) => {
                tracing::error!(err = %e, "acp stdout read error");
                break;
            }
        }
    }
    let _ = app.emit("acp-status-changed", "disconnected");
}

fn dispatch(
    msg: Value,
    pending: &Arc<DashMap<u64, oneshot::Sender<PendingResult>>>,
    app: &AppHandle,
) {
    // Response path: has `id`.
    if let Some(id) = msg.get("id").and_then(|x| x.as_u64()) {
        if let Some((_, tx)) = pending.remove(&id) {
            let outcome: PendingResult = if let Some(err) = msg.get("error") {
                Err(classify_error(err))
            } else {
                Ok(msg.get("result").cloned().unwrap_or(Value::Null))
            };
            let _ = tx.send(outcome);
        } else {
            tracing::warn!(%id, "response for unknown request id");
        }
        return;
    }

    // Notification path: has `method`, no `id`.
    let Some(method) = msg.get("method").and_then(|x| x.as_str()) else {
        tracing::warn!(%msg, "jsonrpc message without id or method");
        return;
    };
    let params = msg.get("params").cloned().unwrap_or(Value::Null);
    match method {
        "session/update" => {
            if let Err(e) = app.emit("session-update", &params) {
                tracing::warn!(err = %e, "emit session-update failed");
            }
        }
        m if m.starts_with("_kiro.dev/") => {
            tracing::debug!(method = m, params = %params, "kiro extension notification");
        }
        other => {
            tracing::debug!(method = other, params = %params, "unhandled notification");
        }
    }
}

/// Classify a JSON-RPC `error` object into an `AppError`. Auth-like messages
/// get mapped to `AuthRequired` so the AuthGate can swap in the login page.
fn classify_error(err: &Value) -> AppError {
    let msg = err
        .get("message")
        .and_then(|x| x.as_str())
        .unwrap_or("jsonrpc error")
        .to_string();
    let data = err
        .get("data")
        .map(|x| x.to_string())
        .unwrap_or_default();
    let haystack = format!("{msg} {data}").to_lowercase();
    let auth_hit = ["unauthor", "forbid", "auth", "login", "token", "credential"]
        .iter()
        .any(|needle| haystack.contains(needle));
    if auth_hit {
        AppError::AuthRequired { message: msg }
    } else {
        AppError::SessionError { message: msg }
    }
}

async fn stderr_loop(stderr: tokio::process::ChildStderr) {
    let mut lines = BufReader::new(stderr).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        tracing::debug!(target: "kiro_cli_stderr", "{line}");
    }
}
