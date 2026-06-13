import type {
  CalendarGame,
  ConfidenceBreakdownItem,
  GameConsolidatedRecommendation,
  LeagueCode,
  MatchedRecommendation,
  ParsedSheets,
} from "../types.js";
import { isDratingsEnabled, isSportsOddsEnabled } from "../config.js";
import { runBetRulesEngine, RULE_CONFIDENCE } from "./betRulesEngine.js";
import {
  dratingsBreakdownDetail,
  dratingsStatusForBet,
  fetchDratingsTrends,
  matchTrendToCalendarGame,
  type DratingsGameTrend,
} from "./dratingsTrends.js";
import {
  buildSportsOddsGameKey,
  fetchSportsOddsSlate,
  isSportsOddsForcePick,
  matchPredictionToCalendarGame,
  sportsOddsAppliesToLeague,
  sportsOddsBreakdownDetail,
  sportsOddsForceBreakdownDetail,
  sportsOddsForceConfidence,
  sportsOddsModelLayersAgree,
  sportsOddsPreferredBetForCoach,
  sportsOddsStatusForBet,
  sportsOddsTrendLabel,
  sportsOddsValueBet,
  sportsOddsValueTrendLabel,
  canonicalEventKeyForGame,
  formatAmericanOdds,
  sportsOddsConsensusForBet,
  teamSideForBet,
  type SportsOddsGamePrediction,
} from "./sportsOddsAlgo.js";
import { DEFAULT_JUICE } from "../parsers/pickBetParser.js";
import { SIGNAL_LABELS } from "./signalMapping.js";
import { todayDisplayDate } from "./calendar.js";

function breakdownItem(
  key: string,
  label: string,
  detail: string,
  value = 0
): ConfidenceBreakdownItem {
  return { key, label, value, impact: 0, detail };
}

function impliedBetForRec(rec: MatchedRecommendation) {
  return rec.recommendedBet ?? rec.opponentBet ?? rec.parsedBet;
}

function isDualAlgoConfirmed(rec: {
  sportsOddsConfirmed?: boolean;
  sportsOddsForced?: boolean;
  dratingsConfirmed?: boolean;
}): boolean {
  if (rec.sportsOddsForced) return false;
  if (!rec.sportsOddsConfirmed) return false;
  if (!isDratingsEnabled()) return true;
  return Boolean(rec.dratingsConfirmed);
}

function withDualAlgoFlag<T extends GameConsolidatedRecommendation | MatchedRecommendation>(
  rec: T
): T {
  return { ...rec, dualAlgoConfirmed: isDualAlgoConfirmed(rec) };
}

function blockGameRec(
  rec: GameConsolidatedRecommendation,
  reason: string,
  filterKey: "sportsOdds" | "dratings",
  status: "agrees" | "disagrees" | "unavailable",
  detail: string
): GameConsolidatedRecommendation {
  const blocked: GameConsolidatedRecommendation = {
    ...rec,
    recommendedTeam: "",
    recommendedBet: undefined,
    betType: undefined,
    confidence: RULE_CONFIDENCE.noBet,
    noBet: true,
    noBetReason: reason,
    hasConflict: true,
    dualAlgoConfirmed: false,
    confidenceBreakdown: [
      ...rec.confidenceBreakdown.filter((b) => b.key !== filterKey && b.key !== "result"),
      breakdownItem(filterKey, filterKey === "sportsOdds" ? "Sports Odds" : "DRatings", detail),
      breakdownItem("result", "Result", `Result: No bet — ${reason}`),
    ],
    reasoning: `${rec.reasoning.split(" · Result:")[0]} · ${reason}`,
  };

  if (filterKey === "sportsOdds") {
    blocked.sportsOddsConfirmed = false;
    blocked.sportsOddsStatus = status;
    blocked.sportsOddsBlocked = true;
  } else {
    blocked.dratingsConfirmed = false;
    blocked.dratingsStatus = status;
  }

  return blocked;
}

