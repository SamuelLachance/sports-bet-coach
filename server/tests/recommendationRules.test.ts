/**
 * Unit tests for bet recommendation rules.
 * Run: npx tsx server/tests/recommendationRules.test.ts
 */
import assert from "node:assert/strict";
import {
  buildGameKey,
  computeConfidence,
  resolveGameConflicts,
} from "../services/confidenceEngine.js";
import { isOpposingDualFade, resolveDualFadeMatch } from "../services/dualFadeStats.js";
import { buildHistoricalStats } from "../services/historicalStats.js";
import type { CalendarGame, MatchedRecommendation, SheetPick } from "../types.js";

const GAME: CalendarGame = {
  id: "401815688",
  league: "MLB",
  homeTeam: "Chicago Cubs",
  awayTeam: "Colorado Rockies",
  homeAbbr: "CHC",
  awayAbbr: "COL",
  startTime: "2026-06-09T22:40:00Z",
  status: "Scheduled",
};

const bookPick: SheetPick = {
  id: "book-1",
  league: "MLB",
  signalType: "book_needs_fade",
  pick: "COLORADO",
  opponent: "CUBS",
  rawRow: 10,
  gameSlot: 1,
  signalCol: 4,
};

const squarePick: SheetPick = {
  id: "square-1",
  league: "MLB",
  signalType: "square_fade",
  pick: "CUBS",
  opponent: "COLORADO",
  rawRow: 10,
  gameSlot: 1,
  signalCol: 6,
};

const sharpPick: SheetPick = {
  id: "sharp-1",
  league: "MLB",
  signalType: "sharp_money",
  pick: "SEATTLE",
  opponent: "BALTIMORE",
  rawRow: 11,
  gameSlot: 2,
  signalCol: 2,
};

const stats = buildHistoricalStats([], [], 0, "");

function makeRec(pick: SheetPick, matchedGame?: CalendarGame): MatchedRecommendation {
  const result = computeConfidence({
    pick,
    matchedGame,
    stats,
    slatePicks: [bookPick, squarePick, sharpPick],
  });

  return {
    id: pick.id,
    league: pick.league,
    signalType: pick.signalType,
    signalLabel: pick.signalType,
    pick: pick.pick,
    opponent: pick.opponent,
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
    gameKey: buildGameKey(pick, [bookPick, squarePick, sharpPick], matchedGame),
  };
}

function main() {
  assert.ok(isOpposingDualFade(bookPick, squarePick), "book/square on opposite sides");

  const bookConf = computeConfidence({
    pick: bookPick,
    matchedGame: GAME,
    stats,
    slatePicks: [bookPick, squarePick],
  });
  assert.equal(bookConf.signalPolarity, "inverted");
  assert.ok(
    bookConf.opponentPick?.toUpperCase().includes("CUBS"),
    "Book Needs COLORADO → bet CUBS"
  );

  const squareConf = computeConfidence({
    pick: squarePick,
    matchedGame: GAME,
    stats,
    slatePicks: [bookPick, squarePick],
  });
  assert.equal(squareConf.signalPolarity, "inverted");
  assert.ok(
    squareConf.opponentPick?.toUpperCase().includes("COLORADO"),
    "Square Top CUBS → bet COLORADO"
  );

  const sharpConf = computeConfidence({
    pick: sharpPick,
    stats,
    slatePicks: [sharpPick],
  });
  assert.equal(sharpConf.signalPolarity, "positive");
  assert.ok(sharpConf.confidence >= 78, "Sharp Money gets high confidence");
  assert.ok(!sharpConf.opponentPick, "Sharp Money does not invert");

  const dualResolution = resolveDualFadeMatch(bookPick, squarePick, {
    computedAt: "",
    archiveDays: 0,
    historicalSample: {
      weeks: 0,
      months: 0,
      archiveDays: 0,
      recentDualActiveDays: 0,
      totalPicksTracked: 0,
      totalDataPoints: 0,
    },
    tracker: {
      bookNeedsAllTimeRoi: 0,
      squareAllTimeRoi: 0,
      bookNeedsBlendedRoi: 0,
      squareBlendedRoi: 0,
      roiGap: 0,
    },
    coOccurrence: {
      dualActiveDays: 0,
      dualPositiveDays: 0,
      dualNegativeDays: 0,
      combinedWinRate: 0.5,
      bookOutperformedSquareDays: 0,
      squareOutperformedBookDays: 0,
    },
    archiveTrend: {
      bookInverseWinRate: 0.5,
      squareInverseWinRate: 0.5,
      resolutionRule: "",
      sampleSize: 0,
    },
    byLeague: {},
  }, "MLB");

  assert.ok(dualResolution?.isNoBet, "Opposing dual-fade → no bet");
  assert.equal(dualResolution?.confidence, 0);

  const gameKey = buildGameKey(bookPick, [bookPick, squarePick], GAME);
  const { gameRecommendations } = resolveGameConflicts(
    [makeRec(bookPick, GAME), makeRec(squarePick, GAME)],
    stats,
    { slatePicks: [bookPick, squarePick] }
  );

  const card = gameRecommendations.find((g) => g.gameKey === gameKey);
  assert.ok(card, "Game card created");
  assert.ok(card!.noBet, "Opposing book/square game → no bet");
  assert.equal(card!.recommendedTeam, "");

  console.log("✓ All recommendation rule tests passed");
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
