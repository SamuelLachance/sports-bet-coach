/**
 * Unit tests for bet recommendation rules.
 * Run: npx tsx server/tests/recommendationRules.test.ts
 */
import assert from "node:assert/strict";
import {
  buildGameKey,
  collectFadeTargetsForGame,
  computePickRules,
  resolveGameConflicts,
  resolveImpliedBets,
  RULE_CONFIDENCE,
  type ImpliedBetEntry,
} from "../services/betRulesEngine.js";
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
  homeTeam: "Atlanta Braves",
  awayTeam: "Chicago White Sox",
  homeAbbr: "ATL",
  awayAbbr: "CWS",
  startTime: "2026-06-11T18:10:00Z",
  status: "Scheduled",
};

const DODGERS_PIRATES_GAME: CalendarGame = {
  id: "401815700",
  league: "MLB",
  homeTeam: "Pittsburgh Pirates",
  awayTeam: "Los Angeles Dodgers",
  homeAbbr: "PIT",
  awayAbbr: "LAD",
  startTime: "2026-06-11T18:40:00Z",
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

/** Same VS matchup but book/square parsed on different sheet rows (production layout). */
const whiteSoxBookSplitRow: SheetPick = {
  ...whiteSoxBookPick,
  id: "book-ws-split",
  rawRow: 31,
};

const atlantaSquareSplitRow: SheetPick = {
  ...atlantaSquarePick,
  id: "square-atl-split",
  rawRow: 32,
};

/** Production VS layout: odds embedded in pick, opponents not yet linked on sheet pick. */
const whiteSoxBookOddsOnly: SheetPick = {
  id: "book-ws-odds",
  league: "MLB",
  signalType: "book_needs_fade",
  pick: "WHITE SOX -101",
  rawRow: 31,
  gameSlot: 1,
  signalCol: 4,
};

const atlantaSquareOddsOnly: SheetPick = {
  id: "square-atl-odds",
  league: "MLB",
  signalType: "square_fade",
  pick: "ATLANTA -120",
  rawRow: 32,
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

const rlmPick: SheetPick = {
  id: "rlm-ws",
  league: "MLB",
  signalType: "reverse_line_movement",
  pick: "WHITE SOX",
  opponent: "ATLANTA",
  rawRow: 24,
  gameSlot: 1,
  signalCol: 8,
};

const whalePick: SheetPick = {
  id: "whale-ws",
  league: "MLB",
  signalType: "whale_plays",
  pick: "WHITE SOX",
  opponent: "ATLANTA",
  rawRow: 26,
  gameSlot: 1,
  signalCol: 4,
};

const rlmAtlantaPick: SheetPick = {
  id: "rlm-atl",
  league: "MLB",
  signalType: "reverse_line_movement",
  pick: "ATLANTA",
  opponent: "WHITE SOX",
  rawRow: 27,
  gameSlot: 1,
  signalCol: 8,
};

const pittsburghBookPick: SheetPick = {
  id: "book-pit",
  league: "MLB",
  signalType: "book_needs_fade",
  pick: "PITTSBURGH +140",
  opponent: "LA DODGERS",
  rawRow: 40,
  gameSlot: 1,
  signalCol: 4,
};

const dodgersSquarePick: SheetPick = {
  id: "square-lad",
  league: "MLB",
  signalType: "square_fade",
  pick: "LA DODGERS",
  opponent: "PITTSBURGH",
  rawRow: 40,
  gameSlot: 1,
  signalCol: 6,
};

const pittsburghBookOnlyPick: SheetPick = {
  id: "book-pit-only",
  league: "MLB",
  signalType: "book_needs_fade",
  pick: "PITTSBURGH +140",
  opponent: "LA DODGERS",
  rawRow: 41,
  gameSlot: 1,
  signalCol: 4,
};

const modelOnPirates: SheetPick = {
  id: "model-pit",
  league: "MLB",
  signalType: "model_best_values",
  pick: "PITTSBURGH +140",
  opponent: "LA DODGERS",
  rawRow: 42,
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

const sameSideBookPick: SheetPick = {
  id: "book-same",
  league: "MLB",
  signalType: "book_needs_fade",
  pick: "WHITE SOX",
  opponent: "ATLANTA",
  rawRow: 25,
  gameSlot: 1,
  signalCol: 4,
};

const sameSideSquarePick: SheetPick = {
  id: "square-same",
  league: "MLB",
  signalType: "square_fade",
  pick: "WHITE SOX",
  opponent: "ATLANTA",
  rawRow: 25,
  gameSlot: 1,
  signalCol: 6,
};

const VEGAS_CAROLINA_GAME: CalendarGame = {
  id: "401567890",
  league: "NHL",
  homeTeam: "Carolina Hurricanes",
  awayTeam: "Vegas Golden Knights",
  homeAbbr: "CAR",
  awayAbbr: "VGK",
  startTime: "2026-06-11T23:00:00Z",
  status: "Scheduled",
};

const sharpCarolinaPick: SheetPick = {
  id: "sharp-car",
  league: "NHL",
  signalType: "sharp_money",
  pick: "CAROLINA -145",
  opponent: "VEGAS",
  rawRow: 50,
  gameSlot: 1,
  signalCol: 2,
};

const squareCarolinaPick: SheetPick = {
  id: "square-car",
  league: "NHL",
  signalType: "square_fade",
  pick: "CAROLINA -155",
  opponent: "VEGAS",
  rawRow: 50,
  gameSlot: 1,
  signalCol: 6,
};

const sharpSeattlePick: SheetPick = {
  id: "sharp-sea",
  league: "MLB",
  signalType: "sharp_money",
  pick: "SEATTLE",
  opponent: "BALTIMORE",
  rawRow: 60,
  gameSlot: 1,
  signalCol: 2,
};

const bookFadeSeattlePick: SheetPick = {
  id: "book-sea",
  league: "MLB",
  signalType: "book_needs_fade",
  pick: "SEATTLE",
  opponent: "BALTIMORE",
  rawRow: 60,
  gameSlot: 1,
  signalCol: 4,
};

const SEATTLE_ORIOLES_GAME: CalendarGame = {
  id: "401815687",
  league: "MLB",
  homeTeam: "Baltimore Orioles",
  awayTeam: "Seattle Mariners",
  homeAbbr: "BAL",
  awayAbbr: "SEA",
  startTime: "2026-06-09T22:35:00Z",
  status: "Scheduled",
};

const stats = buildHistoricalStats([], [], 0, "");

function makeRec(
  pick: SheetPick,
  matchedGame?: CalendarGame,
  slatePicks: SheetPick[] = [bookPick, squarePick, sharpPick]
): MatchedRecommendation {
  const result = computePickRules({
    pick,
    matchedGame,
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
  assert.ok(
    isOpposingDualFade(whiteSoxBookSplitRow, atlantaSquareSplitRow),
    "Opposing fades detected even when sheet rows differ"
  );

  const bookConf = computePickRules({
    pick: bookPick,
    matchedGame: GAME,
    slatePicks: [bookPick, squarePick],
  });
  assert.equal(bookConf.signalPolarity, "inverted");
  assert.ok(
    bookConf.opponentPick?.toUpperCase().includes("CUBS"),
    "Book Needs COLORADO → bet CUBS"
  );
  assert.equal(bookConf.confidence, RULE_CONFIDENCE.singleFade);

  const squareConf = computePickRules({
    pick: squarePick,
    matchedGame: GAME,
    slatePicks: [bookPick, squarePick],
  });
  assert.equal(squareConf.signalPolarity, "inverted");
  assert.ok(
    squareConf.opponentPick?.toUpperCase().includes("COLORADO"),
    "Square Top CUBS → bet COLORADO"
  );

  const bookOnlyConf = computePickRules({
    pick: bookOnlyPick,
    matchedGame: WHITE_SOX_GAME,
    slatePicks: [bookOnlyPick],
  });
  assert.equal(bookOnlyConf.signalPolarity, "inverted");
  assert.ok(
    bookOnlyConf.opponentPick?.toUpperCase().includes("ATLANTA"),
    "Single book fade WHITE SOX → bet ATLANTA"
  );

  const squareOnlyConf = computePickRules({
    pick: squareOnlyPick,
    matchedGame: WHITE_SOX_GAME,
    slatePicks: [squareOnlyPick],
  });
  assert.equal(squareOnlyConf.signalPolarity, "inverted");
  assert.ok(
    squareOnlyConf.opponentPick?.toUpperCase().includes("WHITE SOX"),
    "Single square fade ATLANTA → bet WHITE SOX"
  );

  const sharpConf = computePickRules({
    pick: sharpPick,
    slatePicks: [sharpPick],
  });
  assert.equal(sharpConf.signalPolarity, "positive");
  assert.equal(sharpConf.confidence, RULE_CONFIDENCE.sharp);
  assert.ok(!sharpConf.opponentPick, "Sharp Money does not invert");

  const rlmConf = computePickRules({
    pick: rlmPick,
    matchedGame: WHITE_SOX_GAME,
    slatePicks: [rlmPick],
  });
  assert.equal(rlmConf.signalPolarity, "inverted");
  assert.ok(
    rlmConf.opponentPick?.toUpperCase().includes("ATLANTA"),
    "RLM fade WHITE SOX → bet ATLANTA"
  );
  assert.equal(rlmConf.confidence, RULE_CONFIDENCE.singleFade);

  const whaleConf = computePickRules({
    pick: whalePick,
    matchedGame: WHITE_SOX_GAME,
    slatePicks: [whalePick],
  });
  assert.equal(whaleConf.signalPolarity, "inverted");
  assert.ok(
    whaleConf.opponentPick?.toUpperCase().includes("ATLANTA"),
    "Whale fade WHITE SOX → bet ATLANTA"
  );
  assert.equal(whaleConf.confidence, RULE_CONFIDENCE.singleFade);

  const modelConf = computePickRules({
    pick: modelOnFadedTeam,
    matchedGame: WHITE_SOX_GAME,
    slatePicks: [modelOnFadedTeam],
  });
  assert.equal(modelConf.signalPolarity, "inverted");
  assert.ok(
    modelConf.opponentPick?.toUpperCase().includes("ATLANTA"),
    "Model fade WHITE SOX → bet ATLANTA"
  );
  assert.equal(modelConf.confidence, RULE_CONFIDENCE.singleFade);

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
  assert.equal(wsCard!.recommendedTeam, "");
  assert.equal(wsCard!.confidence, 0);

  const wsSplitSlate = [whiteSoxBookSplitRow, atlantaSquareSplitRow];
  const { gameRecommendations: wsSplitCards } = resolveGameConflicts(
    [
      makeRec(whiteSoxBookSplitRow, WHITE_SOX_GAME, wsSplitSlate),
      makeRec(atlantaSquareSplitRow, WHITE_SOX_GAME, wsSplitSlate),
    ],
    stats,
    { slatePicks: wsSplitSlate, dualStats: emptyDualStats }
  );
  const wsSplitCard = wsSplitCards.find((g) => g.matchedGame?.id === WHITE_SOX_GAME.id);
  assert.ok(wsSplitCard?.noBet, "Split-row opposing fades → no bet");
  assert.equal(wsSplitCard!.recommendedTeam, "");
  assert.equal(wsSplitCard!.confidence, 0);

  const oddsOnlySlate = [whiteSoxBookOddsOnly, atlantaSquareOddsOnly];
  const { gameRecommendations: oddsOnlyCards } = resolveGameConflicts(
    [
      makeRec(whiteSoxBookOddsOnly, WHITE_SOX_GAME, oddsOnlySlate),
      makeRec(atlantaSquareOddsOnly, WHITE_SOX_GAME, oddsOnlySlate),
    ],
    stats,
    { slatePicks: oddsOnlySlate, dualStats: emptyDualStats }
  );
  const oddsOnlyCard = oddsOnlyCards.find((g) => g.matchedGame?.id === WHITE_SOX_GAME.id);
  assert.ok(oddsOnlyCard?.noBet, "Odds-only opposing fades (no opponent on sheet) → no bet");
  assert.equal(oddsOnlyCard!.recommendedTeam, "");
  assert.equal(oddsOnlyCard!.confidence, 0);
  assert.ok(oddsOnlyCard!.dualFade?.isOpposingNoBet, "Opposing dual-fade flag set");
  assert.ok(
    oddsOnlyCard!.confidenceBreakdown.some((b) => b.detail?.includes("Result: No bet")),
    "Breakdown shows no-bet result, not misleading edge totals"
  );

  const sameSideSlate = [sameSideBookPick, sameSideSquarePick];
  const { gameRecommendations: sameSideCards } = resolveGameConflicts(
    [
      makeRec(sameSideBookPick, WHITE_SOX_GAME, sameSideSlate),
      makeRec(sameSideSquarePick, WHITE_SOX_GAME, sameSideSlate),
    ],
    stats,
    { slatePicks: sameSideSlate }
  );
  const sameSideCard = sameSideCards.find((g) => g.matchedGame?.id === WHITE_SOX_GAME.id);
  assert.ok(sameSideCard, "Same-side dual fade produces game card");
  assert.ok(
    sameSideCard!.recommendedTeam.toUpperCase().includes("ATLANTA"),
    "Same-side book+square fade WHITE SOX → bet ATLANTA"
  );
  assert.equal(sameSideCard!.confidence, RULE_CONFIDENCE.sameSideDualFade);

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
    "Book + model both fade WHITE SOX → bet ATLANTA"
  );
  assert.equal(
    modelVsFadeCard!.confidence,
    RULE_CONFIDENCE.sameSideDualFade,
    "Same-side book + model fade uses multi-fade confidence"
  );

  const bookRlmSlate = [bookOnlyPick, rlmAtlantaPick];
  const { gameRecommendations: bookRlmCards } = resolveGameConflicts(
    [
      makeRec(bookOnlyPick, WHITE_SOX_GAME, bookRlmSlate),
      makeRec(rlmAtlantaPick, WHITE_SOX_GAME, bookRlmSlate),
    ],
    stats,
    { slatePicks: bookRlmSlate, dualStats: emptyDualStats }
  );
  const bookRlmCard = bookRlmCards.find((g) => g.matchedGame?.id === WHITE_SOX_GAME.id);
  assert.ok(bookRlmCard?.noBet, "Book fades WS + RLM fades ATL → opposing fades, no bet");
  assert.equal(bookRlmCard!.recommendedTeam, "");
  assert.equal(bookRlmCard!.confidence, 0);

  const fadeTargets = collectFadeTargetsForGame(
    [makeRec(bookOnlyPick, WHITE_SOX_GAME, [bookOnlyPick])],
    [bookOnlyPick],
    WHITE_SOX_GAME
  );
  assert.ok(
    fadeTargets.has("CHICAGO WHITE SOX"),
    "Book listed team tracked as fade target (game-resolved)"
  );

  assert.ok(
    isOpposingDualFade(pittsburghBookPick, dodgersSquarePick),
    "Pittsburgh book + LA Dodgers square on opposite VS sides"
  );

  const pitGameKey = buildGameKey(
    pittsburghBookPick,
    [pittsburghBookPick, dodgersSquarePick],
    DODGERS_PIRATES_GAME
  );
  const { gameRecommendations: pitDualCards } = resolveGameConflicts(
    [
      makeRec(pittsburghBookPick, DODGERS_PIRATES_GAME, [pittsburghBookPick, dodgersSquarePick]),
      makeRec(dodgersSquarePick, DODGERS_PIRATES_GAME, [pittsburghBookPick, dodgersSquarePick]),
    ],
    stats,
    {
      slatePicks: [pittsburghBookPick, dodgersSquarePick],
      dualStats: emptyDualStats,
    }
  );
  const pitDualCard = pitDualCards.find((g) => g.gameKey === pitGameKey);
  assert.ok(pitDualCard?.noBet, "Pittsburgh book + Dodgers square → no bet");
  assert.equal(pitDualCard!.recommendedTeam, "");
  assert.equal(pitDualCard!.confidence, 0);

  const { gameRecommendations: pitBookOnlyCards } = resolveGameConflicts(
    [makeRec(pittsburghBookOnlyPick, DODGERS_PIRATES_GAME, [pittsburghBookOnlyPick])],
    stats,
    { slatePicks: [pittsburghBookOnlyPick], dualStats: emptyDualStats }
  );
  const pitBookOnlyCard = pitBookOnlyCards.find(
    (g) => g.matchedGame?.id === DODGERS_PIRATES_GAME.id
  );
  assert.ok(pitBookOnlyCard, "Single Pittsburgh book fade produces consolidated game card");
  assertNeverRecommendsFadeTarget(pitBookOnlyCard!, "PITTSBURGH", "Single Pittsburgh book fade");
  assertNeverRecommendsFadeTarget(pitBookOnlyCard!, "PIRATES", "Single Pittsburgh book fade");
  assert.ok(
    pitBookOnlyCard!.recommendedTeam.toUpperCase().includes("DODGER"),
    "Book fade PITTSBURGH → bet Dodgers"
  );

  const { gameRecommendations: pitModelCards } = resolveGameConflicts(
    [
      makeRec(pittsburghBookOnlyPick, DODGERS_PIRATES_GAME, [
        pittsburghBookOnlyPick,
        modelOnPirates,
      ]),
      makeRec(modelOnPirates, DODGERS_PIRATES_GAME, [pittsburghBookOnlyPick, modelOnPirates]),
    ],
    stats,
    {
      slatePicks: [pittsburghBookOnlyPick, modelOnPirates],
      dualStats: emptyDualStats,
    }
  );
  const pitModelCard = pitModelCards.find((g) => g.matchedGame?.id === DODGERS_PIRATES_GAME.id);
  assert.ok(pitModelCard, "Pittsburgh book + model on Pirates produces consolidated card");
  assertNeverRecommendsFadeTarget(
    pitModelCard!,
    "PITTSBURGH",
    "Model vs Pittsburgh book fade"
  );
  assertNeverRecommendsFadeTarget(pitModelCard!, "PIRATES", "Model vs Pittsburgh book fade");
  assert.ok(
    pitModelCard!.recommendedTeam.toUpperCase().includes("DODGER"),
    "Book + model both fade Pirates → bet Dodgers"
  );
  assert.equal(
    pitModelCard!.confidence,
    RULE_CONFIDENCE.sameSideDualFade,
    "Same-side book + model fade uses multi-fade confidence"
  );

  // resolveImpliedBets unit cases
  const sharpOnly: ImpliedBetEntry[] = [
    {
      signalType: "sharp_money",
      label: "Sharp Money",
      impliedSide: "Carolina Hurricanes",
      impliedNorm: "ml:CAROLINA HURRICANES",
      impliedBet: {
        betType: "moneyline",
        team: "Carolina Hurricanes",
        rawText: "CAROLINA",
        displayText: "Carolina Hurricanes",
      },
      betKey: "ml:CAROLINA HURRICANES",
      detail: "Sharp Money → Carolina Hurricanes",
    },
  ];
  const sharpOnlyResult = resolveImpliedBets(sharpOnly);
  assert.equal(sharpOnlyResult.side, "Carolina Hurricanes");
  assert.equal(sharpOnlyResult.confidence, RULE_CONFIDENCE.sharp);
  assert.ok(
    sharpOnlyResult.breakdown.some((b) => b.detail === "Result: Carolina Hurricanes (85%)")
  );

  const singleFade: ImpliedBetEntry[] = [
    {
      signalType: "square_fade",
      label: "Square Top (Fade)",
      impliedSide: "Vegas Golden Knights",
      impliedNorm: "ml:VEGAS GOLDEN KNIGHTS",
      impliedBet: {
        betType: "moneyline",
        team: "Vegas Golden Knights",
        rawText: "CAROLINA",
        displayText: "Vegas Golden Knights",
      },
      betKey: "ml:VEGAS GOLDEN KNIGHTS",
      fadeTarget: "Carolina Hurricanes",
      detail: "Square Top (Fade) → Vegas Golden Knights",
    },
  ];
  const singleFadeResult = resolveImpliedBets(singleFade);
  assert.equal(singleFadeResult.side, "Vegas Golden Knights");
  assert.equal(singleFadeResult.confidence, RULE_CONFIDENCE.singleFade);

  const conflict: ImpliedBetEntry[] = [
    sharpOnly[0]!,
    singleFade[0]!,
  ];
  const conflictResult = resolveImpliedBets(conflict);
  assert.equal(conflictResult.side, null);
  assert.ok(
    conflictResult.breakdown.some((b) =>
      b.detail?.includes("Result: No bet — conflicting:")
    )
  );

  // Sharp Carolina only → Carolina 85%
  const { gameRecommendations: sharpOnlyCards } = resolveGameConflicts(
    [makeRec(sharpCarolinaPick, VEGAS_CAROLINA_GAME, [sharpCarolinaPick])],
    stats,
    { slatePicks: [sharpCarolinaPick] }
  );
  const sharpOnlyCard = sharpOnlyCards.find((g) => g.matchedGame?.id === VEGAS_CAROLINA_GAME.id);
  assert.ok(sharpOnlyCard, "Sharp-only game produces consolidated card");
  assert.ok(
    sharpOnlyCard!.recommendedTeam.toUpperCase().includes("CAROLINA"),
    "Sharp Carolina only → bet Carolina"
  );
  assert.equal(sharpOnlyCard!.confidence, RULE_CONFIDENCE.sharp);

  // Square fade Carolina only → Vegas 75%
  const { gameRecommendations: squareOnlyCarolinaCards } = resolveGameConflicts(
    [makeRec(squareCarolinaPick, VEGAS_CAROLINA_GAME, [squareCarolinaPick])],
    stats,
    { slatePicks: [squareCarolinaPick] }
  );
  const squareOnlyCarolinaCard = squareOnlyCarolinaCards.find(
    (g) => g.matchedGame?.id === VEGAS_CAROLINA_GAME.id
  );
  assert.ok(squareOnlyCarolinaCard, "Square-only fade produces consolidated card");
  assert.ok(
    squareOnlyCarolinaCard!.recommendedTeam.toUpperCase().includes("VEGAS"),
    "Square fade Carolina only → bet Vegas"
  );
  assert.equal(squareOnlyCarolinaCard!.confidence, RULE_CONFIDENCE.singleFade);
  assert.ok(
    !squareOnlyCarolinaCard!.recommendedTeam.toUpperCase().includes("CAROLINA"),
    "Fade target must not be recommended"
  );

  // Sharp Seattle + Book fade Seattle → no bet
  const seaSlate = [sharpSeattlePick, bookFadeSeattlePick];
  const { gameRecommendations: seaConflictCards } = resolveGameConflicts(
    [
      makeRec(sharpSeattlePick, SEATTLE_ORIOLES_GAME, seaSlate),
      makeRec(bookFadeSeattlePick, SEATTLE_ORIOLES_GAME, seaSlate),
    ],
    stats,
    { slatePicks: seaSlate }
  );
  const seaConflictCard = seaConflictCards.find(
    (g) => g.matchedGame?.id === SEATTLE_ORIOLES_GAME.id
  );
  assert.ok(seaConflictCard?.noBet, "Sharp Seattle + book fade Seattle → no bet");
  assert.equal(seaConflictCard!.recommendedTeam, "");

  // Sharp + square fade same target team → no bet (signals cancel)
  const carolinaSlate = [sharpCarolinaPick, squareCarolinaPick];
  const { gameRecommendations: carolinaCards } = resolveGameConflicts(
    [
      makeRec(sharpCarolinaPick, VEGAS_CAROLINA_GAME, carolinaSlate),
      makeRec(squareCarolinaPick, VEGAS_CAROLINA_GAME, carolinaSlate),
    ],
    stats,
    { slatePicks: carolinaSlate, dualStats: emptyDualStats }
  );
  const carolinaCard = carolinaCards.find((g) => g.matchedGame?.id === VEGAS_CAROLINA_GAME.id);
  assert.ok(carolinaCard, "Sharp + square on Carolina produces consolidated game card");
  assert.ok(carolinaCard!.noBet, "Sharp CAROLINA + square fade CAROLINA → no bet");
  assert.equal(
    carolinaCard!.recommendedTeam,
    "",
    "No bet must have empty recommendedTeam"
  );
  assert.ok(
    !carolinaCard!.recommendedTeam.toUpperCase().includes("VEGAS"),
    "Must NOT recommend Vegas when sharp and fade cancel"
  );
  assert.ok(
    !carolinaCard!.recommendedTeam.toUpperCase().includes("CAROLINA"),
    "Must NOT recommend Carolina when sharp and fade cancel"
  );
  assert.ok(
    carolinaCard!.noBetReason?.includes("no bet"),
    "No bet reason should explain signal cancellation"
  );

  // Fade OVER → recommend UNDER
  const torontoOverPick: SheetPick = {
    id: "fade-over",
    league: "NBA",
    signalType: "book_needs_fade",
    pick: "TORONTO OVER 167.5",
    opponent: "BOSTON",
    rawRow: 70,
    gameSlot: 1,
    signalCol: 4,
  };
  const overFadeRules = computePickRules({
    pick: torontoOverPick,
    slatePicks: [torontoOverPick],
  });
  assert.equal(overFadeRules.signalPolarity, "inverted");
  assert.ok(
    overFadeRules.opponentPick?.toUpperCase().includes("UNDER"),
    "Fade TORONTO OVER → UNDER"
  );
  assert.ok(overFadeRules.opponentPick?.includes("167.5"), "Same total line preserved");

  console.log("✓ All recommendation rule tests passed");
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
