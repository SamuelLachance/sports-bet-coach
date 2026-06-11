/**
 * Pure rule-based bet recommendation engine.
 * Historical ROI and trends do NOT influence which side is recommended.
 */
import { formatInTimeZone } from "date-fns-tz";
import { TIMEZONE } from "../config.js";
import {
  betKey,
  fadeParsedBet,
  parsePickBet,
  resolveBetDisplay,
} from "../parsers/pickBetParser.js";
import type {
  CalendarGame,
  ConfidenceBreakdownItem,
  DualFadeInfo,
  GameConsolidatedRecommendation,
  LeagueCode,
  MatchedRecommendation,
  ParsedBet,
  SheetPick,
  SignalPolarity,
  SignalType,
} from "../types.js";
import {
  pickBelongsToGame,
  resolveGameTeamDisplay,
  validateRecommendedTeam,
} from "./calendar.js";
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
  if (pick.parsedBet?.betType === "total") return true;
  return /\b(OVER|UNDER)\b/i.test(pick.pick) || !!pick.line;
}

function parsedBetForPick(pick: SheetPick): ParsedBet {
  if (pick.parsedBet) return pick.parsedBet;
  return (
    parsePickBet(pick.pick, pick.line) ?? {
      betType: "moneyline",
      team: displayTeamName(pick.pick),
      rawText: pick.pick,
      displayText: displayTeamName(pick.pick),
    }
  );
}

