declare module "@server/config.js" {
  export const TIMEZONE: string;
  export const SHEET_TABS: SheetTabConfig[];
  export function getSheetCsvUrl(tab: SheetTabConfig): string;
  export interface SheetTabConfig {
    id: string;
    name: string;
    gid: string;
    type: string;
  }
}

declare module "@server/parsers/archive.js" {
  import type { ArchiveEntry } from "@server/types.js";
  export function parseArchiveCsv(csv: string): ArchiveEntry[];
}

declare module "@server/parsers/dailyPicks.js" {
  import type { SheetPick } from "@server/types.js";
  export function parseDailyPicksCsv(csv: string): SheetPick[];
}

declare module "@server/parsers/performance.js" {
  import type {
    DailyPerformanceBlock,
    YearlyPerformanceRow,
  } from "@server/types.js";
  export function parseDailyPerformanceCsv(csv: string): {
    blocks: DailyPerformanceBlock[];
    mtd?: { wins: number; losses: number; returnUnits: number };
  };
  export function parseYearlyPerformanceCsv(csv: string): YearlyPerformanceRow[];
}

declare module "@server/services/calendar.js" {
  import type { CalendarGame, LeagueCode } from "@server/types.js";
  export interface GameResult extends CalendarGame {
    homeScore?: number;
    awayScore?: number;
    winnerTeam?: string;
    isFinal: boolean;
  }
  export function fetchAllSchedules(
    leagues: LeagueCode[],
    date?: string
  ): Promise<CalendarGame[]>;
  export function fetchResultsForDate(
    leagues: LeagueCode[],
    dateKey: string
  ): Promise<GameResult[]>;
  export function displayDateToEspnKey(displayDate: string): string;
  export function pickTeamInGame(teamName: string, game: CalendarGame): boolean;
  export function todayDateKey(): string;
  export function todayDisplayDate(): string;
}

declare module "@server/services/tracking.js" {
  import type {
    GameConsolidatedRecommendation,
    MatchedRecommendation,
  } from "@server/types.js";
  export interface TrackedBet {
    id: string;
    date: string;
    gameKey: string;
    status: string;
    units: number;
  }
  export interface TrackingStore {
    version: 1;
    bets: TrackedBet[];
  }
  export interface TrackingResponse {
    bets: TrackedBet[];
    summary: Record<string, unknown>;
    weekly: unknown[];
    monthly: unknown[];
    trackingSince: string | null;
    note?: string;
    timezone: string;
    lastUpdated: string;
  }
  export function seedTrackingStore(overlay: TrackingStore): Promise<void>;
  export function updateTracking(
    gameRecommendations: GameConsolidatedRecommendation[],
    recommendations: MatchedRecommendation[],
    date: string
  ): Promise<TrackingResponse>;
}

declare module "@server/services/confidenceCache.js" {
  import type { ParsedSheets } from "@server/types.js";
  export function buildAndCacheConfidenceStats(
    sheets: ParsedSheets,
    yearlyCsv?: string,
    performanceDailyCsv?: string,
    performanceHistoryCsv?: string
  ): Promise<unknown>;
}

declare module "@server/services/dratingsTrends.js" {
  export interface DratingsGameTrend {
    gameKey: string;
    league: string;
    awayTeam: string;
    homeTeam: string;
    moneyLine: { trendLabel?: string };
    total: { trendLabel?: string };
  }
}

declare module "@server/services/sportsOddsAlgo.js" {
  export interface SportsOddsGamePrediction {
    eventId: string;
    league: string;
    awayTeam: string;
    homeTeam: string;
    model: {
      favoriteSide: "away" | "home";
      winProbability: number;
    };
  }
}

declare module "@server/services/mainScreenPicks.js" {
  import type {
    GameConsolidatedRecommendation,
    MatchedRecommendation,
  } from "@server/types.js";
  export interface MainScreenFilterOptions {
    leagueFilter?: string;
    signalFilter?: string;
  }
  export function isActionableGameRec(
    rec: GameConsolidatedRecommendation
  ): boolean;
  export function isVisiblePick(rec: MatchedRecommendation): boolean;
  export function selectMainScreenGameRecommendations<
    T extends GameConsolidatedRecommendation,
  >(
    gameRecommendations: T[],
    recommendations: MatchedRecommendation[],
    options?: MainScreenFilterOptions
  ): T[];
  export function selectTrackableGameRecommendations<
    T extends GameConsolidatedRecommendation,
  >(
    gameRecommendations: T[],
    recommendations: MatchedRecommendation[],
    options?: MainScreenFilterOptions
  ): T[];
  export function selectMainScreenStandalonePicks<
    T extends MatchedRecommendation,
  >(
    gameRecommendations: GameConsolidatedRecommendation[],
    recommendations: T[],
    options?: MainScreenFilterOptions
  ): T[];
}

declare module "@server/services/recommendations.js" {
  import type { DratingsGameTrend } from "@server/services/dratingsTrends.js";
  import type { SportsOddsGamePrediction } from "@server/services/sportsOddsAlgo.js";
  import type {
    CalendarGame,
    GameConsolidatedRecommendation,
    LeagueCode,
    MatchedRecommendation,
    ParsedSheets,
  } from "@server/types.js";
  export function buildRecommendations(
    sheets: ParsedSheets,
    games: CalendarGame[],
    targetDate?: string,
    options?: {
      dratingsTrends?: DratingsGameTrend[];
      skipDratingsFetch?: boolean;
      sportsOddsPredictions?: SportsOddsGamePrediction[];
      skipSportsOddsFetch?: boolean;
    }
  ): Promise<{
    recommendations: MatchedRecommendation[];
    gameRecommendations: GameConsolidatedRecommendation[];
  }>;
  export function getActiveLeagues(sheets: ParsedSheets): LeagueCode[];
}

declare module "@server/types.js" {
  export type LeagueCode =
    | "MLB"
    | "NBA"
    | "NHL"
    | "NFL"
    | "WNBA"
    | "CBB"
    | "CFB"
    | "MLS"
    | "EPL"
    | "LALIGA"
    | "BUNDESLIGA"
    | "SERIEA"
    | "LIGUE1"
    | "WORLDCUP"
    | "FIFA_FRIENDLIES"
    | "CONCACAF_WCQ"
    | "CONCACAF_GOLD"
    | "CONCACAF_NATIONS"
    | "UEFA_EURO"
    | "UEFA_NATIONS"
    | "COPA_AMERICA"
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
    gameSlot?: number;
    signalCol?: number;
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

  export interface ConfidenceBreakdownItem {
    key: string;
    label: string;
    value: number;
    impact: number;
    detail?: string;
  }

  export type BetType = "spread" | "moneyline" | "total";
  export type TotalDirection = "over" | "under";
  export type SignalPolarity = "positive" | "negative" | "inverted";

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
    consensusTotal?: number;
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
}
