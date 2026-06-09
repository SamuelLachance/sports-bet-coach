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
  resolveDualFadeMatch,
  type DualFadeStatsCache,
} from "./dualFadeStats.js";
import { FADE_SIGNALS, SIGNAL_LABELS_FR } from "./signalMapping.js";

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

/** Group picks on same game (ESPN id, team pair, or same sheet row) */
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

  if (slatePicks) {
    const sameRow = slatePicks.filter(
      (p) =>
        p.rawRow === pick.rawRow &&
        sportLeague(p) === league &&
        p.id !== pick.id &&
        !p.line
    );
    const linked = sameRow.filter((p) => {
      const otherTeam = normalizeTeamName(p.pick);
      const myOpp = pick.opponent ? normalizeTeamName(pick.opponent) : "";
      const theirOpp = p.opponent ? normalizeTeamName(p.opponent) : "";
      return myOpp === otherTeam || theirOpp === team;
    });
    if (linked.length > 0) {
      const teams = [team, ...linked.map((p) => normalizeTeamName(p.pick))].sort();
      if (teams.length >= 2) {
        return `${league}:row-${pick.rawRow}:${teams[0]}|${teams[1]}`;
      }
    }
  }

  return `${league}:row-${pick.rawRow}:${team}`;
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
      (gameKey(p, slatePicks) === key || p.rawRow === pick.rawRow)
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
    label: `ROI historique ${SIGNAL_LABELS_FR[pick.signalType]}`,
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

  if (highConviction) {
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
    opponentPick: inverted ? opponentPick : undefined,
    opponentConfidence: inverted ? opponentConfidence : undefined,
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
// 1. GROUPING — buildGameKey() uses ESPN game id, sorted team pair, or same
//    sheet row (e.g. Book Needs col + Square col on one MLB line).
//
// 2. EFFECTIVE TEAM — each pick maps to one supported team after inversion:
//    • inverted fade → opponent side (historically losing fade = bet other side)
//    • positive sharp / whale / model → pick side
//    • negative non-inverted → weak support for pick side
//
// 3. NET EDGE — per team, sum weighted edge:
//    weight = sampleWeight × |blendedRoi|/150 (stronger historical inversion = more weight)
//    inverted edge = opponentConfidence × weight
//    positive edge = confidence × 0.55
//
// 4. DOUBLE FADE (Book Needs + Square on OPPOSITE sides of same game):
//    Both fades are inverted; whichever signal has worse (more negative) ROI gets
//    a reliability bonus (+12% edge). Apply "Double fade public/book" penalty (-8)
//    to both sides when edges are within 15% — signals cancel out.
//
// 5. SHARP + FADE CONFLUENCE — sharp_money or mega_sharps supporting the same
//    team as an inverted fade adds +12 edge to that team.
//
// 6. OUTPUT — one GameConsolidatedRecommendation per multi-pick game.
//    Conflicting individual picks get gameConflict=true, dampened confidence,
//    and conflictNote pointing to the match-level winner.
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

function effectiveTeamForRec(rec: MatchedRecommendation): {
  teamNorm: string;
  teamDisplay: string;
} | null {
  if (rec.line) return null;

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
  stats: ConfidenceStatsCache
): TeamEdgeContribution | null {
  const team = effectiveTeamForRec(rec);
  if (!team) return null;

  const sampleW = signalSampleWeight(stats, rec.signalType);
  const roiW = signalRoiWeight(stats, rec.signalType);
  const weight = sampleW * roiW;

  let edge: number;
  let note: string;

  if (rec.signalPolarity === "inverted") {
    const boost = rec.opponentConfidence ?? invertBoostForSignal(stats, rec.signalType);
    edge = boost * weight;
    note = `${SIGNAL_LABELS_FR[rec.signalType]} fade → ${team.teamDisplay} (+${Math.round(edge)})`;
  } else if (rec.signalPolarity === "positive") {
    edge = rec.confidence * 0.55 * weight;
    note = `${SIGNAL_LABELS_FR[rec.signalType]} → ${team.teamDisplay} (+${Math.round(edge)})`;
  } else {
    edge = rec.confidence * 0.2 * weight;
    note = `${SIGNAL_LABELS_FR[rec.signalType]} (faible) → ${team.teamDisplay}`;
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
  stats: ConfidenceStatsCache
): { edgeDelta: Map<string, number>; notes: string[]; dampenConfidence: boolean } {
  const edgeDelta = new Map<string, number>();
  const notes: string[] = [];
  let dampenConfidence = false;

  const signals = new Set(contributions.map((c) => c.signalType));
  const hasBook = signals.has("book_needs_fade");
  const hasSquare = signals.has("square_fade");
  const teamsSupported = new Set(contributions.map((c) => c.teamNorm));

  if (hasBook && hasSquare && teamsSupported.size > 1) {
    notes.push("Double fade Book Needs + Square sur côtés opposés");
    const bookRoi = Math.abs(stats.signals.book_needs_fade.blendedRoi);
    const squareRoi = Math.abs(stats.signals.square_fade.blendedRoi);

    for (const c of contributions) {
      if (c.signalType === "book_needs_fade" && bookRoi >= squareRoi) {
        edgeDelta.set(c.teamNorm, (edgeDelta.get(c.teamNorm) ?? 0) + 12);
        notes.push(`Book Needs ROI plus négatif → bonus ${c.teamDisplay}`);
      } else if (c.signalType === "square_fade" && squareRoi > bookRoi) {
        edgeDelta.set(c.teamNorm, (edgeDelta.get(c.teamNorm) ?? 0) + 12);
        notes.push(`Square ROI plus négatif → bonus ${c.teamDisplay}`);
      }
    }

    dampenConfidence = true;
    notes.push("Pénalité double fade opposé (-8 par côté)");
    for (const team of teamsSupported) {
      edgeDelta.set(team, (edgeDelta.get(team) ?? 0) - 8);
    }
  }

  const sharpTypes: SignalType[] = ["sharp_money", "mega_sharps"];
  const fades = contributions.filter((c) => FADE_SIGNALS.has(c.signalType));
  const sharps = contributions.filter((c) => sharpTypes.includes(c.signalType));

  for (const sharp of sharps) {
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

function resolveSingleGame(
  gameKey: string,
  recs: MatchedRecommendation[],
  stats: ConfidenceStatsCache,
  dualStats?: DualFadeStatsCache,
  slatePicks?: SheetPick[]
): { consolidated: GameConsolidatedRecommendation; updatedRecs: MatchedRecommendation[] } {
  const contributions = recs
    .map((r) => contributionForRec(r, stats))
    .filter((c): c is TeamEdgeContribution => c != null);

  const teamEdges = new Map<string, { edge: number; display: string; notes: string[] }>();

  for (const c of contributions) {
    const existing = teamEdges.get(c.teamNorm) ?? { edge: 0, display: c.teamDisplay, notes: [] };
    existing.edge += c.edge;
    existing.notes.push(c.note);
    teamEdges.set(c.teamNorm, existing);
  }

  const cross = applyGameCrossSignalRules(contributions, stats);
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

  if (dualStats && slatePicks?.length) {
    const league = sportLeagueFromRec(recs[0]);
    const rawRow = getRawRowFromRecs(recs, slatePicks);
    const pair = findDualFadePair(slatePicks, rawRow, league);
    const resolution = resolveDualFadeMatch(pair.book, pair.square, dualStats, league);

    if (resolution?.isDualFade) {
      winnerNorm = resolution.recommendedSideNorm;
      winnerDisplay = resolution.recommendedSide;
      winnerEdge = resolution.confidence;
      margin = resolution.confidence - (runnerEdge || 0);
      dualFadeReasoning = resolution.reasoning;
      dualFadeConfidence = resolution.confidence;
      dualFadeInfo = {
        isDualFade: true,
        bookNeedsFadeTeam: resolution.bookNeedsFadeTeam,
        squareFadeTeam: resolution.squareFadeTeam,
        strongerFadeColumn: resolution.strongerFadeColumn,
        archiveWinRate: resolution.archiveWinRate,
        archiveSampleDays: dualStats.coOccurrence.dualActiveDays,
      };
      for (const b of resolution.breakdown) {
        cross.notes.push(`${b.label}: ${b.detail ?? b.value}`);
      }
    } else if (resolution?.isStandalone && recs.length === 1) {
      winnerNorm = resolution.recommendedSideNorm;
      winnerDisplay = resolution.recommendedSide;
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

  let confidence = clamp(55 + (margin / maxEdge) * 35, 52, 88);
  if (dualFadeConfidence != null) {
    confidence = dualFadeConfidence;
  } else if (cross.dampenConfidence && margin / maxEdge < 0.2) {
    confidence = clamp(confidence - 12, 50, 72);
  } else if (hasConflict && margin / maxEdge < 0.08) {
    confidence = clamp(confidence - 10, 50, 65);
  }
  confidence = Math.round(confidence);

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
      label: SIGNAL_LABELS_FR[c.signalType],
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

function sportLeagueFromRec(rec: MatchedRecommendation): string {
  const map: Partial<Record<LeagueCode, string>> = {
    MEGA_SHARPS: "MLB",
    WHALE: "MLB",
    MODEL: "MLB",
    RLM: "MLB",
  };
  return map[rec.league] || rec.league;
}

function getRawRowFromRecs(recs: MatchedRecommendation[], slatePicks?: SheetPick[]): number {
  if (!slatePicks?.length) return 0;
  for (const rec of recs) {
    const pick = slatePicks.find((p) => p.id === rec.id);
    if (pick?.rawRow) return pick.rawRow;
  }
  return 0;
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
      const league = sportLeagueFromRec(single);
      const rawRow = getRawRowFromRecs([single], slatePicks);
      const pair = slatePicks ? findDualFadePair(slatePicks, rawRow, league) : {};
      const isStandaloneFade =
        (single.signalType === "book_needs_fade" || single.signalType === "square_fade") &&
        !pair.book &&
        !pair.square;

      if (dualStats && slatePicks && isStandaloneFade) {
        const pick =
          single.signalType === "book_needs_fade"
            ? slatePicks.find((p) => p.id === single.id)
            : slatePicks.find((p) => p.id === single.id);
        const resolution = resolveDualFadeMatch(
          pick?.signalType === "book_needs_fade" ? pick : undefined,
          pick?.signalType === "square_fade" ? pick : undefined,
          dualStats,
          league
        );
        if (resolution?.isStandalone) {
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
