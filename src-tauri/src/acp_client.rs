use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{oneshot, Mutex};

use crate::error::{AppError, AppResult};
use crate::file_activity;
use crate::kiro_discovery;

const MINIMUM_KIRO_CLI_VERSION: (u64, u64, u64) = (2, 2, 0);
const JSONRPC_METHOD_NOT_FOUND: i64 = -32601;
const JSONRPC_INVALID_REQUEST: i64 = -32600;

/// Wire-level response from `initialize`, enriched with the executable version
/// that KiroWork validated before starting ACP.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeResult {
    pub protocol_version: i32,
    pub agent_capabilities: Value,
    #[serde(default)]
    pub auth_methods: Vec<Value>,
    pub agent_info: Value,
    #[serde(default)]
    pub cli_version: String,
    #[serde(default)]
    pub compatibility_warning: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionOption {
    pub option_id: String,
    pub name: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRequestEvent {
    pub request_id: Value,
    pub session_id: Option<String>,
    pub tool_call_id: Option<String>,
    pub title: String,
    pub kind: String,
    pub options: Vec<PermissionOption>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum RpcId {
    Number(String),
    String(String),
}

impl RpcId {
    fn from_value(value: &Value) -> Option<Self> {
        match value {
            Value::Number(n) => Some(Self::Number(n.to_string())),
            Value::String(s) => Some(Self::String(s.clone())),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
struct InboundRequest {
    id: Value,
    method: String,
}

type PendingResult = Result<Value, AppError>;

pub struct AcpClient {
    child: Mutex<Child>,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Arc<DashMap<RpcId, oneshot::Sender<PendingResult>>>,
    inbound: Arc<DashMap<RpcId, InboundRequest>>,
    next_id: AtomicU64,
    auto_approve: Arc<AtomicBool>,
    alive: Arc<AtomicBool>,
    cli_version: String,
    agent_capabilities: Value,
    compatibility_warning: Option<String>,
}

impl AcpClient {
    /// Spawn the stable V2 ACP engine. Permission requests are handled by the
    /// host; auto-approval is an explicit runtime setting instead of a process
    /// default.
    pub async fn spawn(app: AppHandle) -> AppResult<(Self, InitializeResult)> {
        let path = kiro_discovery::find_kiro_cli()?;
        let cli_version = detect_cli_version(&path).await?;
        let compatibility_warning = validate_cli_version(&cli_version)?;
        tracing::info!(
            path = %path.display(),
            version = %cli_version,
            "spawning kiro-cli ACP V2"
        );

        let mut child = Command::new(&path)
            .args(["acp", "--agent-engine", "v2"])
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

        let pending = Arc::new(DashMap::new());
        let inbound = Arc::new(DashMap::new());
        let stdin = Arc::new(Mutex::new(stdin));
        let auto_approve = Arc::new(AtomicBool::new(false));
        let alive = Arc::new(AtomicBool::new(true));

        tokio::spawn(reader_loop(
            stdout,
            stdin.clone(),
            pending.clone(),
            inbound.clone(),
            auto_approve.clone(),
            alive.clone(),
            app.clone(),
        ));
        tokio::spawn(stderr_loop(stderr));

        let mut client = Self {
            child: Mutex::new(child),
            stdin,
            pending,
            inbound,
            next_id: AtomicU64::new(0),
            auto_approve,
            alive,
            cli_version: cli_version.clone(),
            agent_capabilities: Value::Null,
            compatibility_warning: compatibility_warning.clone(),
        };

        let init_value = client
            .request(
                "initialize",
                json!({
                    "protocolVersion": 1,
                    "clientCapabilities": {
                        "fs": { "readTextFile": false, "writeTextFile": false },
                        "terminal": false,
                    },
                    "clientInfo": {
                        "name": "kiro-cowork-desktop",
                        "version": env!("CARGO_PKG_VERSION"),
                    }
                }),
            )
            .await?;

        let mut init: InitializeResult =
            serde_json::from_value(init_value).map_err(|e| AppError::AcpConnectionFailed {
                message: format!("bad initialize result: {e}"),
            })?;
        init.cli_version = cli_version;
        init.compatibility_warning = compatibility_warning;
        client.agent_capabilities = init.agent_capabilities.clone();

        Ok((client, init))
    }

    pub async fn request(&self, method: &str, params: Value) -> AppResult<Value> {
        self.request_with_timeout(method, params, Some(Duration::from_secs(120)))
            .await
    }

    pub async fn request_no_timeout(&self, method: &str, params: Value) -> AppResult<Value> {
        self.request_with_timeout(method, params, None).await
    }

    async fn request_with_timeout(
        &self,
        method: &str,
        params: Value,
        timeout: Option<Duration>,
    ) -> AppResult<Value> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let key = RpcId::Number(id.to_string());
        let (tx, rx) = oneshot::channel();
        self.pending.insert(key.clone(), tx);

        let frame = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        if let Err(error) = write_frame(&self.stdin, &frame).await {
            self.pending.remove(&key);
            return Err(error);
        }

        let recv = async {
            match rx.await {
                Err(_) => Err(AppError::AcpConnectionFailed {
                    message: format!("{method}: ACP reader stopped before the response"),
                }),
                Ok(result) => result,
            }
        };

        if let Some(duration) = timeout {
            match tokio::time::timeout(duration, recv).await {
                Err(_) => {
                    self.pending.remove(&key);
                    Err(AppError::AcpTimeout {
                        message: format!("{method} timed out"),
                    })
                }
                Ok(result) => result,
            }
        } else {
            recv.await
        }
    }

    pub async fn notify(&self, method: &str, params: Value) -> AppResult<()> {
        write_frame(
            &self.stdin,
            &json!({
                "jsonrpc": "2.0",
                "method": method,
                "params": params,
            }),
        )
        .await
    }

    pub fn set_auto_approve(&self, enabled: bool) {
        self.auto_approve.store(enabled, Ordering::SeqCst);
    }

    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    pub fn cli_version(&self) -> &str {
        &self.cli_version
    }

    pub fn agent_capabilities(&self) -> &Value {
        &self.agent_capabilities
    }

    pub fn compatibility_warning(&self) -> Option<&str> {
        self.compatibility_warning.as_deref()
    }

    pub async fn respond_permission(
        &self,
        request_id: Value,
        option_id: Option<String>,
    ) -> AppResult<()> {
        let key = RpcId::from_value(&request_id).ok_or_else(|| AppError::SessionError {
            message: "permission request has an unsupported JSON-RPC id".into(),
        })?;
        let (_, request) = self
            .inbound
            .remove(&key)
            .ok_or_else(|| AppError::SessionError {
                message: "permission request is no longer pending".into(),
            })?;
        if request.method != "session/request_permission" {
            return Err(AppError::SessionError {
                message: format!("cannot answer inbound method {}", request.method),
            });
        }

        let result = match option_id {
            Some(option_id) => {
                json!({ "outcome": { "outcome": "selected", "optionId": option_id } })
            }
            None => json!({ "outcome": { "outcome": "cancelled" } }),
        };
        if let Err(error) = send_response(&self.stdin, request.id.clone(), result).await {
            if self.is_alive() {
                self.inbound.insert(key, request);
            }
            return Err(error);
        }
        Ok(())
    }

    pub async fn shutdown(&self) {
        self.alive.store(false, Ordering::SeqCst);
        self.fail_all_pending("ACP connection closed");
        self.inbound.clear();
        let mut child = self.child.lock().await;
        if let Err(error) = child.kill().await {
            tracing::debug!(%error, "ACP child was already stopped");
        }
    }

    fn fail_all_pending(&self, message: &str) {
        fail_pending(&self.pending, message);
    }
}

async fn write_frame(stdin: &Arc<Mutex<ChildStdin>>, frame: &Value) -> AppResult<()> {
    let mut line = serde_json::to_vec(frame)?;
    line.push(b'\n');
    let mut writer = stdin.lock().await;
    writer
        .write_all(&line)
        .await
        .map_err(|e| AppError::AcpConnectionFailed {
            message: format!("write to ACP stdin: {e}"),
        })?;
    writer
        .flush()
        .await
        .map_err(|e| AppError::AcpConnectionFailed {
            message: format!("flush ACP stdin: {e}"),
        })
}

async fn send_response(stdin: &Arc<Mutex<ChildStdin>>, id: Value, result: Value) -> AppResult<()> {
    write_frame(
        stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": result,
        }),
    )
    .await
}

async fn send_error(
    stdin: &Arc<Mutex<ChildStdin>>,
    id: Value,
    code: i64,
    message: String,
) -> AppResult<()> {
    write_frame(
        stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": code, "message": message },
        }),
    )
    .await
}

