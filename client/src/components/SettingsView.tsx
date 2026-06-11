import { isClientSyncEnabled, isStaticDeploy } from "../api";
import type { SyncStatus } from "../types";

interface SettingsViewProps {
  syncStatus: SyncStatus | null;
  onSync: () => void;
  syncing: boolean;
  error: string | null;
}

export function SettingsView({
  syncStatus,
  onSync,
  syncing,
  error,
}: SettingsViewProps) {
  return (
    <div className="space-y-6 max-w-2xl">
      <div className="card">
        <h2 className="font-display text-lg font-semibold mb-4">
          Data sync
        </h2>
        {isStaticDeploy && isClientSyncEnabled && (
          <p className="text-sm text-slate-400 mb-4 bg-surface/50 border border-slate-700 rounded-lg p-3">
            GitHub Pages: initial data from the latest CI deployment. Use the button
            below to refresh live from Google Sheets and ESPN.
          </p>
        )}
        {isStaticDeploy && !isClientSyncEnabled && (
          <p className="text-sm text-slate-400 mb-4 bg-surface/50 border border-slate-700 rounded-lg p-3">
            GitHub Pages deployment: data snapshot from CI build time.
            Run the app locally (<code className="text-accent">npm run dev</code>) for live sync.
          </p>
        )}
        {error && (
          <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg p-3 mb-4 text-sm">
            {error}
          </div>
        )}

        <dl className="space-y-3 text-sm">
          <Row
            label="Last sync"
            value={
              syncStatus?.lastSync
                ? new Date(syncStatus.lastSync).toLocaleString("en-US", {
                    timeZone: "America/Toronto",
                  })
                : "Never"
            }
          />
          <Row label="Picks loaded" value={String(syncStatus?.pickCount ?? 0)} />
          <Row label="Games today" value={String(syncStatus?.gameCount ?? 0)} />
          <Row
            label="Leagues"
            value={syncStatus?.leagues.join(", ") || "—"}
          />
        </dl>

        <button
          onClick={onSync}
          disabled={syncing || (isStaticDeploy && !isClientSyncEnabled)}
          className="mt-6 w-full py-3 rounded-lg bg-accent text-surface font-semibold hover:bg-accent-glow disabled:opacity-50 transition-colors"
        >
          {syncing ? "Syncing…" : "Force sync"}
        </button>
      </div>

      <div className="card">
        <h3 className="font-display font-semibold mb-3">Google Sheets sources</h3>
        <ul className="space-y-2 text-sm text-slate-400">
          {syncStatus?.tabs.map((tab) => (
            <li key={tab.id} className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${tab.ok ? "bg-success" : "bg-danger"}`}
              />
              {tab.name}
              {tab.error && (
                <span className="text-danger text-xs">({tab.error})</span>
              )}
            </li>
          )) || (
            <>
              <li>· Daily picks (gid=0)</li>
              <li>· Archive (gid=1883403692)</li>
              <li>· Daily performance (gid=0)</li>
              <li>· Yearly performance (gid=1887286192)</li>
            </>
          )}
        </ul>
      </div>

      <div className="card">
        <h3 className="font-display font-semibold mb-3">Schedule APIs</h3>
        <p className="text-sm text-slate-400 leading-relaxed">
          Schedules via ESPN (MLB, NBA, NHL, NFL, WNBA, CBB, CFB). No API
          key required. Timezone: America/Toronto (Eastern).
        </p>
      </div>

      <div className="card">
        <h3 className="font-display font-semibold mb-3">Environment variables</h3>
        <pre className="text-xs bg-surface-raised p-3 rounded-lg text-slate-400 overflow-x-auto">
{`PORT=3001          # Backend API port
TZ=America/Toronto # Timezone`}
        </pre>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-200 font-medium text-right">{value}</dd>
    </div>
  );
}
