import type { ReactNode } from "react";

export type Tab = "picks" | "calendar" | "leagues" | "tracking" | "settings";

interface LayoutProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  children: ReactNode;
  date: string;
  syncing: boolean;
  onSync: () => void;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "picks", label: "Today's Picks" },
  { id: "calendar", label: "Calendar" },
  { id: "leagues", label: "Leagues" },
  { id: "tracking", label: "Tracking" },
  { id: "settings", label: "Settings" },
];

export function Layout({
  activeTab,
  onTabChange,
  children,
  date,
  syncing,
  onSync,
}: LayoutProps) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-surface-border bg-surface-raised/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">
              Sharp Sheet <span className="text-accent">Tips</span>
            </h1>
            <p className="text-sm text-slate-400 mt-0.5">
              Daily recommendations · {date} · Timezone: America/Toronto
            </p>
          </div>
          <button
            onClick={onSync}
            disabled={syncing}
            className="px-4 py-2 rounded-lg bg-accent/20 text-accent-glow border border-accent/40 hover:bg-accent/30 disabled:opacity-50 text-sm font-medium transition-colors"
          >
            {syncing ? "Syncing…" : "↻ Sync"}
          </button>
        </div>
        <nav className="max-w-7xl mx-auto px-4 pb-3 flex gap-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`nav-btn whitespace-nowrap ${
                activeTab === tab.id ? "nav-btn-active" : "nav-btn-inactive"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">{children}</main>
      <footer className="border-t border-surface-border py-4 text-center text-xs text-slate-500">
        Data synced from Google Sheets · ESPN schedules
      </footer>
    </div>
  );
}
