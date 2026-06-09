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

const POLARITY_LABELS: Record<
  MatchedRecommendation["signalPolarity"],
  { text: string; class: string }
> = {
  positive: { text: "Signal positif", class: "text-success" },
  negative: { text: "Signal négatif", class: "text-warning" },
  inverted: { text: "Inversé — jouer l'adversaire", class: "text-accent-glow" },
};

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

function trendLabel(t?: "up" | "down" | "flat") {
  if (t === "up") return "amélioration";
  if (t === "down") return "déclin";
  return "stable";
}

function impactSign(n: number) {
  return n >= 0 ? `+${n}` : `${n}`;
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
            <span className="badge bg-warning/20 text-warning">Conflit match</span>
          )}
          {rec.highConviction && (
            <span className="badge bg-success/20 text-success">Haute conviction</span>
          )}
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

      {rec.gameConflict && rec.consolidatedTeam && (
        <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 mb-3 text-sm">
          <div className="text-xs text-warning uppercase tracking-wide mb-1">
            {rec.conflictNote ?? "Conflit — voir recommandation match"}
          </div>
          <p className="text-slate-300">
            Décision match:{" "}
            <span className="font-semibold text-accent-glow">{rec.consolidatedTeam}</span>
            {rec.consolidatedConfidence != null && (
              <span className="text-slate-400"> ({rec.consolidatedConfidence}%)</span>
            )}
          </p>
          {rec.standaloneConfidence != null && (
            <p className="text-xs text-slate-500 mt-1">
              Confiance standalone (avant résolution): {rec.standaloneConfidence}%
            </p>
          )}
        </div>
      )}

      {rec.signalPolarity === "inverted" && rec.opponentPick && (
        <div className="bg-accent/10 border border-accent/30 rounded-lg p-3 mb-3">
          <div className="text-xs text-accent-muted uppercase tracking-wide mb-1">
            Pick inversé recommandé
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
                <div className="text-xs text-slate-500">confiance inversée</div>
              </div>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Ce signal fade perd historiquement — mise sur l&apos;adversaire.
          </p>
        </div>
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
        {rec.historicalWinRate != null && (
          <span>
            Hist. {Math.round(rec.historicalWinRate * 100)}% WR
            {rec.historicalRoi != null && ` · ${rec.historicalRoi.toFixed(1)}u ROI`}
          </span>
        )}
        {rec.weeklyTrend && (
          <span title={`Tendance 4 semaines: ${trendLabel(rec.weeklyTrend)}`}>
            {trendArrow(rec.weeklyTrend)} {trendLabel(rec.weeklyTrend)}
          </span>
        )}
        {rec.gameTime && <span>Heure: {rec.gameTime}</span>}
        {rec.postingTime && <span>Publié: {rec.postingTime}</span>}
      </div>

      {rec.confidenceBreakdown?.length > 0 && (
        <details className="mb-3 group">
          <summary className="text-sm text-slate-400 cursor-pointer hover:text-slate-200 transition-colors">
            Détail confiance ({rec.confidenceBreakdown.length} facteurs)
          </summary>
          <ul className="mt-2 space-y-1.5 text-xs">
            {rec.confidenceBreakdown.map((item) => (
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

      <p className="text-sm text-slate-400 leading-relaxed">{rec.reasoning}</p>
    </article>
  );
}
