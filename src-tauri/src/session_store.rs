//! Kiro persists each session as two sibling files in `~/.kiro/sessions/cli/`:
//!   <uuid>.json   — one-shot metadata (title, cwd, timestamps)
//!   <uuid>.jsonl  — append-only message log, one JSON record per line
//!   <uuid>.lock   — kiro-cli's lock; when present, another process owns it
//!
//! Phase 2 reads both. We do NOT write to kiro's session files — all writes
//! happen through `kiro-cli acp` itself. `session/load` over ACP restores
//! kiro's internal session state, but it does NOT replay the message history
//! over the wire, so the jsonl file is the source of truth for UI replay.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{AppError, AppResult};

/// Sidebar entry. `updatedAt` / `createdAt` pass through as the raw ISO 8601
/// strings kiro emits — the frontend formats them with locale-aware logic.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
    pub session_id: String,
    pub title: String,
    pub cwd: String,
    pub updated_at: String,
    pub created_at: String,
}

/// A message as it replays into the UI. Shapes mirror kiro's jsonl `kind`
/// field: Prompt → User, AssistantMessage → Agent, ToolResults → Tool.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "role", rename_all = "camelCase")]
pub enum ReplayMessage {
    User {
        id: String,
        text: String,
        timestamp: Option<i64>,
    },
    Agent {
        id: String,
        blocks: Vec<ReplayBlock>,
    },
    Tool {
        id: String,
        tool_use_id: String,
        text: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ReplayBlock {
    Text { text: String },
    ToolUse {
        tool_use_id: String,
        name: String,
        input: Value,
    },
}

fn sessions_dir() -> AppResult<PathBuf> {
    let home = dirs::home_dir().ok_or(AppError::Unknown {
        message: "no home dir".into(),
    })?;
    Ok(home.join(".kiro/sessions/cli"))
}

/// Scan the sessions directory for metadata files, filter out live-locked
/// sessions (another kiro process has them open), and return sorted newest
/// first. Parse failures on individual files are logged at debug and
/// skipped — a stray half-written file should not break the sidebar.
pub fn list_sessions() -> AppResult<Vec<SessionMeta>> {
    let dir = sessions_dir()?;
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    let entries = std::fs::read_dir(&dir).map_err(|e| AppError::Unknown {
        message: format!("read_dir {}: {e}", dir.display()),
    })?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|x| x.to_str()) != Some("json") {
            continue;
        }
        // Skip live-locked sessions to avoid racing kiro-cli.
        let lock = path.with_extension("lock");
        if lock.exists() {
            tracing::debug!(path = %path.display(), "session locked, skipping");
            continue;
        }
        match parse_meta(&path) {
            Ok(Some(meta)) => out.push(meta),
            Ok(None) => {}
            Err(e) => tracing::debug!(path = %path.display(), err = %e, "session parse skip"),
        }
    }
    // Newest first. Lexicographic sort on ISO 8601 works because the strings
    // are zero-padded and UTC-terminated.
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(out)
}

fn parse_meta(path: &Path) -> AppResult<Option<SessionMeta>> {
    let text = std::fs::read_to_string(path)?;
    let v: Value = serde_json::from_str(&text)?;
    let get_str = |k: &str| v.get(k).and_then(|x| x.as_str()).map(|s| s.to_string());
    let Some(session_id) = get_str("session_id") else {
        return Ok(None);
    };
    Ok(Some(SessionMeta {
        session_id,
        title: get_str("title").unwrap_or_default(),
        cwd: get_str("cwd").unwrap_or_default(),
        updated_at: get_str("updated_at").unwrap_or_default(),
        created_at: get_str("created_at").unwrap_or_default(),
    }))
}

/// Read just the title from a session's `.json` file, ignoring any lock file.
/// Used to refresh the sidebar title for the currently active session after
/// kiro-cli writes it at end-of-turn.
pub fn get_session_title(session_id: &str) -> AppResult<Option<String>> {
    let dir = sessions_dir()?;
    let path = dir.join(format!("{session_id}.json"));
    if !path.is_file() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(&path).map_err(|e| AppError::Unknown {
        message: format!("read {}: {e}", path.display()),
    })?;
    let v: Value = serde_json::from_str(&text).map_err(|e| AppError::Unknown {
        message: format!("parse {}: {e}", path.display()),
    })?;
    Ok(v.get("title").and_then(|x| x.as_str()).map(|s| s.to_string()))
}