function teamResolver(game?: CalendarGame): (name: string) => string | undefined {
  return (name: string) =>
    game != null ? resolveGameTeamDisplay(name, game) ?? displayTeamName(name) : displayTeamName(name);
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

function breakdownItem(
  key: string,
  label: string,
  detail: string,
  value = 0
): ConfidenceBreakdownItem {
  return { key, label, value, impact: 0, detail };
}

export function extractOpponentName(
  pick: SheetPick,
  slatePicks: SheetPick[],
  matchedGame?: CalendarGame
): string | undefined {
  if (isTotalPick(pick)) {
    const bet = parsedBetForPick(pick);
    const faded = fadeParsedBet(bet);
    return faded ? resolveBetDisplay(faded) : invertTotalSide(pick.pick);
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
  opponentBet?: ParsedBet;
  recommendedBet?: ParsedBet;
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
  const listedBet = parsedBetForPick(pick);
  const resolveTeam = teamResolver(matchedGame);
  const listedDisplay = resolveBetDisplay(listedBet, resolveTeam);

  if (SHARP_BET_SIGNALS.has(pick.signalType)) {
    const confidence =
      pick.signalType === "mega_sharps" ? RULE_CONFIDENCE.megaSharps : RULE_CONFIDENCE.sharp;
    const signalLabel = SIGNAL_LABELS[pick.signalType];
    breakdown.push(
      breakdownItem("sharp_rule", signalLabel, `${signalLabel} → ${listedDisplay}`, confidence)
    );
    return {
      confidence,
      confidenceBreakdown: breakdown,
      recommendedBet: listedBet,
      signalPolarity: "positive",
      edgeLabel: `${SIGNAL_LABELS[pick.signalType]} — bet listed side`,
    };
  }

  if (FADE_SIGNALS.has(pick.signalType)) {
    const opponentName = extractOpponentName(pick, slatePicks, matchedGame);
    const fadedBet = fadeParsedBet(listedBet, opponentName, resolveTeam);
    const confidence = RULE_CONFIDENCE.singleFade;
    if (fadedBet) {
      const fadedDisplay = resolveBetDisplay(fadedBet, resolveTeam);
      const signalLabel = SIGNAL_LABELS[pick.signalType];
      breakdown.push(
        breakdownItem(
          "fade_rule",
          signalLabel,
          `${signalLabel} → ${fadedDisplay}`,
          confidence
        )
      );
      return {
        confidence,
        confidenceBreakdown: breakdown,
        opponentPick: fadedDisplay,
        opponentBet: fadedBet,
        opponentConfidence: confidence,
        signalPolarity: "inverted",
        edgeLabel: `${signalLabel} — fade listed side`,
      };
    }

    breakdown.push(
      breakdownItem("fade_incomplete", "Incomplete fade", "Incomplete fade — opponent not identified")
    );
    return {
      confidence: 0,
      confidenceBreakdown: breakdown,
      signalPolarity: "negative",
      edgeLabel: "Fade with no opponent identified",
    };
  }

  const signalLabel = SIGNAL_LABELS[pick.signalType];
  breakdown.push(
    breakdownItem(
      "secondary_signal",
      signalLabel,
      `${signalLabel} → ${listedDisplay}`,
      RULE_CONFIDENCE.secondary
    )
  );
  return {
    confidence: RULE_CONFIDENCE.secondary,
    confidenceBreakdown: breakdown,
    recommendedBet: listedBet,
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
    if (FADE_SIGNALS.has(rec.signalType)) {
      const bet = rec.parsedBet ?? parsePickBet(rec.pick, rec.line);
      if (bet?.betType === "total" && bet.team) addTarget(bet.team);
      else if (bet?.team) addTarget(bet.team);
      else addTarget(rec.pick);
    }
  }

  if (matchedGame) {
    const league = sportLeagueFromRec(recs[0]);
    for (const p of slatePicks) {
      if (!FADE_SIGNALS.has(p.signalType)) continue;
      if (p.league !== league && p.league !== "UNKNOWN") continue;
      if (pickBelongsToGame(p.pick, p.opponent, matchedGame)) {
        const bet = parsedBetForPick(p);
        if (bet.betType === "total" && bet.team) addTarget(bet.team);
        else if (bet.team) addTarget(bet.team);
        else addTarget(p.pick);
      }
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

export interface ImpliedBetEntry {
  signalType: SignalType;
  label: string;
  impliedSide: string;
  impliedNorm: string;
  impliedBet: ParsedBet;
  betKey: string;
  /** away / home / total:… — used to detect opposing teams on the same event */
  teamSideKey: string;
  detail: string;
  fadeTarget?: string;
}

function teamSideKeyForBet(bet: ParsedBet, matchedGame?: CalendarGame): string {
  if (bet.betType === "total") {
    return `total:${bet.totalDirection}:${bet.totalLine}`;
  }
  if (!matchedGame || !bet.team) return `unknown:${betKey(bet)}`;
  const resolved = resolveGameTeamDisplay(bet.team, matchedGame);
  if (!resolved) return `unknown:${betKey(bet)}`;
  if (normalizeTeamName(resolved) === normalizeTeamName(matchedGame.awayTeam)) {
    return "away";
  }
  if (normalizeTeamName(resolved) === normalizeTeamName(matchedGame.homeTeam)) {
    return "home";
  }
  return `unknown:${betKey(bet)}`;
}

function impliedSideNorm(side: string, matchedGame?: CalendarGame): string {
  const resolved =
    matchedGame != null ? resolveGameTeamDisplay(side, matchedGame) ?? side : side;
  return normalizeTeamName(resolved);
}

function impliedBetFromRec(
  rec: MatchedRecommendation,
  slatePicks: SheetPick[],
  matchedGame?: CalendarGame
): ImpliedBetEntry | null {
  const pick = sheetPickFromRec(rec, slatePicks);
  const label = SIGNAL_LABELS[rec.signalType];
  const resolveTeam = teamResolver(matchedGame);
  const listedBet = parsedBetForPick(pick);

  if (SHARP_BET_SIGNALS.has(rec.signalType)) {
    const display = resolveBetDisplay(listedBet, resolveTeam);
    return {
      signalType: rec.signalType,
      label,
      impliedSide: display,
      impliedNorm: betKey(listedBet),
      impliedBet: listedBet,
      betKey: betKey(listedBet),
      teamSideKey: teamSideKeyForBet(listedBet, matchedGame),
      detail: `${label} → ${display}`,
    };
  }

  if (FADE_SIGNALS.has(rec.signalType)) {
    const opponent = extractOpponentName(pick, slatePicks, matchedGame) ?? rec.opponentPick;
    const fadedBet = fadeParsedBet(listedBet, opponent, resolveTeam);
    if (!fadedBet) return null;
    const display = resolveBetDisplay(fadedBet, resolveTeam);
    const fadeTarget = resolveBetDisplay(listedBet, resolveTeam);
    return {
      signalType: rec.signalType,
      label,
      impliedSide: display,
      impliedNorm: betKey(fadedBet),
      impliedBet: fadedBet,
      betKey: betKey(fadedBet),
      teamSideKey: teamSideKeyForBet(fadedBet, matchedGame),
      fadeTarget,
      detail: `${label} → ${display}`,
    };
  }

  const display = resolveBetDisplay(listedBet, resolveTeam);
  return {
    signalType: rec.signalType,
    label,
    impliedSide: display,
    impliedNorm: betKey(listedBet),
    impliedBet: listedBet,
    betKey: betKey(listedBet),
    teamSideKey: teamSideKeyForBet(listedBet, matchedGame),
    detail: `${label} → ${display}`,
  };
}

function confidenceForAgreeingSignals(entries: ImpliedBetEntry[]): number {
  const sharpCount = entries.filter((e) => SHARP_BET_SIGNALS.has(e.signalType)).length;
  const fadeCount = entries.filter((e) => FADE_SIGNALS.has(e.signalType)).length;

  if (sharpCount > 0 && fadeCount === 0 && entries.length === sharpCount) {
    return RULE_CONFIDENCE.sharp;
  }
  if (sharpCount > 0) {
    return RULE_CONFIDENCE.sharp;
  }
  if (fadeCount >= 2) {
    return RULE_CONFIDENCE.sameSideDualFade;
  }
  if (fadeCount === 1) {
    return RULE_CONFIDENCE.singleFade;
  }
  return RULE_CONFIDENCE.secondary;
}

export interface ResolveImpliedBetsResult {
  side: string | null;
  impliedBet?: ParsedBet;
  confidence: number;
  breakdown: ConfidenceBreakdownItem[];
  noBetReason?: string;
  conflictingSides?: string[];
  dualFade?: DualFadeInfo;
}

/** Map signals to implied bet sides; recommend only when all agree on one side. */
export function resolveImpliedBets(entries: ImpliedBetEntry[]): ResolveImpliedBetsResult {
  const breakdown: ConfidenceBreakdownItem[] = entries.map((entry, i) =>
    breakdownItem(`signal_${i}`, entry.label, entry.detail)
  );

  if (entries.length === 0) {
    return {
      side: null,
      confidence: RULE_CONFIDENCE.noBet,
      breakdown: [
        ...breakdown,
        breakdownItem("result", "Result", "Result: No bet — no resolvable signals"),
      ],
      noBetReason: "No resolvable signals on this game.",
    };
  }

  const uniqueByTeam = new Map<string, { side: string; bet: ParsedBet }>();
  for (const entry of entries) {
    const teamKey = entry.teamSideKey;
    if (!uniqueByTeam.has(teamKey)) {
      uniqueByTeam.set(teamKey, { side: entry.impliedSide, bet: entry.impliedBet });
    }
  }

  const uniqueSides = [...uniqueByTeam.values()];

  if (uniqueSides.length === 1) {
    const { side, bet } = uniqueSides[0]!;
    const confidence = confidenceForAgreeingSignals(entries);
    const fadeEntries = entries.filter((e) => FADE_SIGNALS.has(e.signalType));
    const fadeTargets = [...new Set(fadeEntries.map((e) => e.fadeTarget).filter(Boolean))];

    let dualFade: DualFadeInfo | undefined;
    if (fadeEntries.length >= 2 && fadeTargets.length === 1) {
      dualFade = {
        isDualFade: true,
        bookNeedsFadeTeam: fadeTargets[0],
        squareFadeTeam: fadeTargets[0],
      };
    }

    return {
      side,
      confidence,
      impliedBet: bet,
      breakdown: [
        ...breakdown,
        breakdownItem("result", "Result", `Result: ${side} (${confidence}%)`, confidence),
      ],
      dualFade,
    };
  }

  const conflictingSides = uniqueSides.map((u) => u.side).slice(0, 2);
  const conflictLabel = conflictingSides.join(" vs ");
  const conflictSignals = entries.map((e) => `${e.label} → ${e.impliedSide}`).join(" vs ");
  const fadeEntries = entries.filter((e) => FADE_SIGNALS.has(e.signalType));
  const fadeTargets = [...new Set(fadeEntries.map((e) => e.fadeTarget).filter(Boolean))];

  let dualFade: DualFadeInfo | undefined;
  if (fadeEntries.length >= 2 && fadeTargets.length >= 2) {
    dualFade = {
      isDualFade: true,
      isOpposingNoBet: true,
      bookNeedsFadeTeam: fadeTargets[0],
      squareFadeTeam: fadeTargets[1],
    };
  }

  return {
    side: null,
    confidence: RULE_CONFIDENCE.noBet,
    breakdown: [
      ...breakdown,
      breakdownItem(
        "result",
        "Result",
        `Result: No bet — conflicting: ${conflictSignals || conflictLabel}`
      ),
    ],
    noBetReason: `Conflicting signals on this game (${conflictLabel}) — no bet.`,
    conflictingSides,
    dualFade,
  };
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
    confidenceBreakdown: breakdown ?? [breakdownItem("no_bet", "No bet", `Result: No bet — ${reason}`)],
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
    conflictNote: reason,
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
  recommendedBet: ParsedBet | undefined,
  confidence: number,
  breakdown: ConfidenceBreakdownItem[],
  reasoning: string,
  matchedGame?: CalendarGame,
  dualFade?: DualFadeInfo
): { consolidated: GameConsolidatedRecommendation; updatedRecs: MatchedRecommendation[] } {
  const { awayTeam, homeTeam } = matchupLabels(recs);

  const consolidated: GameConsolidatedRecommendation = {
    gameKey,
    league: recs[0].league,
    awayTeam,
    homeTeam,
    recommendedTeam,
    recommendedBet,
    betType: recommendedBet?.betType,
    confidence,
    confidenceBreakdown: breakdown,
    hasConflict: false,
    pickIds: recs.map((r) => r.id),
    reasoning: `Game: ${awayTeam} @ ${homeTeam} · ${reasoning}`,
    matchedGame,
    dualFade,
  };

  const updatedRecs = recs.map((rec) => ({
    ...rec,
    gameKey,
    consolidatedTeam: recommendedTeam,
    consolidatedConfidence: confidence,
  }));

  return { consolidated, updatedRecs };
}

function resolveGameGroup(
  gameKey: string,
  recs: MatchedRecommendation[],
  slatePicks: SheetPick[]
): { consolidated: GameConsolidatedRecommendation; updatedRecs: MatchedRecommendation[] } {
  recs = filterRecsForGame(recs);
  const matchedGame = recs.find((r) => r.matchedGame)?.matchedGame;

  const impliedEntries = recs
    .map((rec) => impliedBetFromRec(rec, slatePicks, matchedGame))
    .filter((entry): entry is ImpliedBetEntry => entry != null);

  const resolved = resolveImpliedBets(impliedEntries);

  if (resolved.side == null) {
    return buildNoBetCard(
      gameKey,
      recs,
      resolved.noBetReason ?? "Conflicting signals on this game — no bet.",
      resolved.dualFade,
      matchedGame,
      resolved.breakdown
    );
  }

  const team = resolved.side;
  const recommendedBet = resolved.impliedBet;
  if (
    matchedGame &&
    recommendedBet?.betType !== "total" &&
    recommendedBet?.team &&
    !validateRecommendedTeam(recommendedBet.team, matchedGame)
  ) {
    return buildNoBetCard(
      gameKey,
      recs,
      `${team} is not part of this matchup.`,
      undefined,
      matchedGame,
      resolved.breakdown
    );
  }

  return buildBetCard(
    gameKey,
    recs,
    team,
    recommendedBet,
    resolved.confidence,
    resolved.breakdown,
    `Result: ${team} (${resolved.confidence}%)`,
    matchedGame,
    resolved.dualFade
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
        recs[0].matchedGame &&
        (FADE_SIGNALS.has(recs[0].signalType) || SHARP_BET_SIGNALS.has(recs[0].signalType)));

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
      parsedBet: pick.parsedBet ?? parsedBetForPick(pick),
      recommendedBet: rules.recommendedBet,
      opponentBet: rules.opponentBet,
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