async fn reader_loop(
    stdout: ChildStdout,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Arc<DashMap<RpcId, oneshot::Sender<PendingResult>>>,
    inbound: Arc<DashMap<RpcId, InboundRequest>>,
    auto_approve: Arc<AtomicBool>,
    alive: Arc<AtomicBool>,
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
                    Ok(value) => value,
                    Err(error) => {
                        tracing::warn!(%error, line = %line, "non-JSON line on ACP stdout");
                        continue;
                    }
                };
                dispatch(
                    msg,
                    &stdin,
                    &pending,
                    &inbound,
                    auto_approve.load(Ordering::SeqCst),
                    &app,
                )
                .await;
            }
            Ok(None) => {
                tracing::info!("ACP stdout closed");
                break;
            }
            Err(error) => {
                tracing::error!(%error, "ACP stdout read error");
                break;
            }
        }
    }
    alive.store(false, Ordering::SeqCst);
    fail_pending(&pending, "ACP process exited");
    inbound.clear();
    let _ = app.emit("acp-status-changed", "disconnected");
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MessageKind {
    ServerRequest,
    Notification,
    Response,
    Invalid,
}

fn classify_message(msg: &Value) -> MessageKind {
    let has_method = msg.get("method").and_then(Value::as_str).is_some();
    let has_id = msg.get("id").and_then(RpcId::from_value).is_some();
    match (has_method, has_id) {
        (true, true) => MessageKind::ServerRequest,
        (true, false) => MessageKind::Notification,
        (false, true) => MessageKind::Response,
        (false, false) => MessageKind::Invalid,
    }
}

