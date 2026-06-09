import type { GameConsolidatedRecommendation } from "../types";

function confidenceColor(c: number) {
  if (c >= 85) return "text-success";
  if (c >= 75) return "text-accent-glow";
  if (c >= 50) return "text-slate-200";
  return "text-warning";
}

function trendArrow(t?: "up" | "down" | "flat") {
  if (t === "up") return "↑";
  if (t === "down") return "↓";
  return "→";
}

function impactSign(n: number) {
  return n >= 0 ? `+${n}` : `${n}`;
}

export function GameRecommendationCard({ game }: { game: GameConsolidatedRecommendation }) {
  return (
    <article className="card border-2 border-accent/40 bg-accent/5 md:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div className="flex flex-wrap gap-2">
          <span className="badge bg-accent/20 text-accent-glow">Recommandation match</span>
          <span className="badge bg-surface-raised text-slate-300 border border-surface-border">
            {game.league}
          </span>
          {game.hasConflict && (
          <span className="badge bg-warning/20 text-warning">
            {game.dualFade?.isDualFade ? "Dual-fade résolu" : "Conflit résolu"}
          </span>
        )}
          {game.highConviction && (
            <span className="badge bg-success/20 text-success">Haute conviction</span>
          )}
        </div>
        <div className="text-right">
          <div className={`text-3xl font-bold font-display ${confidenceColor(game.confidence)}`}>
            {game.confidence}%
          </div>
          <div className="text-xs text-slate-500">confiance match</div>
        </div>
      </div>

      <h3 className="font-display text-xl font-semibold text-white mb-1">
        {game.awayTeam} @ {game.homeTeam}
      </h3>

      <div className="bg-accent/10 border border-accent/30 rounded-lg p-3 mb-3">
        <div className="text-xs text-accent-muted uppercase tracking-wide mb-1">
          Côté recommandé
        </div>
        <div className="font-display text-2xl font-semibold text-accent-glow">
          {game.recommendedTeam}
        </div>
        {(game.historicalWinRate != null || game.weeklyTrend) && (
          <p className="text-xs text-slate-400 mt-2">
            {game.historicalWinRate != null && (
              <>
                Historique: {Math.round(game.historicalWinRate * 100)}% WR
                {game.historicalRoi != null && ` · ${game.historicalRoi.toFixed(1)}u ROI`}
              </>
            )}
            {game.weeklyTrend && (
              <>
                {game.historicalWinRate != null && " · "}
                Tendance 4 sem. {trendArrow(game.weeklyTrend)}
              </>
            )}
          </p>
        )}
        {game.hasConflict && !game.dualFade?.isDualFade && (
          <p className="text-xs text-slate-400 mt-2">
            Signaux opposés sur ce match — edge net calculé à partir du ROI historique et
            des règles croisées.
          </p>
        )}
      </div>

      {game.dualFade?.isDualFade && (
        <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 mb-3">
          <div className="text-xs text-warning uppercase tracking-wide mb-1">
            Dynamique dual-fade
          </div>
          <p className="text-sm text-slate-200 leading-relaxed">
            Book Needs fade{" "}
            <span className="font-medium text-white">{game.dualFade.bookNeedsFadeTeam}</span>
            {" + "}
            Square fade{" "}
            <span className="font-medium text-white">{game.dualFade.squareFadeTeam}</span>
            {" → "}
            tendance archive:{" "}
            <span className="font-medium text-accent-glow">{game.recommendedTeam}</span>
            {game.dualFade.archiveWinRate != null && (
              <>
                {" "}
                (~{Math.round(game.dualFade.archiveWinRate * 100)}%
                {game.dualFade.archiveSampleDays != null &&
                  ` · ${game.dualFade.archiveSampleDays} jours co-actifs`}
                )
              </>
            )}
          </p>
          {game.dualFade.strongerFadeColumn && (
            <p className="text-xs text-slate-400 mt-1">
              Colonne dominante:{" "}
              {game.dualFade.strongerFadeColumn === "book_needs_fade"
                ? "Book Needs (ROI tracker plus négatif)"
                : "Square Top (ROI tracker plus négatif)"}
            </p>
          )}
        </div>
      )}

      {game.matchedGame && (
        <div className="bg-surface-raised rounded-lg p-3 mb-3 text-sm">
          <div className="text-slate-400">
            {new Date(game.matchedGame.startTime).toLocaleString("fr-CA", {
              timeZone: "America/Toronto",
              dateStyle: "medium",
              timeStyle: "short",
            })}
            {game.matchedGame.venue && ` · ${game.matchedGame.venue}`}
          </div>
        </div>
      )}

      {game.confidenceBreakdown?.length > 0 && (
        <details className="mb-3 group">
          <summary className="text-sm text-slate-400 cursor-pointer hover:text-slate-200 transition-colors">
            Détail edge net ({game.confidenceBreakdown.length} facteurs)
          </summary>
          <ul className="mt-2 space-y-1.5 text-xs">
            {game.confidenceBreakdown.map((item) => (
              <li
                key={item.key}
                className="flex flex-wrap justify-between gap-x-2 gap-y-0.5 bg-surface-raised rounded px-2 py-1.5"
              >
                <span className="text-slate-300">{item.label}</span>
                <span
                  className={
                    item.impact >= 0 ? "text-success font-medium" : "text-warning font-medium"
                  }
                >
                  {impactSign(Math.round(item.impact * 10) / 10)}
                </span>
                {item.detail && (
                  <span className="w-full text-slate-500">{item.detail}</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="text-sm text-slate-400 leading-relaxed">{game.reasoning}</p>
      <p className="text-xs text-slate-500 mt-2">
        {game.pickIds.length} signaux agrégés sur ce match
      </p>
    </article>
  );
}
