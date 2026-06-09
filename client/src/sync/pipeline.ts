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
import type { ParsedSheets } from "@server/types.js";
import type { MatchedRecommendation, StatsResponse, SyncStatus } from "../types";
import type { ClientSyncSnapshot } from "./types";

export type { ClientSyncSnapshot } from "./types";

async function fetchTabCsv(tab: SheetTabConfig): Promise<string> {
  const url = getSheetCsvUrl(tab);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Échec fetch ${tab.name} (${res.status})`);
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

export async function runClientSync(): Promise<ClientSyncSnapshot> {
  const { sheets } = await syncAllSheets();
  const leagues = getActiveLeagues(sheets);
  const dateKey = todayDateKey();
  const games = await fetchAllSchedules(leagues, dateKey);
  const built = await buildRecommendations(sheets, games);

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
    syncStatus: buildSyncStatus(sheets, leagues, games.length),
  };
}

export { TIMEZONE, todayDateKey };
