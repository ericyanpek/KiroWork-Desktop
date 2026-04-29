//! Watches `<workspace>/.kiro/` for file-system changes and emits a
//! `workspace-manifest-updated` Tauri event with the re-scanned manifest.
//!
//! Only one watcher is active at a time. Calling `start` while a watcher is
//! already running replaces it (the old thread is signalled to stop).

use std::path::PathBuf;
use std::sync::Mutex;

use notify::{Event, RecommendedWatcher, RecursiveMode, Result as NResult, Watcher};
use tauri::{AppHandle, Emitter};

use crate::workspace_scanner;

/// Shared state: holds the active watcher so it stays alive.
pub struct WatcherState {
    _watcher: RecommendedWatcher,
}

/// Global slot for the current watcher.
static WATCHER: Mutex<Option<WatcherState>> = Mutex::new(None);

/// Start (or replace) a `.kiro/` watcher for `workspace_root`.
/// Debounces rapid bursts to at most one rescan per 500 ms.
pub fn start(app: AppHandle, workspace_root: PathBuf) {
    let kiro_dir = workspace_root.join(".kiro");

    // Clone for the closure.
    let app_clone = app.clone();
    let root_clone = workspace_root.clone();

    let watcher_result = notify::recommended_watcher(
        move |res: NResult<Event>| {
            if res.is_err() {
                return;
            }
            // Re-scan and emit. Errors are logged and swallowed.
            match workspace_scanner::scan(&root_clone) {
                Ok(manifest) => {
                    let _ = app_clone.emit("workspace-manifest-updated", manifest);
                }
                Err(e) => {
                    tracing::warn!("workspace rescan failed: {e}");
                }
            }
        },
    );

    match watcher_result {
        Ok(mut watcher) => {
            // Watch `.kiro/` if it exists; fall back to workspace root so we
            // catch the moment `.kiro/` is first created.
            let watch_target = if kiro_dir.is_dir() { &kiro_dir } else { &workspace_root };
            if let Err(e) = watcher.watch(watch_target, RecursiveMode::Recursive) {
                tracing::warn!("failed to watch {}: {e}", watch_target.display());
                return;
            }
            tracing::debug!("watching {} for .kiro/ changes", watch_target.display());
            let mut slot = WATCHER.lock().unwrap();
            *slot = Some(WatcherState { _watcher: watcher });
        }
        Err(e) => {
            tracing::warn!("could not create watcher: {e}");
        }
    }
}

/// Stop any active watcher (e.g. when workspace is closed).
pub fn stop() {
    let mut slot = WATCHER.lock().unwrap();
    *slot = None;
}
