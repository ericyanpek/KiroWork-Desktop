import { useApp } from "./stores/app-store";
import { useAcp } from "./hooks/useAcp";
import { useWorkspaceDrop } from "./hooks/useWorkspaceDrop";
import { useSystemTheme } from "./hooks/useTheme";
import { ChatPanel } from "./components/ChatPanel";
import { AuthGate } from "./components/AuthGate";
import { Toolbar } from "./components/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { WorkspacePicker } from "./components/WorkspacePicker";

function MainUI() {
  useAcp();
  useWorkspaceDrop();
  const sessionId = useApp((s) => s.sessionId);

  if (!sessionId) {
    return <WorkspacePicker />;
  }

  return (
    <main className="flex h-full">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Toolbar />
        <div className="flex-1 min-h-0">
          <ChatPanel />
        </div>
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
