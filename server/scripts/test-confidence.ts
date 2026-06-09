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
import { buildHistoricalStats } from "../services/historicalStats.js";
import {
  computeConfidence,
  LEGACY_SIGNAL_CONFIDENCE,
} from "../services/confidenceEngine.js";
import { SIGNAL_LABELS_FR } from "../services/signalMapping.js";
import type { ParsedSheets } from "../types.js";

async function loadSheets(): Promise<{ sheets: ParsedSheets; yearlyCsv: string }> {
  const cachePath = path.join(CACHE_DIR, "sheets.json");
  try {
    const raw = await fs.readFile(cachePath, "utf-8");
    const yearlyCsv = await fs.readFile(path.join(RAW_DIR, "performance_yearly.csv"), "utf-8");
    return { sheets: JSON.parse(raw) as ParsedSheets, yearlyCsv };
  } catch {
    const daily = await fs.readFile(path.join(RAW_DIR, "daily_picks.csv"), "utf-8");
    const archive = await fs.readFile(path.join(RAW_DIR, "archive.csv"), "utf-8");
    const perfDaily = await fs.readFile(path.join(RAW_DIR, "performance_daily.csv"), "utf-8");
    const yearlyCsv = await fs.readFile(path.join(RAW_DIR, "performance_yearly.csv"), "utf-8");

    const sheets: ParsedSheets = {
      syncedAt: new Date().toISOString(),
      dailyPicks: parseDailyPicksCsv(daily),
      archive: parseArchiveCsv(archive),
      performanceDaily: parseDailyPerformanceCsv(perfDaily).blocks,
      performanceYearly: parseYearlyPerformanceCsv(yearlyCsv),
    };
    return { sheets, yearlyCsv };
  }
}

async function main() {
  const { sheets, yearlyCsv } = await loadSheets();
  const stats = buildHistoricalStats(
    sheets.performanceYearly,
    sheets.performanceDaily,
    sheets.archive.length,
    yearlyCsv
  );

  console.log("\n=== Signal historical ROI (all-time / blended) ===\n");
  for (const [signal, s] of Object.entries(stats.signals)) {
    console.log(
      `${SIGNAL_LABELS_FR[s.signalType].padEnd(22)} all-time: ${s.allTimeReturn.toFixed(1).padStart(8)}u  blended: ${s.blendedRoi.toFixed(1).padStart(8)}u  W/L: ${s.wins}/${s.losses}`
    );
  }

  console.log(`\n=== Today's picks: legacy vs dynamic (${sheets.dailyPicks.length} picks) ===\n`);
  console.log(
    "Pick".padEnd(28) +
      "Signal".padEnd(20) +
      "Legacy".padEnd(8) +
      "New".padEnd(8) +
      "Δ".padEnd(6) +
      "Polarity"
  );
  console.log("-".repeat(90));

  for (const pick of sheets.dailyPicks) {
    const result = computeConfidence({
      pick,
      stats,
      slatePicks: sheets.dailyPicks,
    });
    const legacy = LEGACY_SIGNAL_CONFIDENCE[pick.signalType];
    const delta = result.confidence - legacy;
    const pickLabel = pick.pick.slice(0, 26);
    console.log(
      pickLabel.padEnd(28) +
        SIGNAL_LABELS_FR[pick.signalType].slice(0, 18).padEnd(20) +
        `${legacy}%`.padEnd(8) +
        `${result.confidence}%`.padEnd(8) +
        `${delta >= 0 ? "+" : ""}${delta}`.padEnd(6) +
        result.signalPolarity +
        (result.opponentPick ? ` → ${result.opponentPick}` : "")
    );
  }

  console.log("\n=== Sample breakdown (first inverted fade if any) ===\n");
  const inverted = sheets.dailyPicks.find((p) => {
    const r = computeConfidence({ pick: p, stats, slatePicks: sheets.dailyPicks });
    return r.signalPolarity === "inverted";
  });

  if (inverted) {
    const r = computeConfidence({ pick: inverted, stats, slatePicks: sheets.dailyPicks });
    console.log(`Pick: ${inverted.pick} (${SIGNAL_LABELS_FR[inverted.signalType]})`);
    console.log(`Confidence: ${r.confidence}% | Opponent: ${r.opponentPick ?? "N/A"}`);
    for (const b of r.confidenceBreakdown) {
      console.log(`  ${b.label}: impact ${b.impact}${b.detail ? ` (${b.detail})` : ""}`);
    }
  } else {
    const sample = sheets.dailyPicks[0];
    const r = computeConfidence({ pick: sample, stats, slatePicks: sheets.dailyPicks });
    console.log(`Pick: ${sample.pick}`);
    for (const b of r.confidenceBreakdown) {
      console.log(`  ${b.label}: impact ${b.impact}`);
    }
  }

  console.log(`\nCross-signal rules loaded: ${stats.crossSignalRules.length}`);
  console.log(`Archive days: ${stats.archiveDays}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