function withBookConsensus(
  rec: GameConsolidatedRecommendation,
  prediction?: SportsOddsGamePrediction
): GameConsolidatedRecommendation {
  if (rec.noBet || !rec.recommendedBet || !rec.matchedGame) return rec;

  const fromMarket =
    prediction &&
    sportsOddsConsensusForBet(rec.recommendedBet, rec.matchedGame, prediction);

  if (fromMarket) {
    const betType = rec.recommendedBet.betType;
    const consensusOdds =
      betType === "spread" || betType === "total"
        ? (rec.recommendedBet.odds ?? DEFAULT_JUICE)
        : fromMarket.moneyline;

    return {
      ...rec,
      bookProvider: fromMarket.provider,
      consensusOdds,
      consensusSpread: fromMarket.spread,
      consensusTotal: fromMarket.total,
      consensusLabel: fromMarket.label,
    };
  }

  const sheetOdds = rec.recommendedBet.odds;
  if (sheetOdds != null && Number.isFinite(sheetOdds)) {
    return {
      ...rec,
      consensusOdds: sheetOdds,
      consensusLabel: formatAmericanOdds(sheetOdds),
    };
  }

  return rec;
}

function buildForcedSportsOddsGameRec(
  base: GameConsolidatedRecommendation,
  prediction: SportsOddsGamePrediction
): GameConsolidatedRecommendation {
  const game = base.matchedGame!;
  const bet = sportsOddsValueBet(prediction, game);
  const teamLabel = bet.displayText;
  const forceDetail = sportsOddsForceBreakdownDetail(prediction);
  const valueLabel = sportsOddsValueTrendLabel(prediction);
  const coachNote = base.noBet
    ? breakdownItem(
        "coach",
        "Coach",
        `Coach: no bet${base.noBetReason ? ` — ${base.noBetReason}` : ""}`
      )
    : breakdownItem(
        "coach",
        "Coach",
        `Coach favored ${base.recommendedTeam} — overridden by high book edge`
      );

  return withBookConsensus(
    withDualAlgoFlag({
      ...base,
      recommendedTeam: teamLabel,
      recommendedBet: bet,
      betType: bet.betType,
      confidence: sportsOddsForceConfidence(prediction),
      noBet: false,
      noBetReason: undefined,
      hasConflict: base.hasConflict,
      sportsOddsConfirmed: true,
      sportsOddsForced: true,
      sportsOddsStatus: "agrees",
      sportsOddsTrendLabel: valueLabel,
      dualAlgoConfirmed: false,
      confidenceBreakdown: [
        ...base.confidenceBreakdown.filter(
          (b) => b.key !== "sportsOdds" && b.key !== "result" && b.key !== "coach"
        ),
        coachNote,
        breakdownItem("sportsOdds", "Sports Odds", forceDetail),
        breakdownItem("result", "Result", `Result: Force pick — ${teamLabel}`),
      ],
      reasoning: `Sports Odds force pick — ${valueLabel} overrides coach${base.noBet ? " no-bet" : " disagreement"}.`,
    }),
    prediction
  );
}

function shouldForceSportsOddsOverride(
  rec: GameConsolidatedRecommendation,
  prediction: SportsOddsGamePrediction | undefined
): boolean {
  if (
    !prediction ||
    !rec.matchedGame ||
    !isSportsOddsForcePick(prediction)
  ) {
    return false;
  }
  if (rec.noBet) return true;
  if (!rec.recommendedBet) return false;
  return (
    sportsOddsStatusForBet(rec.recommendedBet, rec.matchedGame, prediction) ===
    "disagrees"
  );
}

