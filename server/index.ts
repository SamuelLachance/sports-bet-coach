import cors from "cors";
import express from "express";
import { TIMEZONE } from "./config.js";
import {
  fetchAllSchedules,
  todayDateKey,
  todayDisplayDate,
} from "./services/calendar.js";
import {
  buildRecommendations,
  filterByLeague,
  getActiveLeagues,
} from "./services/recommendations.js";
import { loadCachedSheets, syncAllSheets } from "./services/sheetFetcher.js";
import type { LeagueCode, SyncStatus } from "./types.js";

const PORT = Number(process.env.PORT) || 3001;
const app = express();

app.use(cors());
app.use(express.json());

let lastSyncStatus: SyncStatus = {
  lastSync: null,
  tabs: [],
  leagues: [],
  pickCount: 0,
  gameCount: 0,
};

async function getSheets(force = false) {
  if (force) return syncAllSheets();
  const cached = await loadCachedSheets();
  if (cached) return cached;
  return syncAllSheets();
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, timezone: TIMEZONE, date: todayDisplayDate() });
});

app.get("/api/sync/status", (_req, res) => {
  res.json(lastSyncStatus);
});

app.post("/api/sync", async (_req, res) => {
  try {
    const sheets = await syncAllSheets();
    const leagues = getActiveLeagues(sheets);
    const games = await fetchAllSchedules(leagues, todayDateKey());

    lastSyncStatus = {
      lastSync: sheets.syncedAt,
      tabs: [
        { id: "daily_picks", name: "Picks du jour", ok: true },
        { id: "archive", name: "Archives", ok: true },
        { id: "performance_daily", name: "Performance quotidienne", ok: true },
        { id: "performance_yearly", name: "Performance annuelle", ok: true },
      ],
      leagues,
      pickCount: sheets.dailyPicks.length,
      gameCount: games.length,
    };

    res.json({ ok: true, status: lastSyncStatus, sheets });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    res.status(500).json({ ok: false, error: message });
  }
});

app.get("/api/sheets", async (_req, res) => {
  try {
    const sheets = await getSheets();
    res.json(sheets);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    res.status(500).json({ error: message });
  }
});

app.get("/api/calendar", async (req, res) => {
  try {
    const sheets = await getSheets();
    const leagues = getActiveLeagues(sheets);
    const date = (req.query.date as string) || todayDateKey();
    const games = await fetchAllSchedules(leagues, date);
    res.json({ date, timezone: TIMEZONE, games });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    res.status(500).json({ error: message });
  }
});

app.get("/api/recommendations", async (req, res) => {
  try {
    const sheets = await getSheets();
    const leagues = getActiveLeagues(sheets);
    const dateKey = todayDateKey();
    const games = await fetchAllSchedules(leagues, dateKey);
    let recs = await buildRecommendations(sheets, games);

    const league = req.query.league as LeagueCode | "ALL" | undefined;
    if (league) recs = filterByLeague(recs, league);

    const signal = req.query.signal as string | undefined;
    if (signal) recs = recs.filter((r) => r.signalType === signal);

    res.json({
      date: todayDisplayDate(),
      timezone: TIMEZONE,
      count: recs.length,
      recommendations: recs,
      games,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    res.status(500).json({ error: message });
  }
});

app.get("/api/stats", async (_req, res) => {
  try {
    const sheets = await getSheets();
    res.json({
      performanceDaily: sheets.performanceDaily,
      performanceYearly: sheets.performanceYearly,
      mtd: sheets.mtd,
      archiveCount: sheets.archive.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    res.status(500).json({ error: message });
  }
});

async function bootstrap() {
  try {
    const sheets = await getSheets();
    const leagues = getActiveLeagues(sheets);
    const games = await fetchAllSchedules(leagues, todayDateKey());
    lastSyncStatus = {
      lastSync: sheets.syncedAt,
      tabs: [
        { id: "daily_picks", name: "Picks du jour", ok: true },
        { id: "archive", name: "Archives", ok: true },
        { id: "performance_daily", name: "Performance quotidienne", ok: true },
        { id: "performance_yearly", name: "Performance annuelle", ok: true },
      ],
      leagues,
      pickCount: sheets.dailyPicks.length,
      gameCount: games.length,
    };
    console.log(
      `Données chargées: ${sheets.dailyPicks.length} picks, ${games.length} matchs`
    );
  } catch (err) {
    console.warn("Bootstrap sync échoué, démarrage sans cache:", err);
  }

  app.listen(PORT, () => {
    console.log(`API sports-bet-coach → http://localhost:${PORT}`);
  });
}

bootstrap();
