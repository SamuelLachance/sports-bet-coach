import type {
  CalendarGame,
  MatchedRecommendation,
  StatsResponse,
  SyncStatus,
  GameConsolidatedRecommendation,
} from "../types";

export interface ClientSyncSnapshot {
  recommendations: MatchedRecommendation[];
  gameRecommendations: GameConsolidatedRecommendation[];
  games: CalendarGame[];
  date: string;
  stats: StatsResponse;
  syncStatus: SyncStatus;
}
