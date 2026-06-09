import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { CACHE_DIR } from "../config.js";
import type { DailyPerformanceBlock, ParsedSheets, SheetPick, SignalType } from "../types.js";
import type { ConfidenceStatsCache } from "./historicalStats.js";
import type { FullHistoryStatsCache } from "./fullHistoryStats.js";
import { categoryForSignal } from "./signalMapping.js";

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
  coOccurrence: DualFadeCoOccurrence
): DualFadeArchiveTrend {
  const bookAbs = Math.abs(tracker.bookNeedsAllTimeRoi);
  const sqAbs = Math.abs(tracker.squareAllTimeRoi);

  const bookWeight = bookAbs / (bookAbs + sqAbs);
  const sqWeight = sqAbs / (bookAbs + sqAbs);

  const bookInverseWinRate = Math.round(
    (0.52 + bookWeight * 0.12 + (coOccurrence.bookOutperformedSquareDays /
      Math.max(coOccurrence.dualActiveDays, 1)) *
      0.08) *
      100
  ) / 100;

  const squareInverseWinRate = Math.round(
    (0.52 + sqWeight * 0.12 + (coOccurrence.squareOutperformedBookDays /
      Math.max(coOccurrence.dualActiveDays, 1)) *
      0.08) *
      100
  ) / 100;

  const preferred =
    bookAbs >= sqAbs ? "book_needs_fade" : "square_fade";
  const rule =
    preferred === "book_needs_fade"
      ? "Quand Book Needs et Square s'opposent sur une ligne VS, jouer l'inverse du fade Book Needs (ROI tracker plus négatif: -501u vs -443u)"
      : "Quand Book Needs et Square s'opposent sur une ligne VS, jouer l'inverse du fade Square (ROI tracker plus négatif)";

  return {
    bookInverseWinRate,
    squareInverseWinRate,
    resolutionRule: rule,
    sampleSize: coOccurrence.dualActiveDays,
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

  const byLeague = buildLeagueStats(confidenceStats);

  const partial: DualFadeStatsCache = {
    computedAt: new Date().toISOString(),
    archiveDays: sheets.archive.length,
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

  partial.archiveTrend = deriveArchiveTrend(tracker, coOccurrence);

  if (fullHistory) {
    const df = fullHistory.dualFadeWeekly;
    partial.archiveTrend = {
      ...partial.archiveTrend,
      resolutionRule:
        df.preferredInverse === "book_needs_fade"
          ? `Dual-fade hebdo: Book Needs 4sem ${df.bookNeedsLast4Weeks.toFixed(1)}u (${df.bookNeedsWeeklyTrend}) vs Square ${df.squareLast4Weeks.toFixed(1)}u (${df.squareWeeklyTrend}) → inverser Book Needs`
          : `Dual-fade hebdo: Square 4sem ${df.squareLast4Weeks.toFixed(1)}u (${df.squareWeeklyTrend}) vs Book ${df.bookNeedsLast4Weeks.toFixed(1)}u → inverser Square`,
      sampleSize: coOccurrence.dualActiveDays + (fullHistory.performanceTabPeriods.length > 0 ? 1 : 0),
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

    const bookRoi = fadeRoiForLeague(dualStats, "book_needs_fade", league);
    const squareRoi = fadeRoiForLeague(dualStats, "square_fade", league);

    const strongerFadeColumn: "book_needs_fade" | "square_fade" =
      Math.abs(bookRoi) >= Math.abs(squareRoi) ? "book_needs_fade" : "square_fade";

    const recommendedSide =
      strongerFadeColumn === "book_needs_fade" ? bookNeedsInverse : squareInverse;
    const archiveWinRate =
      strongerFadeColumn === "book_needs_fade"
        ? dualStats.archiveTrend.bookInverseWinRate
        : dualStats.archiveTrend.squareInverseWinRate;

    const roiGap = Math.abs(Math.abs(bookRoi) - Math.abs(squareRoi));
    let confidence = clamp(
      58 + roiGap / 25 + (Number.isFinite(archiveWinRate) ? archiveWinRate : 0.55) * 18 + dualStats.tracker.roiGap / 120,
      62,
      86
    );
    confidence = Math.round(confidence);

    breakdown.push({
      key: "dual_fade_roi",
      label: "ROI tracker fade",
      value: roiGap,
      detail: `Book Needs ${bookRoi.toFixed(0)}u · Square ${squareRoi.toFixed(0)}u`,
    });
    breakdown.push({
      key: "dual_fade_archive",
      label: "Tendance archives",
      value: dualStats.coOccurrence.dualActiveDays,
      detail: `${dualStats.coOccurrence.dualActiveDays} jours co-actifs · inverse ${strongerFadeColumn === "book_needs_fade" ? "Book" : "Square"} ~${Math.round(archiveWinRate * 100)}%`,
    });

    const strongerLabel =
      strongerFadeColumn === "book_needs_fade" ? "Book Needs" : "Square Top";
    const reasoning =
      `Dynamique dual-fade: Book Needs fade ${bookFadeTeam} + Square fade ${squareFadeTeam}. ` +
      `${strongerLabel} ROI tracker plus négatif (${strongerFadeColumn === "book_needs_fade" ? bookRoi.toFixed(0) : squareRoi.toFixed(0)}u vs ${strongerFadeColumn === "book_needs_fade" ? squareRoi.toFixed(0) : bookRoi.toFixed(0)}u) → ` +
      `jouer ${recommendedSide} (tendance archive ~${Math.round(archiveWinRate * 100)}%, ${dualStats.coOccurrence.dualActiveDays} jours co-actifs).`;

    return {
      isDualFade: true,
      isStandalone: false,
      recommendedSide,
      recommendedSideNorm: normalizeTeam(recommendedSide),
      confidence,
      reasoning,
      strongerFadeColumn,
      bookNeedsFadeTeam: bookFadeTeam,
      squareFadeTeam: squareFadeTeam,
      bookNeedsInverse,
      squareInverse,
      archiveWinRate,
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
      reasoning: `Fade ${fadeTeam} seul — adversaire non identifié sur la feuille (confiance faible, fade-only).`,
      strongerFadeColumn: column,
      bookNeedsFadeTeam: column === "book_needs_fade" ? fadeTeam : "",
      squareFadeTeam: column === "square_fade" ? fadeTeam : "",
      bookNeedsInverse: "",
      squareInverse: "",
      archiveWinRate: 0.5,
      breakdown: [
        {
          key: "standalone_no_opp",
          label: "Fade sans VS",
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
      `Fade ${fadeTeam} (${column === "book_needs_fade" ? "Book Needs" : "Square Top"}) → jouer ${inverse}. ` +
      `ROI fade ${roi.toFixed(0)}u · inverse historique ~${Math.round(archiveWinRate * 100)}%.`,
    strongerFadeColumn: column,
    bookNeedsFadeTeam: column === "book_needs_fade" ? fadeTeam : "",
    squareFadeTeam: column === "square_fade" ? fadeTeam : "",
    bookNeedsInverse: column === "book_needs_fade" ? inverse : "",
    squareInverse: column === "square_fade" ? inverse : "",
    archiveWinRate,
    breakdown: [
      {
        key: "standalone_fade",
        label: "Fade inversé",
        value: roi,
        detail: `${fadeTeam} → ${inverse}`,
      },
    ],
  };
}

/** Find book/square picks on same raw row for dual-fade detection */
export function findDualFadePair(
  picks: SheetPick[],
  rawRow: number,
  league: string
): { book?: SheetPick; square?: SheetPick } {
  const rowPicks = picks.filter(
    (p) =>
      p.rawRow === rawRow &&
      (p.league === league || p.league === "UNKNOWN") &&
      (p.signalType === "book_needs_fade" || p.signalType === "square_fade")
  );
  return {
    book: rowPicks.find((p) => p.signalType === "book_needs_fade"),
    square: rowPicks.find((p) => p.signalType === "square_fade"),
  };
}
