import { useApp } from "./stores/app-store";
import { useAcp } from "./hooks/useAcp";
import { useWorkspaceDrop } from "./hooks/useWorkspaceDrop";
import { useSystemTheme } from "./hooks/useTheme";
import { useLocalStorageBoolean } from "./hooks/useLocalStorage";
import { ChatPanel } from "./components/ChatPanel";
import { AuthGate } from "./components/AuthGate";
import { Toolbar } from "./components/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { FilePanel } from "./components/FilePanel";
import { WorkspacePicker } from "./components/WorkspacePicker";

function MainUI() {
  useAcp();
  useWorkspaceDrop();
  const sessionId = useApp((s) => s.sessionId);

  // Sidebar visibility is a UI concern — kept out of app-store. Persisted
  // so the user's hide/show preference survives restarts.
  const [sidebarVisible, setSidebarVisible] = useLocalStorageBoolean(
    "kirowork.sidebar.visible",
    true,
  );
  const filePanelOpen = useApp((s) => s.filePanelOpen);

  if (!sessionId) {
    return <WorkspacePicker />;
  }

  return (
    <main className="flex h-full flex-col kiro-ambient">
<div className="flex flex-1 min-h-0 relative">
        {sidebarVisible && <Sidebar onCollapse={() => setSidebarVisible(false)} />}
        {/* Sidebar expand button — fixed position so toolbar is unaffected */}
        {!sidebarVisible && (
          <button
            onClick={() => setSidebarVisible(true)}
            title="Show sidebar"
            aria-label="Show sidebar"
            className="absolute left-[84px] top-[8px] z-20 flex items-center justify-center w-7 h-6 rounded-full border border-border/60 bg-bg/60 text-fg-subtle hover:text-fg hover:border-accent/40 hover:bg-bg-muted/60 transition-colors duration-150 pointer-events-auto"
          >
            {/* panel-left icon: left stripe + right-pointing chevron */}
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
              <path d="M6 3v10" />
              <path d="M8.5 6L10.5 8L8.5 10" />
            </svg>
          </button>
        )}
        <div className="relative flex-1 min-w-0">
          <div className="absolute inset-0">
            <ChatPanel />
          </div>
          <div className="absolute top-0 left-0 right-0 z-10 overflow-visible pointer-events-none">
            <Toolbar
              sidebarCollapsed={!sidebarVisible}
              onExpandSidebar={() => setSidebarVisible(true)}
            />
          </div>
        </div>
        {filePanelOpen && <FilePanel />}
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
