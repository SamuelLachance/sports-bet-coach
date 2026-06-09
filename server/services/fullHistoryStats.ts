import fs from "node:fs/promises";
import path from "node:path";
import { CACHE_DIR } from "../config.js";
import {
  lastNWeeksStats,
  parseFullHistoryCsv,
  summarizeWeeklyTrend,
  type ParsedFullHistory,
  type WeekStats,
} from "../parsers/fullHistory.js";
import type {
  DailyPerformanceBlock,
  SignalType,
  YearlyPerformanceRow,
} from "../types.js";
import { parseYearlyAllTimeSummary } from "../parsers/performance.js";
import { categoryForSignal, signalForCategory } from "./signalMapping.js";
import type { ConfidenceStatsCache, CrossSignalRule } from "./historicalStats.js";

export const FULL_HISTORY_STATS_FILE = "full-history-stats.json";

const ALL_SIGNALS: SignalType[] = [
  "sharp_money",
  "book_needs_fade",
  "square_fade",
  "reverse_line_movement",
  "mega_sharps",
  "whale_plays",
  "model_best_values",
  "mega_rlm",
];

const PRIOR_WINS = 5;
const PRIOR_LOSSES = 5;
const BREAK_EVEN = 0.524; // -110 juice

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export interface SignalLeagueFullStats {
  signalType: SignalType;
  league: string;
  /** All-time ROI units from yearly tracker */
  allTimeRoi: number;
  /** Recent 6-month ROI from yearly */
  recentMonthlyRoi: number;
  /** Last 4 weeks from performance tab */
  last4Weeks: { wins: number; losses: number; returnUnits: number; winRate: number; roi: number };
  /** Current month MTD from performance tab */
  mtd: { wins: number; losses: number; returnUnits: number; winRate: number; sampleSize: number };
  /** Weekly trend direction */
  weeklyTrend: "up" | "down" | "flat";
  /** Bayesian-shrunk win rate */
  bayesianWinRate: number;
  /** Kelly-inspired edge 0-1 */
  kellyEdge: number;
  /** Blended ROI for confidence */
  blendedRoi: number;
  sampleSize: number;
  isProfitable: boolean;
  isToxic: boolean;
  profitableAsInverse: boolean;
  weeks: WeekStats[];
}

export interface SignalFullProfile {
  signalType: SignalType;
  category: string;
  allTimeRoi: number;
  recentMonthlyRoi: number;
  blendedRoi: number;
  winRate: number;
  bayesianWinRate: number;
  sampleSize: number;
  weeklyTrend: "up" | "down" | "flat";
  last4WeeksRoi: number;
  isProfitable: boolean;
  isToxic: boolean;
  profitableAsInverse: boolean;
  byLeague: Record<string, SignalLeagueFullStats>;
}

export interface ProfitableCombo {
  signalType: SignalType;
  league: string;
  blendedRoi: number;
  winRate: number;
  sampleSize: number;
  label: string;
}

export interface CrossSignalConfluence {
  signalA: SignalType;
  signalB: SignalType;
  sameSide: boolean;
  jointWinRate: number;
  sampleHint: number;
  boost: number;
  label: string;
}

export interface FullHistoryStatsCache {
  computedAt: string;
  archiveDays: number;
  performanceTabPeriods: string[];
  signals: Record<SignalType, SignalFullProfile>;
  profitableCombos: ProfitableCombo[];
  toxicCombos: ProfitableCombo[];
  crossSignalConfluence: CrossSignalConfluence[];
  dualFadeWeekly: {
    bookNeedsLast4Weeks: number;
    squareLast4Weeks: number;
    bookNeedsWeeklyTrend: "up" | "down" | "flat";
    squareWeeklyTrend: "up" | "down" | "flat";
    preferredInverse: "book_needs_fade" | "square_fade";
  };
}

function bayesianWinRate(wins: number, losses: number, priorW = PRIOR_WINS, priorL = PRIOR_LOSSES): number {
  return (wins + priorW) / (wins + losses + priorW + priorL);
}

function kellyEdge(winRate: number, odds = -110): number {
  const decimal = odds < 0 ? 1 + 100 / Math.abs(odds) : 1 + odds / 100;
  const b = decimal - 1;
  const p = winRate;
  const q = 1 - p;
  const kelly = (b * p - q) / b;
  return clamp(kelly, -0.5, 0.5);
}