function applySportsOddsToGameRec(
  rec: GameConsolidatedRecommendation,
  prediction: SportsOddsGamePrediction | undefined
): GameConsolidatedRecommendation {
  if (!rec.matchedGame || !sportsOddsAppliesToLeague(rec.matchedGame.league)) {
    return rec;
  }

  if (shouldForceSportsOddsOverride(rec, prediction)) {
    return buildForcedSportsOddsGameRec(rec, prediction!);
  }

  if (rec.noBet || !rec.recommendedBet) return rec;

  if (prediction && !sportsOddsModelLayersAgree(prediction)) {
    return blockGameRec(
      rec,
      "Sports Odds model layers disagree — all 3 layers must find value",
      "sportsOdds",
      "disagrees",
      "Sports Odds: all 3 layers must find value on the same side (no bet)"
    );
  }

  const status = sportsOddsStatusForBet(
    rec.recommendedBet,
    rec.matchedGame,
    prediction
  );
  const detail = sportsOddsBreakdownDetail(
    status,
    prediction,
    rec.recommendedBet,
    rec.matchedGame
  );

  if (status === "agrees" && prediction) {
    const preferredBet = sportsOddsPreferredBetForCoach(
      rec.recommendedBet,
      rec.matchedGame,
      prediction
    );
    return withBookConsensus(
      withDualAlgoFlag({
        ...rec,
        recommendedBet: preferredBet,
        betType: preferredBet.betType,
        recommendedTeam: preferredBet.displayText,
        sportsOddsConfirmed: true,
        sportsOddsStatus: status,
        sportsOddsTrendLabel: sportsOddsTrendLabel(prediction),
        confidenceBreakdown: [
          ...rec.confidenceBreakdown.filter((b) => b.key !== "sportsOdds"),
          breakdownItem("sportsOdds", "Sports Odds", detail),
        ],
      }),
      prediction
    );
  }

  const reason =
    status === "disagrees"
      ? `Sports Odds model favors a different side (${prediction ? sportsOddsTrendLabel(prediction) : "other side"})`
      : rec.recommendedBet.betType === "total"
        ? "Totals cannot be confirmed by Sports Odds — dual algo requires agreement"
        : "Sports Odds prediction unavailable — dual algo requires agreement";

  return blockGameRec(rec, reason, "sportsOdds", status, detail);
}

function gameRecMatchesPrediction(
  rec: GameConsolidatedRecommendation,
  prediction: SportsOddsGamePrediction
): boolean {
  if (!rec.matchedGame) return false;
  return matchPredictionToCalendarGame(rec.matchedGame, [prediction]) != null;
}

function injectForcedSportsOddsPicks(
  gameRecs: GameConsolidatedRecommendation[],
  predictions: SportsOddsGamePrediction[],
  games: CalendarGame[]
): GameConsolidatedRecommendation[] {
  const added: GameConsolidatedRecommendation[] = [];

  for (const prediction of predictions) {
    if (!isSportsOddsForcePick(prediction)) continue;
    if (!sportsOddsAppliesToLeague(prediction.league)) continue;
    if (gameRecs.some((rec) => gameRecMatchesPrediction(rec, prediction))) continue;

    const game = games.find(
      (candidate) => matchPredictionToCalendarGame(candidate, [prediction]) != null
    );
    if (!game) continue;

    const gameKey = game.id
      ? `${game.league}:espn-${game.id}`
      : buildSportsOddsGameKey(game.league, game.awayTeam, game.homeTeam);

    added.push(
      buildForcedSportsOddsGameRec(
        {
          gameKey,
          league: game.league,
          awayTeam: game.awayTeam,
          homeTeam: game.homeTeam,
          recommendedTeam: "",
          confidence: 0,
          confidenceBreakdown: [],
          hasConflict: false,
          pickIds: [],
          reasoning: "",
          matchedGame: game,
        },
        prediction
      )
    );
  }

  return added;
}

function applySportsOddsToPickRec(
  rec: MatchedRecommendation,
  prediction: SportsOddsGamePrediction | undefined
): MatchedRecommendation {
  if (!rec.matchedGame || rec.confidence <= 0) return rec;
  if (!sportsOddsAppliesToLeague(rec.matchedGame.league)) return rec;

  if (prediction && !sportsOddsModelLayersAgree(prediction)) {
    return withDualAlgoFlag({
      ...rec,
      sportsOddsConfirmed: false,
      sportsOddsStatus: "disagrees",
      sportsOddsBlocked: true,
      confidenceBreakdown: [
        ...rec.confidenceBreakdown.filter((b) => b.key !== "sportsOdds"),
        breakdownItem(
          "sportsOdds",
          "Sports Odds",
          "Sports Odds: all 3 layers must find value on the same side (no bet)"
        ),
      ],
    });
  }

  const bet = impliedBetForRec(rec);
  const status = sportsOddsStatusForBet(bet, rec.matchedGame, prediction);
  const detail = sportsOddsBreakdownDetail(status, prediction, bet, rec.matchedGame);

  if (status === "agrees") {
    return withDualAlgoFlag({
      ...rec,
      sportsOddsConfirmed: true,
      sportsOddsStatus: status,
      confidenceBreakdown: [
        ...rec.confidenceBreakdown.filter((b) => b.key !== "sportsOdds"),
        breakdownItem("sportsOdds", "Sports Odds", detail),
      ],
    });
  }

  return withDualAlgoFlag({
    ...rec,
    sportsOddsConfirmed: false,
    sportsOddsStatus: status,
    sportsOddsBlocked: true,
    confidenceBreakdown: [
      ...rec.confidenceBreakdown.filter((b) => b.key !== "sportsOdds"),
      breakdownItem("sportsOdds", "Sports Odds", detail),
    ],
  });
}

