import { parse } from "csv-parse/sync";
import type { SignalType } from "../types.js";
import { signalForCategory } from "../services/signalMapping.js";

function num(value: unknown): number {
  const n = parseFloat(String(value ?? "").replace(/,/g, "").replace(/%/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function pct(value: unknown): number | null {
  const s = String(value ?? "").trim();
  if (!s || !s.includes("%")) return null;
  return num(s) / 100;
}

const KNOWN_CATEGORIES = [
  "Sharp Money",
  "Sportsbook",
  "Squares",
  "Model Best Plays",
  "Model Best Values",
  "Whale 🐳",
  "Whale",
  "MEGA SHARP",
  "Mega sharps",
  "RLM",
  "RLM MS",
  "MEGA RLM",
];

const LEAGUE_NAMES = ["NFL", "NHL", "CBB", "MLB", "NBA", "CFB", "WNBA"];

export interface DayStats {
  day: number;
  wins: number;
  losses: number;
  returnUnits: number;
}

export interface WeekStats {
  weekIndex: number;
  startDay: number;
  endDay: number;
  wins: number;
  losses: number;
  returnUnits: number;
  winRate: number;
}

export interface LeaguePeriodStats {
  league: string;
  daily: DayStats[];
  weeks: WeekStats[];
  mtd: {
    wins: number;
    losses: number;
    returnUnits: number;
    winRate: number;
    sampleSize: number;
  };
}

export interface MonthlyPerformanceBlock {
  periodKey: string;
  monthLabel?: string;
  categories: Record<
    string,
    {
      category: string;
      signalType: SignalType | null;
      leagues: LeaguePeriodStats[];
    }
  >;
}

export interface ParsedFullHistory {
  blocks: MonthlyPerformanceBlock[];
  aggregates: FullHistoryAggregate[];
}

export interface FullHistoryAggregate {
  signalType: SignalType;
  league: string;
  category: string;
  periodKey: string;
  daily: DayStats[];
  weeks: WeekStats[];
  mtd: LeaguePeriodStats["mtd"];
}

interface ColumnMap {
  days: { day: number; wCol: number; lCol: number; retCol: number }[];
  weeks: { weekIndex: number; startDay: number; endDay: number; wCol: number; lCol: number; retCol: number }[];
  mtd?: { wCol: number; lCol: number; retCol: number; wrCol?: number; sampleCol?: number };
}

function isCategoryLabel(label: string): boolean {
  const t = label.trim();
  if (!t) return false;
  return KNOWN_CATEGORIES.some(
    (c) => t === c || t.startsWith(c.replace(" 🐳", "")) || t.startsWith("MEGA SHARP")
  );
}

function isLeagueLabel(label: string): boolean {
  const t = label.trim();
  if (!t) return false;
  if (t.toLowerCase().startsWith("total")) return true;
  return LEAGUE_NAMES.some((l) => t === l || t.startsWith(l));
}

/** Scan sub-header row for consecutive W,L,Return triplets */
function findTriplets(subRow: string[]): { wCol: number; lCol: number; retCol: number }[] {
  const triplets: { wCol: number; lCol: number; retCol: number }[] = [];
  for (let i = 0; i < subRow.length - 2; i++) {
    const a = (subRow[i] || "").trim();
    const b = (subRow[i + 1] || "").trim();
    const c = (subRow[i + 2] || "").trim();
    if (a === "W" && b === "L" && c.toLowerCase().startsWith("return")) {
      triplets.push({ wCol: i, lCol: i + 1, retCol: i + 2 });
      i += 2;
    }
  }
  return triplets;
}

/** Build column map from W,L,Return triplets — 7 daily + 1 weekly repeating pattern */
function buildColumnMap(_dateRow: string[], subRow: string[]): ColumnMap {
  const triplets = findTriplets(subRow);
  const days: ColumnMap["days"] = [];
  const weeks: ColumnMap["weeks"] = [];

  let dayNum = 1;
  let i = 0;
  let weekDayBuffer: number[] = [];

  while (i < triplets.length) {
    // Collect up to 7 daily triplets
    weekDayBuffer = [];
    for (let d = 0; d < 7 && i < triplets.length; d++) {
      const t = triplets[i];
      days.push({ day: dayNum, wCol: t.wCol, lCol: t.lCol, retCol: t.retCol });
      weekDayBuffer.push(dayNum);
      dayNum += 1;
      i += 1;
    }

    if (i < triplets.length) {
      // Don't consume the final triplet — reserved for MTD
      if (i >= triplets.length - 1) break;

      const t = triplets[i];
      const remaining = triplets.length - i - 1; // exclude MTD triplet
      if (remaining <= 0) break;

      weeks.push({
        weekIndex: weeks.length + 1,
        startDay: weekDayBuffer[0] ?? 1,
        endDay: weekDayBuffer[weekDayBuffer.length - 1] ?? dayNum - 1,
        wCol: t.wCol,
        lCol: t.lCol,
        retCol: t.retCol,
      });
      i += 1;
    }
  }

  // MTD is always the final triplet; win% and sample follow in the row
  let mtd: ColumnMap["mtd"];
  if (triplets.length > 0) {
    const mt = triplets[triplets.length - 1];
    mtd = { wCol: mt.wCol, lCol: mt.lCol, retCol: mt.retCol };
    mtd.wrCol = mt.retCol + 2;
    mtd.sampleCol = mt.retCol + 3;
  }

  return { days, weeks, mtd };
}

function parseLeagueRow(row: string[], colMap: ColumnMap, league: string): LeaguePeriodStats {
  const daily: DayStats[] = colMap.days.map(({ day, wCol, lCol, retCol }) => ({
    day,
    wins: num(row[wCol]),
    losses: num(row[lCol]),
    returnUnits: num(row[retCol]),
  }));

  const weeks: WeekStats[] = colMap.weeks.map((w) => {
    const wins = num(row[w.wCol]);
    const losses = num(row[w.lCol]);
    const sample = wins + losses;
    return {
      weekIndex: w.weekIndex,
      startDay: w.startDay,
      endDay: w.endDay,
      wins,
      losses,
      returnUnits: num(row[w.retCol]),
      winRate: sample > 0 ? wins / sample : 0.5,
    };
  });

  let mtd = { wins: 0, losses: 0, returnUnits: 0, winRate: 0.5, sampleSize: 0 };
  if (colMap.mtd) {
    const { wCol, lCol, retCol, wrCol, sampleCol } = colMap.mtd;
    const wins = num(row[wCol]);
    const losses = num(row[lCol]);
    const sample = wins + losses;
    const wrFromCell = wrCol != null ? pct(row[wrCol]) : null;
    mtd = {
      wins,
      losses,
      returnUnits: num(row[retCol]),
      winRate: wrFromCell ?? (sample > 0 ? wins / sample : 0.5),
      sampleSize: sampleCol != null ? num(row[sampleCol]) : sample,
    };
  }

  return { league, daily, weeks, mtd };
}

function parseMonthBlock(
  rows: string[][],
  startIdx: number,
  periodKey: string
): { block: MonthlyPerformanceBlock; endIdx: number } {
  const dateRow = rows[startIdx] ?? [];
  const subRow = rows[startIdx + 1] ?? [];
  const colMap = buildColumnMap(dateRow, subRow);

  const categories: MonthlyPerformanceBlock["categories"] = {};
  let currentCategory = "";
  let i = startIdx + 2;

  while (i < rows.length) {
    const label = (rows[i][0] || "").trim();

    if (label === "Date" && i > startIdx + 2) break;

    if (isCategoryLabel(label)) {
      currentCategory = label;
      const signalType = signalForCategory(label.replace(/\s+$/, ""));
      categories[currentCategory] = {
        category: currentCategory,
        signalType,
        leagues: [],
      };
      i += 1;
      continue;
    }

    if (currentCategory && isLeagueLabel(label)) {
      const league = label.toLowerCase().startsWith("total") ? "Total" : label.trim();
      const stats = parseLeagueRow(rows[i], colMap, league);
      categories[currentCategory].leagues.push(stats);
      i += 1;
      continue;
    }

    if (!label && i > startIdx + 10) {
      const nextNonEmpty = rows.slice(i, i + 5).some((r) => (r[0] || "").trim());
      if (!nextNonEmpty && Object.keys(categories).length > 0) break;
    }

    i += 1;
  }

  return { block: { periodKey, categories }, endIdx: i };
}

export function parseFullHistoryCsv(csv: string, defaultPeriodKey?: string): ParsedFullHistory {
  const rows: string[][] = parse(csv, { relax_column_count: true, skip_empty_lines: false });
  const blocks: MonthlyPerformanceBlock[] = [];
  const aggregates: FullHistoryAggregate[] = [];

  let i = 0;
  let blockIndex = 0;
  while (i < rows.length) {
    const label = (rows[i][0] || "").trim();
    if (label !== "Date") {
      i += 1;
      continue;
    }

    const periodKey = defaultPeriodKey ?? `block-${blockIndex + 1}`;
    const { block, endIdx } = parseMonthBlock(rows, i, periodKey);
    if (Object.keys(block.categories).length > 0) {
      blocks.push(block);
      for (const cat of Object.values(block.categories)) {
        if (!cat.signalType) continue;
        for (const league of cat.leagues) {
          if (league.league === "Total") continue;
          aggregates.push({
            signalType: cat.signalType,
            league: league.league.replace("NFL/CFB", "NFL"),
            category: cat.category,
            periodKey,
            daily: league.daily,
            weeks: league.weeks,
            mtd: league.mtd,
          });
        }
      }
    }
    blockIndex += 1;
    i = endIdx > i ? endIdx : i + 1;
  }

  return { blocks, aggregates };
}

export function summarizeWeeklyTrend(weeks: WeekStats[]): "up" | "down" | "flat" {
  if (weeks.length < 2) return "flat";
  const recent = weeks.slice(-2);
  const older = weeks.slice(-4, -2);
  const recentRoi = recent.reduce((s, w) => s + w.returnUnits, 0);
  const olderRoi = older.length ? older.reduce((s, w) => s + w.returnUnits, 0) : 0;
  const delta = recentRoi - olderRoi;
  if (delta > 1) return "up";
  if (delta < -1) return "down";
  return "flat";
}

export function lastNWeeksStats(weeks: WeekStats[], n = 4): {
  wins: number;
  losses: number;
  returnUnits: number;
  winRate: number;
} {
  const slice = weeks.slice(-n);
  const wins = slice.reduce((s, w) => s + w.wins, 0);
  const losses = slice.reduce((s, w) => s + w.losses, 0);
  const sample = wins + losses;
  return {
    wins,
    losses,
    returnUnits: slice.reduce((s, w) => s + w.returnUnits, 0),
    winRate: sample > 0 ? wins / sample : 0.5,
  };
}
