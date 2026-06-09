import { isStaticDeploy } from "../api";
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
          Synchronisation des données
        </h2>
        {isStaticDeploy && (
          <p className="text-sm text-slate-400 mb-4 bg-surface/50 border border-slate-700 rounded-lg p-3">
            Deploiement GitHub Pages : snapshot des donnees au moment du build CI.
            Lancez l&apos;app en local (<code className="text-accent">npm run dev</code>) pour sync en direct.
          </p>
        )}
        {error && (
          <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg p-3 mb-4 text-sm">
            {error}
          </div>
        )}

        <dl className="space-y-3 text-sm">
          <Row
            label="Dernière sync"
            value={
              syncStatus?.lastSync
                ? new Date(syncStatus.lastSync).toLocaleString("fr-CA", {
                    timeZone: "America/Toronto",
                  })
                : "Jamais"
            }
          />
          <Row label="Picks chargés" value={String(syncStatus?.pickCount ?? 0)} />
          <Row label="Matchs du jour" value={String(syncStatus?.gameCount ?? 0)} />
          <Row
            label="Ligues"
            value={syncStatus?.leagues.join(", ") || "—"}
          />
        </dl>

        <button
          onClick={onSync}
          disabled={syncing || isStaticDeploy}
          className="mt-6 w-full py-3 rounded-lg bg-accent text-surface font-semibold hover:bg-accent-glow disabled:opacity-50 transition-colors"
        >
          {syncing ? "Synchronisation en cours…" : "Forcer la synchronisation"}
        </button>
      </div>

      <div className="card">
        <h3 className="font-display font-semibold mb-3">Sources Google Sheets</h3>
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
              <li>· Picks du jour (gid=0)</li>
              <li>· Archives (gid=1883403692)</li>
              <li>· Performance quotidienne (gid=0)</li>
              <li>· Performance annuelle (gid=1887286192)</li>
            </>
          )}
        </ul>
      </div>

      <div className="card">
        <h3 className="font-display font-semibold mb-3">APIs calendrier</h3>
        <p className="text-sm text-slate-400 leading-relaxed">
          Calendriers via ESPN (MLB, NBA, NHL, NFL, WNBA, CBB, CFB). Aucune clé
          API requise. Fuseau horaire: America/Toronto (Québec).
        </p>
      </div>

      <div className="card">
        <h3 className="font-display font-semibold mb-3">Variables d'environnement</h3>
        <pre className="text-xs bg-surface-raised p-3 rounded-lg text-slate-400 overflow-x-auto">
{`PORT=3001          # Port API backend
TZ=America/Toronto # Fuseau horaire`}
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
