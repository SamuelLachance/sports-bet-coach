import type {
  CalendarGame,
  MatchedRecommendation,
  StatsResponse,
  SyncStatus,
  GameConsolidatedRecommendation,
  TrackingResponse,
} from "../types";

export interface ClientSyncSnapshot {
  recommendations: MatchedRecommendation[];
  gameRecommendations: GameConsolidatedRecommendation[];
  games: CalendarGame[];
  date: string;
  stats: StatsResponse;
  tracking: TrackingResponse;
  syncStatus: SyncStatus;
}