/// Delete a session's `.json` and `.jsonl` files. `.lock` is intentionally
/// not touched — if a lock file exists, `list_sessions` already excluded the
/// session so callers should never reach here for a live session.
pub fn delete_session(session_id: &str) -> AppResult<()> {
    let dir = sessions_dir()?;
    for ext in &["json", "jsonl"] {
        let path = dir.join(format!("{session_id}.{ext}"));
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| AppError::Unknown {
                message: format!("delete {}: {e}", path.display()),
            })?;
        }
    }
    Ok(())
}

/// Read and map a session's jsonl. Lines that fail to parse are logged and
/// skipped. kind values we don't recognise also skip — preserve forward
/// compatibility if kiro adds new message kinds.
pub fn read_jsonl(session_id: &str) -> AppResult<Vec<ReplayMessage>> {
    let dir = sessions_dir()?;
    let path = dir.join(format!("{session_id}.jsonl"));
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| AppError::Unknown {
        message: format!("read {}: {e}", path.display()),
    })?;
    let mut out = Vec::new();
    for (i, line) in text.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let entry: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(e) => {
                tracing::debug!(line=i, err=%e, "jsonl parse skip");
                continue;
            }
        };
        if let Some(msg) = to_replay(&entry) {
            out.push(msg);
        }
    }
    Ok(out)
}

fn to_replay(entry: &Value) -> Option<ReplayMessage> {
    let kind = entry.get("kind")?.as_str()?;
    let data = entry.get("data")?;
    let message_id = data
        .get("message_id")
        .and_then(|x| x.as_str())
        .unwrap_or_default()
        .to_string();

    match kind {
        "Prompt" => {
            let content = data.get("content")?.as_array()?;
            let mut text = String::new();
            for part in content {
                if part.get("kind").and_then(|x| x.as_str()) == Some("text") {
                    if let Some(s) = part.get("data").and_then(|x| x.as_str()) {
                        text.push_str(s);
                    }
                }
            }
            let timestamp = data
                .get("meta")
                .and_then(|m| m.get("timestamp"))
                .and_then(|t| t.as_i64());
            Some(ReplayMessage::User {
                id: message_id,
                text,
                timestamp,
            })
        }
        "AssistantMessage" => {
            let content = data.get("content")?.as_array()?;
            let mut blocks = Vec::new();
            for part in content {
                let pkind = part.get("kind").and_then(|x| x.as_str()).unwrap_or("");
                match pkind {
                    "text" => {
                        let text = part
                            .get("data")
                            .and_then(|x| x.as_str())
                            .unwrap_or_default()
                            .to_string();
                        if !text.is_empty() {
                            blocks.push(ReplayBlock::Text { text });
                        }
                    }
                    "toolUse" => {
                        let tdata = part.get("data")?;
                        let tool_use_id = tdata
                            .get("toolUseId")
                            .and_then(|x| x.as_str())
                            .unwrap_or_default()
                            .to_string();
                        let name = tdata
                            .get("name")
                            .and_then(|x| x.as_str())
                            .unwrap_or_default()
                            .to_string();
                        let input = tdata.get("input").cloned().unwrap_or(Value::Null);
                        blocks.push(ReplayBlock::ToolUse {
                            tool_use_id,
                            name,
                            input,
                        });
                    }
                    _ => {}
                }
            }
            Some(ReplayMessage::Agent {
                id: message_id,
                blocks,
            })
        }
        "ToolResults" => {
            // One ReplayMessage per toolResult in content[]. We return the
            // first here; the caller loop iterates — but caller calls us
            // once per entry, so flatten at callsite? Easier: return Some
            // when there is exactly one result; for multi-result entries,
            // concatenate into a single Tool message keyed by the first
            // toolUseId. Kiro typically emits one result per entry anyway.
            let content = data.get("content")?.as_array()?;
            let first = content.iter().find(|p| {
                p.get("kind").and_then(|x| x.as_str()) == Some("toolResult")
            })?;
            let tdata = first.get("data")?;
            let tool_use_id = tdata
                .get("toolUseId")
                .and_then(|x| x.as_str())
                .unwrap_or_default()
                .to_string();
            let inner = tdata.get("content").and_then(|x| x.as_array());
            let mut text = String::new();
            if let Some(arr) = inner {
                for p in arr {
                    if p.get("kind").and_then(|x| x.as_str()) == Some("text") {
                        if let Some(s) = p.get("data").and_then(|x| x.as_str()) {
                            if !text.is_empty() {
                                text.push('\n');
                            }
                            text.push_str(s);
                        }
                    }
                }
            }
            Some(ReplayMessage::Tool {
                id: message_id,
                tool_use_id,
                text,
            })
        }
        _ => None,
    }
}
