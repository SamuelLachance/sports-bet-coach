/**
 * Unit tests for bet recommendation rules.
 * Run: npx tsx server/tests/recommendationRules.test.ts
 */
import assert from "node:assert/strict";
import {
  buildGameKey,
  collectFadeTargetsForGame,
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

const WHITE_SOX_GAME: CalendarGame = {
  id: "401815699",
  league: "MLB",
  homeTeam: "Chicago White Sox",
  awayTeam: "Atlanta Braves",
  homeAbbr: "CWS",
  awayAbbr: "ATL",
  startTime: "2026-06-11T18:10:00Z",
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

const whiteSoxBookPick: SheetPick = {
  id: "book-ws",
  league: "MLB",
  signalType: "book_needs_fade",
  pick: "WHITE SOX",
  opponent: "ATLANTA",
  rawRow: 20,
  gameSlot: 1,
  signalCol: 4,
};

const atlantaSquarePick: SheetPick = {
  id: "square-atl",
  league: "MLB",
  signalType: "square_fade",
  pick: "ATLANTA",
  opponent: "WHITE SOX",
  rawRow: 20,
  gameSlot: 1,
  signalCol: 6,
};

const bookOnlyPick: SheetPick = {
  id: "book-only",
  league: "MLB",
  signalType: "book_needs_fade",
  pick: "WHITE SOX",
  opponent: "ATLANTA",
  rawRow: 21,
  gameSlot: 1,
  signalCol: 4,
};

const squareOnlyPick: SheetPick = {
  id: "square-only",
  league: "MLB",
  signalType: "square_fade",
  pick: "ATLANTA",
  opponent: "WHITE SOX",
  rawRow: 22,
  gameSlot: 1,
  signalCol: 6,
};

const modelOnFadedTeam: SheetPick = {
  id: "model-ws",
  league: "MLB",
  signalType: "model_best_values",
  pick: "WHITE SOX",
  opponent: "ATLANTA",
  rawRow: 23,
  gameSlot: 1,
  signalCol: 8,
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

function makeRec(
  pick: SheetPick,
  matchedGame?: CalendarGame,
  slatePicks: SheetPick[] = [bookPick, squarePick, sharpPick]
): MatchedRecommendation {
  const result = computeConfidence({
    pick,
    matchedGame,
    stats,
    slatePicks,
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
    gameKey: buildGameKey(pick, slatePicks, matchedGame),
  };
}

const emptyDualStats = {
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
    bookNeedsAllTimeRoi: -120,
    squareAllTimeRoi: -95,
    bookNeedsBlendedRoi: -80,
    squareBlendedRoi: -70,
    roiGap: 25,
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
    bookInverseWinRate: 0.58,
    squareInverseWinRate: 0.55,
    resolutionRule: "",
    sampleSize: 100,
  },
  byLeague: {},
};

function assertNeverRecommendsFadeTarget(
  card: { recommendedTeam: string; noBet?: boolean },
  fadeTarget: string,
  label: string
) {
  if (card.noBet) return;
  assert.ok(
    !card.recommendedTeam.toUpperCase().includes(fadeTarget.toUpperCase()),
    `${label}: must not recommend fade target ${fadeTarget}, got ${card.recommendedTeam}`
  );
}

function main() {
  assert.ok(isOpposingDualFade(bookPick, squarePick), "book/square on opposite sides");
  assert.ok(
    isOpposingDualFade(whiteSoxBookPick, atlantaSquarePick),
    "White Sox book vs Atlanta square on opposite VS sides"
  );

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
  assert.ok(
    !bookConf.edgeLabel.toLowerCase().includes("profitable"),
    "Fade pick must not show profitable edge on listed team"
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

  const bookOnlyConf = computeConfidence({
    pick: bookOnlyPick,
    matchedGame: WHITE_SOX_GAME,
    stats,
    slatePicks: [bookOnlyPick],
  });
  assert.equal(bookOnlyConf.signalPolarity, "inverted");
  assert.ok(
    bookOnlyConf.opponentPick?.toUpperCase().includes("ATLANTA"),
    "Single book fade WHITE SOX → bet ATLANTA"
  );

  const squareOnlyConf = computeConfidence({
    pick: squareOnlyPick,
    matchedGame: WHITE_SOX_GAME,
    stats,
    slatePicks: [squareOnlyPick],
  });
  assert.equal(squareOnlyConf.signalPolarity, "inverted");
  assert.ok(
    squareOnlyConf.opponentPick?.toUpperCase().includes("WHITE SOX"),
    "Single square fade ATLANTA → bet WHITE SOX"
  );

  const sharpConf = computeConfidence({
    pick: sharpPick,
    stats,
    slatePicks: [sharpPick],
  });
  assert.equal(sharpConf.signalPolarity, "positive");
  assert.ok(sharpConf.confidence >= 78, "Sharp Money gets high confidence");
  assert.ok(!sharpConf.opponentPick, "Sharp Money does not invert");

  const dualResolution = resolveDualFadeMatch(
    bookPick,
    squarePick,
    emptyDualStats,
    "MLB"
  );
  assert.ok(dualResolution?.isNoBet, "Opposing dual-fade → no bet");
  assert.equal(dualResolution?.confidence, 0);

  const wsDualResolution = resolveDualFadeMatch(
    whiteSoxBookPick,
    atlantaSquarePick,
    emptyDualStats,
    "MLB"
  );
  assert.ok(wsDualResolution?.isNoBet, "White Sox book + Atlanta square → no bet");
  assert.equal(wsDualResolution?.confidence, 0);

  const gameKey = buildGameKey(bookPick, [bookPick, squarePick], GAME);
  const { gameRecommendations: cubsCards } = resolveGameConflicts(
    [makeRec(bookPick, GAME), makeRec(squarePick, GAME)],
    stats,
    { slatePicks: [bookPick, squarePick] }
  );
  const cubsCard = cubsCards.find((g) => g.gameKey === gameKey);
  assert.ok(cubsCard, "Game card created");
  assert.ok(cubsCard!.noBet, "Opposing book/square game → no bet");
  assert.equal(cubsCard!.recommendedTeam, "");

  const wsGameKey = buildGameKey(whiteSoxBookPick, [whiteSoxBookPick, atlantaSquarePick], WHITE_SOX_GAME);
  const { gameRecommendations: wsCards } = resolveGameConflicts(
    [makeRec(whiteSoxBookPick, WHITE_SOX_GAME, [whiteSoxBookPick, atlantaSquarePick]),
     makeRec(atlantaSquarePick, WHITE_SOX_GAME, [whiteSoxBookPick, atlantaSquarePick])],
    stats,
    { slatePicks: [whiteSoxBookPick, atlantaSquarePick], dualStats: emptyDualStats }
  );
  const wsCard = wsCards.find((g) => g.gameKey === wsGameKey);
  assert.ok(wsCard?.noBet, "White Sox vs Atlanta opposing fades → no bet");

  const { gameRecommendations: bookOnlyCards } = resolveGameConflicts(
    [makeRec(bookOnlyPick, WHITE_SOX_GAME, [bookOnlyPick])],
    stats,
    { slatePicks: [bookOnlyPick], dualStats: emptyDualStats }
  );
  const bookOnlyCard = bookOnlyCards.find((g) => g.matchedGame?.id === WHITE_SOX_GAME.id);
  assert.ok(bookOnlyCard, "Single book fade produces consolidated game card");
  assertNeverRecommendsFadeTarget(bookOnlyCard!, "WHITE SOX", "Single book fade game");
  assert.ok(
    bookOnlyCard!.recommendedTeam.toUpperCase().includes("ATLANTA"),
    "Single book fade should recommend ATLANTA"
  );

  const { gameRecommendations: modelVsFadeCards } = resolveGameConflicts(
    [
      makeRec(bookOnlyPick, WHITE_SOX_GAME, [bookOnlyPick, modelOnFadedTeam]),
      makeRec(modelOnFadedTeam, WHITE_SOX_GAME, [bookOnlyPick, modelOnFadedTeam]),
    ],
    stats,
    { slatePicks: [bookOnlyPick, modelOnFadedTeam], dualStats: emptyDualStats }
  );
  const modelVsFadeCard = modelVsFadeCards.find((g) => g.matchedGame?.id === WHITE_SOX_GAME.id);
  assert.ok(modelVsFadeCard, "Book + model on same game produces consolidated card");
  assertNeverRecommendsFadeTarget(
    modelVsFadeCard!,
    "WHITE SOX",
    "Model vs book fade on same game"
  );
  assert.ok(
    modelVsFadeCard!.recommendedTeam.toUpperCase().includes("ATLANTA"),
    "Book fade must beat model picking faded team"
  );

  const fadeTargets = collectFadeTargetsForGame(
    [makeRec(bookOnlyPick, WHITE_SOX_GAME, [bookOnlyPick])],
    [bookOnlyPick],
    WHITE_SOX_GAME
  );
  assert.ok(fadeTargets.has("WHITE SOX"), "Book listed team tracked as fade target");

  console.log("✓ All recommendation rule tests passed");
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
