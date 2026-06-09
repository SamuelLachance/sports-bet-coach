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

export function parseYearlyPerformanceCsv(csv: string): YearlyPerformanceRow[] {
  const rows: string[][] = parse(csv, { relax_column_count: true, skip_empty_lines: false });
  const results: YearlyPerformanceRow[] = [];
  let currentYear = 0;
  let currentCategory = "";

  for (const row of rows) {
    const col0 = (row[0] || "").trim();
    const col1 = (row[1] || "").trim();

    const yearMatch = col0.match(/^(\d{4})$/);
    if (yearMatch) {
      currentYear = parseInt(yearMatch[1], 10);
      continue;
    }

    const categories = [
      "Sharp Money",
      "Sportsbook",
      "Squares",
      "Model Best Values",
      "Whale 🐳",
      "Whale",
      "Mega sharps",
      "RLM",
      "RLM MS",
      "Total",
    ];

    if (categories.includes(col0)) {
      currentCategory = col0;
      continue;
    }

    if (!currentYear || !currentCategory) continue;

    const league = col0;
    if (!league || league === "AVERAGE" || league === "ALL TIME") continue;

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
    const allTime = row[16] ? num(row[16]) : null;

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
