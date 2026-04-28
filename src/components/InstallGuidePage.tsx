import { open } from "@tauri-apps/plugin-shell";

export function InstallGuidePage({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <main className="flex h-full items-center justify-center px-6">
      <div className="max-w-lg rounded-2xl border bg-white p-8 shadow-sm space-y-5">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-yellow-100 flex items-center justify-center text-yellow-700 text-lg font-bold">!</div>
          <h1 className="text-xl font-semibold text-gray-800">Kiro CLI not found</h1>
        </div>
        <p className="text-sm text-gray-600">
          KiroWork Desktop needs <code>kiro-cli</code> to talk to Kiro. It couldn't
          find the binary on this machine.
        </p>
        {message && (
          <pre className="text-xs bg-gray-50 border rounded p-2 overflow-x-auto text-gray-700">{message}</pre>
        )}
        <div className="space-y-2 text-sm">
          <p className="text-gray-700 font-medium">Install with the official installer:</p>
          <pre className="text-xs bg-gray-900 text-gray-100 rounded p-3 overflow-x-auto">
curl -fsSL https://cli.kiro.dev/install | bash
          </pre>
          <p className="text-xs text-gray-500">
            After installation, ensure <code>~/.local/bin/kiro-cli</code> exists, then retry.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onRetry}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Retry
          </button>
          <button
            onClick={() => open("https://cli.kiro.dev").catch(() => {})}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Open installer page
          </button>
        </div>
      </div>
    </main>
  );
}
