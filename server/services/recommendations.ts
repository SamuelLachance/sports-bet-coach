import { formatInTimeZone } from "date-fns-tz";
import { TIMEZONE } from "../config.js";
import type {
  CalendarGame,
  MatchedRecommendation,
  ParsedSheets,
  SheetPick,
  SignalType,
} from "../types.js";
import { getConfidenceStats, getDualFadeStats, getFullHistoryStats } from "./confidenceCache.js";
import {
  applyConfidenceToRecommendation,
  buildGameKey,
  computeConfidence,
  resolveGameConflicts,
} from "./confidenceEngine.js";
import { SIGNAL_LABELS_FR } from "./signalMapping.js";
import { matchPickToGame, todayDisplayDate } from "./calendar.js";

function buildReasoning(pick: SheetPick, game?: CalendarGame): string {
  const signal = SIGNAL_LABELS_FR[pick.signalType];
  const parts = [`Signal: ${signal}`];

  if (pick.opponent) {
    parts.push(`Matchup fade: ${pick.pick} vs ${pick.opponent}`);
  } else if (pick.line) {
    parts.push(`Ligne: ${pick.pick} ${pick.line}`);
  } else {
    parts.push(`Sélection: ${pick.pick}`);
  }

  if (pick.gameTime) parts.push(`Heure affichée: ${pick.gameTime}`);
  if (pick.postingTime) parts.push(`Publié: ${pick.postingTime}`);

  if (game) {
    parts.push(
      `Match confirmé: ${game.awayTeam} @ ${game.homeTeam} (${formatInTimeZone(
        new Date(game.startTime),
        TIMEZONE,
        "HH:mm"
      )} HE)`
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

const SPECIAL_TO_SPORT: Partial<Record<string, string>> = {
  MEGA_SHARPS: "MLB",
  WHALE: "MLB",
  MODEL: "MLB",
  RLM: "MLB",
};

function sportLeagueForPick(pick: SheetPick): string {
  return SPECIAL_TO_SPORT[pick.league] || pick.league;
}

export async function buildRecommendations(
  sheets: ParsedSheets,
  games: CalendarGame[],
  targetDate?: string
): Promise<{
  recommendations: MatchedRecommendation[];
  gameRecommendations: import("../types.js").GameConsolidatedRecommendation[];
}> {
  const gameDate = targetDate || todayDisplayDate();
  const stats = await getConfidenceStats(sheets);
  const dualStats = (await getDualFadeStats()) ?? undefined;
  const fullHistory = (await getFullHistoryStats()) ?? undefined;

  const rawRecs = sheets.dailyPicks.map((pick) => {
    const sportLeague = sportLeagueForPick(pick);
    const leagueGames = games.filter((g) => g.league === sportLeague);
    const matchedGame = matchPickToGame(pick.pick, pick.opponent, leagueGames);

    const confidenceResult = computeConfidence({
      pick,
      matchedGame,
      stats,
      slatePicks: sheets.dailyPicks,
      fullHistory,
    });

    const base = {
      id: pick.id,
      league: pick.league,
      signalType: pick.signalType,
      signalLabel: SIGNAL_LABELS_FR[pick.signalType],
      pick: pick.pick,
      opponent: pick.opponent,
      gameTime: pick.gameTime,
      postingTime: pick.postingTime,
      line: pick.line,
      reasoning: buildReasoning(pick, matchedGame),
      status: inferStatus(matchedGame),
      matchedGame,
      gameDate,
      gameKey: buildGameKey(pick, sheets.dailyPicks, matchedGame),
    };

    return applyConfidenceToRecommendation(base, confidenceResult);
  });

  return resolveGameConflicts(rawRecs, stats, {
    dualStats,
    slatePicks: sheets.dailyPicks,
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

export { SIGNAL_LABELS_FR };
