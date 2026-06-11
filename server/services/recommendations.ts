import type {
  CalendarGame,
  ConfidenceBreakdownItem,
  GameConsolidatedRecommendation,
  LeagueCode,
  MatchedRecommendation,
  ParsedSheets,
} from "../types.js";
import { isDratingsEnabled } from "../config.js";
import { runBetRulesEngine, RULE_CONFIDENCE } from "./betRulesEngine.js";
import {
  dratingsBreakdownDetail,
  dratingsStatusForBet,
  fetchDratingsTrends,
  matchTrendToCalendarGame,
  type DratingsGameTrend,
} from "./dratingsTrends.js";
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

function blockGameRec(
  rec: GameConsolidatedRecommendation,
  reason: string,
  dratingsStatus: GameConsolidatedRecommendation["dratingsStatus"],
  dratingsDetail: string
): GameConsolidatedRecommendation {
  return {
    ...rec,
    recommendedTeam: "",
    recommendedBet: undefined,
    betType: undefined,
    confidence: RULE_CONFIDENCE.noBet,
    noBet: true,
    noBetReason: reason,
    hasConflict: true,
    dratingsConfirmed: false,
    dratingsStatus,
    confidenceBreakdown: [
      ...rec.confidenceBreakdown.filter((b) => b.key !== "dratings"),
      breakdownItem("dratings", "DRatings", dratingsDetail),
      breakdownItem("result", "Result", `Result: No bet — ${reason}`),
    ],
    reasoning: `${rec.reasoning.split(" · Result:")[0]} · ${reason}`,
  };
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
    return {
      ...rec,
      dratingsConfirmed: true,
      dratingsStatus: status,
      dratingsTrendLabel: trendLabel,
      confidenceBreakdown: [
        ...rec.confidenceBreakdown.filter((b) => b.key !== "dratings"),
        breakdownItem("dratings", "DRatings", detail),
      ],
    };
  }

  const reason =
    status === "disagrees"
      ? `DRatings trends favor a different side (${trendLabel ?? "other side"})`
      : "DRatings trends unavailable — cannot verify agreement";

  return blockGameRec(rec, reason, status, detail);
}

function applyDratingsToPickRec(
  rec: MatchedRecommendation,
  trend: DratingsGameTrend | undefined
): MatchedRecommendation {
  if (!rec.matchedGame || rec.confidence <= 0) return rec;

  const bet = impliedBetForRec(rec);
  const status = dratingsStatusForBet(bet, rec.matchedGame, trend);

  if (status === "agrees") {
    return {
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
    };
  }

  return {
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
  };
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
  options?: { dratingsTrends?: DratingsGameTrend[]; skipDratingsFetch?: boolean }
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

  if (options?.skipDratingsFetch && !options.dratingsTrends) {
    return engineResult;
  }

  const leagues = [...new Set(games.map((g) => g.league))] as LeagueCode[];
  const trends =
    options?.dratingsTrends ??
    (await fetchDratingsTrends(leagues, gameDate)).trends;

  return applyDratingsFilter(engineResult, trends);
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
