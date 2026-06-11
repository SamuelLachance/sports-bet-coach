/**

 * Compare legacy static confidence vs dynamic engine on today's picks.

 * Run: npm run test:confidence

 */

import fs from "node:fs/promises";

import path from "node:path";

import { CACHE_DIR, RAW_DIR } from "../config.js";

import { parseDailyPicksCsv } from "../parsers/dailyPicks.js";

import { parseDailyPerformanceCsv, parseYearlyPerformanceCsv } from "../parsers/performance.js";

import { parseArchiveCsv } from "../parsers/archive.js";

import { parseFullHistoryCsv } from "../parsers/fullHistory.js";

import { buildHistoricalStats } from "../services/historicalStats.js";

import {

  buildFullHistoryStats,

  cacheFullHistoryStats,

  enrichConfidenceStats,

  loadFullHistoryStats,

} from "../services/fullHistoryStats.js";

import {

  buildDualFadeStats,

  cacheDualFadeStats,

  resolveDualFadeMatch,

} from "../services/dualFadeStats.js";

import {

  buildGameKey,

  computeConfidence,

  resolveGameConflicts,

} from "../services/confidenceEngine.js";

import { SIGNAL_LABELS } from "../services/signalMapping.js";

import type { ParsedSheets, SheetPick } from "../types.js";



async function loadSheets(): Promise<{

  sheets: ParsedSheets;

  yearlyCsv: string;

  performanceDailyCsv: string;

  performanceHistoryCsv: string;

}> {

  const cachePath = path.join(CACHE_DIR, "sheets.json");

  const yearlyCsv = await fs.readFile(path.join(RAW_DIR, "performance_yearly.csv"), "utf-8");

  const performanceDailyCsv = await fs.readFile(

    path.join(RAW_DIR, "performance_daily.csv"),

    "utf-8"

  );

  let performanceHistoryCsv = "";

  try {

    performanceHistoryCsv = await fs.readFile(

      path.join(RAW_DIR, "performance_history.csv"),

      "utf-8"

    );

  } catch {

    performanceHistoryCsv = "";

  }



  try {

    const raw = await fs.readFile(cachePath, "utf-8");

    return {

      sheets: JSON.parse(raw) as ParsedSheets,

      yearlyCsv,

      performanceDailyCsv,

      performanceHistoryCsv,

    };

  } catch {

    const daily = await fs.readFile(path.join(RAW_DIR, "daily_picks.csv"), "utf-8");

    const archive = await fs.readFile(path.join(RAW_DIR, "archive.csv"), "utf-8");

    const perfDaily = await fs.readFile(path.join(RAW_DIR, "performance_daily.csv"), "utf-8");



    const sheets: ParsedSheets = {

      syncedAt: new Date().toISOString(),

      dailyPicks: parseDailyPicksCsv(daily),

      archive: parseArchiveCsv(archive),

      performanceDaily: parseDailyPerformanceCsv(perfDaily).blocks,

      performanceYearly: parseYearlyPerformanceCsv(yearlyCsv),

    };

    return { sheets, yearlyCsv, performanceDailyCsv, performanceHistoryCsv };

  }

}



function mlbFadePicks(picks: SheetPick[]) {

  return picks.filter(

    (p) =>

      p.league === "MLB" &&

      (p.signalType === "book_needs_fade" || p.signalType === "square_fade")

  );

}



function printDualFadeResolution(

  label: string,

  book: SheetPick | undefined,

  square: SheetPick | undefined,

  dualStats: ReturnType<typeof buildDualFadeStats> extends (...args: infer _A) => infer R ? R : never

) {

  const res = resolveDualFadeMatch(book, square, dualStats, "MLB");

  if (!res) {

    console.log(`  ${label}: (pas de résolution dual-fade)`);

    return;

  }

  console.log(`  ${label}:`);

  console.log(`    → Jouer: ${res.recommendedSide} @ ${res.confidence}%`);

  console.log(`    ${res.reasoning}`);

}



