/**
 * Pure rule-based bet recommendation engine.
 * Historical ROI and trends do NOT influence which side is recommended.
 */
import { formatInTimeZone } from "date-fns-tz";
import { TIMEZONE } from "../config.js";
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
import {
  pickBelongsToGame,
  resolveGameTeamDisplay,
  validateRecommendedTeam,
} from "./calendar.js";
import { isOpposingDualFade } from "./dualFadeStats.js";
import { FADE_SIGNALS, SHARP_BET_SIGNALS, SIGNAL_LABELS } from "./signalMapping.js";

/** Fixed confidence — never derived from historical ROI */
export const RULE_CONFIDENCE = {
  sharp: 85,
  megaSharps: 85,
  singleFade: 75,
  sameSideDualFade: 78,
  noBet: 0,
  secondary: 70,
} as const;

const PREMIUM_LEAGUES = new Set<LeagueCode>(["MEGA_SHARPS", "WHALE", "MODEL", "RLM"]);

const SPECIAL_TO_SPORT: Partial<Record<LeagueCode, string>> = {
  MEGA_SHARPS: "MLB",
  WHALE: "MLB",
  MODEL: "MLB",
  RLM: "MLB",
};

export function sportLeagueForPick(pick: SheetPick): string {
  return SPECIAL_TO_SPORT[pick.league] || pick.league;
}

