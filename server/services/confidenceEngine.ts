import type {
  CalendarGame,
  ConfidenceBreakdownItem,
  LeagueCode,
  MatchedRecommendation,
  SheetPick,
  SignalPolarity,
  SignalType,
} from "../types.js";
import type { ConfidenceStatsCache, CrossSignalRule } from "./historicalStats.js";
import { FADE_SIGNALS, SIGNAL_LABELS_FR } from "./signalMapping.js";

export interface ConfidenceInput {
  pick: SheetPick;
  matchedGame?: CalendarGame;
  stats: ConfidenceStatsCache;
  slatePicks: SheetPick[];
}

export interface ConfidenceResult {
  confidence: number;
  confidenceBreakdown: ConfidenceBreakdownItem[];
  opponentPick?: string;
  opponentConfidence?: number;
  signalPolarity: SignalPolarity;
  edgeLabel: string;
}

const ULTRA_NEGATIVE_ROI = -50;
const INVERT_FADE_ROI = -100;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function normalizeTeamName(text: string): string {
  return text
    .replace(/\s*[+-]?\d+\.?\d*\s*$/g, "")
    .replace(/\b(OVER|UNDER)\b.*/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function sportLeague(pick: SheetPick): string {
  const map: Partial<Record<LeagueCode, string>> = {
    MEGA_SHARPS: "MLB",
    WHALE: "MLB",
    MODEL: "MLB",
    RLM: "MLB",
  };
  return map[pick.league] || pick.league;
}

/** Group picks on same game (same row or same team matchup) */
function gameKey(pick: SheetPick): string {
  const league = sportLeague(pick);
  const team = normalizeTeamName(pick.pick);
  const opp = pick.opponent ? normalizeTeamName(pick.opponent) : "";
  if (opp) {
    const pair = [team, opp].sort().join("|");
    return `${league}:${pair}`;
  }
  return `${league}:row-${pick.rawRow}:${team}`;
}

function picksSameSide(a: SheetPick, b: SheetPick): boolean {
  const teamA = normalizeTeamName(a.pick);
  const teamB = normalizeTeamName(b.pick);
  if (teamA === teamB) return true;

  const oppA = a.opponent ? normalizeTeamName(a.opponent) : "";
  const oppB = b.opponent ? normalizeTeamName(b.opponent) : "";

  if (oppA && teamB === oppA) return false;
  if (oppB && teamA === oppB) return false;

  if (a.rawRow === b.rawRow && sportLeague(a) === sportLeague(b)) {
    return FADE_SIGNALS.has(a.signalType) === FADE_SIGNALS.has(b.signalType);
  }

  return false;
}

function roiToBaseConfidence(roi: number, winRate: number, sampleSize: number): number {
  const sampleWeight = clamp(Math.log10(Math.max(sampleSize, 1) + 1) / 2.5, 0.3, 1);
  const roiComponent = clamp(roi / 8, -30, 30);
  const wrComponent = (winRate - 0.5) * 40;
  return 50 + (roiComponent * 0.6 + wrComponent * 0.4) * sampleWeight;
}

function isUltraNegative(stats: ConfidenceStatsCache, signal: SignalType): boolean {
  const s = stats.signals[signal];
  return s.allTimeReturn < ULTRA_NEGATIVE_ROI || s.blendedRoi < -30;
}

function shouldInvert(stats: ConfidenceStatsCache, signal: SignalType): boolean {
  const s = stats.signals[signal];
  if (!FADE_SIGNALS.has(signal) && signal !== "whale_plays") return false;
  return s.allTimeReturn < INVERT_FADE_ROI || s.blendedRoi < -40;
}

function findCrossSignalAdjustments(
  pick: SheetPick,
  slatePicks: SheetPick[],
  rules: CrossSignalRule[]
): { delta: number; notes: string[] } {
  const key = gameKey(pick);
  const related = slatePicks.filter(
    (p) => p.id !== pick.id && (gameKey(p) === key || p.rawRow === pick.rawRow)
  );

  let delta = 0;
  const notes: string[] = [];

  for (const other of related) {
    for (const rule of rules) {
      const matchPair =
        (rule.signalA === pick.signalType && rule.signalB === other.signalType) ||
        (rule.signalB === pick.signalType && rule.signalA === other.signalType);
      if (!matchPair) continue;

      const sameSide = picksSameSide(pick, other);
      if (rule.sameSide === sameSide) {
        delta += rule.boost;
        notes.push(`${rule.label} (${rule.boost >= 0 ? "+" : ""}${rule.boost})`);
      } else if (rule.sameSide) {
        delta -= Math.abs(rule.boost) * 0.5;
        notes.push(`Conflit ${rule.label}`);
      }
    }

    if (
      pick.signalType !== other.signalType &&
      picksSameSide(pick, other)
    ) {
      const bothPositive =
        pick.signalType === "sharp_money" ||
        pick.signalType === "mega_sharps" ||
        other.signalType === "sharp_money" ||
        other.signalType === "mega_sharps";
      if (bothPositive) {
        delta += 8;
        notes.push("Confluence sharps (+8)");
      }
    }
  }

  return { delta: clamp(delta, -20, 20), notes: [...new Set(notes)] };
}

function extractOpponentName(pick: SheetPick, slatePicks: SheetPick[]): string | undefined {
  if (pick.opponent) {
    return pick.opponent.replace(/\s*[+-]?\d+\.?\d*\s*$/g, "").trim();
  }

  const team = normalizeTeamName(pick.pick);
  const sameRow = slatePicks.filter(
    (p) => p.rawRow === pick.rawRow && sportLeague(p) === sportLeague(pick) && p.id !== pick.id
  );

  for (const other of sameRow) {
    const otherTeam = normalizeTeamName(other.pick);
    if (otherTeam !== team) {
      return other.pick.replace(/\s*[+-]?\d+\.?\d*\s*$/g, "").trim();
    }
    if (other.opponent) {
      const opp = normalizeTeamName(other.opponent);
      if (opp !== team) {
        return other.opponent.replace(/\s*[+-]?\d+\.?\d*\s*$/g, "").trim();
      }
    }
  }

  return undefined;
}

function leagueModifier(
  stats: ConfidenceStatsCache,
  signal: SignalType,
  league: string
): number {
  const leagueStats = stats.signals[signal].byLeague[league];
  if (!leagueStats) return 0;
  const roi = leagueStats.allTimeReturn * 0.4 + leagueStats.recentReturn * 0.6;
  return clamp(roi / 20, -8, 8);
}

export function computeConfidence(input: ConfidenceInput): ConfidenceResult {
  const { pick, matchedGame, stats, slatePicks } = input;
  const signalStats = stats.signals[pick.signalType];
  const league = sportLeague(pick);
  const breakdown: ConfidenceBreakdownItem[] = [];

  let confidence = roiToBaseConfidence(
    signalStats.blendedRoi,
    signalStats.winRate,
    signalStats.sampleSize
  );

  breakdown.push({
    key: "signal_roi",
    label: `ROI historique ${SIGNAL_LABELS_FR[pick.signalType]}`,
    value: Math.round(signalStats.blendedRoi * 10) / 10,
    impact: Math.round((confidence - 50) * 10) / 10,
    detail: `${signalStats.wins}V-${signalStats.losses}D · ${Math.round(signalStats.winRate * 100)}%`,
  });

  const leagueMod = leagueModifier(stats, pick.signalType, league);
  if (Math.abs(leagueMod) >= 1) {
    confidence += leagueMod;
    breakdown.push({
      key: "league",
      label: `Performance ${league}`,
      value: leagueMod,
      impact: leagueMod,
    });
  }

  const recencyBoost = clamp(signalStats.recentReturn / 25, -6, 6);
  if (Math.abs(recencyBoost) >= 0.5) {
    confidence += recencyBoost;
    breakdown.push({
      key: "recency",
      label: "Poids récent (6 mois)",
      value: Math.round(signalStats.recentReturn * 10) / 10,
      impact: Math.round(recencyBoost * 10) / 10,
    });
  }

  const cross = findCrossSignalAdjustments(pick, slatePicks, stats.crossSignalRules);
  if (cross.delta !== 0) {
    confidence += cross.delta;
    breakdown.push({
      key: "cross_signal",
      label: "Croisement signaux (slate)",
      value: cross.delta,
      impact: cross.delta,
      detail: cross.notes.join(" · ") || undefined,
    });
  }

  if (matchedGame) {
    confidence += 5;
    breakdown.push({
      key: "match_quality",
      label: "Match ESPN confirmé",
      value: 1,
      impact: 5,
    });
  }

  let signalPolarity: SignalPolarity = signalStats.blendedRoi >= 0 ? "positive" : "negative";
  let opponentPick: string | undefined;
  let opponentConfidence: number | undefined;
  let edgeLabel = signalStats.blendedRoi >= 0 ? "Signal profitable" : "Signal faible";

  const inverted = shouldInvert(stats, pick.signalType);
  const ultraNeg = isUltraNegative(stats, pick.signalType);

  if (inverted && FADE_SIGNALS.has(pick.signalType)) {
    signalPolarity = "inverted";
    opponentPick = extractOpponentName(pick, slatePicks);

    const fadeConfidence = clamp(25 + signalStats.blendedRoi / 20, 10, 35);
    const invertBoost = clamp(70 - signalStats.blendedRoi / 15, 65, 92);

    breakdown.push({
      key: "inversion",
      label: "Inversion fade (ROI ultra-négatif)",
      value: signalStats.allTimeReturn,
      impact: fadeConfidence - confidence,
      detail: opponentPick
        ? `Jouer ${opponentPick} au lieu de fade`
        : "Fade historiquement perdant — inverser",
    });

    confidence = fadeConfidence;
    edgeLabel = "Fade à éviter — jouer l'adversaire";

    if (opponentPick) {
      opponentConfidence = Math.round(invertBoost);
      breakdown.push({
        key: "opponent_boost",
        label: `Pick inversé: ${opponentPick}`,
        value: invertBoost,
        impact: invertBoost - confidence,
      });
    }
  } else if (ultraNeg) {
    signalPolarity = "negative";
    confidence = clamp(confidence - 15, 15, 45);
    breakdown.push({
      key: "ultra_negative",
      label: "Signal ultra-négatif",
      value: signalStats.allTimeReturn,
      impact: -15,
    });
    edgeLabel = "Signal historiquement perdant";
  } else if (signalStats.blendedRoi > 20) {
    edgeLabel = "Argent intelligent";
    if (pick.signalType === "sharp_money" || pick.signalType === "mega_sharps") {
      edgeLabel = "Consensus sharps";
    }
  }

  confidence = Math.round(clamp(confidence, 0, 100));

  return {
    confidence,
    confidenceBreakdown: breakdown,
    opponentPick: inverted ? opponentPick : undefined,
    opponentConfidence: inverted ? opponentConfidence : undefined,
    signalPolarity,
    edgeLabel,
  };
}

export function applyConfidenceToRecommendation(
  rec: Omit<
    MatchedRecommendation,
    "confidence" | "confidenceBreakdown" | "opponentPick" | "opponentConfidence" | "signalPolarity" | "edgeLabel"
  > & { edgeLabel?: string },
  result: ConfidenceResult
): MatchedRecommendation {
  return {
    ...rec,
    confidence: result.confidence,
    confidenceBreakdown: result.confidenceBreakdown,
    opponentPick: result.opponentPick,
    opponentConfidence: result.opponentConfidence,
    signalPolarity: result.signalPolarity,
    edgeLabel: result.edgeLabel,
  };
}

/** Static baseline for before/after comparison */
export const LEGACY_SIGNAL_CONFIDENCE: Record<SignalType, number> = {
  sharp_money: 85,
  mega_sharps: 92,
  whale_plays: 88,
  model_best_values: 80,
  mega_rlm: 78,
  reverse_line_movement: 75,
  book_needs_fade: 70,
  square_fade: 65,
};
