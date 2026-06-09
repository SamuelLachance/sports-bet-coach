import { useMemo, useState } from "react";
import type { GameConsolidatedRecommendation, MatchedRecommendation } from "../types";
import { GameRecommendationCard } from "./GameRecommendationCard";
import { PickCard } from "./PickCard";

interface DailyPicksProps {
  recommendations: MatchedRecommendation[];
  gameRecommendations?: GameConsolidatedRecommendation[];
  leagues: string[];
}

const SIGNAL_FILTERS = [
  { id: "all", label: "Tous les signaux" },
  { id: "sharp_money", label: "Sharp Money" },
  { id: "book_needs_fade", label: "Book Needs" },
  { id: "square_fade", label: "Square Fade" },
  { id: "reverse_line_movement", label: "RLM" },
  { id: "mega_sharps", label: "Mega Sharps" },
  { id: "whale_plays", label: "Whale" },
  { id: "model_best_values", label: "Modèle" },
];

export function DailyPicks({ recommendations, gameRecommendations = [], leagues }: DailyPicksProps) {
  const [leagueFilter, setLeagueFilter] = useState("ALL");
  const [signalFilter, setSignalFilter] = useState("all");

  const filtered = useMemo(() => {
    return recommendations.filter((r) => {
      if (leagueFilter !== "ALL" && r.league !== leagueFilter) return false;
      if (signalFilter !== "all" && r.signalType !== signalFilter) return false;
      return true;
    });
  }, [recommendations, leagueFilter, signalFilter]);

  const matched = filtered.filter((r) => r.matchedGame).length;
  const conflicts = filtered.filter((r) => r.gameConflict).length;

  const visibleGameRecs = useMemo(() => {
    if (!gameRecommendations.length) return [];
    const filteredIds = new Set(filtered.map((r) => r.id));
    return gameRecommendations.filter((g) =>
      g.pickIds.some((id) => filteredIds.has(id))
    );
  }, [gameRecommendations, filtered]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatBox label="Picks totaux" value={recommendations.length} />
        <StatBox label="Affichés" value={filtered.length} accent />
        <StatBox label="Matchs confirmés" value={matched} />
        <StatBox label="Conflits résolus" value={conflicts || visibleGameRecs.length} />
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          value={leagueFilter}
          onChange={(e) => setLeagueFilter(e.target.value)}
          className="bg-surface-card border border-surface-border rounded-lg px-3 py-2 text-sm"
        >
          <option value="ALL">Toutes les ligues</option>
          {leagues.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <select
          value={signalFilter}
          onChange={(e) => setSignalFilter(e.target.value)}
          className="bg-surface-card border border-surface-border rounded-lg px-3 py-2 text-sm"
        >
          {SIGNAL_FILTERS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="card text-center py-12 text-slate-400">
          Aucun pick pour ces filtres. Essayez de synchroniser les données.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {visibleGameRecs.map((game) => (
            <GameRecommendationCard key={game.gameKey} game={game} />
          ))}
          {filtered.map((rec) => (
            <PickCard key={rec.id} rec={rec} />
          ))}
        </div>
      )}
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
