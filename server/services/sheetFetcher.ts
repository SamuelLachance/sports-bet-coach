import fs from "node:fs/promises";
import path from "node:path";
import {
  CACHE_DIR,
  RAW_DIR,
  SHEET_TABS,
  getSheetCsvUrl,
  type SheetTabConfig,
} from "../config.js";
import { parseArchiveCsv } from "../parsers/archive.js";
import { parseDailyPicksCsv } from "../parsers/dailyPicks.js";
import {
  parseDailyPerformanceCsv,
  parseYearlyPerformanceCsv,
} from "../parsers/performance.js";
import type { ParsedSheets } from "../types.js";

async function ensureDirs() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.mkdir(RAW_DIR, { recursive: true });
}

export async function fetchTabCsv(tab: SheetTabConfig): Promise<string> {
  const url = getSheetCsvUrl(tab);
  const res = await fetch(url, {
    headers: { "User-Agent": "sports-bet-coach/1.0" },
  });
  if (!res.ok) {
    throw new Error(`Échec fetch ${tab.id} (${res.status}): ${url}`);
  }
  const csv = await res.text();
  await fs.writeFile(path.join(RAW_DIR, `${tab.id}.csv`), csv, "utf-8");
  return csv;
}

export async function syncAllSheets(): Promise<ParsedSheets> {
  await ensureDirs();
  const tabResults: Record<string, string> = {};

  for (const tab of SHEET_TABS) {
    tabResults[tab.id] = await fetchTabCsv(tab);
  }

  const dailyPicks = parseDailyPicksCsv(tabResults.daily_picks);
  const archive = parseArchiveCsv(tabResults.archive);
  const perfDaily = parseDailyPerformanceCsv(tabResults.performance_daily);
  const perfYearly = parseYearlyPerformanceCsv(tabResults.performance_yearly);

  const parsed: ParsedSheets = {
    syncedAt: new Date().toISOString(),
    dailyPicks,
    archive,
    performanceDaily: perfDaily.blocks,
    performanceYearly: perfYearly,
    mtd: perfDaily.mtd,
  };

  await fs.writeFile(
    path.join(CACHE_DIR, "sheets.json"),
    JSON.stringify(parsed, null, 2),
    "utf-8"
  );

  return parsed;
}

export async function loadCachedSheets(): Promise<ParsedSheets | null> {
  try {
    const raw = await fs.readFile(path.join(CACHE_DIR, "sheets.json"), "utf-8");
    return JSON.parse(raw) as ParsedSheets;
  } catch {
    return null;
  }
}
