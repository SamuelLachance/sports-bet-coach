import type { GameConsolidatedRecommendation } from "../types";
import { SignalBreakdown } from "./SignalBreakdown";

function confidenceColor(c: number) {
  if (c >= 85) return "text-success";
  if (c >= 75) return "text-accent-glow";
  if (c >= 50) return "text-slate-200";
  return "text-warning";
}

export function GameRecommendationCard({ game }: { game: GameConsolidatedRecommendation }) {
  if (game.noBet) {
    return (
      <article className="card border-2 border-warning/40 bg-warning/5 md:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
          <div className="flex flex-wrap gap-2">
            <span className="badge bg-warning/20 text-warning">No bet</span>
            <span className="badge bg-surface-raised text-slate-300 border border-surface-border">
              {game.league}
            </span>
            {game.dualFade?.isOpposingNoBet && (
              <span className="badge bg-warning/20 text-warning">Opposing dual-fade</span>
            )}
          </div>
        </div>

        <h3 className="font-display text-xl font-semibold text-white mb-1">
          {game.awayTeam} @ {game.homeTeam}
        </h3>

        <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 mb-3">
          <div className="text-xs text-warning uppercase tracking-wide mb-1">
            Recommendation
          </div>
          <div className="font-display text-2xl font-semibold text-warning">No bet</div>
          <p className="text-sm text-slate-300 mt-2 leading-relaxed">
            {game.noBetReason ||
              "Conflicting signals on this game — no side recommended."}
          </p>
        </div>

        {game.dualFade?.isOpposingNoBet && game.dualFade.bookNeedsFadeTeam && game.dualFade.squareFadeTeam && (
          <div className="bg-surface-raised border border-surface-border rounded-lg p-3 mb-3">
            <p className="text-sm text-slate-300">
              Fade targets:{" "}
              <span className="text-white">{game.dualFade.bookNeedsFadeTeam}</span>
              {" vs "}
              <span className="text-white">{game.dualFade.squareFadeTeam}</span>
            </p>
          </div>
        )}

        <SignalBreakdown items={game.confidenceBreakdown} />

        <p className="text-sm text-slate-400 leading-relaxed">{game.reasoning}</p>
      </article>
    );
  }

  return (
    <article className="card border-2 border-accent/40 bg-accent/5 md:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div className="flex flex-wrap gap-2">
          <span className="badge bg-accent/20 text-accent-glow">Game recommendation</span>
          <span className="badge bg-surface-raised text-slate-300 border border-surface-border">
            {game.league}
          </span>
          {game.dualFade?.isDualFade && !game.dualFade.isOpposingNoBet && (
            <span className="badge bg-warning/20 text-warning">Multi-fade</span>
          )}
          {game.dualAlgoConfirmed && (
            <span
              className="badge bg-success/20 text-success"
              title={game.sportsOddsTrendLabel || "Coach + Sports Odds agree"}
            >
              Dual algo ✓
            </span>
          )}
          {game.sportsOddsForced && (
            <span
              className="badge bg-warning/20 text-warning"
              title={game.sportsOddsTrendLabel || "High book edge overrides coach"}
            >
              Odds force ✓
            </span>
          )}
          {game.sportsOddsConfirmed && !game.dualAlgoConfirmed && !game.sportsOddsForced && (
            <span className="badge bg-accent/20 text-accent-glow" title={game.sportsOddsTrendLabel}>
              {game.sportsOddsTrendLabel?.includes("Unified") ? "Unified algo ✓" : "Odds algo ✓"}
            </span>
          )}
          {game.dratingsConfirmed && (
            <span className="badge bg-success/20 text-success" title={game.dratingsTrendLabel}>
              DRatings ✓
            </span>
          )}
        </div>
        <div className="text-right">
          <div className={`text-3xl font-bold font-display ${confidenceColor(game.confidence)}`}>
            {game.confidence}%
          </div>
          <div className="text-xs text-slate-500">game confidence</div>
        </div>
      </div>

      <h3 className="font-display text-xl font-semibold text-white mb-1">
        {game.awayTeam} @ {game.homeTeam}
      </h3>

      <div className="bg-accent/10 border border-accent/30 rounded-lg p-3 mb-3">
        <div className="text-xs text-accent-muted uppercase tracking-wide mb-1">
          Recommended bet
        </div>
        <div className="font-display text-2xl font-semibold text-accent-glow">
          {game.recommendedTeam}
        </div>
        {game.betType && (
          <div className="text-sm text-slate-400 mt-1 capitalize">
            {game.betType === "total"
              ? `${game.recommendedBet?.totalDirection ?? ""} ${game.recommendedBet?.totalLine ?? ""}`.trim()
              : game.betType === "spread" && game.recommendedBet?.spread != null
                ? `Spread ${game.recommendedBet.spread > 0 ? "+" : ""}${game.recommendedBet.spread}`
                : game.recommendedBet?.team === "Draw"
                  ? "Draw (3-way)"
                  : game.betType}
          </div>
        )}
        {game.consensusLabel && (
          <div className="mt-3 pt-3 border-t border-accent/20">
            <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">
              Consensus odds{game.bookProvider ? ` · ${game.bookProvider}` : ""}
            </div>
            <div className="font-display text-xl font-semibold text-white">
              {game.consensusLabel}
            </div>
            {game.betType === "moneyline" && game.consensusOdds != null && (
              <div className="text-xs text-slate-500 mt-1">
                Book moneyline for this side
              </div>
            )}
          </div>
        )}
      </div>

      {game.dualFade?.isDualFade && !game.dualFade.isOpposingNoBet && (
        <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 mb-3">
          <div className="text-xs text-warning uppercase tracking-wide mb-1">
            Same-side multi-fade
          </div>
          <p className="text-sm text-slate-200 leading-relaxed">
            Multiple fade signals target{" "}
            <span className="font-medium text-white">{game.dualFade.bookNeedsFadeTeam}</span>
            {" → bet "}
            <span className="font-medium text-accent-glow">{game.recommendedTeam}</span>
          </p>
        </div>
      )}

      {game.matchedGame && (
        <div className="bg-surface-raised rounded-lg p-3 mb-3 text-sm">
          <div className="text-slate-400">
            {new Date(game.matchedGame.startTime).toLocaleString("en-US", {
              timeZone: "America/Toronto",
              dateStyle: "medium",
              timeStyle: "short",
            })}
            {game.matchedGame.venue && ` · ${game.matchedGame.venue}`}
          </div>
        </div>
      )}

      <SignalBreakdown items={game.confidenceBreakdown} />

      <p className="text-sm text-slate-400 leading-relaxed">{game.reasoning}</p>
      <p className="text-xs text-slate-500 mt-2">
        {game.pickIds.length} signals aggregated for this game
      </p>
    </article>
  );
}
