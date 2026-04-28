import { open } from "@tauri-apps/plugin-shell";
import { KiroMark } from "./KiroMark";

export function InstallGuidePage({
  message,
  onRetry,
}: {
  message?: string;
  onRetry: () => void;
}) {
  return (
    <main className="flex h-full items-center justify-center px-6 kiro-ambient">
      <div className="max-w-lg rounded-2xl border border-border bg-bg-elevated/80 backdrop-blur p-8 shadow-2xl shadow-black/40 space-y-5">
        <KiroMark size="sm" />
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-yellow-400/15 flex items-center justify-center text-yellow-400 text-lg font-bold">
            !
          </div>
          <h1 className="text-xl font-semibold text-fg">Kiro CLI not found</h1>
        </div>
        <p className="text-sm text-fg-muted">
          KiroWork Desktop needs <code className="text-accent-strong">kiro-cli</code>{" "}
          to talk to Kiro. It couldn't find the binary on this machine.
        </p>
        {message && (
          <pre className="text-xs bg-bg-muted border border-border rounded p-2 overflow-x-auto text-fg-muted">
            {message}
          </pre>
        )}
        <div className="space-y-2 text-sm">
          <p className="text-fg font-medium">Install with the official installer:</p>
          <pre className="text-xs bg-prey-900 text-fg border border-border rounded p-3 overflow-x-auto">
            curl -fsSL https://cli.kiro.dev/install | bash
          </pre>
          <p className="text-xs text-fg-subtle">
            After installation, ensure <code className="text-accent-strong">~/.local/bin/kiro-cli</code> exists, then retry.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onRetry}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent-strong hover:text-bg transition-colors"
          >
            Retry
          </button>
          <button
            onClick={() => open("https://cli.kiro.dev").catch(() => {})}
            className="rounded-lg border border-border bg-bg px-4 py-2 text-sm font-medium text-fg-muted hover:text-fg hover:border-accent/50 transition-colors"
          >
            Open installer page
          </button>
        </div>
      </div>
    </main>
  );
}
