import type {
  CalendarGame,
  ConfidenceBreakdownItem,
  DualFadeInfo,
  GameConsolidatedRecommendation,
  LeagueCode,
  MatchedRecommendation,
  SheetPick,
  SignalPolarity,
  SignalType,
} from "../types.js";
import type { ConfidenceStatsCache, CrossSignalRule } from "./historicalStats.js";
import {
  isHighConviction,
  kellyToConfidence,
  lookupPickStats,
  type FullHistoryStatsCache,
} from "./fullHistoryStats.js";
import {
  findDualFadePair,
  isOpposingDualFade,
  resolveDualFadeMatch,
  type DualFadeStatsCache,
} from "./dualFadeStats.js";
import {
  pickBelongsToGame,
  resolveGameTeamDisplay,
  validateRecommendedTeam,
} from "./calendar.js";
import { FADE_SIGNALS, SHARP_BET_SIGNALS, SIGNAL_LABELS } from "./signalMapping.js";

export interface ConfidenceInput {
  pick: SheetPick;
  matchedGame?: CalendarGame;
  stats: ConfidenceStatsCache;
  slatePicks: SheetPick[];
  fullHistory?: FullHistoryStatsCache;
}

export interface ConfidenceResult {
  confidence: number;
  confidenceBreakdown: ConfidenceBreakdownItem[];
  opponentPick?: string;
  opponentConfidence?: number;
  signalPolarity: SignalPolarity;
  edgeLabel: string;
  historicalWinRate?: number;
  historicalRoi?: number;
  weeklyTrend?: "up" | "down" | "flat";
  highConviction?: boolean;
}

const ULTRA_NEGATIVE_ROI = -50;
const INVERT_FADE_ROI = -100;
/** Heavy edge penalty so listed fade teams never win consolidation */
const FADE_TARGET_EDGE_PENALTY = 250;

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

function displayTeamName(text: string): string {
  return text.replace(/\s*[+-]?\d+\.?\d*\s*$/g, "").replace(/\s+/g, " ").trim();
}

/** Group picks on same game (ESPN id, team pair, or VS slot within a sheet row) */
export function buildGameKey(
  pick: SheetPick,
  slatePicks?: SheetPick[],
  matchedGame?: CalendarGame
): string {
  const league = sportLeague(pick);

  if (matchedGame) {
    return `${league}:espn-${matchedGame.id}`;
  }

  const team = normalizeTeamName(pick.pick);
  let opp = pick.opponent ? normalizeTeamName(pick.opponent) : "";

  if (!opp && slatePicks) {
    const oppName = extractOpponentName(pick, slatePicks);
    if (oppName) opp = normalizeTeamName(oppName);
  }

  if (opp) {
    return `${league}:${[team, opp].sort().join("|")}`;
  }

  if (slatePicks && pick.gameSlot != null) {
    const slotPeers = slatePicks.filter(
      (p) =>
        p.rawRow === pick.rawRow &&
        p.gameSlot === pick.gameSlot &&
        sportLeague(p) === league &&
        p.id !== pick.id &&
        !p.line
    );
    const teams = [team, ...slotPeers.map((p) => normalizeTeamName(p.pick))].sort();
    if (teams.length >= 2) {
      return `${league}:row-${pick.rawRow}:slot-${pick.gameSlot}:${teams[0]}|${teams[1]}`;
    }
    return `${league}:row-${pick.rawRow}:slot-${pick.gameSlot}:${team}`;
  }

  return `${league}:pick-${pick.id}`;
}