function normalizeTeamName(text: string): string {
  return text
    .replace(/\s*[+-]?\d+\.?\d*\s*$/g, "")
    .replace(/\b(OVER|UNDER)\b.*/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function displayTeamName(text: string): string {
  return text.replace(/\s*[+-]?\d+\.?\d*\s*$/g, "").replace(/\s+/g, " ").trim();
}

function isTotalPick(pick: SheetPick): boolean {
  return /\b(OVER|UNDER)\b/i.test(pick.pick) || !!pick.line;
}

function invertTotalSide(text: string): string | undefined {
  const upper = text.toUpperCase();
  if (upper.includes("OVER")) return text.replace(/\bOVER\b/i, "UNDER");
  if (upper.includes("UNDER")) return text.replace(/\bUNDER\b/i, "OVER");
  return undefined;
}

function sameTeamInGame(teamA: string, teamB: string, game: CalendarGame): boolean {
  const resolvedA = resolveGameTeamDisplay(teamA, game) ?? displayTeamName(teamA);
  const resolvedB = resolveGameTeamDisplay(teamB, game) ?? displayGameTeam(teamB, game);
  return normalizeTeamName(resolvedA) === normalizeTeamName(resolvedB);
}

function displayGameTeam(teamName: string, game: CalendarGame): string {
  return resolveGameTeamDisplay(teamName, game) ?? displayTeamName(teamName);
}

export function extractOpponentName(
  pick: SheetPick,
  slatePicks: SheetPick[],
  matchedGame?: CalendarGame
): string | undefined {
  if (isTotalPick(pick)) {
    return invertTotalSide(pick.pick);
  }

  if (pick.opponent) {
    return displayTeamName(pick.opponent);
  }

  const team = normalizeTeamName(pick.pick);
  const league = sportLeagueForPick(pick);
  const sameRow = slatePicks.filter(
    (p) =>
      p.rawRow === pick.rawRow &&
      sportLeagueForPick(p) === league &&
      p.id !== pick.id &&
      (pick.gameSlot == null || p.gameSlot === pick.gameSlot)
  );

  for (const other of sameRow) {
    if (other.opponent && normalizeTeamName(other.opponent) === team) {
      return displayTeamName(other.pick);
    }
    if (pick.opponent && normalizeTeamName(other.pick) === normalizeTeamName(pick.opponent)) {
      return displayTeamName(other.pick);
    }
  }

  if (matchedGame) {
    if (sameTeamInGame(pick.pick, matchedGame.awayTeam, matchedGame)) {
      return matchedGame.homeTeam;
    }
    if (sameTeamInGame(pick.pick, matchedGame.homeTeam, matchedGame)) {
      return matchedGame.awayTeam;
    }
  }

  return undefined;
}

/** Group picks on same game (ESPN id, team pair, or VS slot within a sheet row) */
export function buildGameKey(
  pick: SheetPick,
  slatePicks?: SheetPick[],
  matchedGame?: CalendarGame
): string {
  const league = sportLeagueForPick(pick);

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
        sportLeagueForPick(p) === league &&
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

export interface PickRulesResult {
  confidence: number;
  confidenceBreakdown: ConfidenceBreakdownItem[];
  opponentPick?: string;
  opponentConfidence?: number;
  signalPolarity: SignalPolarity;
  edgeLabel: string;
}

export function computePickRules(input: {
  pick: SheetPick;
  matchedGame?: CalendarGame;
  slatePicks: SheetPick[];
}): PickRulesResult {
  const { pick, matchedGame, slatePicks } = input;
  const breakdown: ConfidenceBreakdownItem[] = [];

  if (SHARP_BET_SIGNALS.has(pick.signalType)) {
    const confidence =
      pick.signalType === "mega_sharps" ? RULE_CONFIDENCE.megaSharps : RULE_CONFIDENCE.sharp;
    breakdown.push({
      key: "sharp_rule",
      label: SIGNAL_LABELS[pick.signalType],
      value: confidence,
      impact: confidence - 50,
      detail: `Bet ${displayTeamName(pick.pick)}${pick.line ? ` ${pick.line}` : ""}`,
    });
    return {
      confidence,
      confidenceBreakdown: breakdown,
      signalPolarity: "positive",
      edgeLabel: `${SIGNAL_LABELS[pick.signalType]} — bet listed side`,
    };
  }

  if (FADE_SIGNALS.has(pick.signalType)) {
    const opponentPick = extractOpponentName(pick, slatePicks, matchedGame);
    const confidence = RULE_CONFIDENCE.singleFade;
    if (opponentPick) {
      const signalLabel = SIGNAL_LABELS[pick.signalType];
      breakdown.push({
        key: "fade_rule",
        label: signalLabel,
        value: confidence,
        impact: confidence - 50,
        detail: `Fade ${displayTeamName(pick.pick)} → bet ${displayTeamName(opponentPick)}`,
      });
      return {
        confidence,
        confidenceBreakdown: breakdown,
        opponentPick,
        opponentConfidence: confidence,
        signalPolarity: "inverted",
        edgeLabel: `${signalLabel} — bet opponent`,
      };
    }

    breakdown.push({
      key: "fade_incomplete",
      label: "Incomplete fade",
      value: 0,
      impact: -50,
      detail: "Opponent not identified on sheet",
    });
    return {
      confidence: 0,
      confidenceBreakdown: breakdown,
      signalPolarity: "negative",
      edgeLabel: "Fade with no opponent identified",
    };
  }

  breakdown.push({
    key: "secondary_signal",
    label: SIGNAL_LABELS[pick.signalType],
    value: RULE_CONFIDENCE.secondary,
    impact: RULE_CONFIDENCE.secondary - 50,
    detail: `Bet ${displayTeamName(pick.pick)}`,
  });
  return {
    confidence: RULE_CONFIDENCE.secondary,
    confidenceBreakdown: breakdown,
    signalPolarity: "positive",
    edgeLabel: `${SIGNAL_LABELS[pick.signalType]} — bet listed side`,
  };
}

/** @deprecated alias — stats ignored */
export function computeConfidence(input: {
  pick: SheetPick;
  matchedGame?: CalendarGame;
  slatePicks: SheetPick[];
  stats?: unknown;
  fullHistory?: unknown;
}): PickRulesResult {
  return computePickRules(input);
}

function buildReasoning(pick: SheetPick, game?: CalendarGame): string {
  const signal = SIGNAL_LABELS[pick.signalType];
  const parts = [`Signal: ${signal}`];

  if (pick.opponent) {
    parts.push(`Matchup: ${pick.pick} vs ${pick.opponent}`);
  } else if (pick.line) {
    parts.push(`Line: ${pick.pick} ${pick.line}`);
  } else {
    parts.push(`Selection: ${pick.pick}`);
  }

  if (pick.gameTime) parts.push(`Listed time: ${pick.gameTime}`);
  if (pick.postingTime) parts.push(`Posted: ${pick.postingTime}`);

  if (game) {
    parts.push(
      `Game: ${game.awayTeam} @ ${game.homeTeam} (${formatInTimeZone(
        new Date(game.startTime),
        TIMEZONE,
        "HH:mm"
      )} ET)`
    );
  }

  return parts.join(" · ");
}

function inferStatus(game?: CalendarGame): MatchedRecommendation["status"] {
  if (!game) return "pending";
  const status = game.status.toLowerCase();
  if (status.includes("final") || status.includes("termin")) return "settled";
  if (status.includes("in progress") || status.includes("en cours")) return "matched";
  return "recommended";
}

function gamesForPick(pick: SheetPick, games: CalendarGame[]): CalendarGame[] {
  if (PREMIUM_LEAGUES.has(pick.league)) return games;
  const sportLeague = sportLeagueForPick(pick);
  return games.filter((g) => g.league === sportLeague);
}

function sheetPickFromRec(
  rec: MatchedRecommendation,
  slatePicks: SheetPick[]
): SheetPick {
  const fromSlate = slatePicks.find((p) => p.id === rec.id);
  return {
    id: rec.id,
    league: rec.league,
    signalType: rec.signalType,
    pick: rec.pick,
    opponent: rec.opponent ?? rec.opponentPick ?? fromSlate?.opponent,
    line: rec.line,
    rawRow: fromSlate?.rawRow ?? 0,
    signalCol: fromSlate?.signalCol ?? 0,
    gameSlot: fromSlate?.gameSlot,
  };
}

function fadeTargetsForRecs(
  recs: MatchedRecommendation[],
  slatePicks: SheetPick[],
  matchedGame?: CalendarGame
): Map<string, string> {
  const targets = new Map<string, string>();

  const addTarget = (team: string) => {
    const stripped = displayTeamName(team);
    if (!stripped) return;
    const resolved =
      matchedGame != null ? resolveGameTeamDisplay(stripped, matchedGame) ?? stripped : stripped;
    const norm = normalizeTeamName(resolved);
    if (norm) targets.set(norm, resolved);
  };

  for (const rec of recs) {
    if (rec.line) continue;
    if (FADE_SIGNALS.has(rec.signalType)) addTarget(rec.pick);
  }

  if (matchedGame) {
    const league = sportLeagueFromRec(recs[0]);
    for (const p of slatePicks) {
      if (!FADE_SIGNALS.has(p.signalType) || p.line) continue;
      if (p.league !== league && p.league !== "UNKNOWN") continue;
      if (pickBelongsToGame(p.pick, p.opponent, matchedGame)) addTarget(p.pick);
    }
  }

  return targets;
}

/** Teams listed in fade signals — never recommend these */
export function collectFadeTargetsForGame(
  recs: MatchedRecommendation[],
  slatePicks?: SheetPick[],
  matchedGame?: CalendarGame
): Map<string, string> {
  return fadeTargetsForRecs(recs, slatePicks ?? [], matchedGame);
}

function isFadeTargetTeam(
  teamNorm: string,
  fadeTargets: Map<string, string>,
  matchedGame?: CalendarGame
): boolean {
  for (const fadeNorm of fadeTargets.keys()) {
    if (teamNorm === fadeNorm) return true;
    if (matchedGame && sameTeamInGame(teamNorm, fadeNorm, matchedGame)) return true;
  }
  return false;
}

function sportLeagueFromRec(rec: MatchedRecommendation): string {
  return SPECIAL_TO_SPORT[rec.league] || rec.league;
}

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

function matchupLabels(recs: MatchedRecommendation[]): { awayTeam: string; homeTeam: string } {
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
  return { awayTeam: list[0] ?? "Team A", homeTeam: list[1] ?? "Team B" };
}

function fadeTargetNorm(pick: SheetPick, matchedGame?: CalendarGame): string {
  const stripped = displayTeamName(pick.pick);
  const resolved =
    matchedGame != null ? resolveGameTeamDisplay(stripped, matchedGame) ?? stripped : stripped;
  return normalizeTeamName(resolved);
}

function collectFadePicksForGame(
  recs: MatchedRecommendation[],
  slatePicks: SheetPick[],
  matchedGame?: CalendarGame
): SheetPick[] {
  const picks: SheetPick[] = [];
  const seen = new Set<string>();

  for (const rec of recs) {
    if (!FADE_SIGNALS.has(rec.signalType) || rec.line) continue;
    const pick = sheetPickFromRec(rec, slatePicks);
    if (seen.has(pick.id)) continue;
    seen.add(pick.id);
    picks.push(pick);
  }

  if (matchedGame && recs.length > 0) {
    const league = sportLeagueFromRec(recs[0]);
    for (const p of slatePicks) {
      if (!FADE_SIGNALS.has(p.signalType) || p.line) continue;
      if (p.league !== league && p.league !== "UNKNOWN") continue;
      if (!pickBelongsToGame(p.pick, p.opponent, matchedGame)) continue;
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      picks.push(p);
    }
  }

  return picks;
}

/** Two fade picks target different sides of the same game → opposing fades */
function isOpposingFadePick(
  a: SheetPick,
  b: SheetPick,
  matchedGame?: CalendarGame
): boolean {
  if (fadeTargetNorm(a, matchedGame) === fadeTargetNorm(b, matchedGame)) return false;
  if (isOpposingDualFade(a, b)) return true;
  if (!matchedGame) return false;

  const aInGame = pickBelongsToGame(a.pick, a.opponent, matchedGame);
  const bInGame = pickBelongsToGame(b.pick, b.opponent, matchedGame);
  if (!aInGame || !bInGame) return false;

  if (a.gameSlot != null && b.gameSlot != null && a.gameSlot === b.gameSlot) return true;

  return true;
}

function findOpposingFadePair(
  fadePicks: SheetPick[],
  matchedGame?: CalendarGame
): { a: SheetPick; b: SheetPick } | undefined {
  for (let i = 0; i < fadePicks.length; i++) {
    for (let j = i + 1; j < fadePicks.length; j++) {
      if (isOpposingFadePick(fadePicks[i], fadePicks[j], matchedGame)) {
        return { a: fadePicks[i], b: fadePicks[j] };
      }
    }
  }
  return undefined;
}

function findSameSideFadeCluster(
  fadePicks: SheetPick[],
  matchedGame?: CalendarGame
): SheetPick[] | undefined {
  if (fadePicks.length < 2) return undefined;
  const target = fadeTargetNorm(fadePicks[0], matchedGame);
  const cluster = fadePicks.filter((p) => fadeTargetNorm(p, matchedGame) === target);
  return cluster.length >= 2 ? cluster : undefined;
}

function sharpBetTeamNorm(sharp: MatchedRecommendation, matchedGame?: CalendarGame): string {
  const stripped = displayTeamName(sharp.pick);
  const resolved =
    matchedGame != null ? resolveGameTeamDisplay(stripped, matchedGame) ?? stripped : stripped;
  return normalizeTeamName(resolved);
}

function sharpBetTeamDisplay(sharp: MatchedRecommendation, matchedGame?: CalendarGame): string {
  if (matchedGame) return displayGameTeam(sharp.pick, matchedGame);
  return displayTeamName(sharp.pick);
}

/** Sharp bets Team X while a fade signal also lists Team X → signals cancel */
function findSharpFadeSameTeamConflict(
  sharpRecs: MatchedRecommendation[],
  fadePicks: SheetPick[],
  fadeTargets: Map<string, string>,
  matchedGame?: CalendarGame
): { sharp: MatchedRecommendation; fadePicks: SheetPick[]; team: string } | undefined {
  for (const sharp of sharpRecs) {
    const sharpNorm = sharpBetTeamNorm(sharp, matchedGame);
    if (!isFadeTargetTeam(sharpNorm, fadeTargets, matchedGame)) continue;

    let team = sharpBetTeamDisplay(sharp, matchedGame);
    for (const [, display] of fadeTargets) {
      if (
        normalizeTeamName(display) === sharpNorm ||
        (matchedGame && sameTeamInGame(display, sharp.pick, matchedGame))
      ) {
        team = matchedGame ? displayGameTeam(display, matchedGame) : display;
        break;
      }
    }

    const conflictingFades = fadePicks.filter(
      (p) => fadeTargetNorm(p, matchedGame) === sharpNorm ||
        (matchedGame && sameTeamInGame(p.pick, sharp.pick, matchedGame))
    );
    if (conflictingFades.length === 0) continue;

    return { sharp, fadePicks: conflictingFades, team };
  }
  return undefined;
}

function buildNoBetCard(
  gameKey: string,
  recs: MatchedRecommendation[],
  reason: string,
  dualFade: DualFadeInfo | undefined,
  matchedGame?: CalendarGame,
  breakdown?: ConfidenceBreakdownItem[]
): { consolidated: GameConsolidatedRecommendation; updatedRecs: MatchedRecommendation[] } {
  const { awayTeam, homeTeam } = matchupLabels(recs);

  const consolidated: GameConsolidatedRecommendation = {
    gameKey,
    league: recs[0].league,
    awayTeam,
    homeTeam,
    recommendedTeam: "",
    confidence: RULE_CONFIDENCE.noBet,
    noBet: true,
    noBetReason: reason,
    confidenceBreakdown: breakdown ?? [
      {
        key: "no_bet",
        label: "No bet",
        value: 0,
        impact: 0,
        detail: reason,
      },
    ],
    hasConflict: true,
    pickIds: recs.map((r) => r.id),
    reasoning: `Game: ${awayTeam} @ ${homeTeam} · ${reason}`,
    matchedGame,
    dualFade,
  };

  const updatedRecs = recs.map((rec) => ({
    ...rec,
    gameKey,
    gameConflict: true,
    conflictNote: "No bet — conflicting signals",
    consolidatedTeam: undefined,
    consolidatedConfidence: 0,
    edgeLabel: "No bet — conflicting signals",
  }));

  return { consolidated, updatedRecs };
}

function buildBetCard(
  gameKey: string,
  recs: MatchedRecommendation[],
  recommendedTeam: string,
  confidence: number,
  breakdown: ConfidenceBreakdownItem[],
  reasoning: string,
  matchedGame?: CalendarGame,
  dualFade?: DualFadeInfo,
  hasConflict = false
): { consolidated: GameConsolidatedRecommendation; updatedRecs: MatchedRecommendation[] } {
  const { awayTeam, homeTeam } = matchupLabels(recs);
  const winnerNorm = normalizeTeamName(recommendedTeam);

  const consolidated: GameConsolidatedRecommendation = {
    gameKey,
    league: recs[0].league,
    awayTeam,
    homeTeam,
    recommendedTeam,
    confidence,
    confidenceBreakdown: breakdown,
    hasConflict,
    pickIds: recs.map((r) => r.id),
    reasoning: `Game: ${awayTeam} @ ${homeTeam} · ${reasoning}`,
    matchedGame,
    dualFade,
  };

  const updatedRecs = recs.map((rec) => {
    const effTeam =
      FADE_SIGNALS.has(rec.signalType) && rec.opponentPick
        ? normalizeTeamName(rec.opponentPick)
        : SHARP_BET_SIGNALS.has(rec.signalType)
          ? normalizeTeamName(rec.pick)
          : normalizeTeamName(rec.pick);

    const aligns = matchedGame
      ? effTeam === winnerNorm || sameTeamInGame(effTeam, recommendedTeam, matchedGame)
      : effTeam === winnerNorm;

    if (!hasConflict) {
      return { ...rec, gameKey, consolidatedTeam: recommendedTeam, consolidatedConfidence: confidence };
    }

    return {
      ...rec,
      gameKey,
      gameConflict: true,
      conflictNote: "Conflict resolved — see game recommendation",
      consolidatedTeam: recommendedTeam,
      consolidatedConfidence: confidence,
      confidence: aligns ? rec.confidence : Math.min(rec.confidence, 40),
    };
  });

  return { consolidated, updatedRecs };
}

function resolveGameGroup(
  gameKey: string,
  recs: MatchedRecommendation[],
  slatePicks: SheetPick[]
): { consolidated: GameConsolidatedRecommendation; updatedRecs: MatchedRecommendation[] } {
  recs = filterRecsForGame(recs);
  const matchedGame = recs.find((r) => r.matchedGame)?.matchedGame;
  const fadeTargets = fadeTargetsForRecs(recs, slatePicks, matchedGame);
  const fadePicks = collectFadePicksForGame(recs, slatePicks, matchedGame);

  const sharpRecs = recs.filter((r) => SHARP_BET_SIGNALS.has(r.signalType) && !r.line);

  // Opposing fades on same game → no bet
  const opposingPair = findOpposingFadePair(fadePicks, matchedGame);
  if (opposingPair) {
    const { a, b } = opposingPair;
    const fadeATeam = displayTeamName(a.pick);
    const fadeBTeam = displayTeamName(b.pick);
    const inverseA = a.opponent ? displayTeamName(a.opponent) : fadeBTeam;
    const inverseB = b.opponent ? displayTeamName(b.opponent) : fadeATeam;
    const labelA = SIGNAL_LABELS[a.signalType];
    const labelB = SIGNAL_LABELS[b.signalType];
    const reason =
      `${labelA} lists ${fadeATeam} (→ ${inverseA}) and ${labelB} lists ${fadeBTeam} (→ ${inverseB}). ` +
      `Both teams on opposite sides — conflicting signals, no bet.`;

    return buildNoBetCard(gameKey, recs, reason, {
      isDualFade: true,
      isOpposingNoBet: true,
      bookNeedsFadeTeam: fadeATeam,
      squareFadeTeam: fadeBTeam,
    }, matchedGame, [
      {
        key: "no_bet_dual_fade",
        label: "No bet",
        value: 0,
        impact: 0,
        detail: `${fadeATeam} vs ${fadeBTeam} — opposing fades cancel`,
      },
      {
        key: "fade_a",
        label: labelA,
        value: RULE_CONFIDENCE.singleFade,
        impact: 0,
        detail: `Fade ${fadeATeam} → would bet ${inverseA}`,
      },
      {
        key: "fade_b",
        label: labelB,
        value: RULE_CONFIDENCE.singleFade,
        impact: 0,
        detail: `Fade ${fadeBTeam} → would bet ${inverseB}`,
      },
    ]);
  }

  // Sharp bets Team X while a fade also targets Team X → no bet (signals cancel)
  const sharpFadeConflict = findSharpFadeSameTeamConflict(
    sharpRecs,
    fadePicks,
    fadeTargets,
    matchedGame
  );
  if (sharpFadeConflict) {
    const { sharp, fadePicks: conflictingFades, team } = sharpFadeConflict;
    const sharpLabel = SIGNAL_LABELS[sharp.signalType];
    const fadeLabels = [...new Set(conflictingFades.map((p) => SIGNAL_LABELS[p.signalType]))].join(
      " + "
    );
    const reason =
      `${sharpLabel} bets ${team} but ${fadeLabels} fade ${team} — conflicting signals, no bet.`;

    const breakdown: ConfidenceBreakdownItem[] = [
      {
        key: "no_bet_sharp_fade",
        label: "No bet",
        value: 0,
        impact: 0,
        detail: `${team} — sharp and fade cancel`,
      },
      {
        key: "sharp_conflict",
        label: sharpLabel,
        value: RULE_CONFIDENCE.sharp,
        impact: 0,
        detail: `Bet ${team}`,
      },
    ];
    for (const fadePick of conflictingFades) {
      const fadeTarget = displayTeamName(fadePick.pick);
      const inverse =
        extractOpponentName(fadePick, slatePicks, matchedGame) ?? "opponent";
      breakdown.push({
        key: `fade_${fadePick.id}`,
        label: SIGNAL_LABELS[fadePick.signalType],
        value: RULE_CONFIDENCE.singleFade,
        impact: 0,
        detail: `Fade ${fadeTarget} → would bet ${displayTeamName(inverse)}`,
      });
    }

    return buildNoBetCard(gameKey, recs, reason, undefined, matchedGame, breakdown);
  }

  // Sharp takes priority over fades that target a different team
  if (sharpRecs.length > 0) {
    const sharp = sharpRecs[0];
    const team = sharpBetTeamDisplay(sharp, matchedGame);
    const breakdown: ConfidenceBreakdownItem[] = [
      {
        key: "sharp_priority",
        label: SIGNAL_LABELS[sharp.signalType],
        value: RULE_CONFIDENCE.sharp,
        impact: RULE_CONFIDENCE.sharp - 50,
        detail: `Sharp rule — bet ${team}`,
      },
    ];
    for (const fadeRec of recs.filter((r) => FADE_SIGNALS.has(r.signalType))) {
      breakdown.push({
        key: `fade_${fadeRec.id}`,
        label: SIGNAL_LABELS[fadeRec.signalType],
        value: 0,
        impact: 0,
        detail: `Overridden by ${SIGNAL_LABELS[sharp.signalType]} on ${team}`,
      });
    }
    return buildBetCard(
      gameKey,
      recs,
      team,
      RULE_CONFIDENCE.sharp,
      breakdown,
      `${SIGNAL_LABELS[sharp.signalType]} → ${team} (${RULE_CONFIDENCE.sharp}%)`,
      matchedGame,
      undefined,
      recs.length > 1
    );
  }

  // Same-side multi-fade → bet opponent
  const sameSideCluster = findSameSideFadeCluster(fadePicks, matchedGame);
  if (sameSideCluster) {
    const anchor = sameSideCluster[0];
    const fadeTarget = displayTeamName(anchor.pick);
    const opponent =
      extractOpponentName(anchor, slatePicks, matchedGame) ??
      sameSideCluster
        .map((p) => extractOpponentName(p, slatePicks, matchedGame))
        .find(Boolean);
    if (opponent) {
      let team = opponent;
      if (matchedGame) team = displayGameTeam(opponent, matchedGame);
      const signalSummary = [...new Set(sameSideCluster.map((p) => SIGNAL_LABELS[p.signalType]))].join(
        " + "
      );
      return buildBetCard(
        gameKey,
        recs,
        team,
        RULE_CONFIDENCE.sameSideDualFade,
        [
          {
            key: "same_side_multi_fade",
            label: "Same-side multi-fade",
            value: RULE_CONFIDENCE.sameSideDualFade,
            impact: RULE_CONFIDENCE.sameSideDualFade - 50,
            detail: `${signalSummary} fade ${fadeTarget} → bet ${team}`,
          },
        ],
        `${signalSummary} fade ${fadeTarget} → ${team} (${RULE_CONFIDENCE.sameSideDualFade}%)`,
        matchedGame,
        {
          isDualFade: true,
          bookNeedsFadeTeam: fadeTarget,
          squareFadeTeam: fadeTarget,
        },
        true
      );
    }
  }

  // Rule 2/3: single fade
  const fadeRec = recs.find((r) => FADE_SIGNALS.has(r.signalType) && !r.line);
  if (fadeRec?.opponentPick) {
    let team = fadeRec.opponentPick;
    if (matchedGame) team = displayGameTeam(fadeRec.opponentPick, matchedGame);
    const fadeTarget = displayTeamName(fadeRec.pick);
    const signalLabel = SIGNAL_LABELS[fadeRec.signalType];
    return buildBetCard(
      gameKey,
      recs,
      team,
      RULE_CONFIDENCE.singleFade,
      [
        {
          key: "single_fade",
          label: signalLabel,
          value: RULE_CONFIDENCE.singleFade,
          impact: RULE_CONFIDENCE.singleFade - 50,
          detail: `${signalLabel}: fade ${fadeTarget} → bet ${team}`,
        },
      ],
      `${signalLabel}: fade ${fadeTarget} → ${team} (${RULE_CONFIDENCE.singleFade}%)`,
      matchedGame
    );
  }

  // Secondary signals — prefer side that is NOT a fade target
  const nonFadeRecs = recs.filter((r) => !FADE_SIGNALS.has(r.signalType) && !r.line);
  for (const rec of nonFadeRecs) {
    const teamNorm = normalizeTeamName(rec.pick);
    if (!isFadeTargetTeam(teamNorm, fadeTargets, matchedGame)) {
      let team = displayTeamName(rec.pick);
      if (matchedGame) team = displayGameTeam(rec.pick, matchedGame);
      return buildBetCard(
        gameKey,
        recs,
        team,
        RULE_CONFIDENCE.secondary,
        [
          {
            key: "secondary",
            label: SIGNAL_LABELS[rec.signalType],
            value: RULE_CONFIDENCE.secondary,
            impact: RULE_CONFIDENCE.secondary - 50,
            detail: `Bet ${team}`,
          },
        ],
        `${SIGNAL_LABELS[rec.signalType]} → ${team}`,
        matchedGame,
        undefined,
        recs.length > 1
      );
    }
  }

  // Fade-only without resolved opponent
  if (fadeRec) {
    return buildNoBetCard(
      gameKey,
      recs,
      "Fade signal present but opponent could not be identified.",
      undefined,
      matchedGame
    );
  }

  // Fallback: first rec listed side
  const first = recs[0];
  let team = displayTeamName(first.pick);
  if (matchedGame) team = displayGameTeam(first.pick, matchedGame);

  if (matchedGame && !validateRecommendedTeam(team, matchedGame)) {
    return buildNoBetCard(
      gameKey,
      recs,
      `${team} is not part of this matchup.`,
      undefined,
      matchedGame
    );
  }

  if (isFadeTargetTeam(normalizeTeamName(team), fadeTargets, matchedGame)) {
    const opp = extractOpponentName(sheetPickFromRec(first, slatePicks), slatePicks, matchedGame);
    if (opp) {
      if (matchedGame) team = displayGameTeam(opp, matchedGame);
      else team = opp;
    }
  }

  return buildBetCard(
    gameKey,
    recs,
    team,
    first.confidence,
    first.confidenceBreakdown,
    first.edgeLabel,
    matchedGame
  );
}

export interface GameConflictResult {
  recommendations: MatchedRecommendation[];
  gameRecommendations: GameConsolidatedRecommendation[];
}

export function resolveGameConflicts(
  recommendations: MatchedRecommendation[],
  _stats?: unknown,
  options?: { slatePicks?: SheetPick[]; dualStats?: unknown }
): GameConflictResult {
  const slatePicks = options?.slatePicks ?? [];
  const byGame = new Map<string, MatchedRecommendation[]>();

  for (const rec of recommendations) {
    const key = rec.gameKey ?? rec.id;
    if (!byGame.has(key)) byGame.set(key, []);
    byGame.get(key)!.push(rec);
  }

  const gameRecommendations: GameConsolidatedRecommendation[] = [];
  const recById = new Map<string, MatchedRecommendation>();

  for (const [key, recs] of byGame) {
    const needsCard =
      recs.length > 1 ||
      (recs.length === 1 &&
        FADE_SIGNALS.has(recs[0].signalType) &&
        !recs[0].line &&
        recs[0].matchedGame);

    if (!needsCard) {
      recById.set(recs[0].id, { ...recs[0], gameKey: key });
      continue;
    }

    const { consolidated, updatedRecs } = resolveGameGroup(key, recs, slatePicks);

    gameRecommendations.push(consolidated);
    for (const rec of updatedRecs) recById.set(rec.id, rec);
  }

  const ordered = recommendations.map((r) => recById.get(r.id) ?? r);
  return { recommendations: ordered, gameRecommendations };
}

export function runBetRulesEngine(input: {
  slatePicks: SheetPick[];
  games: CalendarGame[];
  gameDate: string;
}): GameConflictResult {
  const { slatePicks, games, gameDate } = input;

  const rawRecs: MatchedRecommendation[] = slatePicks.map((pick) => {
    const leagueGames = gamesForPick(pick, games);
    const matchedGame = leagueGames.find((g) =>
      pickBelongsToGame(pick.pick, pick.opponent, g)
    );

    const rules = computePickRules({ pick, matchedGame, slatePicks });

    return {
      id: pick.id,
      league: pick.league,
      signalType: pick.signalType,
      signalLabel: SIGNAL_LABELS[pick.signalType],
      pick: pick.pick,
      opponent: pick.opponent,
      gameTime: pick.gameTime,
      postingTime: pick.postingTime,
      line: pick.line,
      confidence: rules.confidence,
      confidenceBreakdown: rules.confidenceBreakdown,
      opponentPick: rules.opponentPick,
      opponentConfidence: rules.opponentConfidence,
      signalPolarity: rules.signalPolarity,
      edgeLabel: rules.edgeLabel,
      reasoning: buildReasoning(pick, matchedGame),
      status: inferStatus(matchedGame),
      matchedGame,
      gameDate,
      gameKey: buildGameKey(pick, slatePicks, matchedGame),
    };
  });

  return resolveGameConflicts(rawRecs, undefined, { slatePicks });
}
