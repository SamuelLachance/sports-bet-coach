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

export type SignalPolarity = "positive" | "negative" | "inverted";

export interface ConfidenceBreakdownItem {
  key: string;
  label: string;
  value: number;
  impact: number;
  detail?: string;
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
  historicalSample?: DualFadeHistoricalSampleInfo;
}

export interface GameConsolidatedRecommendation {
  gameKey: string;
  league: LeagueCode;
  awayTeam: string;
  homeTeam: string;
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
  dualFade?: DualFadeInfo;
  highConviction?: boolean;
  historicalWinRate?: number;
  historicalRoi?: number;
  weeklyTrend?: "up" | "down" | "flat";
  dratingsConfirmed?: boolean;
  dratingsStatus?: "agrees" | "disagrees" | "unavailable";
  dratingsTrendLabel?: string;
  sportsOddsConfirmed?: boolean;
  sportsOddsForced?: boolean;
  sportsOddsStatus?: "agrees" | "disagrees" | "unavailable";
  sportsOddsTrendLabel?: string;
  dualAlgoConfirmed?: boolean;
  bookProvider?: string;
  consensusOdds?: number;
  consensusSpread?: number;
  consensusLabel?: string;
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
  gameKey?: string;
  gameConflict?: boolean;
  conflictNote?: string;
  standaloneConfidence?: number;
  consolidatedTeam?: string;
  consolidatedConfidence?: number;
  historicalWinRate?: number;
  historicalRoi?: number;
  weeklyTrend?: "up" | "down" | "flat";
  highConviction?: boolean;
  dratingsConfirmed?: boolean;
  dratingsStatus?: "agrees" | "disagrees" | "unavailable";
  dratingsBlocked?: boolean;
  sportsOddsConfirmed?: boolean;
  sportsOddsStatus?: "agrees" | "disagrees" | "unavailable";
  sportsOddsBlocked?: boolean;
  dualAlgoConfirmed?: boolean;
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

export interface SyncStatus {
  lastSync: string | null;
  tabs: { id: string; name: string; ok: boolean; error?: string }[];
  leagues: string[];
  pickCount: number;
  gameCount: number;
}

export interface StatsResponse {
  performanceDaily: DailyPerformanceBlock[];
  performanceYearly: YearlyPerformanceRow[];
  mtd?: { wins: number; losses: number; returnUnits: number };
  archiveCount: number;
}

export type BetResult = "pending" | "win" | "loss" | "push";

export interface TrackedBet {
  id: string;
  date: string;
  gameKey: string;
  league: LeagueCode;
  awayTeam: string;
  homeTeam: string;
  recommendedTeam: string;
  recommendedBet?: ParsedBet;
  betType?: BetType;
  spread?: number;
  odds?: number;
  americanOdds?: number;
  consensusLabel?: string;
  consensusOdds?: number;
  consensusSpread?: number;
  consensusTotal?: number;
  bookProvider?: string;
  totalLine?: number;
  totalDirection?: TotalDirection;
  confidence: number;
  signalTypes: SignalType[];
  signalLabels: string[];
  status: BetResult;
  units: number;
  stakeUnits: number;
  gradedAt?: string;
  espnGameId?: string;
  finalScore?: string;
  highConviction?: boolean;
  /** True when bet mirrors a main-screen GameRecommendationCard */
  mainScreenGameRec?: boolean;
  recordedAt: string;
}

export interface PeriodRollup {
  key: string;
  label: string;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  units: number;
  bets: number;
  roiPercent: number;
}

export interface TrackingSummary {
  totalUnits: number;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  roiPercent: number;
  record: string;
  currentStreak: { type: "win" | "loss"; count: number } | null;
}

export interface TrackingResponse {
  bets: TrackedBet[];
  summary: TrackingSummary;
  daily: PeriodRollup[];
  weekly: PeriodRollup[];
  monthly: PeriodRollup[];
  yearly: PeriodRollup[];
  trackingSince: string | null;
  note?: string;
  timezone: string;
  lastUpdated: string;
}
