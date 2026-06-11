import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { CACHE_DIR } from "../config.js";
import type {
  DailyPerformanceBlock,
  ParsedSheets,
  SheetPick,
  SignalType,
  YearlyPerformanceRow,
} from "../types.js";
import type { ConfidenceStatsCache } from "./historicalStats.js";
import type { FullHistoryStatsCache } from "./fullHistoryStats.js";
import { pickBelongsToGame } from "./calendar.js";
import { categoryForSignal } from "./signalMapping.js";
import type { CalendarGame } from "../types.js";

export const DUAL_FADE_STATS_FILE = "dual-fade-stats.json";

export interface DualFadeLeagueStats {
  league: string;
  bookNeedsAllTimeRoi: number;
  squareAllTimeRoi: number;
  bookNeedsBlendedRoi: number;
  squareBlendedRoi: number;
  preferredColumn: "book_needs_fade" | "square_fade";
  roiGap: number;
}

/** Full historical sample used for dual-fade confidence (not just recent daily window) */
export interface DualFadeHistoricalSample {
  /** Weekly rows parsed from performance history tab (gid=1234539794) */
  weeks: number;
  /** Months where both fade columns had tracked results (yearly tracker 2022+) */
  months: number;
  /** Archive days listed in archives tab */
  archiveDays: number;
  /** Recent days where both columns active (performance daily tab — short window) */
  recentDualActiveDays: number;
  /** Total W+L picks tracked for book + square signals */
  totalPicksTracked: number;
  /** Combined data points for confidence weighting */
  totalDataPoints: number;
}

export interface DualFadeCoOccurrence {
  /** Days where both Sportsbook and Squares had at least one pick */
  dualActiveDays: number;
  /** Days where both had picks and combined return was positive */
  dualPositiveDays: number;
  /** Days where both had picks and combined return was negative */
  dualNegativeDays: number;
  /** Proxy win rate when both columns active (combined W/(W+L)) */
  combinedWinRate: number;
  /** When book had better day return than square on dual days */
  bookOutperformedSquareDays: number;
  /** When square had better day return than book on dual days */
  squareOutperformedBookDays: number;
}

export interface DualFadeArchiveTrend {
  /** Inverse of Book Needs fade wins more often when columns oppose (derived) */
  bookInverseWinRate: number;
  /** Inverse of Square fade wins more often when columns oppose (derived) */
  squareInverseWinRate: number;
  /** Recommended rule from archive + tracker analysis */
  resolutionRule: string;
  sampleSize: number;
}

export interface DualFadeStatsCache {
  computedAt: string;
  archiveDays: number;
  historicalSample: DualFadeHistoricalSample;
  tracker: {
    bookNeedsAllTimeRoi: number;
    squareAllTimeRoi: number;
    bookNeedsBlendedRoi: number;
    squareBlendedRoi: number;
    roiGap: number;
  };
  coOccurrence: DualFadeCoOccurrence;
  archiveTrend: DualFadeArchiveTrend;
  byLeague: Record<string, DualFadeLeagueStats>;
}