export function applySportsOddsFilter(
  result: {
    recommendations: MatchedRecommendation[];
    gameRecommendations: GameConsolidatedRecommendation[];
  },
  predictions: SportsOddsGamePrediction[],
  games: CalendarGame[] = []
): {
  recommendations: MatchedRecommendation[];
  gameRecommendations: GameConsolidatedRecommendation[];
} {
  if (!isSportsOddsEnabled()) return result;

  const gameRecommendations = result.gameRecommendations.map((rec) => {
    const prediction = rec.matchedGame
      ? matchPredictionToCalendarGame(rec.matchedGame, predictions)
      : undefined;
    return applySportsOddsToGameRec(rec, prediction);
  });

  gameRecommendations.push(
    ...injectForcedSportsOddsPicks(gameRecommendations, predictions, games)
  );

  const enrichedGameRecommendations = gameRecommendations.map((rec) => {
    if (rec.consensusLabel || rec.noBet || !rec.matchedGame) return rec;
    const prediction = matchPredictionToCalendarGame(rec.matchedGame, predictions);
    return withBookConsensus(rec, prediction);
  });

  const recommendations = result.recommendations.map((rec) => {
    const prediction = rec.matchedGame
      ? matchPredictionToCalendarGame(rec.matchedGame, predictions)
      : undefined;
    return applySportsOddsToPickRec(rec, prediction);
  });

  return { recommendations, gameRecommendations: enrichedGameRecommendations };
}

function applyDratingsToGameRec(
  rec: GameConsolidatedRecommendation,
  trend: DratingsGameTrend | undefined
): GameConsolidatedRecommendation {
  if (rec.noBet || !rec.recommendedBet || !rec.matchedGame) return rec;

  const status = dratingsStatusForBet(rec.recommendedBet, rec.matchedGame, trend);
  const trendLabel =
    rec.recommendedBet.betType === "total"
      ? trend?.total.trendLabel
      : trend?.moneyLine.trendLabel;
  const detail = dratingsBreakdownDetail(status, trend, rec.recommendedBet);

  if (status === "agrees") {
    return withDualAlgoFlag({
      ...rec,
      dratingsConfirmed: true,
      dratingsStatus: status,
      dratingsTrendLabel: trendLabel,
      confidenceBreakdown: [
        ...rec.confidenceBreakdown.filter((b) => b.key !== "dratings"),
        breakdownItem("dratings", "DRatings", detail),
      ],
    });
  }

  const reason =
    status === "disagrees"
      ? `DRatings trends favor a different side (${trendLabel ?? "other side"})`
      : "DRatings trends unavailable — cannot verify agreement";

  return blockGameRec(rec, reason, "dratings", status, detail);
}

function applyDratingsToPickRec(
  rec: MatchedRecommendation,
  trend: DratingsGameTrend | undefined
): MatchedRecommendation {
  if (!rec.matchedGame || rec.confidence <= 0) return rec;

  const bet = impliedBetForRec(rec);
  const status = dratingsStatusForBet(bet, rec.matchedGame, trend);

  if (status === "agrees") {
    return withDualAlgoFlag({
      ...rec,
      dratingsConfirmed: true,
      dratingsStatus: status,
      confidenceBreakdown: [
        ...rec.confidenceBreakdown.filter((b) => b.key !== "dratings"),
        breakdownItem(
          "dratings",
          "DRatings",
          dratingsBreakdownDetail(status, trend, bet)
        ),
      ],
    });
  }

  return withDualAlgoFlag({
    ...rec,
    dratingsConfirmed: false,
    dratingsStatus: status,
    dratingsBlocked: true,
    confidenceBreakdown: [
      ...rec.confidenceBreakdown.filter((b) => b.key !== "dratings"),
      breakdownItem(
        "dratings",
        "DRatings",
        dratingsBreakdownDetail(status, trend, bet)
      ),
    ],
  });
}

