import fs from "node:fs/promises";
import path from "node:path";
import { TIMEZONE } from "../config.js";
import {
  fetchAllSchedules,
  todayDateKey,
  todayDisplayDate,
} from "../services/calendar.js";
import {
  buildRecommendations,
  getActiveLeagues,
} from "../services/recommendations.js";
import { syncAllSheets } from "../services/sheetFetcher.js";

const outDir = path.join(process.cwd(), "client", "public", "api");

async function writeJson(name: string, data: unknown) {
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(
    path.join(outDir, `${name}.json`),
    JSON.stringify(data, null, 0)
  );
}

async function main() {
  console.log("Sync Google Sheets + ESPN for GitHub Pages snapshot…");
  const sheets = await syncAllSheets();
  const leagues = getActiveLeagues(sheets);
  const dateKey = todayDateKey();
  const games = await fetchAllSchedules(leagues, dateKey);
  const built = await buildRecommendations(sheets, games);

  const syncStatus = {
    lastSync: sheets.syncedAt,
    tabs: [
      { id: "daily_picks", name: "Picks du jour", ok: true },
      { id: "archive", name: "Archives", ok: true },
      { id: "performance_daily", name: "Performance quotidienne", ok: true },
      { id: "performance_yearly", name: "Performance annuelle", ok: true },
      {
        id: "performance_history",
        name: "Performance mensuelle/hebdo",
        ok: true,
      },
    ],
    leagues,
    pickCount: sheets.dailyPicks.length,
    gameCount: games.length,
  };

  await writeJson("health", {
    ok: true,
    timezone: TIMEZONE,
    date: todayDisplayDate(),
  });
  await writeJson("sync-status", syncStatus);
  await writeJson("recommendations", {
    date: todayDisplayDate(),
    timezone: TIMEZONE,
    count: built.recommendations.length,
    recommendations: built.recommendations,
    gameRecommendations: built.gameRecommendations,
    games,
  });
  await writeJson("calendar", {
    date: dateKey,
    timezone: TIMEZONE,
    games,
  });
  await writeJson("stats", {
    performanceDaily: sheets.performanceDaily,
    performanceYearly: sheets.performanceYearly,
    mtd: sheets.mtd,
    archiveCount: sheets.archive.length,
  });

  console.log(
    `Wrote API snapshot to ${outDir} (${built.recommendations.length} picks, ${games.length} games)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