function computeRecentMonthlyRoi(rows: YearlyPerformanceRow[]): number {
  const MONTH_ORDER = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEPT", "OCT", "NOV", "DEC"];
  const totalRows = rows.filter((r) => r.league.toLowerCase().startsWith("total"));
  if (!totalRows.length) return 0;

  const sorted = [...totalRows].sort((a, b) => b.year - a.year);
  let weighted = 0;
  let weightSum = 0;
  let monthsSeen = 0;

  for (const row of sorted) {
    const monthEntries = MONTH_ORDER.map((m) => ({ m, v: row.months[m] }))
      .filter((x) => x.v != null)
      .reverse();
    for (const { v } of monthEntries) {
      if (monthsSeen >= 6) break;
      const w = Math.pow(0.85, monthsSeen);
      weighted += (v as number) * w;
      weightSum += w;
      monthsSeen += 1;
    }
    if (monthsSeen >= 6) break;
  }
  return weightSum > 0 ? (weighted / weightSum) * 6 : 0;
}

function allTimeFromYearly(rows: YearlyPerformanceRow[]): number {
  const total = rows.find((r) => r.league.toLowerCase().startsWith("total") && r.allTime != null);
  if (total?.allTime != null) return total.allTime;
  return rows
    .filter((r) => r.league.toLowerCase().startsWith("total") && r.yearTotal != null)
    .reduce((s, r) => s + (r.yearTotal ?? 0), 0);
}

function leagueAllTimeFromYearly(rows: YearlyPerformanceRow[], league: string): number {
  const lr = rows.find(
    (r) => r.league.replace("NFL/CFB", "NFL") === league && r.allTime != null
  );
  if (lr?.allTime != null) return lr.allTime;
  return rows
    .filter((r) => r.league.replace("NFL/CFB", "NFL") === league)
    .reduce((s, r) => s + (r.yearTotal ?? 0), 0);
}

function aggregateDailyByCategory(
  blocks: DailyPerformanceBlock[]
): Map<string, { wins: number; losses: number; returnUnits: number; byLeague: Map<string, { wins: number; losses: number; returnUnits: number }> }> {
  const map = new Map<
    string,
    {
      wins: number;
      losses: number;
      returnUnits: number;
      byLeague: Map<string, { wins: number; losses: number; returnUnits: number }>;
    }
  >();

  for (const block of blocks) {
    const key = block.category;
    if (!map.has(key)) {
      map.set(key, { wins: 0, losses: 0, returnUnits: 0, byLeague: new Map() });
    }
    const agg = map.get(key)!;
    agg.wins += block.total.wins;
    agg.losses += block.total.losses;
    agg.returnUnits += block.total.returnUnits;
    for (const league of block.leagues) {
      const lk = league.league.replace("NFL/CFB", "NFL");
      if (!agg.byLeague.has(lk)) {
        agg.byLeague.set(lk, { wins: 0, losses: 0, returnUnits: 0 });
      }
      const la = agg.byLeague.get(lk)!;
      la.wins += league.wins;
      la.losses += league.losses;
      la.returnUnits += league.returnUnits;
    }
  }
  return map;
}

function buildCrossSignalConfluence(
  signals: Record<SignalType, SignalFullProfile>
): CrossSignalConfluence[] {
  const rules: CrossSignalConfluence[] = [];
  const positive = ALL_SIGNALS.filter((s) => signals[s].blendedRoi > 5);
  const fadeSignals: SignalType[] = ["book_needs_fade", "square_fade"];

  for (let i = 0; i < positive.length; i++) {
    for (let j = i + 1; j < positive.length; j++) {
      const a = positive[i];
      const b = positive[j];
      const jointWr =
        (signals[a].bayesianWinRate + signals[b].bayesianWinRate) / 2;
      const avgRoi = (signals[a].blendedRoi + signals[b].blendedRoi) / 2;
      rules.push({
        signalA: a,
        signalB: b,
        sameSide: true,
        jointWinRate: jointWr,
        sampleHint: Math.min(signals[a].sampleSize, signals[b].sampleSize),
        boost: clamp(Math.round(avgRoi / 12 + (jointWr - 0.5) * 20), 6, 18),
        label: `${a}+${b} confluence`,
      });
    }
  }

  for (const pos of positive) {
    for (const fade of fadeSignals) {
      if (!signals[fade].profitableAsInverse) continue;
      rules.push({
        signalA: pos,
        signalB: fade,
        sameSide: true,
        jointWinRate: (signals[pos].bayesianWinRate + (1 - signals[fade].bayesianWinRate)) / 2,
        sampleHint: signals[fade].sampleSize,
        boost: clamp(Math.round(signals[pos].blendedRoi / 15 + 4), 5, 14),
        label: `${pos}+fade ${fade} inverse confluence`,
      });
      rules.push({
        signalA: pos,
        signalB: fade,
        sameSide: false,
        jointWinRate: 0.45,
        sampleHint: signals[fade].sampleSize,
        boost: -10,
        label: `${pos} vs fade ${fade} conflit`,
      });
    }
  }

  rules.push({
    signalA: "book_needs_fade",
    signalB: "square_fade",
    sameSide: true,
    jointWinRate: 0.48,
    sampleHint: Math.min(signals.book_needs_fade.sampleSize, signals.square_fade.sampleSize),
    boost: -8,
    label: "Double fade public/book",
  });

  return rules;
}

