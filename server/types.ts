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

export type BetType = "spread" | "moneyline" | "total";

export type TotalDirection = "over" | "under";

export interface ParsedBet {
  betType: BetType;
  team?: string;
  rawText: string;
  spread?: number;
  odds?: number;
  totalDirection?: TotalDirection;
  totalLine?: number;
  displayText: string;
}

export interface SheetPick {
  id: string;
  league: LeagueCode;
  signalType: SignalType;
  pick: string;
  opponent?: string;
  gameTime?: string;
  postingTime?: string;
  line?: string;
  parsedBet?: ParsedBet;
  rawRow: number;
  /** VS-group or orphan bucket within a multi-game sheet row */
  gameSlot?: number;
  signalCol?: number;
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

export interface DualFadeHistoricalSampleInfo {
  weeks: number;
  months: number;
  archiveDays: number;
  totalPicksTracked: number;
  totalDataPoints: number;
  label: string;
}

export interface DualFadeInfo {
  isDualFade: boolean;
  /** Book Needs + Square Top on opposite sides → no bet */
  isOpposingNoBet?: boolean;
  bookNeedsFadeTeam?: string;
  squareFadeTeam?: string;
  strongerFadeColumn?: "book_needs_fade" | "square_fade";
  archiveWinRate?: number;
  /** @deprecated Use historicalSample instead */
  archiveSampleDays?: number;
  historicalSample?: DualFadeHistoricalSampleInfo;
}

export interface GameConsolidatedRecommendation {
  gameKey: string;
  league: LeagueCode;
  awayTeam: string;
  homeTeam: string;
  /** Full bet text for display (team + line/spread/odds or over/under) */
  recommendedTeam: string;
  recommendedBet?: ParsedBet;
  betType?: BetType;
  confidence: number;
  /** True when signals cancel out (e.g. opposing Book Needs + Square Top) */
  noBet?: boolean;
  noBetReason?: string;
  confidenceBreakdown: ConfidenceBreakdownItem[];
  hasConflict: boolean;
  pickIds: string[];
  reasoning: string;
  matchedGame?: CalendarGame;
  /** Present when Book Needs + Square oppose on same VS row */
  dualFade?: DualFadeInfo;
  highConviction?: boolean;
  historicalWinRate?: number;
  historicalRoi?: number;
  weeklyTrend?: "up" | "down" | "flat";
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
  parsedBet?: ParsedBet;
  recommendedBet?: ParsedBet;
  opponentBet?: ParsedBet;
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
  /** Stable key grouping picks on the same matchup */
  gameKey?: string;
  /** True when this pick disagrees with another signal on the same game */
  gameConflict?: boolean;
  /** French note pointing to consolidated match recommendation */
  conflictNote?: string;
  /** Pre-conflict resolution confidence (for transparency) */
  standaloneConfidence?: number;
  /** Winning side from game-level consolidation */
  consolidatedTeam?: string;
  consolidatedConfidence?: number;
  /** Historical stats for this signal × league */
  historicalWinRate?: number;
  historicalRoi?: number;
  weeklyTrend?: "up" | "down" | "flat";
  highConviction?: boolean;
}

export interface SyncStatus {
  lastSync: string | null;
  tabs: { id: string; name: string; ok: boolean; error?: string }[];
  leagues: string[];
  pickCount: number;
  gameCount: number;
}
