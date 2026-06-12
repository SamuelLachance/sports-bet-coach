import { useMemo, useState } from "react";
import type { TrackedBet, TrackingResponse } from "../types";
import {
  type CalendarViewMode,
  filterBetsByPeriod,
  formatUnits,
  getPeriodLabel,
} from "../utils/trackingCalendar";
import { TrackingCalendar } from "./TrackingCalendar";

interface TrackingViewProps {
  tracking: TrackingResponse | null;
}

export function TrackingView({ tracking }: TrackingViewProps) {
  const [viewMode, setViewMode] = useState<CalendarViewMode>("month");
  const [anchorDate, setAnchorDate] = useState(() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  });

  const filteredBets = useMemo(() => {
    if (!tracking) return [];
    return filterBetsByPeriod(tracking.bets, anchorDate, viewMode);
  }, [tracking, anchorDate, viewMode]);

  if (!tracking) {
    return (
      <div className="card text-center py-12 text-slate-400">
        Loading tracking…
      </div>
    );
  }

  const { summary } = tracking;
  const periodLabel = getPeriodLabel(anchorDate, viewMode);
  const logTitle =
    viewMode === "all"
      ? "Bet log — all time"
      : `Bet log — ${periodLabel}`;

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

      <TrackingCalendar
        tracking={tracking}
        viewMode={viewMode}
        anchorDate={anchorDate}
        onViewModeChange={setViewMode}
        onAnchorDateChange={setAnchorDate}
      />

      <section className="card">
        <h3 className="font-display font-semibold text-lg mb-4">{logTitle}</h3>
        {filteredBets.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-8">
            {viewMode === "all"
              ? "No bets tracked yet. Load Daily Picks to record today's recommendations."
              : "No bets in this period. Try another date or view mode."}
          </p>
        ) : (
          <div className="space-y-3">
            {filteredBets.map((bet) => (
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
