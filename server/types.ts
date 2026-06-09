export type LeagueCode =
  | "MLB"
  | "NBA"
  | "NHL"
  | "NFL"
  | "WNBA"
  | "CBB"
  | "CFB"
  | "MEGA_SHARPS"
  | "WHALE"
  | "MODEL"
  | "RLM"
  | "UNKNOWN";

export type SignalType =
  | "sharp_money"
  | "book_needs_fade"
  | "square_fade"
  | "reverse_line_movement"
  | "mega_sharps"
  | "whale_plays"
  | "model_best_values"
  | "mega_rlm";

export interface SheetPick {
  id: string;
  league: LeagueCode;
  signalType: SignalType;
  pick: string;
  opponent?: string;
  gameTime?: string;
  postingTime?: string;
  line?: string;
  rawRow: number;
}

export type SignalPolarity = "positive" | "negative" | "inverted";

export interface ConfidenceBreakdownItem {
  key: string;
  label: string;
  value: number;
  impact: number;
  detail?: string;
}

export interface ArchiveEntry {
  date: string;
  label: string;
}

export interface LeaguePerformance {
  league: string;
  wins: number;
  losses: number;
  returnUnits: number;
}

export interface DailyPerformanceBlock {
  category: string;
  leagues: LeaguePerformance[];
  total: LeaguePerformance;
}

export interface YearlyPerformanceRow {
  year: number;
  category: string;
  league: string;
  months: Record<string, number | null>;
  yearTotal: number | null;
  allTime: number | null;
}

export interface ParsedSheets {
  syncedAt: string;
  dailyPicks: SheetPick[];
  archive: ArchiveEntry[];
  performanceDaily: DailyPerformanceBlock[];
  performanceYearly: YearlyPerformanceRow[];
  mtd?: { wins: number; losses: number; returnUnits: number };
}

export interface CalendarGame {
  id: string;
  league: LeagueCode;
  homeTeam: string;
  awayTeam: string;
  homeAbbr: string;
  awayAbbr: string;
  startTime: string;
  status: string;
  venue?: string;
}

export interface MatchedRecommendation {
  id: string;
  league: LeagueCode;
  signalType: SignalType;
  signalLabel: string;
  pick: string;
  opponent?: string;
  gameTime?: string;
  postingTime?: string;
  line?: string;
  confidence: number;
  confidenceBreakdown: ConfidenceBreakdownItem[];
  opponentPick?: string;
  opponentConfidence?: number;
  signalPolarity: SignalPolarity;
  edgeLabel: string;
  reasoning: string;
  status: "recommended" | "pending" | "matched" | "settled";
  matchedGame?: CalendarGame;
  gameDate: string;
}

export interface SyncStatus {
  lastSync: string | null;
  tabs: { id: string; name: string; ok: boolean; error?: string }[];
  leagues: string[];
  pickCount: number;
  gameCount: number;
}
