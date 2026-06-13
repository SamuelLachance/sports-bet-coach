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
  computeSportsOddsModelAgreement,
  effectiveTopPickEdge,
  isSportsOddsForcePick,
  mapRemoteSlateGame,
  matchPredictionToCalendarGame,
  sportsOddsAgreesWithBet,
  sportsOddsConsensusForBet,
  sportsOddsModelLayersAgree,
  sportsOddsStatusForBet,
  sportsOddsValueBet,
  sportsOddsValueTrendLabel,
  teamSideForBet,
  type SportsOddsGamePrediction,
} from "../services/sportsOddsAlgo.js";
import { sportsOddsForceMinEdge } from "../config.js";
import { oddsEdge } from "../utils/oddsEdge.js";
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
    blendLayers: 3,
    legacy: { favoriteSide: "home", totalScore: -64.48 },
    power: { homeWinProbability: 64 },
    basketballPred: { homeWinProbability: 65 },
    modelAgreement: {
      required: 3,
      agreed: true,
      agreementMode: "value",
      valueSides: ["home"],
    },
  },
  market: { spread: -5.5, awayMoneyline: 110, homeMoneyline: -130 },
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
  edge: 110,
  marketOdds: -108,
  modelProjection: 6.3,
  betType: "spread" as const,
  spreadLine: -5.5,
  spreadOdds: -108,
  consensusSpread: -5.5,
  modelMargin: 11,
};

const highValuePrediction: SportsOddsGamePrediction = {
  ...spursPrediction,
  model: {
    ...spursPrediction.model,
    favoriteSide: "home",
    winProbability: 64.48,
    blendLayers: 3,
    legacy: { favoriteSide: "home", totalScore: -64.48 },
    power: { homeWinProbability: 64 },
    basketballPred: { homeWinProbability: 65 },
  },
  topPick: highEdgeTopPick,
};

