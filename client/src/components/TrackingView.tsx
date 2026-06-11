import { useMemo, useState } from "react";
import type { PeriodRollup, TrackedBet, TrackingResponse } from "../types";

interface TrackingViewProps {
  tracking: TrackingResponse | null;
}

type RollupMode = "weekly" | "monthly";

export function TrackingView({ tracking }: TrackingViewProps) {
  const [rollupMode, setRollupMode] = useState<RollupMode>("weekly");

  const rollups = useMemo(() => {
    if (!tracking) return [];
    return rollupMode === "weekly" ? tracking.weekly : tracking.monthly;
  }, [tracking, rollupMode]);

  if (!tracking) {
    return (
      <div className="card text-center py-12 text-slate-400">
        Loading tracking…
      </div>
    );
  }

  const { summary } = tracking;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryCard
          label="Total units"
          value={`${summary.totalUnits > 0 ? "+" : ""}${summary.totalUnits.toFixed(2)}u`}
          positive={summary.totalUnits > 0}
          negative={summary.totalUnits < 0}
        />
        <SummaryCard label="Record" value={summary.record} />
        <SummaryCard
          label="ROI"
          value={`${summary.roiPercent > 0 ? "+" : ""}${summary.roiPercent.toFixed(1)}%`}
          positive={summary.roiPercent > 0}
          negative={summary.roiPercent < 0}
        />
        <SummaryCard label="Wins" value={String(summary.wins)} positive />
        <SummaryCard label="Losses" value={String(summary.losses)} negative />
        <SummaryCard
          label="Streak"
          value={
            summary.currentStreak
              ? `${summary.currentStreak.count}${summary.currentStreak.type === "win" ? "W" : "L"}`
              : "—"
          }
          positive={summary.currentStreak?.type === "win"}
          negative={summary.currentStreak?.type === "loss"}
        />
      </div>

      {tracking.note && (
        <p className="text-xs text-slate-500 text-center">{tracking.note}</p>
      )}

      <section className="card">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <h3 className="font-display font-semibold text-lg">Period rollup</h3>
          <div className="flex gap-1">
            <RollupToggle
              active={rollupMode === "weekly"}
              onClick={() => setRollupMode("weekly")}
              label="Weekly"
            />
            <RollupToggle
              active={rollupMode === "monthly"}
              onClick={() => setRollupMode("monthly")}
              label="Monthly"
            />
          </div>
        </div>

        {rollups.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-6">
            No settled periods yet. Bets appear here once recommendations are logged.
          </p>
        ) : (
          <>
            <RollupChart rollups={rollups} />
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-500 text-left border-b border-surface-border">
                    <th className="pb-2 pr-4">Period</th>
                    <th className="pb-2 pr-4">Bets</th>
                    <th className="pb-2 pr-4">W-L</th>
                    <th className="pb-2 pr-4">Pending</th>
                    <th className="pb-2">Units</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rollups].reverse().map((row) => (
                    <tr
                      key={row.key}
                      className="border-b border-surface-border/50"
                    >
                      <td className="py-2 pr-4 font-medium">{row.label}</td>
                      <td className="py-2 pr-4">{row.bets}</td>
                      <td className="py-2 pr-4">
                        {row.wins}-{row.losses}
                        {row.pushes > 0 ? `-${row.pushes}` : ""}
                      </td>
                      <td className="py-2 pr-4 text-slate-400">
                        {row.pending || "—"}
                      </td>
                      <td
                        className={`py-2 font-medium ${
                          row.units >= 0 ? "text-success" : "text-danger"
                        }`}
                      >
                        {row.units > 0 ? "+" : ""}
                        {row.units.toFixed(2)}u
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h3 className="font-display font-semibold text-lg mb-4">Bet log</h3>
        {tracking.bets.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-8">
            No bets tracked yet. Load Daily Picks to record today&apos;s recommendations.
          </p>
        ) : (
          <div className="space-y-3">
            {tracking.bets.map((bet) => (
              <BetLogRow key={bet.id} bet={bet} />
            ))}
          </div>
        )}
      </section>

      {tracking.trackingSince && (
        <p className="text-xs text-slate-500 text-center">
          Tracking since {tracking.trackingSince} · {tracking.timezone}
        </p>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  positive,
  negative,
}: {
  label: string;
  value: string;
  positive?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="card text-center">
      <div
        className={`text-xl sm:text-2xl font-bold font-display ${
          positive ? "text-success" : negative ? "text-danger" : "text-white"
        }`}
      >
        {value}
      </div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </div>
  );
}

function RollupToggle({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        active
          ? "bg-accent/20 text-accent-glow border border-accent/30"
          : "text-slate-400 hover:text-slate-200 hover:bg-surface-raised border border-transparent"
      }`}
    >
      {label}
    </button>
  );
}

function RollupChart({ rollups }: { rollups: PeriodRollup[] }) {
  const maxAbs = Math.max(...rollups.map((r) => Math.abs(r.units)), 1);

  return (
    <div className="flex items-end gap-1 h-32 px-1">
      {rollups.map((row) => {
        const height = Math.max(4, (Math.abs(row.units) / maxAbs) * 100);
        const positive = row.units >= 0;
        return (
          <div
            key={row.key}
            className="flex-1 flex flex-col items-center justify-end min-w-0 group"
            title={`${row.label}: ${row.units > 0 ? "+" : ""}${row.units.toFixed(2)}u`}
          >
            <div
              className={`w-full max-w-[2.5rem] rounded-t transition-all ${
                positive ? "bg-success/70" : "bg-danger/70"
              }`}
              style={{ height: `${height}%` }}
            />
            <span className="text-[10px] text-slate-500 mt-1 truncate w-full text-center hidden sm:block">
              {row.label.split(" ")[0]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function formatAmericanOdds(odds: number): string {
  return `${odds > 0 ? "+" : ""}${odds}`;
}

function effectiveAmericanOdds(bet: TrackedBet): number | undefined {
  if (bet.betType === "spread" || bet.betType === "total") {
    return (
      bet.consensusOdds ??
      bet.odds ??
      bet.americanOdds ??
      bet.recommendedBet?.odds ??
      -110
    );
  }
  return (
    bet.consensusOdds ??
    bet.americanOdds ??
    bet.odds ??
    bet.recommendedBet?.odds
  );
}

function consensusOddsDisplay(bet: TrackedBet): string {
  if (bet.betType === "moneyline" && bet.consensusLabel) {
    return bet.consensusLabel;
  }
  if (bet.betType === "spread") {
    const juice = effectiveAmericanOdds(bet);
    if (juice != null) return formatAmericanOdds(juice);
  }
  if (bet.consensusLabel) return bet.consensusLabel;
  const odds = effectiveAmericanOdds(bet);
  return odds != null ? formatAmericanOdds(odds) : "—";
}

function formatUnits(units: number): string {
  const rounded = Math.round(units * 100) / 100;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(2)}u`;
}

function betTypeLabel(bet: TrackedBet): string {
  if (bet.betType === "spread" && bet.spread != null) {
    return `Spread ${bet.spread > 0 ? "+" : ""}${bet.spread}`;
  }
  if (bet.betType === "total" && bet.totalDirection && bet.totalLine != null) {
    return `${bet.totalDirection === "over" ? "Over" : "Under"} ${bet.totalLine}`;
  }
  if (bet.betType === "moneyline") return "Moneyline";
  return "—";
}

function BetLogRow({ bet }: { bet: TrackedBet }) {
  const matchup = `${bet.awayTeam} @ ${bet.homeTeam}`;

  return (
    <div className="border border-surface-border/60 rounded-lg p-3 bg-surface-raised/40">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-white">{bet.recommendedTeam}</span>
            <ResultBadge status={bet.status} units={bet.units} />
            {bet.highConviction && (
              <span className="badge bg-warning/20 text-warning">High conviction</span>
            )}
          </div>
          <p className="text-sm text-slate-400 mt-0.5 truncate">{matchup}</p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-medium text-accent-glow">
            {bet.confidence}% conf
          </div>
          <div className="text-xs text-slate-500">{bet.date}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-xs">
        <div>
          <span className="text-slate-500">Bet type</span>
          <div className="text-slate-200 font-medium">{betTypeLabel(bet)}</div>
        </div>
        <div>
          <span className="text-slate-500">Line</span>
          <div className="text-slate-200 font-medium">
            {bet.consensusSpread != null
              ? `${bet.consensusSpread > 0 ? "+" : ""}${bet.consensusSpread}`
              : bet.spread != null
                ? `${bet.spread > 0 ? "+" : ""}${bet.spread}`
                : bet.consensusTotal != null
                  ? String(bet.consensusTotal)
                  : bet.totalLine != null
                    ? String(bet.totalLine)
                    : "—"}
          </div>
        </div>
        <div>
          <span className="text-slate-500">
            {bet.bookProvider ? `Odds · ${bet.bookProvider}` : "Consensus odds"}
          </span>
          <div className="text-slate-200 font-medium">{consensusOddsDisplay(bet)}</div>
        </div>
        <div>
          <span className="text-slate-500">Units</span>
          <div className="text-slate-200 font-medium">
            {bet.status === "pending"
              ? "—"
              : bet.status === "push"
                ? "0u"
                : formatUnits(bet.units)}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-2">
        <span className="badge bg-surface-border text-slate-300">{bet.league}</span>
        {bet.signalLabels.map((label) => (
          <span key={label} className="badge bg-accent/10 text-accent-muted">
            {label}
          </span>
        ))}
      </div>

      {bet.finalScore && (
        <p className="text-xs text-slate-500 mt-2">Final: {bet.finalScore}</p>
      )}
    </div>
  );
}

function ResultBadge({
  status,
  units,
}: {
  status: TrackedBet["status"];
  units: number;
}) {
  if (status === "pending") {
    return <span className="badge bg-slate-700 text-slate-300">Pending</span>;
  }
  if (status === "push") {
    return <span className="badge bg-slate-600 text-slate-300">Push 0u</span>;
  }
  const win = status === "win";
  return (
    <span
      className={`badge ${win ? "bg-success/20 text-success" : "bg-danger/20 text-danger"}`}
    >
      {win ? "Win" : "Loss"} {formatUnits(units)}
    </span>
  );
}
