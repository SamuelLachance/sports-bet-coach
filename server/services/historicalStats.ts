import type {
  DailyPerformanceBlock,
  SignalType,
  YearlyPerformanceRow,
} from "../types.js";
import { parseYearlyAllTimeSummary } from "../parsers/performance.js";
import { categoryForSignal, signalForCategory } from "./signalMapping.js";

export interface SignalHistoricalStats {
  signalType: SignalType;
  category: string;
  wins: number;
  losses: number;
  winRate: number;
  sampleSize: number;
  allTimeReturn: number;
  recentReturn: number;
  blendedRoi: number;
  roiPercent: number;
  byLeague: Record<
    string,
    {
      wins: number;
      losses: number;
      winRate: number;
      allTimeReturn: number;
      recentReturn: number;
    }
  >;
}

export interface CrossSignalRule {
  signalA: SignalType;
  signalB: SignalType;
  sameSide: boolean;
  boost: number;
  label: string;
  sampleHint: number;
}

export interface ConfidenceStatsCache {
  computedAt: string;
  archiveDays: number;
  signals: Record<SignalType, SignalHistoricalStats>;
  crossSignalRules: CrossSignalRule[];
  ultraNegativeThreshold: number;
}

const MONTH_ORDER = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEPT", "OCT", "NOV", "DEC",
];

const RECENT_MONTHS = 6;
const RECENT_DECAY = 0.85;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function num(value: unknown): number {
  const n = parseFloat(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function isTotalLeague(league: string): boolean {
  return league.toLowerCase().startsWith("total");
}

/** Aggregate W/L from daily performance blocks (all columns summed) */
function aggregateDailyPerformance(
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
      const leagueKey = league.league.replace("NFL/CFB", "NFL");
      if (!agg.byLeague.has(leagueKey)) {
        agg.byLeague.set(leagueKey, { wins: 0, losses: 0, returnUnits: 0 });
      }
      const la = agg.byLeague.get(leagueKey)!;
      la.wins += league.wins;
      la.losses += league.losses;
      la.returnUnits += league.returnUnits;
    }
  }

  return map;
}

/** Recent ROI from last N months with exponential decay (yearly monthly data) */
function computeRecentReturn(rows: YearlyPerformanceRow[]): number {
  const totalRows = rows.filter((r) => isTotalLeague(r.league));
  if (totalRows.length === 0) return 0;

  const sorted = [...totalRows].sort((a, b) => b.year - a.year);
  let weighted = 0;
  let weightSum = 0;
  let monthsSeen = 0;

  for (const row of sorted) {
    const monthEntries = MONTH_ORDER.map((m) => ({ m, v: row.months[m] }))
      .filter((x) => x.v != null)
      .reverse();

    for (const { v } of monthEntries) {
      if (monthsSeen >= RECENT_MONTHS * 2) break;
      const w = Math.pow(RECENT_DECAY, monthsSeen);
      weighted += (v as number) * w;
      weightSum += w;
      monthsSeen += 1;
    }
    if (monthsSeen >= RECENT_MONTHS * 2) break;
  }

  return weightSum > 0 ? weighted / weightSum * RECENT_MONTHS : 0;
}

function allTimeFromYearly(rows: YearlyPerformanceRow[]): number {
  const totalRow = rows.find((r) => isTotalLeague(r.league) && r.allTime != null);
  if (totalRow?.allTime != null) return totalRow.allTime;

  const sumYearTotals = rows
    .filter((r) => isTotalLeague(r.league) && r.yearTotal != null)
    .reduce((s, r) => s + (r.yearTotal ?? 0), 0);
  return sumYearTotals;
}

function leagueStatsFromYearly(
  rows: YearlyPerformanceRow[]
): Record<string, { allTimeReturn: number; recentReturn: number }> {
  const byLeague: Record<string, { allTimeReturn: number; recentReturn: number }> = {};
  const leagueRows = rows.filter((r) => !isTotalLeague(r.league));

  for (const row of leagueRows) {
    const league = row.league.replace("NFL/CFB", "NFL");
    if (!byLeague[league]) {
      byLeague[league] = { allTimeReturn: 0, recentReturn: 0 };
    }
    if (row.allTime != null) {
      byLeague[league].allTimeReturn = row.allTime;
    } else if (row.yearTotal != null) {
      byLeague[league].allTimeReturn += row.yearTotal;
    }
  }

  for (const league of Object.keys(byLeague)) {
    const lr = leagueRows.filter((r) => r.league.replace("NFL/CFB", "NFL") === league);
    byLeague[league].recentReturn = computeRecentReturn(lr);
  }

  return byLeague;
}

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

