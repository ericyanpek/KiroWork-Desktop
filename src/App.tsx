import { useApp } from "./stores/app-store";
import { useAcp } from "./hooks/useAcp";
import { useWorkspaceDrop } from "./hooks/useWorkspaceDrop";
import { useSystemTheme } from "./hooks/useTheme";
import { ChatPanel } from "./components/ChatPanel";
import { AuthGate } from "./components/AuthGate";
import { Toolbar } from "./components/Toolbar";
import { WorkspacePicker } from "./components/WorkspacePicker";

function MainUI() {
  useAcp();
  useWorkspaceDrop();
  const sessionId = useApp((s) => s.sessionId);

  if (!sessionId) {
    return <WorkspacePicker />;
  }

  return (
    <main className="flex h-full flex-col">
      <Toolbar />
      <div className="flex-1 min-h-0">
        <ChatPanel />
      </div>
    </main>
  );
}

export default function App() {
  useSystemTheme(); // toggles <html class="dark"> to match macOS Appearance
  return (
    <AuthGate>
      <MainUI />
    </AuthGate>
  );
}
