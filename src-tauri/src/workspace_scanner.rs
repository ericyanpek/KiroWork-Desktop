//! Project-scope `.kiro/` scanner. Reads only `<workspace>/.kiro/`, NOT
//! `~/.kiro/` — user explicitly scoped to project-level in Phase 2 plan.
//!
//! Parses three config surfaces:
//! - `.kiro/skills/<name>/SKILL.md` — frontmatter: name / version / description
//! - `.kiro/settings/mcp.json`      — `{ mcpServers: { <name>: {...} } }`
//! - `.kiro/steering/*.md`          — frontmatter: inclusion / fileMatchPattern
//!
//! Uses a hand-rolled frontmatter parser (flat `key: value` lines) to avoid
//! pulling serde_yaml just for this. Assumption: no block-scalars in real
//! project steering files. Validated across ~/Kiro/ projects on this machine.

use std::path::Path;

use serde::Serialize;

use crate::error::AppResult;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceManifest {
    pub skills: Vec<SkillEntry>,
    pub mcp_servers: Vec<McpServerEntry>,
    pub steering: Vec<SteeringEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillEntry {
    pub name: String,
    pub version: Option<String>,
    pub description: Option<String>,
    pub dir_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerEntry {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub disabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteeringEntry {
    pub name: String,
    /// Passes through raw: "always" | "manual" | "auto" | "fileMatch" (we
    /// saw `auto` in real projects; DESIGN.md listed only the other three).
    pub inclusion: String,
    pub file_match_pattern: Option<String>,
    pub file_path: String,
}

pub fn scan(root: &Path) -> AppResult<WorkspaceManifest> {
    let kiro = root.join(".kiro");
    Ok(WorkspaceManifest {
        skills: if kiro.is_dir() {
            scan_skills(&kiro.join("skills"))
        } else {
            Vec::new()
        },
        mcp_servers: if kiro.is_dir() {
            scan_mcp(&kiro.join("settings").join("mcp.json"))
        } else {
            Vec::new()
        },
        steering: if kiro.is_dir() {
            scan_steering(&kiro.join("steering"))
        } else {
            Vec::new()
        },
    })
}

fn scan_skills(dir: &Path) -> Vec<SkillEntry> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let sub = entry.path();
        if !sub.is_dir() {
            continue;
        }
        let manifest = sub.join("SKILL.md");
        if !manifest.is_file() {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&manifest) else {
            continue;
        };
        let fm = parse_frontmatter(&text);
        let name = fm.get("name").cloned().unwrap_or_else(|| {
            sub.file_name()
                .and_then(|x| x.to_str())
                .unwrap_or("?")
                .to_string()
        });
        out.push(SkillEntry {
            name,
            version: fm.get("version").cloned(),
            description: fm.get("description").cloned(),
            dir_path: sub.to_string_lossy().into_owned(),
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

fn scan_mcp(path: &Path) -> Vec<McpServerEntry> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(v): Result<serde_json::Value, _> = serde_json::from_str(&text) else {
        tracing::debug!(path = %path.display(), "mcp.json parse failed");
        return Vec::new();
    };
    let Some(servers) = v.get("mcpServers").and_then(|x| x.as_object()) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (name, cfg) in servers {
        let command = cfg
            .get("command")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        let args = cfg
            .get("args")
            .and_then(|x| x.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();
        let disabled = cfg
            .get("disabled")
            .and_then(|x| x.as_bool())
            .unwrap_or(false);
        out.push(McpServerEntry {
            name: name.clone(),
            command,
            args,
            disabled,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

fn scan_steering(dir: &Path) -> Vec<SteeringEntry> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let p = entry.path();
        if p.extension().and_then(|x| x.to_str()) != Some("md") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&p) else {
            continue;
        };
        let fm = parse_frontmatter(&text);
        let name = p
            .file_stem()
            .and_then(|x| x.to_str())
            .unwrap_or("?")
            .to_string();
        out.push(SteeringEntry {
            name,
            inclusion: fm
                .get("inclusion")
                .cloned()
                .unwrap_or_else(|| "manual".into()),
            file_match_pattern: fm.get("fileMatchPattern").cloned(),
            file_path: p.to_string_lossy().into_owned(),
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Parse YAML frontmatter as a flat `key: value` map. Bounded by leading
/// `---\n` ... next `---\n`. Strips surrounding single/double quotes.
/// Returns empty map if no frontmatter.
fn parse_frontmatter(text: &str) -> std::collections::BTreeMap<String, String> {
    use std::collections::BTreeMap;
    let mut out = BTreeMap::new();
    let Some(body) = text
        .strip_prefix("---\n")
        .or_else(|| text.strip_prefix("---\r\n"))
    else {
        return out;
    };
    let Some(end) = body.find("\n---") else {
        return out;
    };
    let block = &body[..end];
    for line in block.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((k, v)) = line.split_once(':') else {
            continue;
        };
        let key = k.trim().to_string();
        let mut val = v.trim().to_string();
        // Strip matched quotes once.
        if val.len() >= 2 {
            let first = val.chars().next().unwrap();
            let last = val.chars().last().unwrap();
            if (first == '"' && last == '"') || (first == '\'' && last == '\'') {
                val = val[1..val.len() - 1].to_string();
            }
        }
        if !key.is_empty() {
            out.insert(key, val);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontmatter_flat_values() {
        let text = "---\ninclusion: always\nfileMatchPattern: \"src/**/*.ts\"\n---\n# body";
        let fm = parse_frontmatter(text);
        assert_eq!(fm.get("inclusion").unwrap(), "always");
        assert_eq!(fm.get("fileMatchPattern").unwrap(), "src/**/*.ts");
    }

    #[test]
    fn frontmatter_accepts_auto_value() {
        let text = "---\ninclusion: auto\n---\n";
        let fm = parse_frontmatter(text);
        assert_eq!(fm.get("inclusion").unwrap(), "auto");
    }

    #[test]
    fn no_frontmatter_returns_empty() {
        let fm = parse_frontmatter("# just a heading\n\nsome body");
        assert!(fm.is_empty());
    }
}
