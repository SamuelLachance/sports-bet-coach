import { useCallback, useEffect, useState } from "react";
import {
  fetchRecommendations,
  fetchSyncStatus,
  fetchTracking,
  triggerSync,
  isStaticDeploy,
} from "./api";
import { CalendarView } from "./components/CalendarView";
import { DailyPicks } from "./components/DailyPicks";
import { HomeView } from "./components/HomeView";
import { Layout, type Tab } from "./components/Layout";
import { LeaguesView } from "./components/LeaguesView";
import { SettingsView } from "./components/SettingsView";
import { TrackingView } from "./components/TrackingView";
import { applyTabHash, parseTabFromHash } from "./utils/tabRouting";
import type {
  CalendarGame,
  MatchedRecommendation,
  SyncStatus,
  TrackingResponse,
} from "./types";

function App() {
  const [tab, setTab] = useState<Tab>(() => parseTabFromHash(window.location.hash));
  const [recommendations, setRecommendations] = useState<MatchedRecommendation[]>(
    []
  );
  const [gameRecommendations, setGameRecommendations] = useState<
    import("./types").GameConsolidatedRecommendation[]
  >([]);
  const [games, setGames] = useState<CalendarGame[]>([]);
  const [leagues, setLeagues] = useState<string[]>([]);
  const [date, setDate] = useState("");
  const [tracking, setTracking] = useState<TrackingResponse | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [recData, trackingData, statusData] = await Promise.all([
        fetchRecommendations(),
        fetchTracking(),
        fetchSyncStatus(),
      ]);
      setRecommendations(recData.recommendations);
      setGameRecommendations(recData.gameRecommendations ?? []);
      setGames(recData.games);
      setDate(recData.date);
      setLeagues(statusData.leagues);
      setTracking(trackingData);
      setSyncStatus(statusData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
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
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }, [loadData]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadData]);

  useEffect(() => {
    const onHashChange = () => setTab(parseTabFromHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const handleTabChange = useCallback((next: Tab) => {
    setTab(next);
    applyTabHash(next);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400">Loading recommendations…</p>
        </div>
      </div>
    );
  }

  return (
    <Layout
      activeTab={tab}
      onTabChange={handleTabChange}
      date={date}
      syncing={syncing}
      onSync={handleSync}
    >
      {error && tab !== "settings" && (
        <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg p-3 mb-4 text-sm">
          {error}
          {!isStaticDeploy && " — Make sure the API server is running on port 3001."}
        </div>
      )}

      {tab === "home" && (
        <HomeView
          date={date}
          games={games}
          recommendations={recommendations}
          gameRecommendations={gameRecommendations}
          leagues={leagues}
          tracking={tracking}
          onNavigate={handleTabChange}
        />
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
      {tab === "tracking" && <TrackingView tracking={tracking} />}
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
