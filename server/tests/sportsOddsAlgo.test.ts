/**
 * Unit tests for Sports Odds dual-algo agreement logic.
 * Run: npx tsx server/tests/sportsOddsAlgo.test.ts
 */
import assert from "node:assert/strict";
import {
  applySportsOddsFilter,
} from "../services/recommendations.js";
import {
  buildSportsOddsGameKey,
  isSportsOddsForcePick,
  matchPredictionToCalendarGame,
  sportsOddsAgreesWithBet,
  sportsOddsStatusForBet,
  type SportsOddsGamePrediction,
} from "../services/sportsOddsAlgo.js";
import type { CalendarGame, GameConsolidatedRecommendation, ParsedBet } from "../types.js";

const KNICKS_GAME: CalendarGame = {
  id: "401859967",
  league: "NBA",
  homeTeam: "San Antonio Spurs",
  awayTeam: "New York Knicks",
  homeAbbr: "SA",
  awayAbbr: "NY",
  startTime: "2026-06-14T00:30:00Z",
  status: "Scheduled",
};

const spursPrediction: SportsOddsGamePrediction = {
  eventId: "401859967",
  league: "NBA",
  awayTeam: "New York Knicks",
  homeTeam: "San Antonio Spurs",
  model: {
    favoriteSide: "home",
    winProbability: 64.48,
  },
  market: { spread: -5.5 },
};

const spursMlBet: ParsedBet = {
  betType: "moneyline",
  team: "Spurs",
  rawText: "Spurs",
  displayText: "Spurs",
};

const knicksMlBet: ParsedBet = {
  betType: "moneyline",
  team: "Knicks",
  rawText: "Knicks",
  displayText: "Knicks",
};

assert.equal(
  buildSportsOddsGameKey("NBA", "New York Knicks", "San Antonio Spurs"),
  buildSportsOddsGameKey("NBA", "San Antonio Spurs", "New York Knicks")
);

assert.equal(
  matchPredictionToCalendarGame(KNICKS_GAME, [spursPrediction])?.model.favoriteSide,
  "home"
);

assert.equal(
  sportsOddsAgreesWithBet(spursMlBet, KNICKS_GAME, spursPrediction),
  true
);
assert.equal(
  sportsOddsAgreesWithBet(knicksMlBet, KNICKS_GAME, spursPrediction),
  false
);
assert.equal(
  sportsOddsStatusForBet(spursMlBet, KNICKS_GAME, spursPrediction),
  "agrees"
);
assert.equal(
  sportsOddsStatusForBet(knicksMlBet, KNICKS_GAME, spursPrediction),
  "disagrees"
);

const baseGameRec: GameConsolidatedRecommendation = {
  gameKey: "nba-test",
  league: "NBA",
  awayTeam: KNICKS_GAME.awayTeam,
  homeTeam: KNICKS_GAME.homeTeam,
  recommendedTeam: "Spurs ML",
  recommendedBet: spursMlBet,
  betType: "moneyline",
  confidence: 85,
  confidenceBreakdown: [],
  hasConflict: false,
  pickIds: ["pick-1"],
  reasoning: "Sharp money on Spurs",
  matchedGame: KNICKS_GAME,
};

const agreed = applySportsOddsFilter(
  { recommendations: [], gameRecommendations: [baseGameRec] },
  [spursPrediction]
).gameRecommendations[0];

assert.equal(agreed.noBet, undefined);
assert.equal(agreed.sportsOddsConfirmed, true);
assert.equal(agreed.dualAlgoConfirmed, true);
assert.equal(agreed.recommendedBet?.betType, "spread");
assert.equal(agreed.recommendedBet?.spread, -5.5);

const disagreed = applySportsOddsFilter(
  {
    recommendations: [],
    gameRecommendations: [
      {
        ...baseGameRec,
        recommendedTeam: "Knicks ML",
        recommendedBet: knicksMlBet,
      },
    ],
  },
  [spursPrediction]
).gameRecommendations[0];

assert.equal(disagreed.noBet, true);
assert.equal(disagreed.sportsOddsConfirmed, false);
assert.equal(disagreed.dualAlgoConfirmed, false);

const highEdgeTopPick = {
  side: "home" as const,
  teamName: "San Antonio Spurs",
  edge: 25,
  marketOdds: -170,
  modelProjection: -195,
};

const highValuePrediction: SportsOddsGamePrediction = {
  ...spursPrediction,
  model: {
    favoriteSide: "home",
    winProbability: 64.48,
  },
  topPick: highEdgeTopPick,
};

const lowEdgePrediction: SportsOddsGamePrediction = {
  ...spursPrediction,
  topPick: { ...highEdgeTopPick, edge: 8 },
};

assert.equal(isSportsOddsForcePick(highValuePrediction), true);
assert.equal(isSportsOddsForcePick(lowEdgePrediction), false);
assert.equal(isSportsOddsForcePick(spursPrediction), false);

const forcedDisagree = applySportsOddsFilter(
  {
    recommendations: [],
    gameRecommendations: [
      {
        ...baseGameRec,
        recommendedTeam: "Knicks ML",
        recommendedBet: knicksMlBet,
      },
    ],
  },
  [highValuePrediction],
  [KNICKS_GAME]
).gameRecommendations[0];

assert.ok(!forcedDisagree.noBet);
assert.equal(forcedDisagree.sportsOddsForced, true);
assert.equal(forcedDisagree.sportsOddsConfirmed, true);
assert.equal(forcedDisagree.dualAlgoConfirmed, false);
assert.equal(forcedDisagree.recommendedBet?.team, "SA");
assert.equal(forcedDisagree.recommendedBet?.betType, "spread");
assert.equal(forcedDisagree.recommendedBet?.spread, -5.5);

const noBetRec: GameConsolidatedRecommendation = {
  gameKey: "nba-no-bet",
  league: "NBA",
  awayTeam: KNICKS_GAME.awayTeam,
  homeTeam: KNICKS_GAME.homeTeam,
  recommendedTeam: "",
  confidence: 0,
  noBet: true,
  noBetReason: "Conflicting signals",
  confidenceBreakdown: [],
  hasConflict: true,
  pickIds: ["pick-a", "pick-b"],
  reasoning: "No bet",
  matchedGame: KNICKS_GAME,
};

const forcedNoBet = applySportsOddsFilter(
  { recommendations: [], gameRecommendations: [noBetRec] },
  [highValuePrediction],
  [KNICKS_GAME]
).gameRecommendations[0];

assert.ok(!forcedNoBet.noBet);
assert.equal(forcedNoBet.sportsOddsForced, true);
assert.ok(forcedNoBet.recommendedTeam.includes("Sa -5.5"));

const injected = applySportsOddsFilter(
  { recommendations: [], gameRecommendations: [] },
  [highValuePrediction],
  [KNICKS_GAME]
).gameRecommendations[0];

assert.equal(injected.sportsOddsForced, true);
assert.ok(injected.recommendedTeam.includes("Sa -5.5"));
assert.equal(injected.pickIds.length, 0);

console.log("sportsOddsAlgo.test.ts: all tests passed");
