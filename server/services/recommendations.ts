import type {
  CalendarGame,
  MatchedRecommendation,
  ParsedSheets,
  SheetPick,
} from "../types.js";
import { runBetRulesEngine } from "./betRulesEngine.js";
import { SIGNAL_LABELS } from "./signalMapping.js";
import { todayDisplayDate } from "./calendar.js";

export async function buildRecommendations(
  sheets: ParsedSheets,
  games: CalendarGame[],
  targetDate?: string
): Promise<{
  recommendations: MatchedRecommendation[];
  gameRecommendations: import("../types.js").GameConsolidatedRecommendation[];
}> {
  const gameDate = targetDate || todayDisplayDate();

  return runBetRulesEngine({
    slatePicks: sheets.dailyPicks,
    games,
    gameDate,
  });
}

export function getActiveLeagues(sheets: ParsedSheets): import("../types.js").LeagueCode[] {
  const leagues = new Set<import("../types.js").LeagueCode>();
  for (const pick of sheets.dailyPicks) {
    if (pick.league !== "UNKNOWN") leagues.add(pick.league);
  }
  return [...leagues];
}

export function filterByLeague(
  recs: MatchedRecommendation[],
  league: import("../types.js").LeagueCode | "ALL"
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
