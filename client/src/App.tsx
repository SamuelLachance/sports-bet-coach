import { useCallback, useEffect, useState } from "react";
import {
  fetchRecommendations,
  fetchStats,
  fetchSyncStatus,
  triggerSync,
  isStaticDeploy,
} from "./api";
import { CalendarView } from "./components/CalendarView";
import { DailyPicks } from "./components/DailyPicks";
import { Layout, type Tab } from "./components/Layout";
import { LeaguesView } from "./components/LeaguesView";
import { SettingsView } from "./components/SettingsView";
import { StatsView } from "./components/StatsView";
import type {
  CalendarGame,
  MatchedRecommendation,
  StatsResponse,
  SyncStatus,
} from "./types";

function App() {
  const [tab, setTab] = useState<Tab>("picks");
  const [recommendations, setRecommendations] = useState<MatchedRecommendation[]>(
    []
  );
  const [gameRecommendations, setGameRecommendations] = useState<
    import("./types").GameConsolidatedRecommendation[]
  >([]);
  const [games, setGames] = useState<CalendarGame[]>([]);
  const [leagues, setLeagues] = useState<string[]>([]);
  const [date, setDate] = useState("");
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [recData, statsData, statusData] = await Promise.all([
        fetchRecommendations(),
        fetchStats(),
        fetchSyncStatus(),
      ]);
      setRecommendations(recData.recommendations);
      setGameRecommendations(recData.gameRecommendations ?? []);
      setGames(recData.games);
      setDate(recData.date);
      setLeagues(statusData.leagues);
      setStats(statsData);
      setSyncStatus(statusData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      await triggerSync();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec sync");
    } finally {
      setSyncing(false);
    }
  }, [loadData]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadData]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400">Chargement des recommandations…</p>
        </div>
      </div>
    );
  }

  return (
    <Layout
      activeTab={tab}
      onTabChange={setTab}
      date={date}
      syncing={syncing}
      onSync={handleSync}
    >
      {error && tab !== "settings" && (
        <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg p-3 mb-4 text-sm">
          {error}{isStaticDeploy ? "" : " — Vérifiez que le serveur API tourne sur le port 3001."}
        </div>
      )}

      {tab === "picks" && (
        <DailyPicks
          recommendations={recommendations}
          gameRecommendations={gameRecommendations}
          leagues={leagues}
        />
      )}
      {tab === "calendar" && <CalendarView games={games} date={date} />}
      {tab === "leagues" && (
        <LeaguesView recommendations={recommendations} leagues={leagues} />
      )}
      {tab === "stats" && <StatsView stats={stats} />}
      {tab === "settings" && (
        <SettingsView
          syncStatus={syncStatus}
          onSync={handleSync}
          syncing={syncing}
          error={error}
        />
      )}
    </Layout>
  );
}

export default App;
