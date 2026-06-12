import { useMemo } from "react";
import {
  selectMainScreenGameRecommendations,
  selectMainScreenStandalonePicks,
} from "@server/services/mainScreenPicks.js";
import type { Tab } from "./Layout";
import type {
  CalendarGame,
  GameConsolidatedRecommendation,
  MatchedRecommendation,
  TrackingResponse,
} from "../types";

interface HomeViewProps {
  date: string;
  games: CalendarGame[];
  recommendations: MatchedRecommendation[];
  gameRecommendations: GameConsolidatedRecommendation[];
  leagues: string[];
  tracking: TrackingResponse | null;
  onNavigate: (tab: Tab) => void;
}

const QUICK_LINKS: { tab: Tab; label: string; description: string }[] = [
  {
    tab: "picks",
    label: "Today's Picks",
    description: "Actionable bets and signal breakdown",
  },
  {
    tab: "calendar",
    label: "Calendar",
    description: "Full schedule for today's slate",
  },
  {
    tab: "tracking",
    label: "Tracking",
    description: "Units, record, and bet history",
  },
  {
    tab: "leagues",
    label: "Leagues",
    description: "Picks and signals by league",
  },
];

export function HomeView({
  date,
  games,
  recommendations,
  gameRecommendations,
  leagues,
  tracking,
  onNavigate,
}: HomeViewProps) {
  const visibleGameRecs = useMemo(
    () => selectMainScreenGameRecommendations(gameRecommendations, recommendations),
    [gameRecommendations, recommendations]
  );

  const visiblePicks = useMemo(
    () => selectMainScreenStandalonePicks(gameRecommendations, recommendations),
    [gameRecommendations, recommendations]
  );

  const actionableCount = visibleGameRecs.length + visiblePicks.length;
  const pendingBets = tracking?.summary.pending ?? 0;
  const totalUnits = tracking?.summary.totalUnits ?? 0;
  const record = tracking?.summary.record ?? "—";

  const topPicks = useMemo(() => {
    const combined: { label: string; confidence: number; league: string }[] = [
      ...visibleGameRecs.map((g) => ({
        label: `${g.awayTeam} @ ${g.homeTeam}`,
        confidence: g.confidence,
        league: g.league,
      })),
      ...visiblePicks.map((p) => ({
        label: p.pick,
        confidence: p.confidence,
        league: p.league,
      })),
    ];
    return combined.sort((a, b) => b.confidence - a.confidence).slice(0, 4);
  }, [visibleGameRecs, visiblePicks]);

  const slatePreview = games.slice(0, 6);

  return (
    <div className="space-y-6">
      <div className="card">
        <h2 className="font-display text-xl font-semibold">Welcome back</h2>
        <p className="text-sm text-slate-400 mt-1">
          Sharp Sheet Tips dashboard · {date} · America/Toronto
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatBox label="Actionable picks" value={actionableCount} accent />
        <StatBox label="Games today" value={games.length} />
        <StatBox label="Active leagues" value={leagues.length} />
        <StatBox label="Pending bets" value={pendingBets} />
      </div>

      {tracking && (
        <div className="card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="font-display text-sm font-semibold text-slate-300">
              Season tracking
            </h3>
            <p className="text-2xl font-bold font-display text-white mt-1">
              {totalUnits > 0 ? "+" : ""}
              {totalUnits.toFixed(2)}u
              <span className="text-base font-normal text-slate-400 ml-2">
                {record}
              </span>
            </p>
          </div>
          <button
            onClick={() => onNavigate("tracking")}
            className="px-4 py-2 rounded-lg bg-accent/20 text-accent-glow border border-accent/40 hover:bg-accent/30 text-sm font-medium transition-colors self-start sm:self-center"
          >
            View tracking →
          </button>
        </div>
      )}

      <section>
        <h3 className="font-display text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
          Quick links
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_LINKS.map((link) => (
            <button
              key={link.tab}
              onClick={() => onNavigate(link.tab)}
              className="card text-left hover:border-accent/40 transition-colors"
            >
              <div className="font-display font-semibold text-white">
                {link.label}
              </div>
              <p className="text-xs text-slate-500 mt-1">{link.description}</p>
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display text-lg font-semibold">Today&apos;s slate</h3>
            <button
              onClick={() => onNavigate("calendar")}
              className="text-xs text-accent-glow hover:underline"
            >
              Full calendar →
            </button>
          </div>
          {slatePreview.length === 0 ? (
            <p className="text-sm text-slate-400">No games scheduled today.</p>
          ) : (
            <ul className="space-y-2">
              {slatePreview.map((game) => (
                <li
                  key={game.id}
                  className="flex items-center justify-between text-sm border-b border-surface-border pb-2 last:border-0 last:pb-0"
                >
                  <span className="text-slate-300">
                    {game.awayAbbr || game.awayTeam} @{" "}
                    {game.homeAbbr || game.homeTeam}
                  </span>
                  <span className="badge bg-surface-raised text-slate-400 text-[10px]">
                    {game.league}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {games.length > slatePreview.length && (
            <p className="text-xs text-slate-500 mt-3">
              +{games.length - slatePreview.length} more games
            </p>
          )}
        </section>

        <section className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display text-lg font-semibold">Top picks</h3>
            <button
              onClick={() => onNavigate("picks")}
              className="text-xs text-accent-glow hover:underline"
            >
              All picks →
            </button>
          </div>
          {topPicks.length === 0 ? (
            <p className="text-sm text-slate-400">
              No actionable picks yet. Try syncing data.
            </p>
          ) : (
            <ul className="space-y-2">
              {topPicks.map((pick, i) => (
                <li
                  key={`${pick.label}-${i}`}
                  className="flex items-center justify-between text-sm border-b border-surface-border pb-2 last:border-0 last:pb-0"
                >
                  <span className="text-slate-300 truncate pr-2">{pick.label}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="badge bg-surface-raised text-slate-400 text-[10px]">
                      {pick.league}
                    </span>
                    <span className="text-accent-glow font-medium">
                      {pick.confidence}%
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function StatBox({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="card text-center">
      <div
        className={`text-2xl font-bold font-display ${accent ? "text-accent-glow" : "text-white"}`}
      >
        {value}
      </div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </div>
  );
}
