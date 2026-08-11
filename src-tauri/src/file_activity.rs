//! Intercepts `session/update` notifications and extracts file paths that
//! Kiro is actively reading or writing. Emits a lightweight `file-activity`
//! event so the frontend can open the file panel without guessing at the
//! tool_call wire shape.
//!
//! Extraction strategy (in priority order):
//!   1. `content[].path` where `type == "diff"` — edit tool, post-write path
//!   2. `locations[].path`                       — read/view/grep tools
//!   3. `rawInput.path` / `rawInput.filePath`    — fallback for ad-hoc tools

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileActivityEvent {
    /// Absolute path of the file Kiro just read or wrote.
    pub path: String,
    /// "read" | "write" — write means an edit tool completed successfully.
    pub activity: &'static str,
    /// The tool kind string from the ACP event, forwarded verbatim.
    pub tool_kind: String,
}

/// Try to extract a `FileActivityEvent` from a raw `session/update` params
/// value. Returns `None` if the update carries no file path we recognise.
pub fn extract(params: &Value) -> Option<FileActivityEvent> {
    let update = params.get("update")?;
    let session_update = update.get("sessionUpdate").and_then(|v| v.as_str())?;
    let kind = update
        .get("kind")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    match session_update {
        "tool_call_update" => {
            let status = update.get("status").and_then(|v| v.as_str()).unwrap_or("");

            // Priority 1: diff content (edit tool completing)
            if status == "completed" {
                if let Some(path) = extract_diff_path(update) {
                    return Some(FileActivityEvent {
                        path,
                        activity: "write",
                        tool_kind: kind,
                    });
                }
            }

            // Priority 2: locations (any completed tool that tags paths)
            if status == "completed" {
                if let Some(path) = extract_location_path(update) {
                    return Some(FileActivityEvent {
                        path,
                        activity: "read",
                        tool_kind: kind,
                    });
                }
            }

            None
        }

        "tool_call" => {
            // Priority 2: locations (running tool starting up)
            if let Some(path) = extract_location_path(update) {
                return Some(FileActivityEvent {
                    path,
                    activity: "read",
                    tool_kind: kind,
                });
            }

            // Priority 3: rawInput field heuristics
            if let Some(path) = extract_raw_input_path(update) {
                return Some(FileActivityEvent {
                    path,
                    activity: "read",
                    tool_kind: kind,
                });
            }

            None
        }

        _ => None,
    }
}

fn extract_diff_path(update: &Value) -> Option<String> {
    let content = update.get("content")?.as_array()?;
    for item in content {
        if item.get("type").and_then(|v| v.as_str()) == Some("diff") {
            if let Some(p) = item.get("path").and_then(|v| v.as_str()) {
                if !p.is_empty() {
                    return Some(p.to_string());
                }
            }
        }
    }
    None
}

fn extract_location_path(update: &Value) -> Option<String> {
    let locs = update.get("locations")?.as_array()?;
    locs.iter()
        .find_map(|loc| {
            loc.get("path")
                .and_then(|v| v.as_str())
                .filter(|p| !p.is_empty())
        })
        .map(|s| s.to_string())
}

fn extract_raw_input_path(update: &Value) -> Option<String> {
    let ri = update.get("rawInput")?;
    // Try common field names that file-touching tools use.
    for field in &["path", "filePath", "file_path", "filename", "file"] {
        if let Some(p) = ri
            .get(field)
            .and_then(|v| v.as_str())
            .filter(|p| !p.is_empty())
        {
            return Some(p.to_string());
        }
    }
    None
}
