import type { MatchedRecommendation } from "../types";

interface LeaguesViewProps {
  recommendations: MatchedRecommendation[];
  leagues: string[];
}

export function LeaguesView({ recommendations, leagues }: LeaguesViewProps) {
  const leagueStats = leagues.map((league) => {
    const picks = recommendations.filter((r) => r.league === league);
    const signals = [...new Set(picks.map((p) => p.signalLabel))];
    const matched = picks.filter((p) => p.matchedGame).length;
    return { league, picks: picks.length, signals, matched };
  });

  return (
    <div className="space-y-4">
      <div className="card">
        <h2 className="font-display text-lg font-semibold">Ligues actives</h2>
        <p className="text-sm text-slate-400 mt-1">
          Ligues détectées dans la feuille Google Sheets du jour
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {leagueStats.map(({ league, picks, signals, matched }) => (
          <div key={league} className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display text-xl font-bold text-accent-glow">
                {league}
              </h3>
              <span className="badge bg-accent/20 text-accent-glow">
                {picks} picks
              </span>
            </div>
            <div className="text-sm text-slate-400 space-y-2">
              <div>
                Matchs liés:{" "}
                <span className="text-white font-medium">{matched}</span>
              </div>
              <div>
                <span className="text-slate-500">Signaux:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {signals.map((s) => (
                    <span
                      key={s}
                      className="badge bg-surface-raised text-slate-300 text-[10px]"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
