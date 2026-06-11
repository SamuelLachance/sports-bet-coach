/**
 * Regression tests: picks must only associate with their ESPN matchup.
 * Run: npm run test:game-association
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { parseDailyPicksCsv } from "../parsers/dailyPicks.js";
import { validateRecommendedTeam, pickBelongsToGame } from "../services/calendar.js";
import {
  buildGameKey,
  computePickRules,
  resolveGameConflicts,
} from "../services/betRulesEngine.js";
import { findDualFadePair } from "../services/dualFadeStats.js";
import { buildHistoricalStats } from "../services/historicalStats.js";
import { buildDualFadeStats } from "../services/dualFadeStats.js";
import { parseArchiveCsv } from "../parsers/archive.js";
import { parseDailyPerformanceCsv } from "../parsers/performance.js";
import { parseYearlyPerformanceCsv } from "../parsers/performance.js";
import type { CalendarGame, MatchedRecommendation, SheetPick } from "../types.js";

const RAW_DIR = path.join(process.cwd(), "data", "raw");

const MARINERS_ORIOLES: CalendarGame = {
  id: "401815687",
  league: "MLB",
  homeTeam: "Baltimore Orioles",
  awayTeam: "Seattle Mariners",
  homeAbbr: "BAL",
  awayAbbr: "SEA",
  startTime: "2026-06-09T22:35:00Z",
  status: "Scheduled",
};

const CUBS_ROCKIES: CalendarGame = {
  id: "401815688",
  league: "MLB",
  homeTeam: "Chicago Cubs",
  awayTeam: "Colorado Rockies",
  homeAbbr: "CHC",
  awayAbbr: "COL",
  startTime: "2026-06-09T22:40:00Z",
  status: "Scheduled",
};

function assertRecommendedInGame(
  game: CalendarGame,
  recommendedTeam: string,
  label: string
) {
  assert.ok(
    validateRecommendedTeam(recommendedTeam, game),
    `${label}: recommended "${recommendedTeam}" not in ${game.awayTeam} @ ${game.homeTeam}`
  );
}

async function loadPicks(): Promise<SheetPick[]> {
  const csv = await fs.readFile(path.join(RAW_DIR, "daily_picks.csv"), "utf-8");
  return parseDailyPicksCsv(csv);
}

async function main() {
  const picks = await loadPicks();

  const colorado = picks.find(
    (p) => p.signalType === "book_needs_fade" && p.pick.toUpperCase().includes("COLORADO")
  );
  const cubsSquare = picks.find(
    (p) => p.signalType === "square_fade" && p.pick.toUpperCase().includes("CUBS")
  );
  const seattle = picks.find(
    (p) => p.signalType === "sharp_money" && p.pick.toUpperCase().includes("SEATTLE")
  );
  const baltimoreRlm = picks.find(
    (p) => p.signalType === "reverse_line_movement" && p.pick.toUpperCase().includes("BALTIMORE")
  );

  assert.ok(colorado, "COLORADO book_needs pick exists");
  assert.ok(cubsSquare, "CUBS square_fade pick exists");
  assert.ok(seattle, "SEATTLE sharp pick exists");
  assert.ok(baltimoreRlm, "BALTIMORE RLM pick exists");

  assert.equal(colorado!.gameSlot, cubsSquare!.gameSlot, "COLORADO/CUBS share VS slot");
  assert.notEqual(
    colorado!.gameSlot,
    seattle!.gameSlot,
    "COLORADO/CUBS slot must differ from SEATTLE orphan slot"
  );

  assert.ok(
    pickBelongsToGame(colorado!.pick, colorado!.opponent, CUBS_ROCKIES),
    "COLORADO belongs to Cubs @ Rockies"
  );
  assert.ok(
    !pickBelongsToGame(colorado!.pick, colorado!.opponent, MARINERS_ORIOLES),
    "COLORADO must NOT belong to Mariners @ Orioles"
  );
  assert.ok(
    pickBelongsToGame(seattle!.pick, seattle!.opponent, MARINERS_ORIOLES),
    "SEATTLE belongs to Mariners @ Orioles"
  );

  const marinersPair = findDualFadePair(picks, "MLB", {
    homeTeam: MARINERS_ORIOLES.homeTeam,
    awayTeam: MARINERS_ORIOLES.awayTeam,
  });
  assert.ok(
    !marinersPair.book?.pick.toUpperCase().includes("COLORADO"),
    "Mariners dual-fade must not use COLORADO book pick"
  );
  assert.ok(
    !marinersPair.square?.pick.toUpperCase().includes("CUBS"),
    "Mariners dual-fade must not use CUBS square pick"
  );

  const cubsPair = findDualFadePair(picks, "MLB", {
    homeTeam: CUBS_ROCKIES.homeTeam,
    awayTeam: CUBS_ROCKIES.awayTeam,
  });
  assert.ok(
    cubsPair.book?.pick.toUpperCase().includes("COLORADO"),
    "Cubs @ Rockies dual-fade uses COLORADO book pick"
  );
  assert.ok(
    cubsPair.square?.pick.toUpperCase().includes("CUBS"),
    "Cubs @ Rockies dual-fade uses CUBS square pick"
  );

  assert.notEqual(
    buildGameKey(colorado!, picks, CUBS_ROCKIES),
    buildGameKey(seattle!, picks, MARINERS_ORIOLES),
    "Different ESPN games must have different gameKeys"
  );

  const yearlyCsv = await fs.readFile(path.join(RAW_DIR, "performance_yearly.csv"), "utf-8");
  const perfDailyCsv = await fs.readFile(path.join(RAW_DIR, "performance_daily.csv"), "utf-8");
  const archiveCsv = await fs.readFile(path.join(RAW_DIR, "archive.csv"), "utf-8");

  const stats = buildHistoricalStats(
    parseYearlyPerformanceCsv(yearlyCsv),
    parseDailyPerformanceCsv(perfDailyCsv).blocks,
    parseArchiveCsv(archiveCsv).length,
    yearlyCsv
  );
  const dualStats = buildDualFadeStats(
    { syncedAt: "", dailyPicks: picks, archive: [], performanceDaily: [], performanceYearly: [] },
    stats,
    perfDailyCsv
  );

  const mlbPicks = picks.filter((p) => p.league === "MLB");
  const rawRecs: MatchedRecommendation[] = mlbPicks.map((pick) => {
    const matchedGame =
      pickBelongsToGame(pick.pick, pick.opponent, MARINERS_ORIOLES)
        ? MARINERS_ORIOLES
        : pickBelongsToGame(pick.pick, pick.opponent, CUBS_ROCKIES)
          ? CUBS_ROCKIES
          : undefined;

    const result = computePickRules({
      pick,
      matchedGame,
      slatePicks: picks,
    });

    return {
      id: pick.id,
      league: pick.league,
      signalType: pick.signalType,
      signalLabel: pick.signalType,
      pick: pick.pick,
      opponent: pick.opponent,
      line: pick.line,
      confidence: result.confidence,
      confidenceBreakdown: result.confidenceBreakdown,
      opponentPick: result.opponentPick,
      opponentConfidence: result.opponentConfidence,
      signalPolarity: result.signalPolarity,
      edgeLabel: result.edgeLabel,
      reasoning: "",
      status: "recommended",
      matchedGame,
      gameDate: "2026-06-09",
      gameKey: buildGameKey(pick, picks, matchedGame),
    };
  });

  const { gameRecommendations } = resolveGameConflicts(rawRecs, stats, {
    dualStats,
    slatePicks: picks,
  });

  const marinersCard = gameRecommendations.find(
    (g) => g.matchedGame?.id === MARINERS_ORIOLES.id
  );
  const cubsCard = gameRecommendations.find((g) => g.matchedGame?.id === CUBS_ROCKIES.id);

  if (marinersCard) {
    assertRecommendedInGame(
      MARINERS_ORIOLES,
      marinersCard.recommendedTeam,
      "Mariners @ Orioles card"
    );
    assert.ok(
      !marinersCard.recommendedTeam.toUpperCase().includes("CUBS"),
      "Mariners card must never recommend CUBS"
    );
    assert.ok(
      !marinersCard.recommendedTeam.toUpperCase().includes("COLORADO"),
      "Mariners card must never recommend COLORADO"
    );
    if (marinersCard.dualFade?.isDualFade && marinersCard.dualFade.bookNeedsFadeTeam) {
      assert.ok(
        !marinersCard.dualFade.bookNeedsFadeTeam.toUpperCase().includes("COLORADO"),
        "Mariners dual-fade book team must not be COLORADO"
      );
    }
  }

  if (cubsCard) {
    assert.ok(cubsCard.noBet, "Cubs @ Rockies opposing dual-fade should be no bet");
    assert.ok(
      cubsCard.dualFade?.isOpposingNoBet,
      "Cubs @ Rockies should flag opposing dual-fade no bet"
    );
    assert.equal(cubsCard.recommendedTeam, "", "No bet card has empty recommendedTeam");
    assert.equal(cubsCard.confidence, 0, "No bet card has zero confidence");
  }

  for (const card of gameRecommendations) {
    if (!card.matchedGame || card.noBet) continue;
    assertRecommendedInGame(
      card.matchedGame,
      card.recommendedTeam,
      `Game card ${card.awayTeam} @ ${card.homeTeam}`
    );
  }

  console.log("✓ All game association regression tests passed");
  console.log(`  Audited ${gameRecommendations.length} game recommendation cards`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