const lowEdgePrediction: SportsOddsGamePrediction = {
  ...spursPrediction,
  topPick: {
    ...highEdgeTopPick,
    edge: 8,
    modelMargin: -1.2,
  },
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
  model: {
    favoriteSide: "home",
    winProbability: 55.18,
    blendLayers: 3,
    legacy: { favoriteSide: "home", totalScore: -55.18 },
    power: { homeWinProbability: 56 },
    baseballPred: { homeWinProbability: 55 },
  },
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
  model: {
    favoriteSide: "away",
    winProbability: 60.04,
    blendLayers: 3,
    legacy: { favoriteSide: "away", totalScore: 60.04 },
    power: { homeWinProbability: 40 },
    basketballPred: { homeWinProbability: 39 },
  },
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

// Padres away favorite — cross-sign ML edge is ~+26, not raw +230; below force threshold
const padresPredictionBase = {
  eventId: "401815712",
  league: "MLB" as const,
  awayTeam: "San Diego Padres",
  homeTeam: "Cincinnati Reds",
  model: {
    favoriteSide: "away" as const,
    winProbability: 54.79,
    awayProjection: -121,
    homeProjection: 121,
  },
  market: { awayMoneyline: 109, homeMoneyline: -130 },
};

const padresTopPick = {
  side: "away" as const,
  teamName: "San Diego Padres",
  marketOdds: 109,
  modelProjection: -121,
  betType: "moneyline" as const,
};

const padresPrediction: SportsOddsGamePrediction = {
  ...padresPredictionBase,
  topPick: {
    ...padresTopPick,
    edge: oddsEdge(-121, 109, 54.79),
    outcomeWinProbability: 54.79,
  },
};

const padresStaleApiPrediction: SportsOddsGamePrediction = {
  ...padresPredictionBase,
  topPick: {
    ...padresTopPick,
    edge: 230,
  },
};

assert.equal(isSportsOddsForcePick(padresPrediction), false);
assert.equal(isSportsOddsForcePick(padresStaleApiPrediction), false);

const padresRecomputedEdge = effectiveTopPickEdge(
  padresStaleApiPrediction.topPick!,
  padresStaleApiPrediction
);
assert.ok(padresRecomputedEdge > 20 && padresRecomputedEdge < 40);
assert.notEqual(padresRecomputedEdge, 230);

const padresTrend = sportsOddsValueTrendLabel(padresStaleApiPrediction);
assert.ok(padresTrend.includes("+2") || padresTrend.includes("+3"));
assert.ok(!padresTrend.includes("+230"));

assert.equal(sportsOddsForceMinEdge(), 40);
assert.ok((padresPrediction.topPick?.edge ?? 0) < 50);
assert.ok((padresPrediction.topPick?.edge ?? 0) > 20);
assert.ok((padresPrediction.topPick?.modelProjection ?? 0) < 0);
assert.ok((padresPrediction.topPick?.marketOdds ?? 0) > 0);

const padresStaleRemoteSlate = {
  event_id: "401815712",
  league: "mlb",
  matchup: {
    away: { name: "San Diego Padres" },
    home: { name: "Cincinnati Reds" },
  },
  model: {
    favorite_side: "away" as const,
    win_probability: 54.79,
    away_projection: -121,
    home_projection: 121,
  },
  market: { away_moneyline: 109, home_moneyline: -130 },
  top_pick: {
    side: "away" as const,
    team_name: "San Diego Padres",
    edge: 230,
    market_odds: 109,
    model_projection: -121,
    bet_type: "moneyline" as const,
  },
};

const padresFromStaleSlate = mapRemoteSlateGame(padresStaleRemoteSlate);
assert.equal(padresFromStaleSlate?.topPick, undefined);

const nhlForcePrediction: SportsOddsGamePrediction = {
  eventId: "401999001",
  league: "NHL",
  awayTeam: "Boston Bruins",
  homeTeam: "Toronto Maple Leafs",
  model: {
    favoriteSide: "home",
    winProbability: 58,
  },
  market: { spread: -5.5 },
  topPick: {
    side: "home",
    teamName: "Toronto Maple Leafs",
    edge: 49,
    marketOdds: -110,
    modelProjection: 5,
    betType: "spread",
    spreadLine: -5.5,
    spreadOdds: -110,
    consensusSpread: -5.5,
    modelMargin: 7.95,
  },
};

const nhlForce39: SportsOddsGamePrediction = {
  ...nhlForcePrediction,
  topPick: {
    ...nhlForcePrediction.topPick!,
    edge: 39,
    modelMargin: 7.45,
  },
};

const nhlForce40: SportsOddsGamePrediction = {
  ...nhlForcePrediction,
  topPick: {
    ...nhlForcePrediction.topPick!,
    edge: 40,
    modelMargin: 7.5,
  },
};

assert.equal(isSportsOddsForcePick(nhlForce39), false);
assert.equal(isSportsOddsForcePick(nhlForcePrediction), true);
assert.equal(isSportsOddsForcePick(nhlForce40), true);

const nbaValueMarket = { awayMoneyline: 110, homeMoneyline: -130 };

const threeLayerAgree = computeSportsOddsModelAgreement(
  {
    favoriteSide: "home",
    winProbability: 62,
    blendLayers: 3,
    legacy: { favoriteSide: "home", totalScore: -60 },
    power: { homeWinProbability: 64 },
    basketballPred: { homeWinProbability: 63 },
  },
  "NBA",
  nbaValueMarket
);
assert.equal(threeLayerAgree.required, 3);
assert.equal(threeLayerAgree.agreed, true);
assert.equal(threeLayerAgree.agreementMode, "value");
assert.equal(threeLayerAgree.thirdSource, "basketball_pred");

const threeLayerValueOnUnderdog = computeSportsOddsModelAgreement(
  {
    favoriteSide: "home",
    winProbability: 62,
    blendLayers: 3,
    legacy: { favoriteSide: "home", totalScore: -60 },
    power: { homeWinProbability: 42 },
    basketballPred: { homeWinProbability: 64 },
  },
  "NBA",
  { awayMoneyline: 220, homeMoneyline: -260 }
);
assert.equal(threeLayerValueOnUnderdog.agreed, true);
assert.ok(threeLayerValueOnUnderdog.valueSides?.includes("away"));

const underdogValuePrediction: SportsOddsGamePrediction = {
  ...spursPrediction,
  model: {
    ...spursPrediction.model,
    favoriteSide: "home",
    modelAgreement: {
      required: 3,
      agreed: true,
      agreementMode: "value",
      valueSides: ["away"],
    },
  },
  topPick: {
    side: "away",
    teamName: "New York Knicks",
    edge: 18,
    marketOdds: 220,
    modelProjection: 185,
    outcomeWinProbability: 38,
    betType: "moneyline",
  },
};
assert.equal(
  sportsOddsAgreesWithBet(knicksMlBet, KNICKS_GAME, underdogValuePrediction),
  true
);
assert.equal(
  sportsOddsAgreesWithBet(spursMlBet, KNICKS_GAME, underdogValuePrediction),
  false
);
assert.equal(
  sportsOddsStatusForBet(knicksMlBet, KNICKS_GAME, underdogValuePrediction),
  "agrees"
);

const underdogValueConfirmed = applySportsOddsFilter(
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
  [underdogValuePrediction],
  [KNICKS_GAME]
).gameRecommendations[0];
assert.equal(underdogValueConfirmed.noBet, undefined);
assert.equal(underdogValueConfirmed.sportsOddsConfirmed, true);
assert.ok(
  underdogValueConfirmed.confidenceBreakdown.some((b) =>
    b.detail.includes("all 3 layers find value")
  )
);

const threeLayerDisagree = computeSportsOddsModelAgreement(
  {
    favoriteSide: "home",
    winProbability: 62,
    blendLayers: 3,
    legacy: { favoriteSide: "home", totalScore: -60 },
    power: { homeWinProbability: 42 },
    basketballPred: { homeWinProbability: 63 },
  },
  "NBA",
  { awayMoneyline: 70, homeMoneyline: -110 }
);
assert.equal(threeLayerDisagree.agreed, false);

const valueAgreedLowEdgePrediction: SportsOddsGamePrediction = {
  ...highValuePrediction,
  model: {
    ...highValuePrediction.model,
    modelAgreement: {
      required: 3,
      agreed: true,
      agreementMode: "value",
      valueSides: ["home"],
    },
  },
  topPick: {
    ...highEdgeTopPick,
    edge: 10,
    modelMargin: 6,
    consensusSpread: -5.5,
  },
};
assert.equal(isSportsOddsForcePick(valueAgreedLowEdgePrediction), false);

const valueAgreedMinEdgePrediction: SportsOddsGamePrediction = {
  ...valueAgreedLowEdgePrediction,
  topPick: {
    ...valueAgreedLowEdgePrediction.topPick!,
    edge: 40,
    modelMargin: 7.6,
  },
};
assert.equal(isSportsOddsForcePick(valueAgreedMinEdgePrediction), true);

const disagreeForcePrediction: SportsOddsGamePrediction = {
  ...highValuePrediction,
  model: {
    ...highValuePrediction.model,
    blendLayers: 3,
    legacy: { favoriteSide: "home", totalScore: -60 },
    power: { homeWinProbability: 42 },
    basketballPred: { homeWinProbability: 64 },
    modelAgreement: {
      required: 3,
      agreed: false,
      agreementMode: "value",
      valueSides: [],
    },
  },
};
assert.equal(sportsOddsModelLayersAgree(disagreeForcePrediction), false);
assert.equal(isSportsOddsForcePick(disagreeForcePrediction), false);

const forcedDisagreeLayers = applySportsOddsFilter(
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
  [disagreeForcePrediction],
  [KNICKS_GAME]
).gameRecommendations[0];
assert.equal(forcedDisagreeLayers.noBet, true);
assert.equal(forcedDisagreeLayers.sportsOddsBlocked, true);

console.log("sportsOddsAlgo.test.ts: all tests passed");
