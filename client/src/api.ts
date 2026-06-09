import type { MatchedRecommendation, StatsResponse, SyncStatus } from "./types";

const STATIC_API = import.meta.env.VITE_STATIC_API === "true";
const BASE = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");

const STATIC_ROUTES: Record<string, string> = {
  "/recommendations": "recommendations.json",
  "/calendar": "calendar.json",
  "/stats": "stats.json",
  "/sync/status": "sync-status.json",
};

function resolveUrl(pathWithQuery: string): string {
  const [path, query = ""] = pathWithQuery.split("?");
  if (STATIC_API) {
    const file = STATIC_ROUTES[path];
    if (!file) throw new Error(`Endpoint statique inconnu: ${path}`);
    return `${BASE}api/${file}${query ? `?${query}` : ""}`;
  }
  return `/api${pathWithQuery}`;
}

export async function fetchRecommendations(league?: string) {
  const params = league && league !== "ALL" ? `?league=${league}` : "";
  const res = await fetch(resolveUrl(`/recommendations${params}`));
  if (!res.ok) throw new Error("Impossible de charger les recommandations");
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
  const params = date ? `?date=${date}` : "";
  const res = await fetch(resolveUrl(`/calendar${params}`));
  if (!res.ok) throw new Error("Impossible de charger le calendrier");
  return res.json();
}

export async function fetchStats() {
  const res = await fetch(resolveUrl("/stats"));
  if (!res.ok) throw new Error("Impossible de charger les statistiques");
  return res.json() as Promise<StatsResponse>;
}

export async function fetchSyncStatus() {
  const res = await fetch(resolveUrl("/sync/status"));
  if (!res.ok) throw new Error("Impossible de charger le statut");
  return res.json() as Promise<SyncStatus>;
}

export async function triggerSync() {
  if (STATIC_API) {
    throw new Error(
      "La synchronisation en direct n'est pas disponible sur GitHub Pages. Les données sont mises à jour à chaque déploiement."
    );
  }
  const res = await fetch("/api/sync", { method: "POST" });
  if (!res.ok) throw new Error("Échec de la synchronisation");
  return res.json();
}

export const isStaticDeploy = STATIC_API;
