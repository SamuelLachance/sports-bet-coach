import "./shims/buffer";
import { parseArchiveCsv } from "@server/parsers/archive.js";
import { parseDailyPicksCsv } from "@server/parsers/dailyPicks.js";
import {
  parseDailyPerformanceCsv,
  parseYearlyPerformanceCsv,
} from "@server/parsers/performance.js";
import { SHEET_TABS, TIMEZONE, getSheetCsvUrl } from "@server/config.js";
import type { SheetTabConfig } from "@server/config.js";
import {
  fetchAllSchedules,
  todayDateKey,
  todayDisplayDate,
} from "@server/services/calendar.js";
import { buildAndCacheConfidenceStats } from "@server/services/confidenceCache.js";
import {
  buildRecommendations,
  getActiveLeagues,
} from "@server/services/recommendations.js";
import { updateTracking } from "@server/services/tracking.js";
import type { ParsedSheets } from "@server/types.js";
import type { MatchedRecommendation, StatsResponse, SyncStatus } from "../types";
import type { ClientSyncSnapshot } from "./types";

export type { ClientSyncSnapshot } from "./types";

async function fetchTabCsv(tab: SheetTabConfig): Promise<string> {
  const url = getSheetCsvUrl(tab);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Fetch failed for ${tab.name} (${res.status})`);
  }
  return res.text();
}

async function syncAllSheets(): Promise<{
  sheets: ParsedSheets;
  tabCsv: Record<string, string>;
}> {
  const tabCsv: Record<string, string> = {};

  for (const tab of SHEET_TABS) {
    tabCsv[tab.id] = await fetchTabCsv(tab);
  }

  const perfDaily = parseDailyPerformanceCsv(tabCsv.performance_daily);

  const sheets: ParsedSheets = {
    syncedAt: new Date().toISOString(),
    dailyPicks: parseDailyPicksCsv(tabCsv.daily_picks),
    archive: parseArchiveCsv(tabCsv.archive),
    performanceDaily: perfDaily.blocks,
    performanceYearly: parseYearlyPerformanceCsv(tabCsv.performance_yearly),
    mtd: perfDaily.mtd,
  };

  await buildAndCacheConfidenceStats(
    sheets,
    tabCsv.performance_yearly,
    tabCsv.performance_daily,
    tabCsv.performance_history
  );

  return { sheets, tabCsv };
}

function buildSyncStatus(sheets: ParsedSheets, leagues: string[], gameCount: number): SyncStatus {
  return {
    lastSync: sheets.syncedAt,
    tabs: SHEET_TABS.map((tab) => ({
      id: tab.id,
      name: tab.name,
      ok: true,
    })),
    leagues,
    pickCount: sheets.dailyPicks.length,
    gameCount,
  };
}

async function loadBakedSportsOddsPredictions(): Promise<
  import("@server/services/sportsOddsAlgo.js").SportsOddsGamePrediction[] | undefined
> {
  try {
    const base = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
    const res = await fetch(`${base}api/sports-odds-cache.json`);
    if (!res.ok) return undefined;
    const data = (await res.json()) as {
      games?: import("@server/services/sportsOddsAlgo.js").SportsOddsGamePrediction[];
    };
    return data.games?.length ? data.games : undefined;
  } catch {
    return undefined;
  }
}

async function loadBakedDratingsTrends(): Promise<
  import("@server/services/dratingsTrends.js").DratingsGameTrend[] | undefined
> {
  try {
    const base = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
    const res = await fetch(`${base}api/dratings-cache.json`);
    if (!res.ok) return undefined;
    const data = (await res.json()) as { trends?: import("@server/services/dratingsTrends.js").DratingsGameTrend[] };
    return data.trends?.length ? data.trends : undefined;
  } catch {
    return undefined;
  }
}

export async function runClientSync(): Promise<ClientSyncSnapshot> {
  const { sheets } = await syncAllSheets();
  const leagues = getActiveLeagues(sheets);
  const dateKey = todayDateKey();
  const games = await fetchAllSchedules(leagues, dateKey);
  const dratingsTrends = await loadBakedDratingsTrends();
  const sportsOddsPredictions = await loadBakedSportsOddsPredictions();
  const built = await buildRecommendations(sheets, games, todayDisplayDate(), {
    skipDratingsFetch: true,
    dratingsTrends,
    skipSportsOddsFetch: true,
    sportsOddsPredictions,
  });
  const tracking = await updateTracking(
    built.gameRecommendations,
    built.recommendations,
    todayDisplayDate()
  ) as unknown as import("../types.js").TrackingResponse;

  const stats: StatsResponse = {
    performanceDaily: sheets.performanceDaily,
    performanceYearly: sheets.performanceYearly,
    mtd: sheets.mtd,
    archiveCount: sheets.archive.length,
  };

  return {
    recommendations: built.recommendations as MatchedRecommendation[],
    gameRecommendations: built.gameRecommendations as import("../types").GameConsolidatedRecommendation[],
    games,
    date: todayDisplayDate(),
    stats,
    tracking,
    syncStatus: buildSyncStatus(sheets, leagues, games.length),
  };
}

export { TIMEZONE, todayDateKey };