export function buildFullHistoryStats(
  performanceHistoryCsv: string,
  performanceYearly: YearlyPerformanceRow[],
  performanceDaily: DailyPerformanceBlock[],
  archiveDays: number,
  periodKey?: string,
  yearlyCsv?: string
): FullHistoryStatsCache {
  const parsed: ParsedFullHistory = parseFullHistoryCsv(
    performanceHistoryCsv,
    periodKey ?? new Date().toISOString().slice(0, 7)
  );
  const dailyAgg = aggregateDailyByCategory(performanceDaily);
  const allTimeSummary = yearlyCsv ? parseYearlyAllTimeSummary(yearlyCsv) : {};

  const signals = {} as Record<SignalType, SignalFullProfile>;
  const profitableCombos: ProfitableCombo[] = [];
  const toxicCombos: ProfitableCombo[] = [];

  for (const signalType of ALL_SIGNALS) {
    const category = categoryForSignal(signalType);
    const yearlyRows = performanceYearly.filter((r) => r.category === category);
    const daily = dailyAgg.get(category) ?? dailyAgg.get(category.replace(" 🐳", ""));

    const summaryKey = Object.keys(allTimeSummary).find(
      (k) => signalForCategory(k) === signalType || k === category
    );
    const allTimeRoi =
      (summaryKey ? allTimeSummary[summaryKey] : undefined) ?? allTimeFromYearly(yearlyRows);
    const recentMonthlyRoi = computeRecentMonthlyRoi(yearlyRows);
    const wins = daily?.wins ?? 0;
    const losses = daily?.losses ?? 0;
    const sampleSize = wins + losses;
    const winRate = sampleSize > 0 ? wins / sampleSize : 0.5;
    const bayesianWr = bayesianWinRate(wins, losses);

    const historyAgg = parsed.aggregates.filter((a) => a.signalType === signalType);
    const totalWeeks = historyAgg.flatMap((a) => a.weeks);
    const last4 = lastNWeeksStats(totalWeeks, 4);
    const weeklyTrend = summarizeWeeklyTrend(totalWeeks);
    const mtdAgg = historyAgg.reduce(
      (acc, a) => ({
        wins: acc.wins + a.mtd.wins,
        losses: acc.losses + a.mtd.losses,
        returnUnits: acc.returnUnits + a.mtd.returnUnits,
        sampleSize: acc.sampleSize + a.mtd.sampleSize,
      }),
      { wins: 0, losses: 0, returnUnits: 0, sampleSize: 0 }
    );
    const mtdWinRate =
      mtdAgg.wins + mtdAgg.losses > 0
        ? mtdAgg.wins / (mtdAgg.wins + mtdAgg.losses)
        : winRate;

    const last4WeeksRoi = last4.returnUnits;
    const temporalRoi = last4WeeksRoi * 0.5 + mtdAgg.returnUnits * 0.3 + recentMonthlyRoi * 0.2;
    const blendedRoi = allTimeRoi * 0.25 + recentMonthlyRoi * 0.25 + temporalRoi * 0.5;

    const isFade = signalType === "book_needs_fade" || signalType === "square_fade";
    const isProfitable = !isFade ? blendedRoi > 5 : false;
    const isToxic = blendedRoi < -20 || (isFade && allTimeRoi < -100);
    const profitableAsInverse = isFade && allTimeRoi < -50;

    const byLeague: Record<string, SignalLeagueFullStats> = {};
    const leagueSet = new Set<string>();

    if (daily) {
      for (const [league] of daily.byLeague) leagueSet.add(league);
    }
    for (const row of yearlyRows) {
      if (!row.league.toLowerCase().startsWith("total")) {
        leagueSet.add(row.league.replace("NFL/CFB", "NFL"));
      }
    }
    for (const agg of historyAgg) leagueSet.add(agg.league);

    for (const league of leagueSet) {
      const dailyLeague = daily?.byLeague.get(league);
      const lw = dailyLeague?.wins ?? 0;
      const ll = dailyLeague?.losses ?? 0;
      const leagueHistory = historyAgg.find((a) => a.league === league);
      const leagueWeeks = leagueHistory?.weeks ?? [];
      const leagueLast4 = lastNWeeksStats(leagueWeeks, 4);
      const leagueMtd = leagueHistory?.mtd ?? {
        wins: lw,
        losses: ll,
        returnUnits: dailyLeague?.returnUnits ?? 0,
        winRate: lw + ll > 0 ? lw / (lw + ll) : 0.5,
        sampleSize: lw + ll,
      };
      const leagueAllTime = leagueAllTimeFromYearly(yearlyRows, league);
      const leagueRecent = computeRecentMonthlyRoi(
        yearlyRows.filter((r) => r.league.replace("NFL/CFB", "NFL") === league)
      );
      const leagueTemporal =
        leagueLast4.returnUnits * 0.55 + leagueMtd.returnUnits * 0.45;
      const leagueBlended = leagueAllTime * 0.3 + leagueRecent * 0.2 + leagueTemporal * 0.5;
      const leagueBayesian = bayesianWinRate(
        leagueMtd.wins || lw,
        leagueMtd.losses || ll
      );
      const leagueKelly = kellyEdge(leagueBayesian);
      const leagueTrend = summarizeWeeklyTrend(leagueWeeks);
      const leagueSample = leagueMtd.sampleSize || lw + ll;

      const leagueProfitable = !isFade ? leagueBlended > 3 : false;
      const leagueToxic = leagueBlended < -15;
      const leagueInverse = isFade && leagueAllTime < -40;

      byLeague[league] = {
        signalType,
        league,
        allTimeRoi: leagueAllTime,
        recentMonthlyRoi: leagueRecent,
        last4Weeks: {
          ...leagueLast4,
          roi: leagueSample > 0 ? leagueLast4.returnUnits / leagueSample * 100 : leagueLast4.returnUnits,
        },
        mtd: leagueMtd,
        weeklyTrend: leagueTrend,
        bayesianWinRate: leagueBayesian,
        kellyEdge: leagueKelly,
        blendedRoi: leagueBlended,
        sampleSize: leagueSample,
        isProfitable: leagueProfitable,
        isToxic: leagueToxic,
        profitableAsInverse: leagueInverse,
        weeks: leagueWeeks,
      };

      const combo: ProfitableCombo = {
        signalType,
        league,
        blendedRoi: leagueBlended,
        winRate: leagueMtd.winRate,
        sampleSize: leagueSample,
        label: `${category} × ${league}`,
      };
      if (leagueProfitable || leagueInverse) profitableCombos.push(combo);
      if (leagueToxic) toxicCombos.push(combo);
    }

    signals[signalType] = {
      signalType,
      category,
      allTimeRoi,
      recentMonthlyRoi,
      blendedRoi,
      winRate,
      bayesianWinRate: bayesianWr,
      sampleSize,
      weeklyTrend,
      last4WeeksRoi,
      isProfitable,
      isToxic,
      profitableAsInverse,
      byLeague,
    };
  }

  profitableCombos.sort((a, b) => b.blendedRoi - a.blendedRoi);
  toxicCombos.sort((a, b) => a.blendedRoi - b.blendedRoi);

  const bookWeeks = parsed.aggregates
    .filter((a) => a.signalType === "book_needs_fade")
    .flatMap((a) => a.weeks);
  const squareWeeks = parsed.aggregates
    .filter((a) => a.signalType === "square_fade")
    .flatMap((a) => a.weeks);

  const bookLast4 = lastNWeeksStats(bookWeeks, 4);
  const squareLast4 = lastNWeeksStats(squareWeeks, 4);

  const crossSignalConfluence = buildCrossSignalConfluence(signals);

  return {
    computedAt: new Date().toISOString(),
    archiveDays,
    performanceTabPeriods: parsed.blocks.map((b) => b.periodKey),
    signals,
    profitableCombos: profitableCombos.slice(0, 30),
    toxicCombos: toxicCombos.slice(0, 20),
    crossSignalConfluence,
    dualFadeWeekly: {
      bookNeedsLast4Weeks: bookLast4.returnUnits,
      squareLast4Weeks: squareLast4.returnUnits,
      bookNeedsWeeklyTrend: summarizeWeeklyTrend(bookWeeks),
      squareWeeklyTrend: summarizeWeeklyTrend(squareWeeks),
      preferredInverse:
        Math.abs(signals.book_needs_fade.allTimeRoi) >= Math.abs(signals.square_fade.allTimeRoi)
          ? "book_needs_fade"
          : "square_fade",
    },
  };
}

