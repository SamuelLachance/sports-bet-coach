import type { MatchedRecommendation, StatsResponse, SyncStatus } from "./types";

const API = "/api";

export async function fetchRecommendations(league?: string) {
  const params = league && league !== "ALL" ? `?league=${league}` : "";
  const res = await fetch(`${API}/recommendations${params}`);
  if (!res.ok) throw new Error("Impossible de charger les recommandations");
  return res.json() as Promise<{
    date: string;
    timezone: string;
    count: number;
    recommendations: MatchedRecommendation[];
    gameRecommendations?: import("./types").GameConsolidatedRecommendation[];
    games: import("./types").CalendarGame[];
  }>;
}

export async function fetchCalendar(date?: string) {
  const params = date ? `?date=${date}` : "";
  const res = await fetch(`${API}/calendar${params}`);
  if (!res.ok) throw new Error("Impossible de charger le calendrier");
  return res.json();
}

export async function fetchStats() {
  const res = await fetch(`${API}/stats`);
  if (!res.ok) throw new Error("Impossible de charger les statistiques");
  return res.json() as Promise<StatsResponse>;
}

export async function fetchSyncStatus() {
  const res = await fetch(`${API}/sync/status`);
  if (!res.ok) throw new Error("Impossible de charger le statut");
  return res.json() as Promise<SyncStatus>;
}

export async function triggerSync() {
  const res = await fetch(`${API}/sync`, { method: "POST" });
  if (!res.ok) throw new Error("Échec de la synchronisation");
  return res.json();
}
