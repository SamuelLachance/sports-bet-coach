import fs from "node:fs/promises";
import path from "node:path";
import { TIMEZONE, isDratingsEnabled, isSportsOddsEnabled } from "../config.js";
import {
  fetchAllSchedules,
  todayDateKey,
  todayDisplayDate,
} from "../services/calendar.js";
import { fetchDratingsTrends } from "../services/dratingsTrends.js";
import {
  buildRecommendations,
  countDratingsFilterStats,
  countSportsOddsFilterStats,
  getActiveLeagues,
} from "../services/recommendations.js";
import { fetchSportsOddsSlate } from "../services/sportsOddsAlgo.js";
import { syncAllSheets } from "../services/sheetFetcher.js";
import { updateTracking } from "../services/tracking.js";

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
  const displayDate = todayDisplayDate();
  const skipDratingsFetch =
    process.env.CI === "true" && process.env.DRATINGS_ENABLED !== "true";
  const dratingsEnabled = isDratingsEnabled();
  const sportsOddsEnabled = isSportsOddsEnabled();

  let sportsOddsCache: Awaited<ReturnType<typeof fetchSportsOddsSlate>> | undefined;
  if (sportsOddsEnabled) {
    console.log("Fetching Sports Odds daily slate…");
    sportsOddsCache = await fetchSportsOddsSlate(displayDate);
    console.log(
      `Sports Odds: ${sportsOddsCache.games.length} games, ${sportsOddsCache.errors.length} errors`
    );
  } else {
    console.log("Sports Odds dual-algo gate disabled (SPORTS_ODDS_ENABLED=false)");
  }

  let dratingsCache: Awaited<ReturnType<typeof fetchDratingsTrends>> | undefined;
  if (dratingsEnabled && !skipDratingsFetch) {
    console.log("Fetching DRatings Bet Trends…");
    dratingsCache = await fetchDratingsTrends(leagues, displayDate);
    console.log(
      `DRatings: ${dratingsCache.trends.length} games, ${dratingsCache.errors.length} fetch errors`
    );
  } else {
    console.log(
      dratingsEnabled
        ? "DRatings fetch skipped (CI without DRATINGS_ENABLED=true)"
        : "DRatings disabled (DRATINGS_ENABLED=false)"
    );
  }

  const built = await buildRecommendations(sheets, games, displayDate, {
    skipDratingsFetch,
    dratingsTrends: dratingsCache?.trends,
    skipSportsOddsFetch: sportsOddsEnabled && !sportsOddsCache?.games.length,
    sportsOddsPredictions: sportsOddsCache?.games,
  });

  if (sportsOddsEnabled) {
    const stats = countSportsOddsFilterStats(built);
    console.log(
      `Sports Odds filter: ${stats.gamesConfirmed} games confirmed, ${stats.gamesNoBet} games → no bet, ${stats.dualAlgoGames} dual-algo games`
    );
  }

  if (dratingsEnabled && !skipDratingsFetch) {
    const stats = countDratingsFilterStats(built);
    console.log(
      `DRatings filter: ${stats.gamesConfirmed} games confirmed, ${stats.gamesNoBet} games → no bet, ${stats.picksBlocked} picks blocked, ${stats.picksConfirmed} picks confirmed`
    );
  }
  const tracking = await updateTracking(
    built.gameRecommendations,
    built.recommendations,
    todayDisplayDate()
  );

  const syncStatus = {
    lastSync: sheets.syncedAt,
    tabs: [
      { id: "daily_picks", name: "Daily picks", ok: true },
      { id: "archive", name: "Archives", ok: true },
      { id: "performance_daily", name: "Daily performance", ok: true },
      { id: "performance_yearly", name: "Yearly performance", ok: true },
      {
        id: "performance_history",
        name: "Monthly/weekly performance",
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
  await writeJson("tracking", tracking);
  if (dratingsCache) {
    await writeJson("dratings-cache", {
      fetchedAt: dratingsCache.fetchedAt,
      date: dratingsCache.date,
      trends: dratingsCache.trends,
      errors: dratingsCache.errors,
      source: dratingsCache.source,
    });
  }
  if (sportsOddsCache) {
    await writeJson("sports-odds-cache", {
      fetchedAt: sportsOddsCache.fetchedAt,
      date: sportsOddsCache.date,
      games: sportsOddsCache.games,
      errors: sportsOddsCache.errors,
      source: sportsOddsCache.source,
    });
  }

  console.log(
    `Wrote API snapshot to ${outDir} (${built.recommendations.length} picks, ${games.length} games)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