export function applyDratingsFilter(
  result: {
    recommendations: MatchedRecommendation[];
    gameRecommendations: GameConsolidatedRecommendation[];
  },
  trends: DratingsGameTrend[]
): {
  recommendations: MatchedRecommendation[];
  gameRecommendations: GameConsolidatedRecommendation[];
} {
  if (!isDratingsEnabled()) return result;

  const gameRecommendations = result.gameRecommendations.map((rec) => {
    const trend = rec.matchedGame
      ? matchTrendToCalendarGame(rec.matchedGame, trends)
      : undefined;
    return applyDratingsToGameRec(rec, trend);
  });

  const recommendations = result.recommendations.map((rec) => {
    const trend = rec.matchedGame
      ? matchTrendToCalendarGame(rec.matchedGame, trends)
      : undefined;
    return applyDratingsToPickRec(rec, trend);
  });

  return { recommendations, gameRecommendations };
}

const EVENT_CONFLICT_REASON =
  "Conflicting recommendations on different teams for the same game — no bet.";

function eventKeyForGame(game: CalendarGame): string {
  return canonicalEventKeyForGame(game);
}

function isActionableGameRecommendation(
  rec: GameConsolidatedRecommendation
): boolean {
  return !rec.noBet && Boolean(rec.recommendedBet) && Boolean(rec.matchedGame);
}

function isActionablePickRecommendation(rec: MatchedRecommendation): boolean {
  if (!rec.matchedGame || rec.confidence <= 0) return false;
  if (rec.sportsOddsBlocked || rec.dratingsBlocked) return false;
  const bet = impliedBetForRec(rec);
  if (!bet || bet.betType === "total") return false;
  return teamSideForBet(bet, rec.matchedGame) != null;
}

function pickCountsForEventConflict(
  rec: MatchedRecommendation,
  actionableGameRecsByEvent: Map<string, GameConsolidatedRecommendation[]>
): boolean {
  if (!isActionablePickRecommendation(rec) || !rec.matchedGame) return false;
  const key = eventKeyForGame(rec.matchedGame);
  const gameRecs = actionableGameRecsByEvent.get(key) ?? [];
  return !gameRecs.some((gameRec) => gameRec.pickIds.includes(rec.id));
}

function toEventConflictNoBet(
  rec: GameConsolidatedRecommendation,
  pickIds: string[]
): GameConsolidatedRecommendation {
  const mergedPickIds = [...new Set([...rec.pickIds, ...pickIds])];
  return {
    ...rec,
    recommendedTeam: "",
    recommendedBet: undefined,
    betType: undefined,
    confidence: RULE_CONFIDENCE.noBet,
    noBet: true,
    noBetReason: EVENT_CONFLICT_REASON,
    hasConflict: true,
    dualAlgoConfirmed: false,
    sportsOddsForced: false,
    sportsOddsConfirmed: false,
    pickIds: mergedPickIds,
    confidenceBreakdown: [
      ...rec.confidenceBreakdown.filter((b) => b.key !== "result"),
      breakdownItem("result", "Result", `Result: No bet — ${EVENT_CONFLICT_REASON}`),
    ],
    reasoning: `Game: ${rec.awayTeam} @ ${rec.homeTeam} · ${EVENT_CONFLICT_REASON}`,
  };
}

function buildEventConflictNoBetCard(
  game: CalendarGame,
  pickIds: string[]
): GameConsolidatedRecommendation {
  const gameKey = eventKeyForGame(game);
  return {
    gameKey,
    league: game.league,
    awayTeam: game.awayTeam,
    homeTeam: game.homeTeam,
    recommendedTeam: "",
    confidence: RULE_CONFIDENCE.noBet,
    noBet: true,
    noBetReason: EVENT_CONFLICT_REASON,
    confidenceBreakdown: [
      breakdownItem("result", "Result", `Result: No bet — ${EVENT_CONFLICT_REASON}`),
    ],
    hasConflict: true,
    pickIds: [...new Set(pickIds)],
    reasoning: `Game: ${game.awayTeam} @ ${game.homeTeam} · ${EVENT_CONFLICT_REASON}`,
    matchedGame: game,
  };
}

