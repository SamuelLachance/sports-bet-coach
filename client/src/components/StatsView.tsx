import type { StatsResponse } from "../types";

interface StatsViewProps {
  stats: StatsResponse | null;
}

export function StatsView({ stats }: StatsViewProps) {
  if (!stats) {
    return (
      <div className="card text-center py-12 text-slate-400">
        Loading statistics…
      </div>
    );
  }

  const sharpBlock = stats.performanceDaily.find((b) =>
    b.category.toLowerCase().includes("sharp")
  );

  return (
    <div className="space-y-6">
      {stats.mtd && (
        <div className="grid grid-cols-3 gap-3">
          <MtdCard label="MTD wins" value={stats.mtd.wins} positive />
          <MtdCard label="MTD losses" value={stats.mtd.losses} />
          <MtdCard
            label="MTD return (units)"
            value={stats.mtd.returnUnits}
            positive={stats.mtd.returnUnits > 0}
            format="decimal"
          />
        </div>
      )}

      {stats.performanceDaily.map((block) => (
        <section key={block.category} className="card overflow-x-auto">
          <h3 className="font-display font-semibold text-lg mb-4">
            {block.category}
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 text-left border-b border-surface-border">
                <th className="pb-2 pr-4">League</th>
                <th className="pb-2 pr-4">W</th>
                <th className="pb-2 pr-4">L</th>
                <th className="pb-2">Return</th>
              </tr>
            </thead>
            <tbody>
              {block.leagues.map((l) => (
                <tr key={l.league} className="border-b border-surface-border/50">
                  <td className="py-2 pr-4 font-medium">{l.league}</td>
                  <td className="py-2 pr-4 text-success">{l.wins}</td>
                  <td className="py-2 pr-4 text-danger">{l.losses}</td>
                  <td
                    className={`py-2 font-medium ${
                      l.returnUnits >= 0 ? "text-success" : "text-danger"
                    }`}
                  >
                    {l.returnUnits > 0 ? "+" : ""}
                    {l.returnUnits.toFixed(2)}
                  </td>
                </tr>
              ))}
              <tr className="font-semibold text-accent-glow">
                <td className="py-2 pr-4">{block.total.league}</td>
                <td className="py-2 pr-4">{block.total.wins}</td>
                <td className="py-2 pr-4">{block.total.losses}</td>
                <td className="py-2">
                  {block.total.returnUnits > 0 ? "+" : ""}
                  {block.total.returnUnits.toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      ))}

      {sharpBlock && (
        <section className="card">
          <h3 className="font-display font-semibold text-lg mb-4">
            Yearly performance — Sharp Money (preview)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 text-left">
                  <th className="pb-2 pr-3">Year</th>
                  <th className="pb-2 pr-3">League</th>
                  <th className="pb-2 pr-3">Year total</th>
                  <th className="pb-2">All-time</th>
                </tr>
              </thead>
              <tbody>
                {stats.performanceYearly
                  .filter((r) => r.category === "Sharp Money" && r.league !== "Total")
                  .slice(0, 12)
                  .map((r) => (
                    <tr
                      key={`${r.year}-${r.league}`}
                      className="border-t border-surface-border/30"
                    >
                      <td className="py-1.5 pr-3">{r.year}</td>
                      <td className="py-1.5 pr-3">{r.league}</td>
                      <td
                        className={`py-1.5 pr-3 ${
                          (r.yearTotal ?? 0) >= 0 ? "text-success" : "text-danger"
                        }`}
                      >
                        {r.yearTotal?.toFixed(2) ?? "—"}
                      </td>
                      <td className="py-1.5">{r.allTime?.toFixed(2) ?? "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="text-xs text-slate-500 text-center">
        {stats.archiveCount} archived days available
      </p>
    </div>
  );
}

function MtdCard({
  label,
  value,
  positive,
  format,
}: {
  label: string;
  value: number;
  positive?: boolean;
  format?: "decimal";
}) {
  const display =
    format === "decimal"
      ? `${value > 0 ? "+" : ""}${value.toFixed(2)}`
      : value;

  return (
    <div className="card text-center">
      <div
        className={`text-2xl font-bold font-display ${
          positive === undefined
            ? "text-white"
            : positive
              ? "text-success"
              : "text-danger"
        }`}
      >
        {display}
      </div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </div>
  );
}
