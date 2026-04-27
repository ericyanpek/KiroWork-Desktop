use std::path::PathBuf;
use std::process::Command;

use crate::error::AppError;

/// Find the `kiro-cli` executable in priority order:
/// 1. `$KIROWORK_KIRO_CLI_PATH` env override
/// 2. `~/.local/bin/kiro-cli` (the official installer location; critical because
///    macOS GUI apps inherit a stripped PATH that excludes `~/.local/bin`)
/// 3. `which kiro-cli` via the user's login shell so `$PATH` is populated from
///    `~/.zshrc` / `~/.bashrc` even when the app was launched from Finder
pub fn find_kiro_cli() -> Result<PathBuf, AppError> {
    if let Ok(p) = std::env::var("KIROWORK_KIRO_CLI_PATH") {
        let pb = PathBuf::from(&p);
        if is_executable(&pb) {
            tracing::debug!(path = %p, "kiro-cli found via env");
            return Ok(pb);
        }
        tracing::warn!(path = %p, "KIROWORK_KIRO_CLI_PATH set but path not executable");
    }

    if let Some(home) = dirs::home_dir() {
        let pb = home.join(".local/bin/kiro-cli");
        if is_executable(&pb) {
            tracing::debug!(path = %pb.display(), "kiro-cli found at ~/.local/bin");
            return Ok(pb);
        }
    }

    if let Some(pb) = which_via_login_shell("kiro-cli") {
        if is_executable(&pb) {
            tracing::debug!(path = %pb.display(), "kiro-cli found via login shell");
            return Ok(pb);
        }
    }

    Err(AppError::KiroNotFound {
        message: "kiro-cli was not found in $KIROWORK_KIRO_CLI_PATH, ~/.local/bin, or $PATH".into(),
    })
}

fn is_executable(p: &std::path::Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    p.is_file()
        && std::fs::metadata(p)
            .map(|m| m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
}

fn which_via_login_shell(bin: &str) -> Option<PathBuf> {
    // Use the user's login shell so PATH is resolved exactly as in Terminal.
    // This recovers from the stripped PATH that macOS gives GUI apps.
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let out = Command::new(&shell)
        .arg("-lc")
        .arg(format!("command -v {}", bin))
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if path.is_empty() {
        None
    } else {
        Some(PathBuf::from(path))
    }
}
