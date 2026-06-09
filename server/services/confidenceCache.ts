import fs from "node:fs/promises";
import path from "node:path";
import { CACHE_DIR } from "../config.js";
import type { ParsedSheets } from "../types.js";
import { buildHistoricalStats, type ConfidenceStatsCache } from "./historicalStats.js";

const STATS_FILE = "confidence-stats.json";

export async function buildAndCacheConfidenceStats(
  sheets: ParsedSheets,
  yearlyCsv?: string
): Promise<ConfidenceStatsCache> {
  const stats = buildHistoricalStats(
    sheets.performanceYearly,
    sheets.performanceDaily,
    sheets.archive.length,
    yearlyCsv
  );

  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(
    path.join(CACHE_DIR, STATS_FILE),
    JSON.stringify(stats, null, 2),
    "utf-8"
  );

  return stats;
}

export async function loadConfidenceStats(): Promise<ConfidenceStatsCache | null> {
  try {
    const raw = await fs.readFile(path.join(CACHE_DIR, STATS_FILE), "utf-8");
    return JSON.parse(raw) as ConfidenceStatsCache;
  } catch {
    return null;
  }
}

export async function getConfidenceStats(
  sheets: ParsedSheets,
  yearlyCsv?: string
): Promise<ConfidenceStatsCache> {
  const cached = await loadConfidenceStats();
  if (cached) return cached;
  return buildAndCacheConfidenceStats(sheets, yearlyCsv);
}
