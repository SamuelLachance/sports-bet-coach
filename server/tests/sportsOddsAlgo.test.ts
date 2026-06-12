/**
 * Unit tests for Sports Odds dual-algo agreement logic.
 * Run: npx tsx server/tests/sportsOddsAlgo.test.ts
 */
import assert from "node:assert/strict";
import {
  applyEventTeamConflictFilter,
  applySportsOddsFilter,
} from "../services/recommendations.js";
import {
  buildSportsOddsGameKey,
  isSportsOddsForcePick,
  matchPredictionToCalendarGame,
  sportsOddsAgreesWithBet,
  sportsOddsConsensusForBet,
  sportsOddsStatusForBet,
  sportsOddsValueBet,
  teamSideForBet,
  type SportsOddsGamePrediction,
} from "../services/sportsOddsAlgo.js";
import { pickBelongsToGame, resolveGameTeamDisplay } from "../services/calendar.js";
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
  edge: 120,
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

const knicksSpreadRec: GameConsolidatedRecommendation = {
  ...baseGameRec,
  gameKey: "nba-other-key",
  recommendedTeam: "Ny +5.5",
  recommendedBet: {
    betType: "spread",
    team: "NY",
    rawText: "NY +5.5",
    spread: 5.5,
    displayText: "Ny +5.5",
  },
  betType: "spread",
  pickIds: ["pick-2"],
};

const dualSideConflict = applyEventTeamConflictFilter({
  recommendations: [],
  gameRecommendations: [baseGameRec, knicksSpreadRec],
}).gameRecommendations;

assert.equal(dualSideConflict.length, 1);
assert.equal(dualSideConflict[0]?.noBet, true);
assert.ok(dualSideConflict[0]?.pickIds.includes("pick-1"));
assert.ok(dualSideConflict[0]?.pickIds.includes("pick-2"));

const SKY_FEVER_GAME: CalendarGame = {
  id: "401856980",
  league: "WNBA",
  homeTeam: "Indiana Fever",
  awayTeam: "Chicago Sky",
  homeAbbr: "IND",
  awayAbbr: "CHI",
  startTime: "2026-06-11T23:00:00Z",
  status: "Scheduled",
};

const feverSpreadBet: ParsedBet = {
  betType: "spread",
  team: "FEVER",
  rawText: "FEVER -9.5",
  spread: -9.5,
  displayText: "Fever -9.5",
};

const skySpreadBet: ParsedBet = {
  betType: "spread",
  team: "SKY",
  rawText: "SKY +10.5",
  spread: 10.5,
  displayText: "Sky +10.5",
};

assert.equal(teamSideForBet(feverSpreadBet, SKY_FEVER_GAME), "home");
assert.equal(teamSideForBet(skySpreadBet, SKY_FEVER_GAME), "away");

const feverGameRec: GameConsolidatedRecommendation = {
  gameKey: "wnba:espn-401856980",
  league: "WNBA",
  awayTeam: SKY_FEVER_GAME.awayTeam,
  homeTeam: SKY_FEVER_GAME.homeTeam,
  recommendedTeam: "Fever -9.5",
  recommendedBet: feverSpreadBet,
  betType: "spread",
  confidence: 85,
  confidenceBreakdown: [],
  hasConflict: false,
  pickIds: ["fever-pick"],
  reasoning: "Sharp on Fever",
  matchedGame: SKY_FEVER_GAME,
  sportsOddsForced: true,
};

const skyGameRec: GameConsolidatedRecommendation = {
  ...feverGameRec,
  gameKey: "wnba:sky|fever",
  recommendedTeam: "Sky +10.5",
  recommendedBet: skySpreadBet,
  pickIds: ["sky-pick"],
  sportsOddsForced: true,
};

const skyFeverConflict = applyEventTeamConflictFilter({
  recommendations: [],
  gameRecommendations: [feverGameRec, skyGameRec],
}).gameRecommendations;

assert.equal(skyFeverConflict.length, 1);
assert.equal(skyFeverConflict[0]?.noBet, true);
assert.ok(skyFeverConflict[0]?.pickIds.includes("fever-pick"));
assert.ok(skyFeverConflict[0]?.pickIds.includes("sky-pick"));