/** Build cross-signal rules from historical signal profitability */
function buildCrossSignalRules(
  signals: Record<SignalType, SignalHistoricalStats>
): CrossSignalRule[] {
  const rules: CrossSignalRule[] = [];

  const positive = ALL_SIGNALS.filter((s) => signals[s].blendedRoi > 5);
  const negative = ALL_SIGNALS.filter((s) => signals[s].blendedRoi < -20);
  const fadeNegative = negative.filter((s) => s === "book_needs_fade" || s === "square_fade");

  for (let i = 0; i < positive.length; i++) {
    for (let j = i + 1; j < positive.length; j++) {
      const a = positive[i];
      const b = positive[j];
      const avgRoi = (signals[a].blendedRoi + signals[b].blendedRoi) / 2;
      rules.push({
        signalA: a,
        signalB: b,
        sameSide: true,
        boost: clamp(Math.round(avgRoi / 15), 6, 15),
        label: `${a}+${b} accord`,
        sampleHint: Math.min(signals[a].sampleSize, signals[b].sampleSize),
      });
    }
  }

  for (const pos of positive) {
    for (const neg of fadeNegative) {
      rules.push({
        signalA: pos,
        signalB: neg,
        sameSide: false,
        boost: -10,
        label: `${pos} vs fade ${neg} conflit`,
        sampleHint: signals[neg].sampleSize,
      });
      rules.push({
        signalA: pos,
        signalB: neg,
        sameSide: true,
        boost: clamp(Math.round(signals[pos].blendedRoi / 20), 4, 12),
        label: `${pos}+fade ${neg} confluence fade`,
        sampleHint: signals[neg].sampleSize,
      });
    }
  }

  if (fadeNegative.includes("square_fade") && fadeNegative.includes("book_needs_fade")) {
    rules.push({
      signalA: "square_fade",
      signalB: "book_needs_fade",
      sameSide: true,
      boost: -8,
      label: "Double fade public/book",
      sampleHint: Math.min(
        signals.square_fade.sampleSize,
        signals.book_needs_fade.sampleSize
      ),
    });
  }

  for (const neg of negative) {
    for (const pos of positive) {
      if (neg === pos) continue;
      rules.push({
        signalA: pos,
        signalB: neg,
        sameSide: true,
        boost: clamp(Math.round(signals[pos].blendedRoi / 12), 5, 14),
        label: `Sharp+ vs signal négatif ${neg}`,
        sampleHint: signals[pos].sampleSize,
      });
    }
  }

  return rules;
}

export function buildHistoricalStats(
  performanceYearly: YearlyPerformanceRow[],
  performanceDaily: DailyPerformanceBlock[],
  archiveDays: number,
  yearlyCsv?: string
): ConfidenceStatsCache {
  const allTimeSummary = yearlyCsv ? parseYearlyAllTimeSummary(yearlyCsv) : {};
  const dailyAgg = aggregateDailyPerformance(performanceDaily);
  const signals = {} as Record<SignalType, SignalHistoricalStats>;

  for (const signalType of ALL_SIGNALS) {
    const category = categoryForSignal(signalType);
    const yearlyRows = performanceYearly.filter((r) => r.category === category);
    const daily = dailyAgg.get(category) ?? dailyAgg.get(category.replace(" 🐳", ""));

    const wins = daily?.wins ?? 0;
    const losses = daily?.losses ?? 0;
    const sampleSize = wins + losses;
    const winRate = sampleSize > 0 ? wins / sampleSize : 0.5;

    const summaryKey = Object.keys(allTimeSummary).find(
      (k) => signalForCategory(k) === signalType || k === category
    );
    const allTimeReturn =
      (summaryKey ? allTimeSummary[summaryKey] : undefined) ??
      allTimeFromYearly(yearlyRows);
    const recentReturn = computeRecentReturn(yearlyRows);
    const blendedRoi = allTimeReturn * 0.4 + recentReturn * 0.6;

    const leagueYearly = leagueStatsFromYearly(yearlyRows);
    const byLeague: SignalHistoricalStats["byLeague"] = {};

    if (daily) {
      for (const [league, stats] of daily.byLeague) {
        const ly = leagueYearly[league];
        const ls = stats.wins + stats.losses;
        byLeague[league] = {
          wins: stats.wins,
          losses: stats.losses,
          winRate: ls > 0 ? stats.wins / ls : 0.5,
          allTimeReturn: ly?.allTimeReturn ?? stats.returnUnits,
          recentReturn: ly?.recentReturn ?? stats.returnUnits,
        };
      }
    }

    for (const [league, ly] of Object.entries(leagueYearly)) {
      if (!byLeague[league]) {
        byLeague[league] = {
          wins: 0,
          losses: 0,
          winRate: 0.5,
          allTimeReturn: ly.allTimeReturn,
          recentReturn: ly.recentReturn,
        };
      }
    }

    const roiPercent =
      sampleSize > 0
        ? (daily?.returnUnits ?? allTimeReturn) / sampleSize * 100
        : allTimeReturn / Math.max(archiveDays, 1);

    signals[signalType] = {
      signalType,
      category,
      wins,
      losses,
      winRate,
      sampleSize,
      allTimeReturn,
      recentReturn,
      blendedRoi,
      roiPercent,
      byLeague,
    };
  }

  const ultraNegativeThreshold = -50;

  return {
    computedAt: new Date().toISOString(),
    archiveDays,
    signals,
    crossSignalRules: buildCrossSignalRules(signals),
    ultraNegativeThreshold,
  };
}

/** Parse all-time summary row from yearly CSV header (row 2) */
export function parseAllTimeSummaryFromYearly(
  performanceYearly: YearlyPerformanceRow[]
): Record<SignalType, number> {
  const result = {} as Record<SignalType, number>;
  for (const row of performanceYearly) {
    if (!isTotalLeague(row.league)) continue;
    const signal = signalForCategory(row.category);
    if (signal && row.allTime != null) {
      result[signal] = row.allTime;
    }
  }
  return result;
}

export { signalForCategory };
