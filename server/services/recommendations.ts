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
  fetchSportsOddsSlate,
  matchPredictionToCalendarGame,
  sportsOddsAppliesToLeague,
  sportsOddsBreakdownDetail,
  sportsOddsStatusForBet,
  sportsOddsTrendLabel,
  type SportsOddsGamePrediction,
} from "./sportsOddsAlgo.js";
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
  dratingsConfirmed?: boolean;
}): boolean {
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
  } else {
    blocked.dratingsConfirmed = false;
    blocked.dratingsStatus = status;
  }

  return blocked;
}

function applySportsOddsToGameRec(
  rec: GameConsolidatedRecommendation,
  prediction: SportsOddsGamePrediction | undefined
): GameConsolidatedRecommendation {
  if (rec.noBet || !rec.recommendedBet || !rec.matchedGame) return rec;
  if (!sportsOddsAppliesToLeague(rec.matchedGame.league)) return rec;

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
    return withDualAlgoFlag({
      ...rec,
      sportsOddsConfirmed: true,
      sportsOddsStatus: status,
      sportsOddsTrendLabel: sportsOddsTrendLabel(prediction),
      confidenceBreakdown: [
        ...rec.confidenceBreakdown.filter((b) => b.key !== "sportsOdds"),
        breakdownItem("sportsOdds", "Sports Odds", detail),
      ],
    });
  }

  const reason =
    status === "disagrees"
      ? `Sports Odds model favors a different side (${prediction ? sportsOddsTrendLabel(prediction) : "other side"})`
      : rec.recommendedBet.betType === "total"
        ? "Totals cannot be confirmed by Sports Odds — dual algo requires agreement"
        : "Sports Odds prediction unavailable — dual algo requires agreement";

  return blockGameRec(rec, reason, "sportsOdds", status, detail);
}

function applySportsOddsToPickRec(
  rec: MatchedRecommendation,
  prediction: SportsOddsGamePrediction | undefined
): MatchedRecommendation {
  if (!rec.matchedGame || rec.confidence <= 0) return rec;
  if (!sportsOddsAppliesToLeague(rec.matchedGame.league)) return rec;

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
  predictions: SportsOddsGamePrediction[]
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

  const recommendations = result.recommendations.map((rec) => {
    const prediction = rec.matchedGame
      ? matchPredictionToCalendarGame(rec.matchedGame, predictions)
      : undefined;
    return applySportsOddsToPickRec(rec, prediction);
  });

  return { recommendations, gameRecommendations };
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
    result = applySportsOddsFilter(result, predictions);
  }

  if (!isDratingsEnabled()) return result;

  if (options?.skipDratingsFetch && !options.dratingsTrends) {
    return applyDratingsFilter(result, []);
  }

  const leagues = [...new Set(games.map((g) => g.league))] as LeagueCode[];
  const trends =
    options?.dratingsTrends ??
    (await fetchDratingsTrends(leagues, gameDate)).trends;

  return applyDratingsFilter(result, trends);
}

export function countSportsOddsFilterStats(result: {
  recommendations: MatchedRecommendation[];
  gameRecommendations: GameConsolidatedRecommendation[];
}): {
  picksBlocked: number;
  picksConfirmed: number;
  gamesNoBet: number;
  gamesConfirmed: number;
  dualAlgoGames: number;
} {
  return {
    picksBlocked: result.recommendations.filter((r) => r.sportsOddsBlocked).length,
    picksConfirmed: result.recommendations.filter((r) => r.sportsOddsConfirmed).length,
    gamesNoBet: result.gameRecommendations.filter(
      (g) => g.noBet && g.sportsOddsStatus && g.sportsOddsStatus !== "agrees"
    ).length,
    gamesConfirmed: result.gameRecommendations.filter((g) => g.sportsOddsConfirmed).length,
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