/** @deprecated use buildGameKey — kept for internal cross-signal lookups */
function gameKey(pick: SheetPick, slatePicks?: SheetPick[]): string {
  return buildGameKey(pick, slatePicks);
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

function bayesianWinRate(wins: number, losses: number): number {
  const priorW = 5;
  const priorL = 5;
  return (wins + priorW) / (wins + losses + priorW + priorL);
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
  const key = gameKey(pick, slatePicks);
  const related = slatePicks.filter(
    (p) =>
      p.id !== pick.id &&
      gameKey(p, slatePicks) === key &&
      (pick.gameSlot == null || p.gameSlot === pick.gameSlot)
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
    (p) =>
      p.rawRow === pick.rawRow &&
      sportLeague(p) === sportLeague(pick) &&
      p.id !== pick.id &&
      (pick.gameSlot == null || p.gameSlot === pick.gameSlot)
  );

  for (const other of sameRow) {
    if (other.opponent && normalizeTeamName(other.opponent) === team) {
      return other.pick.replace(/\s*[+-]?\d+\.?\d*\s*$/g, "").trim();
    }
    if (pick.opponent && normalizeTeamName(other.pick) === normalizeTeamName(pick.opponent)) {
      return other.pick.replace(/\s*[+-]?\d+\.?\d*\s*$/g, "").trim();
    }
  }

  return undefined;
}

function leagueModifier(
  stats: ConfidenceStatsCache,
  signal: SignalType,
  league: string,
  fullHistory?: FullHistoryStatsCache
): number {
  if (fullHistory) {
    const ls = fullHistory.signals[signal].byLeague[league];
    if (ls) {
      const roi = ls.allTimeRoi * 0.25 + ls.last4Weeks.returnUnits * 0.45 + ls.mtd.returnUnits * 0.3;
      const trendBoost = ls.weeklyTrend === "up" ? 3 : ls.weeklyTrend === "down" ? -4 : 0;
      return clamp(roi / 18 + trendBoost, -12, 12);
    }
  }
  const leagueStats = stats.signals[signal].byLeague[league];
  if (!leagueStats) return 0;
  const roi = leagueStats.allTimeReturn * 0.4 + leagueStats.recentReturn * 0.6;
  return clamp(roi / 20, -8, 8);
}

function temporalModifier(fullHistory: FullHistoryStatsCache, signal: SignalType, league: string): number {
  const profile = fullHistory.signals[signal];
  const ls = profile.byLeague[league];
  const last4 = ls?.last4Weeks ?? {
    returnUnits: profile.last4WeeksRoi,
    winRate: profile.bayesianWinRate,
  };
  const recentBoost = clamp(last4.returnUnits / 15, -8, 8);
  const trendBoost =
    (ls?.weeklyTrend ?? profile.weeklyTrend) === "up"
      ? 5
      : (ls?.weeklyTrend ?? profile.weeklyTrend) === "down"
        ? -6
        : 0;
  return recentBoost + trendBoost;
}

function toxicComboPenalty(fullHistory: FullHistoryStatsCache, signal: SignalType, league: string): number {
  const toxic = fullHistory.toxicCombos.some(
    (c) => c.signalType === signal && c.league === league && c.blendedRoi < -20
  );
  return toxic ? -12 : 0;
}

function profitableComboBoost(fullHistory: FullHistoryStatsCache, signal: SignalType, league: string): number {
  const match = fullHistory.profitableCombos.find(
    (c) => c.signalType === signal && c.league === league && c.blendedRoi > 5
  );
  if (!match) return 0;
  return clamp(Math.round(match.blendedRoi / 20), 4, 10);
}

export function computeConfidence(input: ConfidenceInput): ConfidenceResult {
  const { pick, matchedGame, stats, slatePicks, fullHistory } = input;
  const signalStats = stats.signals[pick.signalType];
  const league = sportLeague(pick);
  const breakdown: ConfidenceBreakdownItem[] = [];

  const pickStats = fullHistory ? lookupPickStats(fullHistory, pick.signalType, league) : null;
  const bayesianWr =
    pickStats && "bayesianWinRate" in pickStats
      ? pickStats.bayesianWinRate
      : bayesianWinRate(signalStats.wins, signalStats.losses);
  const kelly =
    pickStats && "kellyEdge" in pickStats
      ? pickStats.kellyEdge
      : (bayesianWr - 0.524) * 2;

  let confidence = fullHistory
    ? kellyToConfidence(kelly, bayesianWr)
    : roiToBaseConfidence(signalStats.blendedRoi, signalStats.winRate, signalStats.sampleSize);

  breakdown.push({
    key: "signal_roi",
    label: `ROI historique ${SIGNAL_LABELS[pick.signalType]}`,
    value: Math.round(signalStats.blendedRoi * 10) / 10,
    impact: Math.round((confidence - 50) * 10) / 10,
    detail: `${signalStats.wins}V-${signalStats.losses}D · ${Math.round(bayesianWr * 100)}% (Bayesian)`,
  });

  if (fullHistory && pickStats) {
    const histRoi =
      "blendedRoi" in pickStats ? pickStats.blendedRoi : fullHistory.signals[pick.signalType].blendedRoi;
    const histWr =
      "bayesianWinRate" in pickStats
        ? pickStats.bayesianWinRate
        : fullHistory.signals[pick.signalType].bayesianWinRate;
    breakdown.push({
      key: "full_history",
      label: `Base multi-couches ${league}`,
      value: Math.round(histRoi * 10) / 10,
      impact: Math.round(kellyToConfidence(kelly, histWr) - confidence),
      detail: `All-time ${Math.round(("allTimeRoi" in pickStats ? pickStats.allTimeRoi : histRoi) * 10) / 10}u · 4 sem. ${Math.round(("last4Weeks" in pickStats ? pickStats.last4Weeks.returnUnits : fullHistory.signals[pick.signalType].last4WeeksRoi) * 10) / 10}u`,
    });
  }

  const leagueMod = leagueModifier(stats, pick.signalType, league, fullHistory);
  if (Math.abs(leagueMod) >= 1) {
    confidence += leagueMod;
    breakdown.push({
      key: "league",
      label: `Performance ${league}`,
      value: leagueMod,
      impact: leagueMod,
    });
  }

  if (fullHistory) {
    const temporal = temporalModifier(fullHistory, pick.signalType, league);
    if (Math.abs(temporal) >= 0.5) {
      confidence += temporal;
      const trend = fullHistory.signals[pick.signalType].byLeague[league]?.weeklyTrend ??
        fullHistory.signals[pick.signalType].weeklyTrend;
      breakdown.push({
        key: "temporal",
        label: "Tendance 4 semaines",
        value: temporal,
        impact: temporal,
        detail: trend === "up" ? "↑ amélioration" : trend === "down" ? "↓ déclin" : "→ stable",
      });
    }

    const toxic = toxicComboPenalty(fullHistory, pick.signalType, league);
    if (toxic) {
      confidence += toxic;
      breakdown.push({
        key: "toxic_combo",
        label: "Combo historiquement toxique",
        value: toxic,
        impact: toxic,
      });
    }

    const profitBoost = profitableComboBoost(fullHistory, pick.signalType, league);
    if (profitBoost) {
      confidence += profitBoost;
      breakdown.push({
        key: "profitable_combo",
        label: "Combo profitable",
        value: profitBoost,
        impact: profitBoost,
      });
    }
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

  // Rule: Book Needs / Square Top list the public side → always bet the opponent
  if (FADE_SIGNALS.has(pick.signalType)) {
    opponentPick = extractOpponentName(pick, slatePicks);
    if (opponentPick) {
      signalPolarity = "inverted";
      // Fixed inverse confidence — historical ROI on the fade column must not dilute this rule
      opponentConfidence = Math.round(clamp(76 + Math.min(Math.abs(signalStats.blendedRoi), 40) / 50, 74, 85));
      confidence = opponentConfidence;
      edgeLabel =
        pick.signalType === "book_needs_fade"
          ? "Book Needs → jouer l'adversaire"
          : "Square Top → jouer l'adversaire";
      breakdown.push({
        key: "fade_inverse",
        label: "Règle fade",
        value: 1,
        impact: opponentConfidence - 50,
        detail: `${displayTeamName(pick.pick)} listé → jouer ${displayTeamName(opponentPick)}`,
      });
    } else {
      signalPolarity = "negative";
      confidence = Math.round(clamp(confidence, 18, 38));
      edgeLabel = "Fade sans adversaire identifié";
      breakdown.push({
        key: "fade_no_opponent",
        label: "Fade incomplet",
        value: 0,
        impact: -12,
        detail: "Adversaire non trouvé sur la feuille",
      });
    }
  } else if (SHARP_BET_SIGNALS.has(pick.signalType)) {
    // Rule: Sharp Money → always bet the listed team
    signalPolarity = "positive";
    confidence = Math.round(clamp(Math.max(confidence, 80), 78, 95));
    edgeLabel = "Sharp Money — jouer cette équipe";
    breakdown.push({
      key: "sharp_follow",
      label: "Règle Sharp Money",
      value: 1,
      impact: confidence - 50,
      detail: `Jouer ${displayTeamName(pick.pick)}`,
    });
  } else {
    const inverted = shouldInvert(stats, pick.signalType);
    const ultraNeg = isUltraNegative(stats, pick.signalType);

    if (inverted && pick.signalType === "whale_plays") {
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
    }
  }

  confidence = Math.round(clamp(confidence, 0, 100));

  const weeklyTrend =
    fullHistory?.signals[pick.signalType].byLeague[league]?.weeklyTrend ??
    fullHistory?.signals[pick.signalType].weeklyTrend;
  const historicalWinRate = bayesianWr;
  const historicalRoi =
    pickStats && "blendedRoi" in pickStats
      ? pickStats.blendedRoi
      : signalStats.blendedRoi;
  const highConviction = fullHistory
    ? isHighConviction(fullHistory, pick.signalType, league)
    : false;

  if (highConviction && !FADE_SIGNALS.has(pick.signalType)) {
    breakdown.push({
      key: "high_conviction",
      label: "Haute conviction",
      value: 1,
      impact: 6,
      detail: "Tendance hebdo + all-time alignés",
    });
    confidence = Math.round(clamp(confidence + 6, 0, 100));
  }

  return {
    confidence,
    confidenceBreakdown: breakdown,
    opponentPick: signalPolarity === "inverted" ? opponentPick : undefined,
    opponentConfidence: signalPolarity === "inverted" ? opponentConfidence : undefined,
    signalPolarity,
    edgeLabel: highConviction ? `${edgeLabel} · Haute conviction` : edgeLabel,
    historicalWinRate,
    historicalRoi,
    weeklyTrend,
    highConviction,
  };
}

export function applyConfidenceToRecommendation(
  rec: Omit<
    MatchedRecommendation,
    | "confidence"
    | "confidenceBreakdown"
    | "opponentPick"
    | "opponentConfidence"
    | "signalPolarity"
    | "edgeLabel"
    | "historicalWinRate"
    | "historicalRoi"
    | "weeklyTrend"
    | "highConviction"
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
    historicalWinRate: result.historicalWinRate,
    historicalRoi: result.historicalRoi,
    weeklyTrend: result.weeklyTrend,
    highConviction: result.highConviction,
  };
}

// ---------------------------------------------------------------------------
// GAME-LEVEL CONFLICT RESOLUTION
// ---------------------------------------------------------------------------
//
// Rules (applied per matchup when 2+ picks share the same gameKey):
//
// 1. Book Needs / Square Top — sheet lists the public side → bet the opponent.
// 2. Sharp Money — always bet the listed team.
// 3. Opposing dual-fade (Book Needs on one side, Square Top on the other) → NO BET.
// 4. Sharp Money takes priority when consolidating multiple signals on a game.
// 5. Standalone single fade → bet the opponent when VS opponent is known.
// ---------------------------------------------------------------------------

interface TeamEdgeContribution {
  pickId: string;
  signalType: SignalType;
  teamNorm: string;
  teamDisplay: string;
  edge: number;
  note: string;
}

function signalSampleWeight(stats: ConfidenceStatsCache, signal: SignalType): number {
  const s = stats.signals[signal];
  return clamp(Math.log10(Math.max(s.sampleSize, 1) + 1) / 2.5, 0.3, 1);
}

function signalRoiWeight(stats: ConfidenceStatsCache, signal: SignalType): number {
  const s = stats.signals[signal];
  return clamp(Math.abs(s.blendedRoi) / 150, 0.5, 1.5);
}

function invertBoostForSignal(stats: ConfidenceStatsCache, signal: SignalType): number {
  const s = stats.signals[signal];
  return clamp(70 - s.blendedRoi / 15, 65, 92);
}

/** Teams listed in Book Needs / Square Top for a matchup — always negative EV */
export function collectFadeTargetsForGame(
  recs: MatchedRecommendation[],
  slatePicks?: SheetPick[],
  matchedGame?: CalendarGame
): Map<string, string> {
  const targets = new Map<string, string>();

  const addTarget = (team: string) => {
    const norm = normalizeTeamName(team);
    if (norm) targets.set(norm, displayTeamName(team));
  };

  for (const rec of recs) {
    if (rec.line) continue;
    if (FADE_SIGNALS.has(rec.signalType)) addTarget(rec.pick);
  }

  if (slatePicks?.length && matchedGame && recs.length > 0) {
    const league = sportLeagueFromRec(recs[0]);
    for (const p of slatePicks) {
      if (!FADE_SIGNALS.has(p.signalType) || p.line) continue;
      if (p.league !== league && p.league !== "UNKNOWN") continue;
      if (pickBelongsToGame(p.pick, p.opponent, matchedGame)) addTarget(p.pick);
    }
  }

  return targets;
}

function opponentOfTeamInGame(
  teamNorm: string,
  game: CalendarGame
): { norm: string; display: string } | null {
  const awayNorm = normalizeTeamName(game.awayTeam);
  const homeNorm = normalizeTeamName(game.homeTeam);

  if (teamNorm === awayNorm) {
    return { norm: homeNorm, display: game.homeTeam };
  }
  if (teamNorm === homeNorm) {
    return { norm: awayNorm, display: game.awayTeam };
  }

  const resolvedAway = resolveGameTeamDisplay(teamNorm, game);
  if (resolvedAway) {
    const resolvedNorm = normalizeTeamName(resolvedAway);
    if (resolvedNorm === awayNorm) return { norm: homeNorm, display: game.homeTeam };
    if (resolvedNorm === homeNorm) return { norm: awayNorm, display: game.awayTeam };
  }

  return null;
}

function effectiveTeamForRec(rec: MatchedRecommendation): {
  teamNorm: string;
  teamDisplay: string;
} | null {
  if (rec.line) return null;

  if (FADE_SIGNALS.has(rec.signalType)) {
    const opp = rec.opponentPick ?? rec.opponent;
    if (opp) {
      return {
        teamNorm: normalizeTeamName(opp),
        teamDisplay: displayTeamName(opp),
      };
    }
    return null;
  }

  if (rec.signalPolarity === "inverted" && rec.opponentPick) {
    return {
      teamNorm: normalizeTeamName(rec.opponentPick),
      teamDisplay: displayTeamName(rec.opponentPick),
    };
  }

  return {
    teamNorm: normalizeTeamName(rec.pick),
    teamDisplay: displayTeamName(rec.pick),
  };
}

function contributionForRec(
  rec: MatchedRecommendation,
  stats: ConfidenceStatsCache,
  fadeTargets: Set<string>
): TeamEdgeContribution | null {
  const team = effectiveTeamForRec(rec);
  if (!team) return null;

  const sampleW = signalSampleWeight(stats, rec.signalType);
  const roiW = signalRoiWeight(stats, rec.signalType);
  const weight = sampleW * roiW;

  let edge: number;
  let note: string;

  if (!FADE_SIGNALS.has(rec.signalType) && fadeTargets.has(team.teamNorm)) {
    edge = -rec.confidence * 0.9 * weight;
    note = `${SIGNAL_LABELS[rec.signalType]} sur cible fade ${team.teamDisplay} (${Math.round(edge)})`;
  } else if (rec.signalPolarity === "inverted") {
    const boost = rec.opponentConfidence ?? invertBoostForSignal(stats, rec.signalType);
    edge = boost * weight;
    note = `${SIGNAL_LABELS[rec.signalType]} fade → ${team.teamDisplay} (+${Math.round(edge)})`;
  } else if (rec.signalPolarity === "positive") {
    edge = rec.confidence * 0.55 * weight;
    note = `${SIGNAL_LABELS[rec.signalType]} → ${team.teamDisplay} (+${Math.round(edge)})`;
  } else {
    edge = rec.confidence * 0.2 * weight;
    note = `${SIGNAL_LABELS[rec.signalType]} (faible) → ${team.teamDisplay}`;
  }

  return {
    pickId: rec.id,
    signalType: rec.signalType,
    teamNorm: team.teamNorm,
    teamDisplay: team.teamDisplay,
    edge,
    note,
  };
}

function applyGameCrossSignalRules(
  contributions: TeamEdgeContribution[],
  fadeTargets: Set<string>
): { edgeDelta: Map<string, number>; notes: string[]; dampenConfidence: boolean } {
  const edgeDelta = new Map<string, number>();
  const notes: string[] = [];
  let dampenConfidence = false;

  const signals = new Set(contributions.map((c) => c.signalType));
  const hasBook = signals.has("book_needs_fade");
  const hasSquare = signals.has("square_fade");
  const teamsSupported = new Set(contributions.map((c) => c.teamNorm));

  if (hasBook && hasSquare && teamsSupported.size > 1) {
    notes.push("Book Needs + Square Top sur côtés opposés — pas de pari");
    dampenConfidence = true;
  }

  const sharpTypes: SignalType[] = ["sharp_money", "mega_sharps"];
  const fades = contributions.filter((c) => FADE_SIGNALS.has(c.signalType));
  const sharps = contributions.filter((c) => sharpTypes.includes(c.signalType));

  for (const sharp of sharps) {
    if (fadeTargets.has(sharp.teamNorm)) {
      edgeDelta.set(sharp.teamNorm, (edgeDelta.get(sharp.teamNorm) ?? 0) - 40);
      notes.push(`Sharp sur cible fade ${sharp.teamDisplay} — signal ignoré`);
      continue;
    }
    for (const fade of fades) {
      if (sharp.teamNorm === fade.teamNorm) {
        edgeDelta.set(sharp.teamNorm, (edgeDelta.get(sharp.teamNorm) ?? 0) + 12);
        notes.push(`Confluence sharp+fade → ${sharp.teamDisplay} (+12)`);
      } else {
        notes.push(`Sharp vs fade opposés (${sharp.teamDisplay} vs ${fade.teamDisplay})`);
      }
    }
  }

  return { edgeDelta, notes: [...new Set(notes)], dampenConfidence };
}

function applyFadeTargetPenalties(
  teamEdges: Map<string, { edge: number; display: string; notes: string[] }>,
  fadeTargets: Map<string, string>
): void {
  for (const [norm, display] of fadeTargets) {
    const existing = teamEdges.get(norm) ?? { edge: 0, display, notes: [] };
    existing.edge -= FADE_TARGET_EDGE_PENALTY;
    existing.notes.push(`${display} listé en fade — EV négatif`);
    teamEdges.set(norm, existing);
  }
}

function enforceFadeTargetWinner(
  winnerNorm: string,
  winnerDisplay: string,
  fadeTargets: Map<string, string>,
  matchedGame?: CalendarGame,
  recs?: MatchedRecommendation[]
): { norm: string; display: string; flipped: boolean } {
  if (!fadeTargets.has(winnerNorm)) {
    return { norm: winnerNorm, display: winnerDisplay, flipped: false };
  }

  if (matchedGame) {
    const opp = opponentOfTeamInGame(winnerNorm, matchedGame);
    if (opp) {
      return { norm: opp.norm, display: opp.display, flipped: true };
    }
  }

  if (recs) {
    for (const rec of recs) {
      if (!FADE_SIGNALS.has(rec.signalType)) continue;
      if (normalizeTeamName(rec.pick) !== winnerNorm) continue;
      const opp = rec.opponentPick ?? rec.opponent;
      if (opp) {
        return {
          norm: normalizeTeamName(opp),
          display: displayTeamName(opp),
          flipped: true,
        };
      }
    }
  }

  return { norm: winnerNorm, display: winnerDisplay, flipped: false };
}

function matchupLabels(
  recs: MatchedRecommendation[]
): { awayTeam: string; homeTeam: string } {
  const game = recs.find((r) => r.matchedGame)?.matchedGame;
  if (game) {
    return { awayTeam: game.awayTeam, homeTeam: game.homeTeam };
  }

  const teams = new Set<string>();
  for (const rec of recs) {
    if (rec.line) continue;
    teams.add(displayTeamName(rec.pick));
    if (rec.opponent) teams.add(displayTeamName(rec.opponent));
    if (rec.opponentPick) teams.add(displayTeamName(rec.opponentPick));
  }
  const list = [...teams].slice(0, 2);
  return {
    awayTeam: list[0] ?? "Équipe A",
    homeTeam: list[1] ?? "Équipe B",
  };
}

function sportLeagueFromRec(rec: MatchedRecommendation): string {
  const map: Partial<Record<LeagueCode, string>> = {
    MEGA_SHARPS: "MLB",
    WHALE: "MLB",
    MODEL: "MLB",
    RLM: "MLB",
  };
  return map[rec.league] || rec.league;
}

const PREMIUM_LEAGUES = new Set<LeagueCode>(["MEGA_SHARPS", "WHALE", "MODEL", "RLM"]);

function filterRecsForGame(recs: MatchedRecommendation[]): MatchedRecommendation[] {
  const game = recs.find((r) => r.matchedGame)?.matchedGame;
  if (!game) return recs;

  return recs.filter((rec) => {
    if (!rec.matchedGame) return false;
    if (rec.matchedGame.id !== game.id) return false;
    if (rec.matchedGame.league !== game.league) return false;
    if (!PREMIUM_LEAGUES.has(rec.league) && sportLeagueFromRec(rec) !== game.league) {
      return false;
    }
    return pickBelongsToGame(rec.pick, rec.opponent, game);
  });
}

function clampWinnerToGame(
  winnerDisplay: string,
  winnerNorm: string,
  game: CalendarGame | undefined
): { display: string; norm: string } {
  if (!game) return { display: winnerDisplay, norm: winnerNorm };

  const resolved = resolveGameTeamDisplay(winnerDisplay, game);
  if (resolved) {
    return { display: resolved, norm: normalizeTeamName(resolved) };
  }
  return { display: winnerDisplay, norm: winnerNorm };
}

function buildOpposingDualFadeNoBet(
  gameKey: string,
  recs: MatchedRecommendation[],
  bookPick: SheetPick,
  squarePick: SheetPick,
  matchedGame?: CalendarGame
): { consolidated: GameConsolidatedRecommendation; updatedRecs: MatchedRecommendation[] } {
  const resolution =
    resolveDualFadeMatch(bookPick, squarePick, {
      computedAt: "",
      archiveDays: 0,
      historicalSample: {
        weeks: 0,
        months: 0,
        archiveDays: 0,
        recentDualActiveDays: 0,
        totalPicksTracked: 0,
        totalDataPoints: 0,
      },
      tracker: {
        bookNeedsAllTimeRoi: 0,
        squareAllTimeRoi: 0,
        bookNeedsBlendedRoi: 0,
        squareBlendedRoi: 0,
        roiGap: 0,
      },
      coOccurrence: {
        dualActiveDays: 0,
        dualPositiveDays: 0,
        dualNegativeDays: 0,
        combinedWinRate: 0.5,
        bookOutperformedSquareDays: 0,
        squareOutperformedBookDays: 0,
      },
      archiveTrend: {
        bookInverseWinRate: 0.5,
        squareInverseWinRate: 0.5,
        resolutionRule: "",
        sampleSize: 0,
      },
      byLeague: {},
    }, sportLeagueFromRec(recs[0]))!;

  const { awayTeam, homeTeam } = matchupLabels(recs);
  const noBetReason = resolution.reasoning;

  const consolidated: GameConsolidatedRecommendation = {
    gameKey,
    league: recs[0].league,
    awayTeam,
    homeTeam,
    recommendedTeam: "",
    confidence: 0,
    noBet: true,
    noBetReason,
    confidenceBreakdown: [
      {
        key: "no_bet_dual_fade",
        label: "Pas de pari",
        value: 0,
        impact: 0,
        detail: noBetReason,
      },
    ],
    hasConflict: true,
    pickIds: recs.map((r) => r.id),
    reasoning: `Match: ${awayTeam} @ ${homeTeam} · ${noBetReason}`,
    matchedGame,
    dualFade: {
      isDualFade: true,
      isOpposingNoBet: true,
      bookNeedsFadeTeam: resolution.bookNeedsFadeTeam,
      squareFadeTeam: resolution.squareFadeTeam,
    },
  };

  const updatedRecs = recs.map((rec) => ({
    ...rec,
    gameKey,
    gameConflict: true,
    conflictNote: "Dual-fade opposé — pas de pari",
    consolidatedTeam: undefined,
    consolidatedConfidence: 0,
    edgeLabel: "Pas de pari — signaux contradictoires",
  }));

  return { consolidated, updatedRecs };
}

function resolveSingleGame(
  gameKey: string,
  recs: MatchedRecommendation[],
  stats: ConfidenceStatsCache,
  dualStats?: DualFadeStatsCache,
  slatePicks?: SheetPick[]
): { consolidated: GameConsolidatedRecommendation; updatedRecs: MatchedRecommendation[] } {
  recs = filterRecsForGame(recs);

  const matchedGame = recs.find((r) => r.matchedGame)?.matchedGame;

  if (slatePicks?.length && matchedGame) {
    const league = sportLeagueFromRec(recs[0]);
    const pair = findDualFadePair(slatePicks, league, {
      homeTeam: matchedGame.homeTeam,
      awayTeam: matchedGame.awayTeam,
    });
    if (pair.book && pair.square && isOpposingDualFade(pair.book, pair.square)) {
      return buildOpposingDualFadeNoBet(gameKey, recs, pair.book, pair.square, matchedGame);
    }
  }

  const fadeTargets = collectFadeTargetsForGame(recs, slatePicks, matchedGame);
  const fadeTargetNorms = new Set(fadeTargets.keys());

  const contributions = recs
    .map((r) => contributionForRec(r, stats, fadeTargetNorms))
    .filter((c): c is TeamEdgeContribution => c != null);

  const teamEdges = new Map<string, { edge: number; display: string; notes: string[] }>();

  for (const c of contributions) {
    const existing = teamEdges.get(c.teamNorm) ?? { edge: 0, display: c.teamDisplay, notes: [] };
    existing.edge += c.edge;
    existing.notes.push(c.note);
    teamEdges.set(c.teamNorm, existing);
  }

  applyFadeTargetPenalties(teamEdges, fadeTargets);

  const cross = applyGameCrossSignalRules(contributions, fadeTargetNorms);
  for (const [team, delta] of cross.edgeDelta) {
    const existing = teamEdges.get(team);
    if (existing) existing.edge += delta;
  }

  const sorted = [...teamEdges.entries()].sort((a, b) => b[1].edge - a[1].edge);
  let winnerEntry = sorted[0];
  const runnerUp = sorted[1];
  let winnerNorm = winnerEntry?.[0] ?? "";
  let winnerDisplay = winnerEntry?.[1].display ?? "";
  let winnerEdge = winnerEntry?.[1].edge ?? 0;
  const runnerEdge = runnerUp?.[1].edge ?? 0;
  let margin = winnerEdge - runnerEdge;
  const maxEdge = Math.max(winnerEdge, 1);

  const teamsSupported = new Set(contributions.map((c) => c.teamNorm));
  const hasConflict = recs.length > 1 && teamsSupported.size > 1;

  let dualFadeInfo: DualFadeInfo | undefined;
  let dualFadeReasoning = "";
  let dualFadeConfidence: number | undefined;

  if (dualStats && slatePicks?.length && matchedGame) {
    const league = sportLeagueFromRec(recs[0]);
    const pair = findDualFadePair(slatePicks, league, {
      homeTeam: matchedGame.homeTeam,
      awayTeam: matchedGame.awayTeam,
    });
    const resolution = resolveDualFadeMatch(pair.book, pair.square, dualStats, league);

    if (resolution?.isStandalone && recs.length === 1) {
      const clamped = clampWinnerToGame(
        resolution.recommendedSide,
        resolution.recommendedSideNorm,
        matchedGame
      );
      winnerNorm = clamped.norm;
      winnerDisplay = clamped.display;
      winnerEdge = resolution.confidence;
      margin = resolution.confidence;
      dualFadeReasoning = resolution.reasoning;
      dualFadeConfidence = resolution.confidence;
      dualFadeInfo = {
        isDualFade: false,
        strongerFadeColumn: resolution.strongerFadeColumn,
        archiveWinRate: resolution.archiveWinRate,
      };
    }
  }

  const sharpRecs = recs.filter((r) => SHARP_BET_SIGNALS.has(r.signalType) && !r.line);
  if (sharpRecs.length > 0) {
    const sharpSide = effectiveTeamForRec(sharpRecs[0]);
    if (sharpSide && !fadeTargetNorms.has(sharpSide.teamNorm)) {
      const clamped = clampWinnerToGame(sharpSide.teamDisplay, sharpSide.teamNorm, matchedGame);
      winnerNorm = clamped.norm;
      winnerDisplay = clamped.display;
      winnerEdge = Math.max(winnerEdge, 84);
      margin = Math.max(margin, 20);
    }
  }

  const enforced = enforceFadeTargetWinner(
    winnerNorm,
    winnerDisplay,
    fadeTargets,
    matchedGame,
    recs
  );
  if (enforced.flipped) {
    const clamped = clampWinnerToGame(enforced.display, enforced.norm, matchedGame);
    winnerNorm = clamped.norm;
    winnerDisplay = clamped.display;
    winnerEdge = Math.max(winnerEdge, 72);
    margin = Math.max(margin, 15);
  }

  let confidence = clamp(55 + (margin / maxEdge) * 35, 52, 88);
  if (dualFadeConfidence != null) {
    confidence = dualFadeConfidence;
  } else if (sharpRecs.length > 0) {
    confidence = Math.round(clamp(82 + sharpRecs.length * 2, 82, 92));
  } else if (cross.dampenConfidence && margin / maxEdge < 0.2) {
    confidence = clamp(confidence - 12, 50, 72);
  } else if (hasConflict && margin / maxEdge < 0.08) {
    confidence = clamp(confidence - 10, 50, 65);
  }
  confidence = Math.round(confidence);

  if (matchedGame && !validateRecommendedTeam(winnerDisplay, matchedGame)) {
    const { awayTeam, homeTeam } = matchupLabels(recs);
    const noBetReason = `${winnerDisplay} ne fait pas partie de ${awayTeam} @ ${homeTeam}`;
    const consolidated: GameConsolidatedRecommendation = {
      gameKey,
      league: recs[0].league,
      awayTeam,
      homeTeam,
      recommendedTeam: "",
      confidence: 0,
      noBet: true,
      noBetReason,
      confidenceBreakdown: [
        {
          key: "invalid_team",
          label: "Équipe invalide pour ce match",
          value: 0,
          impact: 0,
          detail: noBetReason,
        },
      ],
      hasConflict: true,
      pickIds: recs.map((r) => r.id),
      reasoning: `Match: ${awayTeam} @ ${homeTeam} · ${noBetReason}`,
      matchedGame,
    };

    const updatedRecs = recs.map((rec) => ({
      ...rec,
      gameKey,
      gameConflict: true,
      conflictNote: "Équipe hors match — pas de pari",
      consolidatedTeam: undefined,
      consolidatedConfidence: 0,
      edgeLabel: "Pas de pari — équipe invalide",
    }));

    return { consolidated, updatedRecs };
  }

  const { awayTeam, homeTeam } = matchupLabels(recs);
  const breakdown: ConfidenceBreakdownItem[] = [
    {
      key: "game_net_edge",
      label: dualFadeInfo?.isDualFade ? "Résolution dual-fade" : `Edge net — ${winnerDisplay}`,
      value: Math.round(winnerEdge * 10) / 10,
      impact: confidence - 50,
      detail: sorted.map(([t, v]) => `${v.display}: ${Math.round(v.edge)}`).join(" · "),
    },
  ];

  if (dualFadeInfo?.isDualFade) {
    breakdown.push({
      key: "dual_fade_dynamic",
      label: "Dynamique dual-fade",
      value: dualFadeInfo.archiveWinRate ?? 0,
      impact: confidence - 55,
      detail: dualFadeReasoning,
    });
  }

  if (cross.notes.length > 0) {
    breakdown.push({
      key: "game_cross_signal",
      label: "Règles croisées (match)",
      value: cross.notes.length,
      impact: 0,
      detail: cross.notes.join(" · "),
    });
  }

  for (const c of contributions) {
    breakdown.push({
      key: `pick_${c.pickId}`,
      label: SIGNAL_LABELS[c.signalType],
      value: Math.round(c.edge * 10) / 10,
      impact: Math.round(c.edge),
      detail: c.note,
    });
  }

  const reasoningParts = [
    `Match: ${awayTeam} @ ${homeTeam}`,
    `Recommandation: ${winnerDisplay} (${confidence}%)`,
    ...(dualFadeReasoning ? [dualFadeReasoning] : []),
    ...contributions.map((c) => c.note),
    ...(cross.notes.length ? [`Règles: ${cross.notes.join("; ")}`] : []),
  ];

  const consolidated: GameConsolidatedRecommendation = {
    gameKey,
    league: recs[0].league,
    awayTeam,
    homeTeam,
    recommendedTeam: winnerDisplay,
    confidence,
    confidenceBreakdown: breakdown,
    hasConflict: hasConflict || !!dualFadeInfo?.isDualFade,
    pickIds: recs.map((r) => r.id),
    reasoning: reasoningParts.join(" · "),
    matchedGame: recs.find((r) => r.matchedGame)?.matchedGame,
    dualFade: dualFadeInfo,
    highConviction: recs.some((r) => r.highConviction),
    historicalWinRate: recs.find((r) => r.highConviction)?.historicalWinRate ?? recs[0]?.historicalWinRate,
    historicalRoi: recs.find((r) => r.highConviction)?.historicalRoi ?? recs[0]?.historicalRoi,
    weeklyTrend: recs.find((r) => r.weeklyTrend === "up")?.weeklyTrend ?? recs[0]?.weeklyTrend,
  };

  const updatedRecs = recs.map((rec) => {
    const standalone =
      rec.signalPolarity === "inverted" && rec.opponentConfidence != null
        ? rec.opponentConfidence
        : rec.confidence;

    const conflictActive = hasConflict || dualFadeInfo?.isDualFade;

    if (!conflictActive) {
      return {
        ...rec,
        gameKey,
        consolidatedTeam: winnerDisplay,
        consolidatedConfidence: confidence,
      };
    }

    const eff = effectiveTeamForRec(rec);
    const alignsWithWinner = eff?.teamNorm === winnerNorm;

    return {
      ...rec,
      gameKey,
      gameConflict: true,
      conflictNote: dualFadeInfo?.isDualFade
        ? "Dual-fade résolu — voir recommandation match"
        : "Conflit — voir recommandation match",
      standaloneConfidence: standalone,
      consolidatedTeam: winnerDisplay,
      consolidatedConfidence: confidence,
      confidence: alignsWithWinner ? Math.min(rec.confidence, 38) : Math.min(rec.confidence, 32),
      opponentConfidence:
        rec.opponentConfidence != null
          ? Math.min(rec.opponentConfidence, alignsWithWinner ? 42 : 35)
          : rec.opponentConfidence,
      edgeLabel: dualFadeInfo?.isDualFade
        ? "Dual-fade résolu"
        : "Conflit — voir recommandation match",
    };
  });

  return { consolidated, updatedRecs };
}

export interface GameConflictResult {
  recommendations: MatchedRecommendation[];
  gameRecommendations: GameConsolidatedRecommendation[];
}

export interface GameConflictOptions {
  dualStats?: DualFadeStatsCache;
  slatePicks?: SheetPick[];
}

export function resolveGameConflicts(
  recommendations: MatchedRecommendation[],
  stats: ConfidenceStatsCache,
  options?: GameConflictOptions
): GameConflictResult {
  const { dualStats, slatePicks } = options ?? {};
  const byGame = new Map<string, MatchedRecommendation[]>();

  for (const rec of recommendations) {
    const key = rec.gameKey ?? rec.id;
    if (!byGame.has(key)) byGame.set(key, []);
    byGame.get(key)!.push(rec);
  }

  const gameRecommendations: GameConsolidatedRecommendation[] = [];
  const recById = new Map<string, MatchedRecommendation>();

  for (const [key, recs] of byGame) {
    if (recs.length === 1) {
      const single = recs[0];
      const game = single.matchedGame;
      const isFadePick = FADE_SIGNALS.has(single.signalType) && !single.line;

      if (game && isFadePick && slatePicks) {
        const { consolidated, updatedRecs } = resolveSingleGame(
          key,
          recs,
          stats,
          dualStats,
          slatePicks
        );
        gameRecommendations.push(consolidated);
        for (const rec of updatedRecs) recById.set(rec.id, rec);
        continue;
      }

      recById.set(single.id, { ...single, gameKey: key });
      continue;
    }

    const { consolidated, updatedRecs } = resolveSingleGame(
      key,
      recs,
      stats,
      dualStats,
      slatePicks
    );
    gameRecommendations.push(consolidated);
    for (const rec of updatedRecs) {
      recById.set(rec.id, rec);
    }
  }

  const ordered = recommendations.map((r) => recById.get(r.id) ?? r);
  return { recommendations: ordered, gameRecommendations };
}

/** Re-export dual-fade resolution for tests and API consumers */
export { resolveDualFadeMatch, isOpposingDualFade } from "./dualFadeStats.js";

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
