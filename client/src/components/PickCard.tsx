import type { MatchedRecommendation } from "../types";
import { SignalBreakdown } from "./SignalBreakdown";

const LEAGUE_COLORS: Record<string, string> = {
  MLB: "bg-red-500/20 text-red-300",
  NBA: "bg-orange-500/20 text-orange-300",
  NHL: "bg-blue-500/20 text-blue-300",
  NFL: "bg-green-500/20 text-green-300",
  WNBA: "bg-purple-500/20 text-purple-300",
  CBB: "bg-amber-500/20 text-amber-300",
  MLS: "bg-emerald-500/20 text-emerald-300",
  EPL: "bg-emerald-500/20 text-emerald-300",
  LALIGA: "bg-emerald-500/20 text-emerald-300",
  BUNDESLIGA: "bg-emerald-500/20 text-emerald-300",
  SERIEA: "bg-emerald-500/20 text-emerald-300",
  LIGUE1: "bg-emerald-500/20 text-emerald-300",
  WORLDCUP: "bg-emerald-500/20 text-emerald-300",
  FIFA_FRIENDLIES: "bg-emerald-500/20 text-emerald-300",
  CONCACAF_WCQ: "bg-emerald-500/20 text-emerald-300",
  CONCACAF_GOLD: "bg-emerald-500/20 text-emerald-300",
  CONCACAF_NATIONS: "bg-emerald-500/20 text-emerald-300",
  UEFA_EURO: "bg-emerald-500/20 text-emerald-300",
  UEFA_NATIONS: "bg-emerald-500/20 text-emerald-300",
  COPA_AMERICA: "bg-emerald-500/20 text-emerald-300",
  MEGA_SHARPS: "bg-cyan-500/20 text-cyan-300",
  WHALE: "bg-indigo-500/20 text-indigo-300",
  MODEL: "bg-emerald-500/20 text-emerald-300",
  RLM: "bg-pink-500/20 text-pink-300",
};

const STATUS_LABELS = {
  recommended: { text: "Recommended", class: "bg-success/20 text-success" },
  pending: { text: "Pending", class: "bg-warning/20 text-warning" },
  matched: { text: "In progress", class: "bg-accent/20 text-accent-glow" },
  settled: { text: "Settled", class: "bg-slate-500/20 text-slate-300" },
};

const POLARITY_LABELS: Record<
  MatchedRecommendation["signalPolarity"],
  { text: string; class: string }
> = {
  positive: { text: "Positive signal", class: "text-success" },
  negative: { text: "Negative signal", class: "text-warning" },
  inverted: { text: "Inverted — bet opponent", class: "text-accent-glow" },
};

function confidenceColor(c: number) {
  if (c >= 85) return "text-success";
  if (c >= 75) return "text-accent-glow";
  if (c >= 50) return "text-slate-200";
  return "text-warning";
}

export function PickCard({ rec }: { rec: MatchedRecommendation }) {
  const status = STATUS_LABELS[rec.status];
  const leagueColor = LEAGUE_COLORS[rec.league] || "bg-slate-500/20 text-slate-300";
  const polarity = POLARITY_LABELS[rec.signalPolarity];

  return (
    <article className="card hover:border-accent/30 transition-colors">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div className="flex flex-wrap gap-2">
          <span className={`badge ${leagueColor}`}>{rec.league}</span>
          <span className="badge bg-surface-raised text-slate-300 border border-surface-border">
            {rec.signalLabel}
          </span>
          <span className={`badge ${status.class}`}>{status.text}</span>
          <span className={`badge bg-surface-raised ${polarity.class} border border-surface-border`}>
            {polarity.text}
          </span>
          {rec.gameConflict && (
            <span className="badge bg-warning/20 text-warning">Game conflict</span>
          )}
        </div>
        <div className="text-right">
          <div className={`text-2xl font-bold font-display ${confidenceColor(rec.confidence)}`}>
            {rec.confidence}%
          </div>
          <div className="text-xs text-slate-500">confidence</div>
        </div>
      </div>

      <h3 className="font-display text-xl font-semibold text-white mb-1">
        {rec.pick}
        {rec.line && (
          <span className="text-accent-glow ml-2 text-lg">{rec.line}</span>
        )}
      </h3>

      {rec.opponent && (
        <p className="text-slate-400 text-sm mb-2">
          vs <span className="text-slate-200">{rec.opponent}</span>
        </p>
      )}

      {rec.gameConflict && rec.consolidatedTeam && (
        <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 mb-3 text-sm">
          <div className="text-xs text-warning uppercase tracking-wide mb-1">
            {rec.conflictNote ?? "Conflict — see game recommendation"}
          </div>
          <p className="text-slate-300">
            Game decision:{" "}
            <span className="font-semibold text-accent-glow">{rec.consolidatedTeam}</span>
            {rec.consolidatedConfidence != null && (
              <span className="text-slate-400"> ({rec.consolidatedConfidence}%)</span>
            )}
          </p>
          {rec.standaloneConfidence != null && (
            <p className="text-xs text-slate-500 mt-1">
              Standalone confidence (before resolution): {rec.standaloneConfidence}%
            </p>
          )}
        </div>
      )}

      {rec.signalPolarity === "inverted" && rec.opponentPick && (
        <div className="bg-accent/10 border border-accent/30 rounded-lg p-3 mb-3">
          <div className="text-xs text-accent-muted uppercase tracking-wide mb-1">
            Recommended inverted pick
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="font-display text-lg font-semibold text-accent-glow">
              {rec.opponentPick}
            </div>
            {rec.opponentConfidence != null && (
              <div className="text-right">
                <div className="text-xl font-bold font-display text-success">
                  {rec.opponentConfidence}%
                </div>
                <div className="text-xs text-slate-500">inverted confidence</div>
              </div>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Fade rule — bet the opponent, not the listed public side.
          </p>
        </div>
      )}

      {rec.matchedGame && (
        <div className="bg-surface-raised rounded-lg p-3 mb-3 text-sm">
          <div className="font-medium text-slate-200">
            {rec.matchedGame.awayTeam} @ {rec.matchedGame.homeTeam}
          </div>
          <div className="text-slate-400 mt-1">
            {new Date(rec.matchedGame.startTime).toLocaleString("en-US", {
              timeZone: "America/Toronto",
              dateStyle: "medium",
              timeStyle: "short",
            })}
            {rec.matchedGame.venue && ` · ${rec.matchedGame.venue}`}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3 text-xs text-slate-500 mb-3">
        <span className="text-accent-muted">{rec.edgeLabel}</span>
        {rec.gameTime && <span>Time: {rec.gameTime}</span>}
        {rec.postingTime && <span>Posted: {rec.postingTime}</span>}
      </div>

      <SignalBreakdown items={rec.confidenceBreakdown} />

      <p className="text-sm text-slate-400 leading-relaxed">{rec.reasoning}</p>
    </article>
  );
}