async fn dispatch(
    msg: Value,
    stdin: &Arc<Mutex<ChildStdin>>,
    pending: &Arc<DashMap<RpcId, oneshot::Sender<PendingResult>>>,
    inbound: &Arc<DashMap<RpcId, InboundRequest>>,
    auto_approve: bool,
    app: &AppHandle,
) {
    match classify_message(&msg) {
        MessageKind::ServerRequest => {
            handle_server_request(msg, stdin, inbound, auto_approve, app).await;
        }
        MessageKind::Notification => dispatch_notification(&msg, app),
        MessageKind::Response => dispatch_response(msg, pending),
        MessageKind::Invalid => {
            tracing::warn!(%msg, "invalid JSON-RPC message");
        }
    }
}

fn dispatch_response(msg: Value, pending: &Arc<DashMap<RpcId, oneshot::Sender<PendingResult>>>) {
    let Some(id_value) = msg.get("id") else {
        return;
    };
    let Some(id) = RpcId::from_value(id_value) else {
        tracing::warn!(id = %id_value, "response has unsupported JSON-RPC id");
        return;
    };
    if let Some((_, sender)) = pending.remove(&id) {
        let outcome = if let Some(error) = msg.get("error") {
            Err(classify_error(error))
        } else {
            Ok(msg.get("result").cloned().unwrap_or(Value::Null))
        };
        let _ = sender.send(outcome);
    } else {
        tracing::warn!(id = %id_value, "response for unknown request id");
    }
}

