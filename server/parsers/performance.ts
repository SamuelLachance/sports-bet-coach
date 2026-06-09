import { parse } from "csv-parse/sync";
import type { DailyPerformanceBlock, LeaguePerformance, YearlyPerformanceRow } from "../types.js";

function num(value: unknown): number {
  const n = parseFloat(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseLeagueRow(row: string[], leagueName: string): LeaguePerformance {
  const wins = num(row[1]);
  const losses = num(row[2]);
  const returnUnits = num(row[3]);
  return { league: leagueName, wins, losses, returnUnits };
}

export function parseDailyPerformanceCsv(csv: string): {
  blocks: DailyPerformanceBlock[];
  mtd?: { wins: number; losses: number; returnUnits: number };
} {
  const rows: string[][] = parse(csv, { relax_column_count: true, skip_empty_lines: false });
  const blocks: DailyPerformanceBlock[] = [];
  let currentCategory = "";
  let currentLeagues: LeaguePerformance[] = [];

  const flush = () => {
    if (!currentCategory) return;
    const totalRow = currentLeagues.find((l) => l.league.toLowerCase().startsWith("total"));
    blocks.push({
      category: currentCategory,
      leagues: currentLeagues.filter((l) => !l.league.toLowerCase().startsWith("total")),
      total: totalRow || { league: "Total", wins: 0, losses: 0, returnUnits: 0 },
    });
    currentLeagues = [];
  };

  let mtd: { wins: number; losses: number; returnUnits: number } | undefined;

  for (const row of rows) {
    const label = (row[0] || "").trim();
    if (!label) continue;

    if (label === "MTD" || (row[73] === "MTD" && row[74])) {
      mtd = { wins: num(row[74]), losses: num(row[75]), returnUnits: num(row[76]) };
      continue;
    }

    const knownCategories = [
      "Sharp Money",
      "Sportsbook",
      "Squares",
      "Model Best Plays",
      "Whale 🐳",
      "Whale",
    ];

    if (knownCategories.some((c) => label.startsWith(c.replace(" 🐳", "")))) {
      flush();
      currentCategory = label;
      continue;
    }

    if (!currentCategory) continue;

    const leagueNames = ["NBA", "NHL", "CBB", "NFL/CFB", "Total", "Total "];
    if (leagueNames.some((l) => label === l || label.startsWith("Total"))) {
      currentLeagues.push(parseLeagueRow(row, label.trim()));
    }
  }

  flush();
  return { blocks, mtd };
}

const MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEPT", "OCT", "NOV", "DEC",
];

const YEARLY_CATEGORIES = [
  "Sharp Money",
  "Sportsbook",
  "Squares",
  "Model Best Values",
  "Whale 🐳",
  "Whale",
  "Mega sharps",
  "RLM",
  "RLM MS",
  "MEGA RLM",
  "Total",
];

function readAllTimeCell(row: string[]): number | null {
  const col16 = (row[16] || "").trim();
  const col17 = row[17] != null && row[17] !== "" ? num(row[17]) : null;
  if (YEARLY_CATEGORIES.includes(col16) && col17 != null) return col17;
  if (row[16] != null && row[16] !== "" && !YEARLY_CATEGORIES.includes(col16)) {
    const v = num(row[16]);
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

/** All-time totals from header block (row 2+) before year sections */
export function parseYearlyAllTimeSummary(csv: string): Record<string, number> {
  const rows: string[][] = parse(csv, { relax_column_count: true, skip_empty_lines: false });
  const summary: Record<string, number> = {};

  for (const row of rows) {
    const col16 = (row[16] || "").trim();
    const col17 = row[17] != null && row[17] !== "" ? num(row[17]) : null;
    if (YEARLY_CATEGORIES.includes(col16) && col17 != null) {
      summary[col16] = col17;
    }
  }

  return summary;
}

export function parseYearlyPerformanceCsv(csv: string): YearlyPerformanceRow[] {
  const rows: string[][] = parse(csv, { relax_column_count: true, skip_empty_lines: false });
  const results: YearlyPerformanceRow[] = [];
  let currentYear = 0;
  let currentCategory = "";
  let categoryAllTime: number | null = null;

  for (const row of rows) {
    const col0 = (row[0] || "").trim();

    const yearMatch = col0.match(/^(\d{4})$/);
    if (yearMatch) {
      currentYear = parseInt(yearMatch[1], 10);
      categoryAllTime = null;
      continue;
    }

    const hasMonthData = MONTHS.some((_, idx) => {
      const val = row[idx + 1];
      return val !== undefined && String(val).trim() !== "";
    });

    if (YEARLY_CATEGORIES.includes(col0) && !hasMonthData) {
      currentCategory = col0;
      categoryAllTime = null;
      continue;
    }

    if (!currentYear || !currentCategory || currentCategory === "Total") continue;

    const league = col0;
    if (!league || league === "AVERAGE" || league === "ALL TIME") continue;

    const inlineAllTime = readAllTimeCell(row);
    if (inlineAllTime != null && categoryAllTime == null) {
      categoryAllTime = inlineAllTime;
    }

    const months: Record<string, number | null> = {};
    MONTHS.forEach((m, idx) => {
      const val = row[idx + 1];
      if (val === undefined || val === "") {
        months[m] = null;
      } else {
        months[m] = num(val);
      }
    });

    const yearTotal = row[14] ? num(row[14]) : null;
    const allTime =
      league.toLowerCase().startsWith("total") && categoryAllTime != null
        ? categoryAllTime
        : null;

    results.push({
      year: currentYear,
      category: currentCategory,
      league,
      months,
      yearTotal,
      allTime,
    });
  }

  return results;
}
