import type { MatchedRecommendation } from "../types";

const LEAGUE_COLORS: Record<string, string> = {
  MLB: "bg-red-500/20 text-red-300",
  NBA: "bg-orange-500/20 text-orange-300",
  NHL: "bg-blue-500/20 text-blue-300",
  NFL: "bg-green-500/20 text-green-300",
  WNBA: "bg-purple-500/20 text-purple-300",
  CBB: "bg-amber-500/20 text-amber-300",
  MEGA_SHARPS: "bg-cyan-500/20 text-cyan-300",
  WHALE: "bg-indigo-500/20 text-indigo-300",
  MODEL: "bg-emerald-500/20 text-emerald-300",
  RLM: "bg-pink-500/20 text-pink-300",
};

const STATUS_LABELS = {
  recommended: { text: "Recommandé", class: "bg-success/20 text-success" },
  pending: { text: "En attente", class: "bg-warning/20 text-warning" },
  matched: { text: "En cours", class: "bg-accent/20 text-accent-glow" },
  settled: { text: "Terminé", class: "bg-slate-500/20 text-slate-300" },
};

function confidenceColor(c: number) {
  if (c >= 85) return "text-success";
  if (c >= 75) return "text-accent-glow";
  return "text-warning";
}

export function PickCard({ rec }: { rec: MatchedRecommendation }) {
  const status = STATUS_LABELS[rec.status];
  const leagueColor = LEAGUE_COLORS[rec.league] || "bg-slate-500/20 text-slate-300";

  return (
    <article className="card hover:border-accent/30 transition-colors">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div className="flex flex-wrap gap-2">
          <span className={`badge ${leagueColor}`}>{rec.league}</span>
          <span className="badge bg-surface-raised text-slate-300 border border-surface-border">
            {rec.signalLabel}
          </span>
          <span className={`badge ${status.class}`}>{status.text}</span>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-bold font-display ${confidenceColor(rec.confidence)}`}>
            {rec.confidence}%
          </div>
          <div className="text-xs text-slate-500">confiance</div>
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

      {rec.matchedGame && (
        <div className="bg-surface-raised rounded-lg p-3 mb-3 text-sm">
          <div className="font-medium text-slate-200">
            {rec.matchedGame.awayTeam} @ {rec.matchedGame.homeTeam}
          </div>
          <div className="text-slate-400 mt-1">
            {new Date(rec.matchedGame.startTime).toLocaleString("fr-CA", {
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
        {rec.gameTime && <span>Heure: {rec.gameTime}</span>}
        {rec.postingTime && <span>Publié: {rec.postingTime}</span>}
      </div>

      <p className="text-sm text-slate-400 leading-relaxed">{rec.reasoning}</p>
    </article>
  );
}