async fn handle_server_request(
    msg: Value,
    stdin: &Arc<Mutex<ChildStdin>>,
    inbound: &Arc<DashMap<RpcId, InboundRequest>>,
    auto_approve: bool,
    app: &AppHandle,
) {
    let method = msg
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let id = msg.get("id").cloned().unwrap_or(Value::Null);
    let Some(key) = RpcId::from_value(&id) else {
        tracing::warn!(%id, %method, "server request has unsupported JSON-RPC id");
        return;
    };

    if method != "session/request_permission" {
        tracing::warn!(%method, %id, "rejecting unsupported ACP server request");
        if let Err(error) = send_error(
            stdin,
            id,
            JSONRPC_METHOD_NOT_FOUND,
            format!("Method not found: {method}"),
        )
        .await
        {
            tracing::warn!(%error, "failed to reject ACP server request");
        }
        return;
    }

    let event = parse_permission_event(&msg);
    if auto_approve {
        if let Some(option_id) = preferred_allow_option(&event.options) {
            let result = json!({ "outcome": { "outcome": "selected", "optionId": option_id } });
            if let Err(error) = send_response(stdin, id, result).await {
                tracing::warn!(%error, "failed to auto-approve permission request");
            }
            return;
        }
    }

    if inbound.contains_key(&key) {
        let _ = send_error(
            stdin,
            id,
            JSONRPC_INVALID_REQUEST,
            "Duplicate inbound request id".into(),
        )
        .await;
        return;
    }
    inbound.insert(
        key.clone(),
        InboundRequest {
            id: id.clone(),
            method,
        },
    );

    if let Err(error) = app.emit("permission-request", &event) {
        inbound.remove(&key);
        tracing::warn!(%error, "failed to emit permission request");
        let _ = send_response(
            stdin,
            event.request_id,
            json!({ "outcome": { "outcome": "cancelled" } }),
        )
        .await;
    }
}

fn dispatch_notification(msg: &Value, app: &AppHandle) {
    let Some(method) = msg.get("method").and_then(Value::as_str) else {
        return;
    };
    let params = msg.get("params").cloned().unwrap_or(Value::Null);
    match method {
        "session/update" => {
            if let Err(error) = app.emit("session-update", &params) {
                tracing::warn!(%error, "emit session-update failed");
            }
            if let Some(event) = file_activity::extract(&params) {
                if let Err(error) = app.emit("file-activity", &event) {
                    tracing::warn!(%error, "emit file-activity failed");
                }
            }
        }
        "_kiro.dev/metadata" => {
            if let Err(error) = app.emit("kiro-metadata", &params) {
                tracing::warn!(%error, "emit kiro-metadata failed");
            }
        }
        "_kiro.dev/commands/available" => {
            if let Err(error) = app.emit("kiro-commands", &params) {
                tracing::warn!(%error, "emit kiro-commands failed");
            }
        }
        "_kiro.dev/subagent/list_update" => {
            if let Err(error) = app.emit("kiro-subagents", &params) {
                tracing::warn!(%error, "emit kiro-subagents failed");
            }
        }
        "_kiro.dev/session/update" => {
            if let Err(error) = app.emit("kiro-subagent-activity", &params) {
                tracing::warn!(%error, "emit kiro-subagent-activity failed");
            }
        }
        "_kiro.dev/mcp/oauth_request" => {
            emit_mcp_status(app, &params, "authorization_required");
        }
        "_kiro.dev/mcp/server_initialized" => {
            emit_mcp_status(app, &params, "connected");
        }
        "_kiro.dev/mcp/server_init_failure" => {
            emit_mcp_status(app, &params, "error");
        }
        extension if extension.starts_with("_kiro.dev/") => {
            tracing::debug!(method = extension, params = %params, "Kiro extension notification");
        }
        other => {
            tracing::debug!(method = other, params = %params, "unhandled ACP notification");
        }
    }
}

fn emit_mcp_status(app: &AppHandle, params: &Value, status: &str) {
    let Some(payload) = mcp_status_payload(params, status) else {
        tracing::warn!(%params, %status, "MCP status notification has no server name");
        return;
    };
    if let Err(error) = app.emit("mcp-status", payload) {
        tracing::warn!(%error, "emit mcp-status failed");
    }
}