async function main() {

  const { sheets, yearlyCsv, performanceDailyCsv, performanceHistoryCsv } = await loadSheets();



  const baseStats = buildHistoricalStats(

    sheets.performanceYearly,

    sheets.performanceDaily,

    sheets.archive.length,

    yearlyCsv

  );



  let fullHistory = await loadFullHistoryStats();

  if (!fullHistory && performanceHistoryCsv) {
    fullHistory = buildFullHistoryStats(
      performanceHistoryCsv,
      sheets.performanceYearly,
      sheets.performanceDaily,
      sheets.archive.length,
      undefined,
      yearlyCsv
    );
    await cacheFullHistoryStats(fullHistory);
  }



  const stats = fullHistory ? enrichConfidenceStats(baseStats, fullHistory) : baseStats;

  const dualStats = buildDualFadeStats(sheets, stats, performanceDailyCsv, fullHistory ?? undefined);

  await cacheDualFadeStats(dualStats);



  if (performanceHistoryCsv) {

    const parsed = parseFullHistoryCsv(performanceHistoryCsv);

    console.log("\n=== Performance tab (gid=1234539794) structure ===\n");

    console.log(`Month blocks: ${parsed.blocks.length}`);

    for (const block of parsed.blocks) {

      const cats = Object.keys(block.categories);

      console.log(`  Period ${block.periodKey}: ${cats.length} categories`);

      for (const cat of cats.slice(0, 4)) {

        const c = block.categories[cat];

        const total = c.leagues.find((l) => l.league === "Total");

        if (total) {

          console.log(

            `    ${cat}: MTD ${total.mtd.wins}W-${total.mtd.losses}L ${total.mtd.returnUnits.toFixed(1)}u (${Math.round(total.mtd.winRate * 100)}%) · ${total.weeks.length} weeks`

          );

        }

      }

    }

  }



  if (fullHistory) {

    console.log("\n=== Profitable patterns (top 8) ===\n");

    for (const c of fullHistory.profitableCombos.slice(0, 8)) {

      console.log(

        `  ${SIGNAL_LABELS[c.signalType].padEnd(22)} × ${c.league.padEnd(4)} ROI ${c.blendedRoi.toFixed(1).padStart(7)}u  WR ${Math.round(c.winRate * 100)}%  n=${c.sampleSize}`

      );

    }

    console.log("\n=== Toxic patterns (top 5) ===\n");

    for (const c of fullHistory.toxicCombos.slice(0, 5)) {

      console.log(

        `  ${SIGNAL_LABELS[c.signalType].padEnd(22)} × ${c.league.padEnd(4)} ROI ${c.blendedRoi.toFixed(1).padStart(7)}u`

      );

    }

    console.log("\n=== Fade-as-inverse signals ===\n");

    for (const s of Object.values(fullHistory.signals)) {

      if (s.profitableAsInverse) {

        console.log(`  ${SIGNAL_LABELS[s.signalType]}: all-time ${s.allTimeRoi.toFixed(0)}u → jouer l'inverse`);

      }

    }

  }



  console.log("\n=== Dual-fade stats (full historical dataset) ===\n");

  const hs = dualStats.historicalSample;
  console.log(
    `Sample AVANT (limité): ${dualStats.coOccurrence.dualActiveDays} jours co-actifs (onglet perf. quotidienne)`
  );
  console.log(
    `Sample APRÈS (complet): ${hs.weeks} semaines · ${hs.months} mois · ${hs.archiveDays} jours archives · ${hs.totalPicksTracked} picks · ${hs.totalDataPoints} points de données`
  );

  console.log(

    `Tracker ROI: Book Needs ${dualStats.tracker.bookNeedsAllTimeRoi.toFixed(1)}u · Square ${dualStats.tracker.squareAllTimeRoi.toFixed(1)}u`

  );

  if (fullHistory) {

    console.log(

      `Weekly 4sem: Book ${fullHistory.dualFadeWeekly.bookNeedsLast4Weeks.toFixed(1)}u (${fullHistory.dualFadeWeekly.bookNeedsWeeklyTrend}) · Square ${fullHistory.dualFadeWeekly.squareLast4Weeks.toFixed(1)}u (${fullHistory.dualFadeWeekly.squareWeeklyTrend})`

    );
    console.log(
      `Full history meta: ${fullHistory.historicalSample.weeksTracked} sem. · ${fullHistory.historicalSample.monthsTracked} mois · ${fullHistory.historicalSample.totalPicksTracked} picks · ${fullHistory.historicalSample.performancePeriods} périodes perf.`
    );

  }

  console.log(`Archive rule: ${dualStats.archiveTrend.resolutionRule}`);
  console.log(`Archive trend sampleSize: ${dualStats.archiveTrend.sampleSize} (was ~20 dual-active days)`);



  console.log("\n=== Signal historical ROI (all-time / blended) ===\n");

  for (const s of Object.values(stats.signals)) {

    console.log(

      `${SIGNAL_LABELS[s.signalType].padEnd(22)} all-time: ${s.allTimeReturn.toFixed(1).padStart(8)}u  blended: ${s.blendedRoi.toFixed(1).padStart(8)}u  W/L: ${s.wins}/${s.losses}`

    );

  }



  console.log(`\n=== Today's picks confidence (multi-layer model) ===\n`);

  const allPicks = sheets.dailyPicks;

  const beforeAfter: { pick: string; signal: string; league: string; confidence: number; conviction: boolean }[] = [];



  for (const pick of allPicks.slice(0, 20)) {

    const result = computeConfidence({

      pick,

      stats: baseStats,

      slatePicks: allPicks,

    });

    const enhanced = computeConfidence({

      pick,

      stats,

      slatePicks: allPicks,

      fullHistory: fullHistory ?? undefined,

    });

    beforeAfter.push({

      pick: pick.pick.slice(0, 30),

      signal: pick.signalType,

      league: pick.league,

      confidence: enhanced.confidence,

      conviction: !!enhanced.highConviction,

    });

    const delta = enhanced.confidence - result.confidence;

    const trend = enhanced.weeklyTrend ? ` ${enhanced.weeklyTrend === "up" ? "↑" : enhanced.weeklyTrend === "down" ? "↓" : "→"}` : "";

    console.log(

      `  ${pick.league.padEnd(4)} ${SIGNAL_LABELS[pick.signalType].padEnd(20)} ${pick.pick.slice(0, 25).padEnd(25)} ${result.confidence}% → ${enhanced.confidence}% (${delta >= 0 ? "+" : ""}${delta})${trend}${enhanced.highConviction ? " ★" : ""}`

    );

  }



  console.log(`\n=== June 9 MLB fade rows ===\n`);

  const mlb = mlbFadePicks(sheets.dailyPicks);



  const byRow = new Map<number, { book?: SheetPick; square?: SheetPick }>();

  for (const p of mlb) {

    if (!byRow.has(p.rawRow)) byRow.set(p.rawRow, {});

    const entry = byRow.get(p.rawRow)!;

    if (p.signalType === "book_needs_fade") entry.book = p;

    if (p.signalType === "square_fade") entry.square = p;

  }



  for (const [row, pair] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {

    const hasVs =

      pair.book?.opponent &&

      pair.square?.opponent &&

      resolveDualFadeMatch(pair.book, pair.square, dualStats, "MLB")?.isDualFade;

    const label = hasVs

      ? `Row ${row} (dual-fade VS): ${pair.book!.pick} vs ${pair.square!.pick}`

      : pair.book && pair.square

        ? `Row ${row} (same row, separate): ${pair.book.pick} · ${pair.square.pick}`

        : pair.book

          ? `Row ${row} (standalone Book): ${pair.book.pick}`

          : `Row ${row} (standalone Square): ${pair.square!.pick}`;

    printDualFadeResolution(label, pair.book, pair.square, dualStats);

  }



  console.log("\n=== Game conflict resolution (MLB dual-fade) ===\n");



  const rawRecs = mlb.map((pick) => {

    const result = computeConfidence({

      pick,

      stats,

      slatePicks: sheets.dailyPicks,

      fullHistory: fullHistory ?? undefined,

    });

    return {

      id: pick.id,

      league: pick.league,

      signalType: pick.signalType,

      signalLabel: SIGNAL_LABELS[pick.signalType],

      pick: pick.pick,

      opponent: pick.opponent,

      confidence: result.confidence,

      confidenceBreakdown: result.confidenceBreakdown,

      opponentPick: result.opponentPick,

      opponentConfidence: result.opponentConfidence,

      signalPolarity: result.signalPolarity,

      edgeLabel: result.edgeLabel,

      reasoning: "",

      status: "pending" as const,

      gameDate: "2026-06-09",

      gameKey: buildGameKey(pick, sheets.dailyPicks),

      historicalWinRate: result.historicalWinRate,

      historicalRoi: result.historicalRoi,

      weeklyTrend: result.weeklyTrend,

      highConviction: result.highConviction,

    };

  });



  const { gameRecommendations } = resolveGameConflicts(rawRecs, stats, {

    dualStats,

    slatePicks: sheets.dailyPicks,

  });



  for (const g of gameRecommendations) {

    console.log(`✓ ${g.awayTeam} @ ${g.homeTeam} → ${g.recommendedTeam} @ ${g.confidence}%`);

    if (g.dualFade?.isDualFade) {

      console.log(

        `  Dual-fade: Book fade ${g.dualFade.bookNeedsFadeTeam} + Square fade ${g.dualFade.squareFadeTeam}`

      );

    }

  }



  console.log(`\nCross-signal rules: ${stats.crossSignalRules.length}`);

  console.log(`Full history cache: ${path.join(CACHE_DIR, "full-history-stats.json")}`);

  console.log(`Dual-fade cache: ${path.join(CACHE_DIR, "dual-fade-stats.json")}\n`);

}



main().catch((err) => {

  console.error(err);

  process.exit(1);

});

