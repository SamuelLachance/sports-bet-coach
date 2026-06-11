import type { MatchedRecommendation, StatsResponse, SyncStatus } from "./types";
import { getClientSnapshot, setClientSnapshot } from "./sync/state";

const STATIC_API = import.meta.env.VITE_STATIC_API === "true";
const CLIENT_SYNC =
  import.meta.env.VITE_CLIENT_SYNC === "true" || STATIC_API;
const BASE = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");

const STATIC_ROUTES: Record<string, string> = {
  "/recommendations": "recommendations.json",
  "/calendar": "calendar.json",
  "/stats": "stats.json",
  "/sync/status": "sync-status.json",
};

function resolveUrl(pathWithQuery: string): string {
  const [path, query = ""] = pathWithQuery.split("?");
  if (STATIC_API && !getClientSnapshot()) {
    const file = STATIC_ROUTES[path];
    if (!file) throw new Error(`Unknown static endpoint: ${path}`);
    return `${BASE}api/${file}${query ? `?${query}` : ""}`;
  }
  return `/api${pathWithQuery}`;
}

function snapshotRecData(league?: string) {
  const snap = getClientSnapshot();
  if (!snap) throw new Error("No synced data available");
  let recommendations = snap.recommendations;
  if (league && league !== "ALL") {
    recommendations = recommendations.filter((r) => r.league === league);
  }
  return {
    date: snap.date,
    timezone: "America/Toronto",
    count: recommendations.length,
    recommendations,
    gameRecommendations: snap.gameRecommendations,
    games: snap.games,
  };
}

export async function fetchRecommendations(league?: string) {
  if (getClientSnapshot()) {
    return snapshotRecData(league);
  }
  const params = league && league !== "ALL" ? `?league=${league}` : "";
  const res = await fetch(resolveUrl(`/recommendations${params}`));
  if (!res.ok) throw new Error("Failed to load recommendations");
  const data = (await res.json()) as {
    date: string;
    timezone: string;
    count: number;
    recommendations: MatchedRecommendation[];
    gameRecommendations?: import("./types").GameConsolidatedRecommendation[];
    games: import("./types").CalendarGame[];
  };
  if (STATIC_API && league && league !== "ALL") {
    data.recommendations = data.recommendations.filter(
      (r) => r.league === league
    );
    data.count = data.recommendations.length;
  }
  return data;
}

export async function fetchCalendar(date?: string) {
  if (getClientSnapshot()) {
    const snap = getClientSnapshot()!;
    return {
      date: date || snap.date,
      timezone: "America/Toronto",
      games: snap.games,
    };
  }
  const params = date ? `?date=${date}` : "";
  const res = await fetch(resolveUrl(`/calendar${params}`));
  if (!res.ok) throw new Error("Failed to load calendar");
  return res.json();
}

export async function fetchStats() {
  if (getClientSnapshot()) {
    return getClientSnapshot()!.stats;
  }
  const res = await fetch(resolveUrl("/stats"));
  if (!res.ok) throw new Error("Failed to load statistics");
  return res.json() as Promise<StatsResponse>;
}

export async function fetchSyncStatus() {
  if (getClientSnapshot()) {
    return getClientSnapshot()!.syncStatus;
  }
  const res = await fetch(resolveUrl("/sync/status"));
  if (!res.ok) throw new Error("Failed to load sync status");
  return res.json() as Promise<SyncStatus>;
}

export async function triggerSync() {
  if (CLIENT_SYNC) {
    const { runClientSync } = await import("./sync/pipeline");
    const snapshot = await runClientSync();
    setClientSnapshot(snapshot);
    return { ok: true, status: snapshot.syncStatus };
  }
  const res = await fetch("/api/sync", { method: "POST" });
  if (!res.ok) throw new Error("Sync failed");
  return res.json();
}

/** True when the app loads baked JSON snapshots (GitHub Pages initial load). */
export const isStaticDeploy = STATIC_API;
/** True when the Sync button can refresh data in the browser. */
export const isClientSyncEnabled = CLIENT_SYNC;