function normalizeTeam(text: string): string {
  return text
    .replace(/\s*[+-]?\d+\.?\d*\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function displayTeam(text: string): string {
  return text.replace(/\s*[+-]?\d+\.?\d*\s*$/g, "").replace(/\s+/g, " ").trim();
}

/** Parse performance_daily CSV for days where both fade columns had activity */
export function analyzeDualFadeCoOccurrence(performanceDailyCsv: string): DualFadeCoOccurrence {
  const rows: string[][] = parse(performanceDailyCsv, {
    relax_column_count: true,
    skip_empty_lines: false,
  });

  const dateRow = rows.find((r) => (r[0] || "").trim() === "Date") ?? rows[0];
  if (!dateRow) {
    return emptyCoOccurrence();
  }

  const dateStarts: number[] = [];
  for (let c = 1; c < dateRow.length; c++) {
    const cell = (dateRow[c] || "").trim();
    if (cell && /^\d/.test(cell)) {
      dateStarts.push(c);
    }
  }

  let sportsbookTotalRow: string[] | undefined;
  let squaresTotalRow: string[] | undefined;

  let inSportsbook = false;
  let inSquares = false;

  for (const row of rows) {
    const label = (row[0] || "").trim();
    if (label.startsWith("Sportsbook")) {
      inSportsbook = true;
      inSquares = false;
      sportsbookTotalRow = undefined;
      continue;
    }
    if (label.startsWith("Squares")) {
      inSquares = true;
      inSportsbook = false;
      squaresTotalRow = undefined;
      continue;
    }
    if (
      label.startsWith("Sharp Money") ||
      label.startsWith("Model Best") ||
      label.startsWith("Whale")
    ) {
      inSportsbook = false;
      inSquares = false;
      continue;
    }

    const isTotal = label.toLowerCase().startsWith("total");
    if (inSportsbook && isTotal) sportsbookTotalRow = row;
    if (inSquares && isTotal) squaresTotalRow = row;
  }

  if (!sportsbookTotalRow || !squaresTotalRow) {
    return emptyCoOccurrence();
  }

  let dualActiveDays = 0;
  let dualPositiveDays = 0;
  let dualNegativeDays = 0;
  let combinedWins = 0;
  let combinedLosses = 0;
  let bookOutperformedSquareDays = 0;
  let squareOutperformedBookDays = 0;

  for (const start of dateStarts) {
    const bookW = parseFloat(sportsbookTotalRow[start] || "0") || 0;
    const bookL = parseFloat(sportsbookTotalRow[start + 1] || "0") || 0;
    const bookRet = parseFloat(sportsbookTotalRow[start + 2] || "0") || 0;
    const sqW = parseFloat(squaresTotalRow[start] || "0") || 0;
    const sqL = parseFloat(squaresTotalRow[start + 1] || "0") || 0;
    const sqRet = parseFloat(squaresTotalRow[start + 2] || "0") || 0;

    const bookActive = bookW + bookL > 0;
    const sqActive = sqW + sqL > 0;

    if (!bookActive || !sqActive) continue;

    dualActiveDays += 1;
    combinedWins += bookW + sqW;
    combinedLosses += bookL + sqL;

    const combinedRet = bookRet + sqRet;
    if (combinedRet > 0) dualPositiveDays += 1;
    if (combinedRet < 0) dualNegativeDays += 1;

    if (bookRet > sqRet) bookOutperformedSquareDays += 1;
    if (sqRet > bookRet) squareOutperformedBookDays += 1;
  }

  const total = combinedWins + combinedLosses;

  return {
    dualActiveDays,
    dualPositiveDays,
    dualNegativeDays,
    combinedWinRate: total > 0 ? combinedWins / total : 0.5,
    bookOutperformedSquareDays,
    squareOutperformedBookDays,
  };
}

function emptyCoOccurrence(): DualFadeCoOccurrence {
  return {
    dualActiveDays: 0,
    dualPositiveDays: 0,
    dualNegativeDays: 0,
    combinedWinRate: 0.5,
    bookOutperformedSquareDays: 0,
    squareOutperformedBookDays: 0,
  };
}

const YEARLY_MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEPT", "OCT", "NOV", "DEC",
];

export interface YearlyDualFadeAnalysis {
  coActiveMonths: number;
  bookOutperformedMonths: number;
  squareOutperformedMonths: number;
  bookInverseMonthRate: number;
  squareInverseMonthRate: number;
  bookMonthsTracked: number;
  squareMonthsTracked: number;
}

/** Aggregate monthly Book Needs vs Square history from yearly tracker (2022+) */
export function analyzeDualFadeFromYearly(
  performanceYearly: YearlyPerformanceRow[]
): YearlyDualFadeAnalysis {
  const bookRows = performanceYearly.filter(
    (r) => r.category === "Sportsbook" && r.league.toLowerCase().startsWith("total")
  );
  const squareRows = performanceYearly.filter(
    (r) => r.category === "Squares" && r.league.toLowerCase().startsWith("total")
  );

  let coActiveMonths = 0;
  let bookOutperformedMonths = 0;
  let squareOutperformedMonths = 0;
  let bookInverseMonths = 0;
  let squareInverseMonths = 0;
  let bookMonthsTracked = 0;
  let squareMonthsTracked = 0;

  for (const bookRow of bookRows) {
    const squareRow = squareRows.find((s) => s.year === bookRow.year);
    if (!squareRow) continue;

    for (const m of YEARLY_MONTHS) {
      const bookVal = bookRow.months[m];
      const sqVal = squareRow.months[m];
      const bookActive = bookVal != null;
      const sqActive = sqVal != null;

      if (bookActive) bookMonthsTracked += 1;
      if (sqActive) squareMonthsTracked += 1;

      if (!bookActive || !sqActive) continue;

      coActiveMonths += 1;
      const bookRet = bookVal as number;
      const sqRet = sqVal as number;

      if (bookRet > sqRet) bookOutperformedMonths += 1;
      if (sqRet > bookRet) squareOutperformedMonths += 1;
      // More negative fade column → inverse that side historically
      if (bookRet < sqRet) bookInverseMonths += 1;
      if (sqRet < bookRet) squareInverseMonths += 1;
    }
  }

  return {
    coActiveMonths,
    bookOutperformedMonths,
    squareOutperformedMonths,
    bookInverseMonthRate:
      coActiveMonths > 0 ? bookInverseMonths / coActiveMonths : 0.55,
    squareInverseMonthRate:
      coActiveMonths > 0 ? squareInverseMonths / coActiveMonths : 0.55,
    bookMonthsTracked,
    squareMonthsTracked,
  };
}

function countWeeklyDualFadeHistory(fullHistory?: FullHistoryStatsCache): number {
  if (!fullHistory) return 0;

  let weeks = 0;
  for (const agg of [
    ...Object.values(fullHistory.signals.book_needs_fade.byLeague),
    ...Object.values(fullHistory.signals.square_fade.byLeague),
  ]) {
    weeks += agg.weeks.filter((w) => w.wins + w.losses > 0).length;
  }

  // Deduplicate: league-level weeks are duplicated per league; use signal-level totals
  const bookWeeks = Object.values(fullHistory.signals.book_needs_fade.byLeague).reduce(
    (s, l) => s + l.weeks.filter((w) => w.wins + w.losses > 0).length,
    0
  );
  const squareWeeks = Object.values(fullHistory.signals.square_fade.byLeague).reduce(
    (s, l) => s + l.weeks.filter((w) => w.wins + w.losses > 0).length,
    0
  );
  weeks = Math.max(bookWeeks, squareWeeks, weeks / 4);
  return Math.round(weeks);
}

function countDualFadePicksTracked(
  yearly: YearlyDualFadeAnalysis,
  fullHistory?: FullHistoryStatsCache,
  confidenceStats?: ConfidenceStatsCache
): number {
  let weeklyPicks = 0;
  if (fullHistory) {
    for (const sig of ["book_needs_fade", "square_fade"] as SignalType[]) {
      for (const league of Object.values(fullHistory.signals[sig].byLeague)) {
        weeklyPicks += league.weeks.reduce((s, w) => s + w.wins + w.losses, 0);
        weeklyPicks += league.mtd.sampleSize;
      }
    }
  }

  const bookPicks = confidenceStats?.signals.book_needs_fade.sampleSize ?? 0;
  const squarePicks = confidenceStats?.signals.square_fade.sampleSize ?? 0;
  const monthlyEstimate = yearly.coActiveMonths * 22;

  return Math.max(weeklyPicks, bookPicks + squarePicks, monthlyEstimate);
}

export function buildDualFadeHistoricalSample(
  archiveDays: number,
  coOccurrence: DualFadeCoOccurrence,
  performanceYearly: YearlyPerformanceRow[],
  fullHistory?: FullHistoryStatsCache,
  confidenceStats?: ConfidenceStatsCache
): DualFadeHistoricalSample {
  const yearly = analyzeDualFadeFromYearly(performanceYearly);
  const weeksFromTab = countWeeklyDualFadeHistory(fullHistory);
  const months = yearly.coActiveMonths;
  const weeks = Math.max(weeksFromTab, Math.round(months * 4.33));

  const totalPicksTracked = countDualFadePicksTracked(
    yearly,
    fullHistory,
    confidenceStats
  );

  return {
    weeks,
    months,
    archiveDays,
    recentDualActiveDays: coOccurrence.dualActiveDays,
    totalPicksTracked,
    totalDataPoints: weeks + months + archiveDays,
  };
}

export function formatHistoricalSampleLabel(sample: DualFadeHistoricalSample): string {
  const parts: string[] = [];
  if (sample.weeks > 0) parts.push(`${sample.weeks} weeks`);
  if (sample.months > 0) parts.push(`${sample.months} months`);
  if (sample.totalPicksTracked > 0) parts.push(`${sample.totalPicksTracked} picks`);
  if (parts.length === 0) return "limited history";
  return `Based on ${parts.join(" / ")} of history`;
}

function buildLeagueStats(
  stats: ConfidenceStatsCache
): Record<string, DualFadeLeagueStats> {
  const leagues = new Set<string>();
  for (const sig of ["book_needs_fade", "square_fade"] as SignalType[]) {
    for (const league of Object.keys(stats.signals[sig].byLeague)) {
      leagues.add(league);
    }
  }

  const byLeague: Record<string, DualFadeLeagueStats> = {};

  for (const league of leagues) {
    const book = stats.signals.book_needs_fade.byLeague[league];
    const square = stats.signals.square_fade.byLeague[league];
    if (!book && !square) continue;

    const bookAll = book?.allTimeReturn ?? stats.signals.book_needs_fade.allTimeReturn;
    const sqAll = square?.allTimeReturn ?? stats.signals.square_fade.allTimeReturn;
    const bookBlend = book
      ? book.allTimeReturn * 0.4 + book.recentReturn * 0.6
      : stats.signals.book_needs_fade.blendedRoi;
    const sqBlend = square
      ? square.allTimeReturn * 0.4 + square.recentReturn * 0.6
      : stats.signals.square_fade.blendedRoi;

    const preferredColumn: "book_needs_fade" | "square_fade" =
      Math.abs(bookAll) >= Math.abs(sqAll) ? "book_needs_fade" : "square_fade";

    byLeague[league] = {
      league,
      bookNeedsAllTimeRoi: bookAll,
      squareAllTimeRoi: sqAll,
      bookNeedsBlendedRoi: bookBlend,
      squareBlendedRoi: sqBlend,
      preferredColumn,
      roiGap: Math.abs(Math.abs(bookAll) - Math.abs(sqAll)),
    };
  }

  return byLeague;
}

function deriveArchiveTrend(
  tracker: DualFadeStatsCache["tracker"],
  coOccurrence: DualFadeCoOccurrence,
  yearlyAnalysis: YearlyDualFadeAnalysis,
  historicalSample: DualFadeHistoricalSample
): DualFadeArchiveTrend {
  const bookAbs = Math.abs(tracker.bookNeedsAllTimeRoi);
  const sqAbs = Math.abs(tracker.squareAllTimeRoi);

  const bookWeight = bookAbs / (bookAbs + sqAbs);
  const sqWeight = sqAbs / (bookAbs + sqAbs);

  const dailyBookRate =
    coOccurrence.dualActiveDays > 0
      ? coOccurrence.bookOutperformedSquareDays / coOccurrence.dualActiveDays
      : 0.5;
  const dailySqRate =
    coOccurrence.dualActiveDays > 0
      ? coOccurrence.squareOutperformedBookDays / coOccurrence.dualActiveDays
      : 0.5;

  const monthWeight = yearlyAnalysis.coActiveMonths;
  const dayWeight = coOccurrence.dualActiveDays;
  const totalWeight = monthWeight + dayWeight || 1;
  const monthlyFrac = monthWeight / totalWeight;
  const dailyFrac = dayWeight / totalWeight;

  const bookInverseWinRate = Math.round(
    (yearlyAnalysis.bookInverseMonthRate * monthlyFrac +
      (0.52 + bookWeight * 0.12 + dailyBookRate * 0.08) * dailyFrac) *
      100
  ) / 100;

  const squareInverseWinRate = Math.round(
    (yearlyAnalysis.squareInverseMonthRate * monthlyFrac +
      (0.52 + sqWeight * 0.12 + dailySqRate * 0.08) * dailyFrac) *
      100
  ) / 100;

  const preferred =
    bookAbs >= sqAbs ? "book_needs_fade" : "square_fade";
  const sampleLabel = formatHistoricalSampleLabel(historicalSample);
  const rule =
    preferred === "book_needs_fade"
      ? `Dual-fade: invert Book Needs (ROI ${tracker.bookNeedsAllTimeRoi.toFixed(0)}u vs Square ${tracker.squareAllTimeRoi.toFixed(0)}u) — ${sampleLabel}`
      : `Dual-fade: invert Square (ROI ${tracker.squareAllTimeRoi.toFixed(0)}u vs Book ${tracker.bookNeedsAllTimeRoi.toFixed(0)}u) — ${sampleLabel}`;

  return {
    bookInverseWinRate,
    squareInverseWinRate,
    resolutionRule: rule,
    sampleSize: historicalSample.totalDataPoints,
  };
}

export function buildDualFadeStats(
  sheets: ParsedSheets,
  confidenceStats: ConfidenceStatsCache,
  performanceDailyCsv?: string,
  fullHistory?: FullHistoryStatsCache
): DualFadeStatsCache {
  const book = confidenceStats.signals.book_needs_fade;
  const square = confidenceStats.signals.square_fade;

  const tracker = {
    bookNeedsAllTimeRoi: book.allTimeReturn,
    squareAllTimeRoi: square.allTimeReturn,
    bookNeedsBlendedRoi: book.blendedRoi,
    squareBlendedRoi: square.blendedRoi,
    roiGap: Math.abs(Math.abs(book.allTimeReturn) - Math.abs(square.allTimeReturn)),
  };

  const coOccurrence = performanceDailyCsv
    ? analyzeDualFadeCoOccurrence(performanceDailyCsv)
    : emptyCoOccurrence();

  const yearlyAnalysis = analyzeDualFadeFromYearly(sheets.performanceYearly);
  const historicalSample = buildDualFadeHistoricalSample(
    sheets.archive.length,
    coOccurrence,
    sheets.performanceYearly,
    fullHistory,
    confidenceStats
  );

  const byLeague = buildLeagueStats(confidenceStats);

  const partial: DualFadeStatsCache = {
    computedAt: new Date().toISOString(),
    archiveDays: sheets.archive.length,
    historicalSample,
    tracker,
    coOccurrence,
    archiveTrend: {
      bookInverseWinRate: 0.5,
      squareInverseWinRate: 0.5,
      resolutionRule: "",
      sampleSize: 0,
    },
    byLeague,
  };

  partial.archiveTrend = deriveArchiveTrend(
    tracker,
    coOccurrence,
    yearlyAnalysis,
    historicalSample
  );

  if (fullHistory) {
    const df = fullHistory.dualFadeWeekly;
    const sampleLabel = formatHistoricalSampleLabel(historicalSample);
    partial.archiveTrend = {
      ...partial.archiveTrend,
      resolutionRule:
        df.preferredInverse === "book_needs_fade"
          ? `Dual-fade: Book 4wk ${df.bookNeedsLast4Weeks.toFixed(1)}u (${df.bookNeedsWeeklyTrend}) vs Square ${df.squareLast4Weeks.toFixed(1)}u (${df.squareWeeklyTrend}) → invert Book Needs — ${sampleLabel}`
          : `Dual-fade: Square 4wk ${df.squareLast4Weeks.toFixed(1)}u (${df.squareWeeklyTrend}) vs Book ${df.bookNeedsLast4Weeks.toFixed(1)}u → invert Square — ${sampleLabel}`,
      sampleSize: historicalSample.totalDataPoints,
    };
    if (df.bookNeedsWeeklyTrend === "up" && df.preferredInverse === "book_needs_fade") {
      partial.archiveTrend.bookInverseWinRate = Math.min(
        0.72,
        partial.archiveTrend.bookInverseWinRate + 0.04
      );
    }
    if (df.squareWeeklyTrend === "up" && df.preferredInverse === "square_fade") {
      partial.archiveTrend.squareInverseWinRate = Math.min(
        0.72,
        partial.archiveTrend.squareInverseWinRate + 0.04
      );
    }
  }

  return partial;
}

export async function cacheDualFadeStats(stats: DualFadeStatsCache): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(
    path.join(CACHE_DIR, DUAL_FADE_STATS_FILE),
    JSON.stringify(stats, null, 2),
    "utf-8"
  );
}

