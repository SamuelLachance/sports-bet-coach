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
import { findDualFadePair, isOpposingDualFade } from "./dualFadeStats.js";
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
      const label =
        pick.signalType === "book_needs_fade"
          ? "Book Needs → bet opponent"
          : "Square Top → bet opponent";
      breakdown.push({
        key: "fade_rule",
        label: "Fade rule",
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
        edgeLabel: label,
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

/** Teams listed in Book Needs / Square Top — never recommend these */
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

function findFadePairForGame(
  recs: MatchedRecommendation[],
  slatePicks: SheetPick[],
  matchedGame?: CalendarGame
): { book?: SheetPick; square?: SheetPick } {
  const books = recs
    .filter((r) => r.signalType === "book_needs_fade" && !r.line)
    .map((r) => sheetPickFromRec(r, slatePicks));
  const squares = recs
    .filter((r) => r.signalType === "square_fade" && !r.line)
    .map((r) => sheetPickFromRec(r, slatePicks));

  if (books.length && squares.length) {
    return { book: books[0], square: squares[0] };
  }

  if (matchedGame) {
    const league = sportLeagueFromRec(recs[0]);
    return findDualFadePair(slatePicks, league, {
      homeTeam: matchedGame.homeTeam,
      awayTeam: matchedGame.awayTeam,
    });
  }

  return {};
}

/** Book fades A, Square fades B on same game (A ≠ B) → opposing dual-fade */
function isOpposingFadeOnGame(
  book: SheetPick,
  square: SheetPick,
  matchedGame?: CalendarGame
): boolean {
  const bookFade = normalizeTeamName(book.pick);
  const squareFade = normalizeTeamName(square.pick);
  if (bookFade === squareFade) return false;
  if (isOpposingDualFade(book, square)) return true;

  if (!matchedGame) return false;

  const bookInGame = pickBelongsToGame(book.pick, book.opponent, matchedGame);
  const squareInGame = pickBelongsToGame(square.pick, square.opponent, matchedGame);
  if (!bookInGame || !squareInGame) return false;

  // Same VS slot on sheet (even split across rows) with different fade targets
  if (
    book.gameSlot != null &&
    square.gameSlot != null &&
    book.gameSlot === square.gameSlot
  ) {
    return true;
  }

  return true;
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
  const { book, square } = findFadePairForGame(recs, slatePicks, matchedGame);

  const sharpRecs = recs.filter((r) => SHARP_BET_SIGNALS.has(r.signalType) && !r.line);

  // Rule 4: opposing dual-fade → no bet
  if (book && square && isOpposingFadeOnGame(book, square, matchedGame)) {
    const bookFadeTeam = displayTeamName(book.pick);
    const squareFadeTeam = displayTeamName(square.pick);
    const bookInverse = book.opponent ? displayTeamName(book.opponent) : squareFadeTeam;
    const squareInverse = square.opponent ? displayTeamName(square.opponent) : bookFadeTeam;
    const reason =
      `Book Needs lists ${bookFadeTeam} (→ ${bookInverse}) and Square Top lists ${squareFadeTeam} (→ ${squareInverse}). ` +
      `Both teams on opposite sides — conflicting signals, no bet.`;

    return buildNoBetCard(gameKey, recs, reason, {
      isDualFade: true,
      isOpposingNoBet: true,
      bookNeedsFadeTeam: bookFadeTeam,
      squareFadeTeam: squareFadeTeam,
    }, matchedGame, [
      {
        key: "no_bet_dual_fade",
        label: "No bet",
        value: 0,
        impact: 0,
        detail: `${bookFadeTeam} vs ${squareFadeTeam} — opposing fades cancel`,
      },
      {
        key: "book_fade",
        label: "Book Needs fade",
        value: RULE_CONFIDENCE.singleFade,
        impact: 0,
        detail: `Fade ${bookFadeTeam} → would bet ${bookInverse}`,
      },
      {
        key: "square_fade",
        label: "Square Top fade",
        value: RULE_CONFIDENCE.singleFade,
        impact: 0,
        detail: `Fade ${squareFadeTeam} → would bet ${squareInverse}`,
      },
    ]);
  }

  // Rule 6: Sharp takes priority over fades on same game
  if (sharpRecs.length > 0) {
    const sharp = sharpRecs[0];
    let team = displayTeamName(sharp.pick);
    if (matchedGame) {
      team = displayGameTeam(sharp.pick, matchedGame);
    }
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
        detail: `Overridden by Sharp Money on ${team}`,
      });
    }
    return buildBetCard(
      gameKey,
      recs,
      team,
      RULE_CONFIDENCE.sharp,
      breakdown,
      `Sharp Money → ${team} (${RULE_CONFIDENCE.sharp}%)`,
      matchedGame,
      undefined,
      recs.length > 1
    );
  }

  // Rule 5: same-side dual-fade → bet opponent
  if (book && square && normalizeTeamName(book.pick) === normalizeTeamName(square.pick)) {
    const fadeTarget = displayTeamName(book.pick);
    const opponent =
      extractOpponentName(book, slatePicks, matchedGame) ??
      extractOpponentName(square, slatePicks, matchedGame);
    if (opponent) {
      let team = opponent;
      if (matchedGame) team = displayGameTeam(opponent, matchedGame);
      return buildBetCard(
        gameKey,
        recs,
        team,
        RULE_CONFIDENCE.sameSideDualFade,
        [
          {
            key: "same_side_dual_fade",
            label: "Same-side dual fade",
            value: RULE_CONFIDENCE.sameSideDualFade,
            impact: RULE_CONFIDENCE.sameSideDualFade - 50,
            detail: `Book + Square both fade ${fadeTarget} → bet ${team}`,
          },
        ],
        `Book + Square both fade ${fadeTarget} → ${team} (${RULE_CONFIDENCE.sameSideDualFade}%)`,
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

    // Rule 9: never recommend a fade target
    if (!consolidated.noBet && consolidated.recommendedTeam && matchedGameValid(consolidated)) {
      const fadeTargets = fadeTargetsForRecs(recs, slatePicks, consolidated.matchedGame);
      if (
        isFadeTargetTeam(
          normalizeTeamName(consolidated.recommendedTeam),
          fadeTargets,
          consolidated.matchedGame
        )
      ) {
        const fadeRec = recs.find((r) => FADE_SIGNALS.has(r.signalType));
        const opp = fadeRec?.opponentPick;
        if (opp) {
          let team = opp;
          if (consolidated.matchedGame) team = displayGameTeam(opp, consolidated.matchedGame);
          consolidated.recommendedTeam = team;
          consolidated.confidence = RULE_CONFIDENCE.singleFade;
        }
      }
    }

    gameRecommendations.push(consolidated);
    for (const rec of updatedRecs) recById.set(rec.id, rec);
  }

  const ordered = recommendations.map((r) => recById.get(r.id) ?? r);
  return { recommendations: ordered, gameRecommendations };
}

function matchedGameValid(card: GameConsolidatedRecommendation): boolean {
  return !!card.matchedGame;
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