const forcedWithBlockedCoachPick = applyEventTeamConflictFilter(
  applySportsOddsFilter(
    {
      recommendations: [
        {
          ...({
            id: "pick-knicks",
            league: "NBA",
            signalType: "sharp_money",
            signalLabel: "Sharp Money",
            pick: "Knicks",
            confidence: 85,
            confidenceBreakdown: [],
            signalPolarity: "positive",
            edgeLabel: "Sharp",
            reasoning: "test",
            status: "matched",
            gameDate: "2026-06-14",
            matchedGame: KNICKS_GAME,
            recommendedBet: knicksMlBet,
            sportsOddsBlocked: true,
          } as const),
        },
      ],
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
  )
).gameRecommendations[0];

assert.ok(!forcedWithBlockedCoachPick.noBet);
assert.equal(forcedWithBlockedCoachPick.sportsOddsForced, true);

const whiteSoxGame: CalendarGame = {
  id: "401815716",
  league: "MLB",
  homeTeam: "Chicago White Sox",
  awayTeam: "Atlanta Braves",
  homeAbbr: "CHW",
  awayAbbr: "ATL",
  startTime: "2026-06-11T23:40:00Z",
  status: "Scheduled",
};

const whiteSoxMlBet: ParsedBet = {
  betType: "moneyline",
  team: "CHW",
  rawText: "CHW",
  displayText: "CHW",
};

const whiteSoxPrediction: SportsOddsGamePrediction = {
  eventId: "401815716",
  league: "MLB",
  awayTeam: "Atlanta Braves",
  homeTeam: "Chicago White Sox",
  model: { favoriteSide: "home", winProbability: 55.18 },
  market: {
    provider: "DraftKings",
    spread: 1.5,
    homeMoneyline: 103,
    awayMoneyline: -123,
  },
};

const whiteSoxConsensus = sportsOddsConsensusForBet(
  whiteSoxMlBet,
  whiteSoxGame,
  whiteSoxPrediction
);
assert.equal(whiteSoxConsensus?.label, "+103");
assert.equal(whiteSoxConsensus?.provider, "DraftKings");

const whiteSoxAgreed = applySportsOddsFilter(
  {
    recommendations: [],
    gameRecommendations: [
      {
        gameKey: "mlb-chw",
        league: "MLB",
        awayTeam: whiteSoxGame.awayTeam,
        homeTeam: whiteSoxGame.homeTeam,
        recommendedTeam: "CHW",
        recommendedBet: whiteSoxMlBet,
        betType: "moneyline",
        confidence: 85,
        confidenceBreakdown: [],
        hasConflict: false,
        pickIds: ["chw-pick"],
        reasoning: "test",
        matchedGame: whiteSoxGame,
      },
    ],
  },
  [whiteSoxPrediction],
  [whiteSoxGame]
).gameRecommendations[0];

assert.equal(whiteSoxAgreed.consensusLabel, "+103");
assert.equal(whiteSoxAgreed.bookProvider, "DraftKings");

const spreadTopPickPrediction: SportsOddsGamePrediction = {
  ...spursPrediction,
  topPick: {
    side: "home",
    teamName: "San Antonio Spurs",
    edge: 62,
    marketOdds: -108,
    modelProjection: 6.3,
    betType: "spread",
    spreadLine: -5.5,
    spreadOdds: -108,
    consensusSpread: -5.5,
    consensusLabel: "-5.5 (-108)",
  },
};

const spreadValueBet = sportsOddsValueBet(spreadTopPickPrediction, KNICKS_GAME);
assert.equal(spreadValueBet.betType, "spread");
assert.equal(spreadValueBet.spread, -5.5);
assert.equal(spreadValueBet.odds, -108);

const spreadConsensus = sportsOddsConsensusForBet(
  spreadValueBet,
  KNICKS_GAME,
  spreadTopPickPrediction
);
assert.equal(spreadConsensus?.spread, -5.5);
assert.equal(spreadConsensus?.label, "-5.5 (-108)");

const drawBet: ParsedBet = {
  betType: "moneyline",
  team: "Draw",
  rawText: "Draw",
  displayText: "Draw",
};

const soccerDrawPrediction: SportsOddsGamePrediction = {
  eventId: "760416",
  league: "NBA",
  awayTeam: "Brazil",
  homeTeam: "Spain",
  model: {
    favoriteSide: "home",
    winProbability: 58,
    threeway: true,
    homeWinProbability: 42,
    drawProbability: 28,
    awayWinProbability: 30,
    drawProjection: 250,
  },
  market: {
    drawMoneyline: 280,
  },
  topPick: {
    side: "draw",
    teamName: "Draw",
    edge: 120,
    marketOdds: 280,
    modelProjection: 250,
    betType: "moneyline",
  },
};

assert.equal(teamSideForBet(drawBet, KNICKS_GAME), "draw");
assert.equal(
  sportsOddsAgreesWithBet(drawBet, KNICKS_GAME, soccerDrawPrediction),
  true
);
assert.equal(
  sportsOddsAgreesWithBet(spursMlBet, KNICKS_GAME, soccerDrawPrediction),
  false
);
const drawValueBet = sportsOddsValueBet(soccerDrawPrediction, KNICKS_GAME);
assert.equal(drawValueBet.displayText, "Draw");

const WNBA_GAME: CalendarGame = {
  id: "401856985",
  league: "WNBA",
  homeTeam: "Seattle Storm",
  awayTeam: "Golden State Valkyries",
  homeAbbr: "SEA",
  awayAbbr: "GS",
  startTime: "2026-06-13T02:00:00Z",
  status: "Scheduled",
};

const MLB_SEA_BAL: CalendarGame = {
  id: "401815687",
  league: "MLB",
  homeTeam: "Baltimore Orioles",
  awayTeam: "Seattle Mariners",
  homeAbbr: "BAL",
  awayAbbr: "SEA",
  startTime: "2026-06-09T22:35:00Z",
  status: "Scheduled",
};

assert.equal(resolveGameTeamDisplay("Storm", WNBA_GAME), "Seattle Storm");
assert.equal(resolveGameTeamDisplay("Valkyries", WNBA_GAME), "Golden State Valkyries");
assert.equal(pickBelongsToGame("Seattle", "Golden State", WNBA_GAME), true);
assert.equal(resolveGameTeamDisplay("Seattle", MLB_SEA_BAL), "Seattle Mariners");
assert.equal(resolveGameTeamDisplay("Seattle", WNBA_GAME), "Seattle Storm");
assert.equal(pickBelongsToGame("Storm", "Orioles", MLB_SEA_BAL), false);

const stormSpreadBet: ParsedBet = {
  betType: "spread",
  team: "Storm",
  spread: 9.5,
  rawText: "Storm +9.5",
  displayText: "Storm +9.5",
};

const gsStormPrediction: SportsOddsGamePrediction = {
  eventId: "401856985",
  league: "WNBA",
  awayTeam: "Golden State Valkyries",
  homeTeam: "Seattle Storm",
  model: { favoriteSide: "away", winProbability: 60.04 },
  market: { spread: 9.5 },
  topPick: {
    side: "home",
    teamName: "Seattle Storm",
    edge: 166,
    marketOdds: -115,
    modelProjection: -24,
    betType: "spread",
    spreadLine: 9.5,
    spreadOdds: -115,
    consensusSpread: 9.5,
    modelMargin: -1.2,
  },
};

const staleGsForcePrediction: SportsOddsGamePrediction = {
  ...gsStormPrediction,
  topPick: {
    side: "away",
    teamName: "Golden State Valkyries",
    edge: 214,
    marketOdds: -105,
    modelProjection: 24,
    betType: "spread",
    spreadLine: -9.5,
    spreadOdds: -105,
    consensusSpread: 9.5,
    modelMargin: -1.2,
  },
};

assert.equal(isSportsOddsForcePick(staleGsForcePrediction), false);

assert.equal(
  sportsOddsAgreesWithBet(stormSpreadBet, WNBA_GAME, gsStormPrediction),
  true
);
assert.equal(
  sportsOddsAgreesWithBet(spursMlBet, WNBA_GAME, gsStormPrediction),
  false
);

const SOCCER_GAME: CalendarGame = {
  id: "760416",
  league: "NBA",
  homeTeam: "Canada",
  awayTeam: "Bosnia-Herzegovina",
  homeAbbr: "CAN",
  awayAbbr: "BIH",
  startTime: "2026-06-12T19:00:00Z",
  status: "Scheduled",
};

const homeMlBet: ParsedBet = {
  betType: "moneyline",
  team: "CAN",
  rawText: "CAN",
  displayText: "CAN",
};

const awayMlBet: ParsedBet = {
  betType: "moneyline",
  team: "BIH",
  rawText: "BIH",
  displayText: "BIH",
};

const homeGameRec: GameConsolidatedRecommendation = {
  gameKey: "soccer-home",
  league: "NBA",
  awayTeam: SOCCER_GAME.awayTeam,
  homeTeam: SOCCER_GAME.homeTeam,
  recommendedTeam: "CAN",
  recommendedBet: homeMlBet,
  betType: "moneyline",
  confidence: 80,
  confidenceBreakdown: [],
  hasConflict: false,
  pickIds: ["home-pick"],
  reasoning: "test",
  matchedGame: SOCCER_GAME,
};

const awayGameRec: GameConsolidatedRecommendation = {
  ...homeGameRec,
  gameKey: "soccer-away",
  recommendedTeam: "BIH",
  recommendedBet: awayMlBet,
  pickIds: ["away-pick"],
};

const soccerConflict = applyEventTeamConflictFilter({
  recommendations: [],
  gameRecommendations: [homeGameRec, awayGameRec],
}).gameRecommendations;

assert.equal(soccerConflict.length, 1);
assert.equal(soccerConflict[0]?.noBet, true);

// Rays @ Angels — away favorite projections align with favoriteSide (live slate regression)
const RAYS_GAME: CalendarGame = {
  id: "401815733",
  league: "MLB",
  homeTeam: "Los Angeles Angels",
  awayTeam: "Tampa Bay Rays",
  homeAbbr: "LAA",
  awayAbbr: "TB",
  startTime: "2026-06-13T01:38:00Z",
  status: "Scheduled",
};

const raysPrediction: SportsOddsGamePrediction = {
  eventId: "401815733",
  league: "MLB",
  awayTeam: "Tampa Bay Rays",
  homeTeam: "Los Angeles Angels",
  model: {
    favoriteSide: "away",
    winProbability: 55.68,
    awayProjection: -126,
    homeProjection: 126,
  },
  market: { awayMoneyline: -171, homeMoneyline: 141 },
};

assert.ok((raysPrediction.model.awayProjection ?? 0) < 0);
assert.ok((raysPrediction.model.homeProjection ?? 0) > 0);
assert.equal(isSportsOddsForcePick(raysPrediction), false);

const raysMlBet: ParsedBet = {
  betType: "moneyline",
  team: "TB",
  rawText: "TB",
  displayText: "TB",
};
assert.equal(
  sportsOddsAgreesWithBet(raysMlBet, RAYS_GAME, raysPrediction),
  true
);

// Padres away favorite — ML edge passes force threshold without sign inversion
const padresPrediction: SportsOddsGamePrediction = {
  eventId: "401815712",
  league: "MLB",
  awayTeam: "San Diego Padres",
  homeTeam: "Cincinnati Reds",
  model: {
    favoriteSide: "away",
    winProbability: 54.79,
    awayProjection: -121,
    homeProjection: 121,
  },
  market: { awayMoneyline: 109, homeMoneyline: -130 },
  topPick: {
    side: "away",
    teamName: "San Diego Padres",
    edge: 230,
    marketOdds: 109,
    modelProjection: -121,
    betType: "moneyline",
  },
};

assert.equal(isSportsOddsForcePick(padresPrediction), true);
assert.equal(padresPrediction.topPick?.edge, 230);
assert.ok((padresPrediction.topPick?.modelProjection ?? 0) < 0);
assert.ok((padresPrediction.topPick?.marketOdds ?? 0) > 0);

console.log("sportsOddsAlgo.test.ts: all tests passed");