export async function loadDualFadeStats(): Promise<DualFadeStatsCache | null> {
  try {
    const raw = await fs.readFile(path.join(CACHE_DIR, DUAL_FADE_STATS_FILE), "utf-8");
    return JSON.parse(raw) as DualFadeStatsCache;
  } catch {
    return null;
  }
}

export interface DualFadeResolution {
  isDualFade: boolean;
  isStandalone: boolean;
  /** Book Needs + Square Top on opposite sides — signals cancel */
  isNoBet?: boolean;
  recommendedSide: string;
  recommendedSideNorm: string;
  confidence: number;
  reasoning: string;
  strongerFadeColumn: "book_needs_fade" | "square_fade";
  bookNeedsFadeTeam: string;
  squareFadeTeam: string;
  bookNeedsInverse: string;
  squareInverse: string;
  archiveWinRate: number;
  breakdown: { key: string; label: string; value: number; detail?: string }[];
}

function fadeRoiForLeague(
  stats: DualFadeStatsCache,
  column: "book_needs_fade" | "square_fade",
  _league: string
): number {
  return column === "book_needs_fade"
    ? stats.tracker.bookNeedsAllTimeRoi
    : stats.tracker.squareAllTimeRoi;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Detect if two fade picks oppose on the same VS row */
export function isOpposingDualFade(
  bookNeedsPick: SheetPick,
  squarePick: SheetPick
): boolean {
  if (bookNeedsPick.rawRow !== squarePick.rawRow) return false;

  const bookFade = normalizeTeam(bookNeedsPick.pick);
  const squareFade = normalizeTeam(squarePick.pick);
  const bookOpp = bookNeedsPick.opponent
    ? normalizeTeam(bookNeedsPick.opponent)
    : "";
  const squareOpp = squarePick.opponent ? normalizeTeam(squarePick.opponent) : "";

  if (bookOpp && squareFade === bookOpp && squareOpp && bookFade === squareOpp) {
    return true;
  }

  return bookOpp === squareFade || squareOpp === bookFade;
}

export function resolveDualFadeMatch(
  bookNeedsPick: SheetPick | undefined,
  squarePick: SheetPick | undefined,
  dualStats: DualFadeStatsCache,
  league: string
): DualFadeResolution | null {
  if (!bookNeedsPick && !squarePick) return null;

  const breakdown: DualFadeResolution["breakdown"] = [];

  if (bookNeedsPick && squarePick && isOpposingDualFade(bookNeedsPick, squarePick)) {
    const bookFadeTeam = displayTeam(bookNeedsPick.pick);
    const squareFadeTeam = displayTeam(squarePick.pick);
    const bookNeedsInverse = bookNeedsPick.opponent
      ? displayTeam(bookNeedsPick.opponent)
      : squareFadeTeam;
    const squareInverse = squarePick.opponent
      ? displayTeam(squarePick.opponent)
      : bookFadeTeam;

    const reasoning =
      `Book Needs lists ${bookFadeTeam} (→ ${bookNeedsInverse}) and Square Top lists ${squareFadeTeam} (→ ${squareInverse}). ` +
      `Both teams appear on opposite sides — conflicting signals, no bet.`;

    breakdown.push({
      key: "dual_fade_no_bet",
      label: "Opposing dual-fade",
      value: 0,
      detail: `${bookFadeTeam} vs ${squareFadeTeam} — cancelled`,
    });

    return {
      isDualFade: true,
      isNoBet: true,
      isStandalone: false,
      recommendedSide: "",
      recommendedSideNorm: "",
      confidence: 0,
      reasoning,
      strongerFadeColumn: "book_needs_fade",
      bookNeedsFadeTeam: bookFadeTeam,
      squareFadeTeam: squareFadeTeam,
      bookNeedsInverse,
      squareInverse,
      archiveWinRate: 0,
      breakdown,
    };
  }

  if (bookNeedsPick && squarePick && !isOpposingDualFade(bookNeedsPick, squarePick)) {
    return null;
  }

  const single = bookNeedsPick ?? squarePick!;
  const column: "book_needs_fade" | "square_fade" =
    single.signalType === "book_needs_fade" ? "book_needs_fade" : "square_fade";
  const fadeTeam = displayTeam(single.pick);
  const inverse = single.opponent ? displayTeam(single.opponent) : undefined;

  if (!inverse) {
    return {
      isDualFade: false,
      isStandalone: true,
      recommendedSide: `(fade) ${fadeTeam}`,
      recommendedSideNorm: normalizeTeam(fadeTeam),
      confidence: 28,
      reasoning: `Fade ${fadeTeam} alone — opponent not identified on sheet (low confidence, fade-only).`,
      strongerFadeColumn: column,
      bookNeedsFadeTeam: column === "book_needs_fade" ? fadeTeam : "",
      squareFadeTeam: column === "square_fade" ? fadeTeam : "",
      bookNeedsInverse: "",
      squareInverse: "",
      archiveWinRate: 0.5,
      breakdown: [
        {
          key: "standalone_no_opp",
          label: "Fade without matchup",
          value: 0,
          detail: categoryForSignal(column),
        },
      ],
    };
  }

  const roi = fadeRoiForLeague(dualStats, column, league);
  const archiveWinRate =
    column === "book_needs_fade"
      ? dualStats.archiveTrend.bookInverseWinRate
      : dualStats.archiveTrend.squareInverseWinRate;
  const confidence = Math.round(clamp(52 + Math.abs(roi) / 80 + archiveWinRate * 10, 48, 72));

  return {
    isDualFade: false,
    isStandalone: true,
    recommendedSide: inverse,
    recommendedSideNorm: normalizeTeam(inverse),
    confidence,
    reasoning:
      `Fade ${fadeTeam} (${column === "book_needs_fade" ? "Book Needs" : "Square Top"}) → bet ${inverse}. ` +
      `Fade ROI ${roi.toFixed(0)}u · historical inverse ~${Math.round(archiveWinRate * 100)}%.`,
    strongerFadeColumn: column,
    bookNeedsFadeTeam: column === "book_needs_fade" ? fadeTeam : "",
    squareFadeTeam: column === "square_fade" ? fadeTeam : "",
    bookNeedsInverse: column === "book_needs_fade" ? inverse : "",
    squareInverse: column === "square_fade" ? inverse : "",
    archiveWinRate,
    breakdown: [
      {
        key: "standalone_fade",
        label: "Inverted fade",
        value: roi,
        detail: `${fadeTeam} → ${inverse}`,
      },
    ],
  };
}

/** Find opposing book/square fade pair for a specific ESPN matchup (not just sheet row). */
export function findDualFadePair(
  picks: SheetPick[],
  league: string,
  game?: Pick<CalendarGame, "homeTeam" | "awayTeam">
): { book?: SheetPick; square?: SheetPick } {
  const fadePicks = picks.filter(
    (p) =>
      (p.league === league || p.league === "UNKNOWN") &&
      (p.signalType === "book_needs_fade" || p.signalType === "square_fade")
  );

  const books = fadePicks.filter((p) => p.signalType === "book_needs_fade");
  const squares = fadePicks.filter((p) => p.signalType === "square_fade");

  const gameCtx: CalendarGame | undefined = game
    ? {
        id: "game-filter",
        league: "MLB",
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        homeAbbr: "",
        awayAbbr: "",
        startTime: "",
        status: "",
      }
    : undefined;

  for (const book of books) {
    for (const square of squares) {
      if (!isOpposingDualFade(book, square)) continue;
      if (gameCtx && !pickBelongsToGame(book.pick, book.opponent, gameCtx)) continue;
      if (gameCtx && !pickBelongsToGame(square.pick, square.opponent, gameCtx)) continue;
      if (
        game &&
        book.gameSlot != null &&
        square.gameSlot != null &&
        book.gameSlot !== square.gameSlot
      ) {
        continue;
      }
      return { book, square };
    }
  }

  return {};
}