export function applyEventTeamConflictFilter(result: {
  recommendations: MatchedRecommendation[];
  gameRecommendations: GameConsolidatedRecommendation[];
}): {
  recommendations: MatchedRecommendation[];
  gameRecommendations: GameConsolidatedRecommendation[];
} {
  const sidesByEvent = new Map<string, Set<"away" | "home" | "draw">>();
  const pickIdsByEvent = new Map<string, Set<string>>();
  const actionableGameRecsByEvent = new Map<
    string,
    GameConsolidatedRecommendation[]
  >();

  const notePick = (game: CalendarGame, pickId: string) => {
    const key = eventKeyForGame(game);
    const ids = pickIdsByEvent.get(key) ?? new Set<string>();
    ids.add(pickId);
    pickIdsByEvent.set(key, ids);
  };

  const noteSide = (game: CalendarGame, side: "away" | "home" | "draw") => {
    const key = eventKeyForGame(game);
    const sides = sidesByEvent.get(key) ?? new Set();
    sides.add(side);
    sidesByEvent.set(key, sides);
  };

  for (const rec of result.gameRecommendations) {
    if (!isActionableGameRecommendation(rec) || !rec.recommendedBet || !rec.matchedGame) {
      continue;
    }
    const key = eventKeyForGame(rec.matchedGame);
    const bucket = actionableGameRecsByEvent.get(key) ?? [];
    bucket.push(rec);
    actionableGameRecsByEvent.set(key, bucket);

    const side = teamSideForBet(rec.recommendedBet, rec.matchedGame);
    if (side) noteSide(rec.matchedGame, side);
    for (const id of rec.pickIds) notePick(rec.matchedGame, id);
  }

  for (const rec of result.recommendations) {
    if (!pickCountsForEventConflict(rec, actionableGameRecsByEvent)) continue;
    const bet = impliedBetForRec(rec)!;
    const side = teamSideForBet(bet, rec.matchedGame!);
    if (side) noteSide(rec.matchedGame!, side);
    notePick(rec.matchedGame!, rec.id);
  }

  const conflictedEvents = new Set<string>();
  for (const [eventKey, recs] of actionableGameRecsByEvent) {
    if (recs.length > 1) conflictedEvents.add(eventKey);
  }
  for (const [eventKey, sides] of sidesByEvent) {
    if (sides.size > 1) conflictedEvents.add(eventKey);
  }
  if (conflictedEvents.size === 0) return result;

  const recommendations = result.recommendations.map((rec) => {
    if (!rec.matchedGame) return rec;
    const key = eventKeyForGame(rec.matchedGame);
    if (!conflictedEvents.has(key)) return rec;
    return {
      ...rec,
      gameConflict: true,
      conflictNote: EVENT_CONFLICT_REASON,
      edgeLabel: "No bet — opposing teams on same game",
      consolidatedTeam: undefined,
      consolidatedConfidence: 0,
    };
  });

  const gameRecommendations: GameConsolidatedRecommendation[] = [];

  for (const rec of result.gameRecommendations) {
    if (!rec.matchedGame) {
      gameRecommendations.push(rec);
      continue;
    }
    const key = eventKeyForGame(rec.matchedGame);
    if (!conflictedEvents.has(key)) {
      gameRecommendations.push(rec);
    }
  }

  for (const eventKey of conflictedEvents) {
    const conflictingRecs = actionableGameRecsByEvent.get(eventKey) ?? [];
    const pickIds = [...(pickIdsByEvent.get(eventKey) ?? new Set<string>())];
    for (const rec of conflictingRecs) {
      for (const id of rec.pickIds) {
        if (!pickIds.includes(id)) pickIds.push(id);
      }
    }

    const template =
      conflictingRecs[0] ??
      result.gameRecommendations.find(
        (rec) => rec.matchedGame && eventKeyForGame(rec.matchedGame) === eventKey
      );

    const sampleGame =
      template?.matchedGame ??
      result.recommendations.find(
        (rec) => rec.matchedGame && eventKeyForGame(rec.matchedGame) === eventKey
      )?.matchedGame;

    if (template && template.matchedGame) {
      gameRecommendations.push(toEventConflictNoBet(template, pickIds));
    } else if (sampleGame) {
      gameRecommendations.push(buildEventConflictNoBetCard(sampleGame, pickIds));
    }
  }

  return { recommendations, gameRecommendations };
}