export async function cacheFullHistoryStats(stats: FullHistoryStatsCache): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(
    path.join(CACHE_DIR, FULL_HISTORY_STATS_FILE),
    JSON.stringify(stats, null, 2),
    "utf-8"
  );
}

export async function loadFullHistoryStats(): Promise<FullHistoryStatsCache | null> {
  try {
    const raw = await fs.readFile(path.join(CACHE_DIR, FULL_HISTORY_STATS_FILE), "utf-8");
    return JSON.parse(raw) as FullHistoryStatsCache;
  } catch {
    return null;
  }
}

/** Merge full history into legacy confidence stats shape */
export function enrichConfidenceStats(
  base: ConfidenceStatsCache,
  full: FullHistoryStatsCache
): ConfidenceStatsCache {
  const signals = { ...base.signals };

  for (const signalType of ALL_SIGNALS) {
    const profile = full.signals[signalType];
    const existing = signals[signalType];
    if (!profile || !existing) continue;

    existing.allTimeReturn =
      profile.allTimeRoi !== 0 ? profile.allTimeRoi : existing.allTimeReturn;
    existing.recentReturn = profile.recentMonthlyRoi || existing.recentReturn;
    existing.blendedRoi =
      profile.allTimeRoi * 0.25 +
      profile.recentMonthlyRoi * 0.25 +
      profile.last4WeeksRoi * 0.35 +
      (profile.sampleSize > 0 ? profile.winRate * 10 : 0) * 0.15;
    existing.winRate = profile.bayesianWinRate;
    existing.sampleSize = Math.max(existing.sampleSize, profile.sampleSize);

    for (const [league, ls] of Object.entries(profile.byLeague)) {
      if (!existing.byLeague[league]) {
        existing.byLeague[league] = {
          wins: ls.mtd.wins,
          losses: ls.mtd.losses,
          winRate: ls.mtd.winRate,
          allTimeReturn: ls.allTimeRoi,
          recentReturn: ls.last4Weeks.returnUnits,
        };
      } else {
        existing.byLeague[league].allTimeReturn = ls.allTimeRoi;
        existing.byLeague[league].recentReturn = ls.last4Weeks.returnUnits;
        existing.byLeague[league].winRate = ls.bayesianWinRate;
      }
    }
  }

  const crossSignalRules: CrossSignalRule[] = full.crossSignalConfluence.map((c) => ({
    signalA: c.signalA,
    signalB: c.signalB,
    sameSide: c.sameSide,
    boost: c.boost,
    label: c.label,
    sampleHint: c.sampleHint,
  }));

  return {
    ...base,
    computedAt: full.computedAt,
    signals,
    crossSignalRules,
  };
}

