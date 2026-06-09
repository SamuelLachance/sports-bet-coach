import type { ReactNode } from "react";

export type Tab = "picks" | "calendar" | "leagues" | "stats" | "settings";

interface LayoutProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  children: ReactNode;
  date: string;
  syncing: boolean;
  onSync: () => void;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "picks", label: "Picks du jour" },
  { id: "calendar", label: "Calendrier" },
  { id: "leagues", label: "Ligues" },
  { id: "stats", label: "Trends" },
  { id: "settings", label: "Paramètres" },
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
              Sports <span className="text-accent">Bet Coach</span>
            </h1>
            <p className="text-sm text-slate-400 mt-0.5">
              Recommandations quotidiennes · {date} · Fuseau: America/Toronto
            </p>
          </div>
          <button
            onClick={onSync}
            disabled={syncing}
            className="px-4 py-2 rounded-lg bg-accent/20 text-accent-glow border border-accent/40 hover:bg-accent/30 disabled:opacity-50 text-sm font-medium transition-colors"
          >
            {syncing ? "Synchronisation…" : "↻ Synchroniser"}
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
        Données synchronisées depuis Google Sheets · Calendriers ESPN
      </footer>
    </div>
  );
}