export async function buildRecommendations(
  sheets: ParsedSheets,
  games: CalendarGame[],
  targetDate?: string,
  options?: {
    dratingsTrends?: DratingsGameTrend[];
    skipDratingsFetch?: boolean;
    sportsOddsPredictions?: SportsOddsGamePrediction[];
    skipSportsOddsFetch?: boolean;
  }
): Promise<{
  recommendations: MatchedRecommendation[];
  gameRecommendations: GameConsolidatedRecommendation[];
}> {
  const gameDate = targetDate || todayDisplayDate();

  const engineResult = runBetRulesEngine({
    slatePicks: sheets.dailyPicks,
    games,
    gameDate,
  });

  let result = engineResult;

  if (isSportsOddsEnabled()) {
    const predictions =
      options?.sportsOddsPredictions ??
      (options?.skipSportsOddsFetch
        ? []
        : (await fetchSportsOddsSlate(gameDate)).games);
    result = applySportsOddsFilter(result, predictions, games);
  }

  if (!isDratingsEnabled()) {
    return applyEventTeamConflictFilter(result);
  }

  if (options?.skipDratingsFetch && !options.dratingsTrends) {
    return applyEventTeamConflictFilter(applyDratingsFilter(result, []));
  }

  const leagues = [...new Set(games.map((g) => g.league))] as LeagueCode[];
  const trends =
    options?.dratingsTrends ??
    (await fetchDratingsTrends(leagues, gameDate)).trends;

  return applyEventTeamConflictFilter(applyDratingsFilter(result, trends));
}

export function countSportsOddsFilterStats(result: {
  recommendations: MatchedRecommendation[];
  gameRecommendations: GameConsolidatedRecommendation[];
}): {
  picksBlocked: number;
  picksConfirmed: number;
  gamesNoBet: number;
  gamesConfirmed: number;
  gamesForced: number;
  dualAlgoGames: number;
} {
  return {
    picksBlocked: result.recommendations.filter((r) => r.sportsOddsBlocked).length,
    picksConfirmed: result.recommendations.filter((r) => r.sportsOddsConfirmed).length,
    gamesNoBet: result.gameRecommendations.filter(
      (g) => g.noBet && g.sportsOddsStatus && g.sportsOddsStatus !== "agrees"
    ).length,
    gamesConfirmed: result.gameRecommendations.filter((g) => g.sportsOddsConfirmed).length,
    gamesForced: result.gameRecommendations.filter((g) => g.sportsOddsForced).length,
    dualAlgoGames: result.gameRecommendations.filter((g) => g.dualAlgoConfirmed).length,
  };
}

export function countDratingsFilterStats(result: {
  recommendations: MatchedRecommendation[];
  gameRecommendations: GameConsolidatedRecommendation[];
}): {
  picksBlocked: number;
  picksConfirmed: number;
  gamesNoBet: number;
  gamesConfirmed: number;
} {
  return {
    picksBlocked: result.recommendations.filter((r) => r.dratingsBlocked).length,
    picksConfirmed: result.recommendations.filter((r) => r.dratingsConfirmed).length,
    gamesNoBet: result.gameRecommendations.filter(
      (g) => g.noBet && g.dratingsStatus && g.dratingsStatus !== "agrees"
    ).length,
    gamesConfirmed: result.gameRecommendations.filter((g) => g.dratingsConfirmed).length,
  };
}

export function getActiveLeagues(sheets: ParsedSheets): LeagueCode[] {
  const leagues = new Set<LeagueCode>();
  for (const pick of sheets.dailyPicks) {
    if (pick.league !== "UNKNOWN") leagues.add(pick.league);
  }
  return [...leagues];
}

export function filterByLeague(
  recs: MatchedRecommendation[],
  league: LeagueCode | "ALL"
): MatchedRecommendation[] {
  if (league === "ALL") return recs;
  return recs.filter((r) => r.league === league);
}

export function groupBySignal(
  recs: MatchedRecommendation[]
): Record<string, MatchedRecommendation[]> {
  return recs.reduce(
    (acc, rec) => {
      const key = rec.signalType;
      if (!acc[key]) acc[key] = [];
      acc[key].push(rec);
      return acc;
    },
    {} as Record<string, MatchedRecommendation[]>
  );
}

export { SIGNAL_LABELS };