/** Lookup stats for a pick's signal + league */
export function lookupPickStats(
  full: FullHistoryStatsCache,
  signalType: SignalType,
  league: string
): SignalLeagueFullStats | SignalFullProfile {
  const profile = full.signals[signalType];
  return profile.byLeague[league] ?? profile;
}

export function isHighConviction(
  full: FullHistoryStatsCache,
  signalType: SignalType,
  league: string
): boolean {
  const profile = full.signals[signalType];
  const leagueStats = profile.byLeague[league];
  if (!leagueStats) {
    return profile.isProfitable && profile.weeklyTrend === "up" && profile.blendedRoi > 10;
  }
  const aligned =
    leagueStats.blendedRoi > 5 &&
    leagueStats.weeklyTrend === "up" &&
    leagueStats.allTimeRoi > 0;
  const fadeInverse =
    profile.profitableAsInverse &&
    leagueStats.weeklyTrend === "up" &&
    leagueStats.last4Weeks.returnUnits > 0;
  return aligned || fadeInverse;
}

export function kellyToConfidence(kelly: number, bayesianWr: number): number {
  const edgeComponent = kelly * 80;
  const wrComponent = (bayesianWr - BREAK_EVEN) * 60;
  return clamp(50 + edgeComponent * 0.4 + wrComponent * 0.6, 0, 100);
}