fn mcp_status_payload(params: &Value, status: &str) -> Option<Value> {
    let server_name = params
        .get("serverName")
        .or_else(|| params.get("name"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    if server_name.is_empty() {
        return None;
    }
    let message = params
        .get("error")
        .or_else(|| params.get("message"))
        .and_then(|value| {
            value
                .as_str()
                .or_else(|| value.get("message").and_then(Value::as_str))
        });
    Some(json!({
        "serverName": server_name,
        "status": status,
        "oauthUrl": params
            .get("oauthUrl")
            .or_else(|| params.get("url"))
            .and_then(Value::as_str),
        "message": message,
    }))
}

fn parse_permission_event(msg: &Value) -> PermissionRequestEvent {
    let params = msg.get("params").and_then(Value::as_object);
    let tool_call = params
        .and_then(|value| value.get("toolCall"))
        .and_then(Value::as_object);
    let options = params
        .and_then(|value| value.get("options"))
        .and_then(Value::as_array)
        .map(|options| {
            options
                .iter()
                .filter_map(|option| {
                    let object = option.as_object()?;
                    let option_id = object
                        .get("optionId")
                        .or_else(|| object.get("id"))
                        .and_then(Value::as_str)?
                        .to_string();
                    let name = object
                        .get("name")
                        .or_else(|| object.get("label"))
                        .and_then(Value::as_str)
                        .unwrap_or(&option_id)
                        .to_string();
                    let kind = object
                        .get("kind")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .unwrap_or_else(|| legacy_option_kind(&option_id).to_string());
                    Some(PermissionOption {
                        option_id,
                        name,
                        kind,
                    })
                })
                .collect::<Vec<_>>()
        })
        .filter(|options| !options.is_empty())
        .unwrap_or_else(|| {
            vec![
                PermissionOption {
                    option_id: "allow_once".into(),
                    name: "Allow once".into(),
                    kind: "allow_once".into(),
                },
                PermissionOption {
                    option_id: "allow_always".into(),
                    name: "Always allow".into(),
                    kind: "allow_always".into(),
                },
            ]
        });

    PermissionRequestEvent {
        request_id: msg.get("id").cloned().unwrap_or(Value::Null),
        session_id: params
            .and_then(|value| value.get("sessionId"))
            .and_then(Value::as_str)
            .map(str::to_string),
        tool_call_id: tool_call
            .and_then(|value| value.get("toolCallId"))
            .and_then(Value::as_str)
            .map(str::to_string),
        title: tool_call
            .and_then(|value| value.get("title"))
            .and_then(Value::as_str)
            .unwrap_or("Unknown tool")
            .to_string(),
        kind: tool_call
            .and_then(|value| value.get("kind"))
            .and_then(Value::as_str)
            .unwrap_or("tool")
            .to_string(),
        options,
    }
}

fn legacy_option_kind(option_id: &str) -> &str {
    match option_id.to_ascii_lowercase().as_str() {
        "allow_once" | "allow" => "allow_once",
        "allow_always" | "always" => "allow_always",
        "reject" | "reject_once" | "deny" => "reject_once",
        "reject_always" => "reject_always",
        _ => "",
    }
}

fn preferred_allow_option(options: &[PermissionOption]) -> Option<String> {
    options
        .iter()
        .find(|option| option.kind == "allow_once")
        .or_else(|| options.iter().find(|option| option.kind == "allow_always"))
        .map(|option| option.option_id.clone())
}

fn fail_pending(pending: &Arc<DashMap<RpcId, oneshot::Sender<PendingResult>>>, message: &str) {
    let keys: Vec<RpcId> = pending.iter().map(|entry| entry.key().clone()).collect();
    for key in keys {
        if let Some((_, sender)) = pending.remove(&key) {
            let _ = sender.send(Err(AppError::AcpConnectionFailed {
                message: message.to_string(),
            }));
        }
    }
}

fn classify_error(error: &Value) -> AppError {
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("JSON-RPC error")
        .to_string();
    let data = error.get("data").map(Value::to_string).unwrap_or_default();
    let haystack = format!("{message} {data}").to_lowercase();
    let auth_hit = ["unauthor", "forbid", "auth", "login", "token", "credential"]
        .iter()
        .any(|needle| haystack.contains(needle));
    if auth_hit {
        AppError::AuthRequired { message }
    } else {
        AppError::SessionError { message }
    }
}

async fn detect_cli_version(path: &std::path::Path) -> AppResult<String> {
    let output = Command::new(path)
        .arg("--version")
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(|error| AppError::AcpConnectionFailed {
            message: format!("failed to query {} --version: {error}", path.display()),
        })?;
    if !output.status.success() {
        return Err(AppError::AcpConnectionFailed {
            message: format!("{} --version exited with {}", path.display(), output.status),
        });
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if version.is_empty() {
        return Err(AppError::AcpConnectionFailed {
            message: "kiro-cli --version returned no version".into(),
        });
    }
    Ok(version)
}

fn validate_cli_version(version_output: &str) -> AppResult<Option<String>> {
    let Some(version) = parse_semver(version_output) else {
        return Ok(Some(format!(
            "Could not parse Kiro CLI version from '{version_output}'; capability detection will be used"
        )));
    };
    if version < MINIMUM_KIRO_CLI_VERSION {
        return Err(AppError::AcpConnectionFailed {
            message: format!(
                "Kiro CLI {}.{}.{} is unsupported; install version {}.{}.{} or newer",
                version.0,
                version.1,
                version.2,
                MINIMUM_KIRO_CLI_VERSION.0,
                MINIMUM_KIRO_CLI_VERSION.1,
                MINIMUM_KIRO_CLI_VERSION.2,
            ),
        });
    }
    Ok(None)
}

fn parse_semver(text: &str) -> Option<(u64, u64, u64)> {
    text.split_whitespace().find_map(|token| {
        let clean = token.trim_start_matches('v');
        let mut parts = clean.split('.');
        let major = parts.next()?.parse().ok()?;
        let minor = parts.next()?.parse().ok()?;
        let patch_text = parts.next()?.split('-').next()?;
        let patch = patch_text.parse().ok()?;
        Some((major, minor, patch))
    })
}

async fn stderr_loop(stderr: tokio::process::ChildStderr) {
    let mut lines = BufReader::new(stderr).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        tracing::debug!(target: "kiro_cli_stderr", "{line}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_request_wins_when_id_collides_with_outbound_request() {
        let message = json!({
            "jsonrpc": "2.0",
            "id": 4,
            "method": "session/request_permission",
            "params": {}
        });
        assert_eq!(classify_message(&message), MessageKind::ServerRequest);
    }

    #[test]
    fn string_ids_are_supported() {
        let message = json!({ "jsonrpc": "2.0", "id": "permission-1", "result": {} });
        assert_eq!(classify_message(&message), MessageKind::Response);
        assert_eq!(
            RpcId::from_value(&json!("permission-1")),
            Some(RpcId::String("permission-1".into()))
        );
    }

    #[test]
    fn permission_options_accept_current_and_legacy_shapes() {
        let message = json!({
            "id": "p1",
            "method": "session/request_permission",
            "params": {
                "sessionId": "s1",
                "toolCall": { "toolCallId": "t1", "title": "Run tests", "kind": "execute" },
                "options": [
                    { "optionId": "once", "name": "Allow once", "kind": "allow_once" },
                    { "id": "allow_always", "label": "Always allow" }
                ]
            }
        });
        let event = parse_permission_event(&message);
        assert_eq!(event.request_id, json!("p1"));
        assert_eq!(event.title, "Run tests");
        assert_eq!(event.options[0].kind, "allow_once");
        assert_eq!(event.options[1].kind, "allow_always");
        assert_eq!(
            preferred_allow_option(&event.options).as_deref(),
            Some("once")
        );
    }

    #[test]
    fn version_parser_and_minimum_are_enforced() {
        assert_eq!(parse_semver("kiro-cli 2.16.2"), Some((2, 16, 2)));
        assert!(validate_cli_version("kiro-cli 2.16.2").is_ok());
        assert!(validate_cli_version("kiro-cli 2.1.1").is_err());
    }

    #[test]
    fn mcp_status_payload_normalizes_oauth_and_nested_errors() {
        assert_eq!(
            mcp_status_payload(
                &json!({
                    "serverName": "linear",
                    "oauthUrl": "https://example.com/authorize",
                }),
                "authorization_required",
            ),
            Some(json!({
                "serverName": "linear",
                "status": "authorization_required",
                "oauthUrl": "https://example.com/authorize",
                "message": null,
            }))
        );
        let failure = mcp_status_payload(
            &json!({
                "name": "broken",
                "error": { "message": "connection refused" },
            }),
            "error",
        )
        .expect("named MCP server should produce a status");
        assert_eq!(failure["message"], "connection refused");
        assert!(mcp_status_payload(&json!({}), "connected").is_none());
    }
}
