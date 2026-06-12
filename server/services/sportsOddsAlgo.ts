/**
 * Sports Odds Algorithms integration (James Quintero Algo V2).
 * Requires agreement between the coach rules engine and the odds model
 * before a bet is recommended on MLB / NBA / NHL.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  CACHE_DIR,
  SOCCER_SCHEDULE_LEAGUES,
  SPORTS_ODDS_BASE_URL,
  SPORTS_ODDS_LEAGUE_TO_COACH,
  SPORTS_ODDS_SPREAD_LEAGUES,
  SPORTS_ODDS_SUPPORTED_LEAGUES,
  isSportsOddsEnabled,
  sportsOddsForceMinEdge,
} from "../config.js";
import {
  DEFAULT_JUICE,
  parsePickBet,
  resolveBetDisplay,
} from "../parsers/pickBetParser.js";
import type { CalendarGame, LeagueCode, ParsedBet } from "../types.js";
import { oddsEdge, probabilityToAmerican } from "../utils/oddsEdge.js";
import { resolveGameTeamDisplay } from "./calendar.js";

export type SportsOddsAgreementStatus = "agrees" | "disagrees" | "unavailable";

export type SportsOddsLayerSide = "away" | "home" | "draw";

export interface SportsOddsModelAgreement {
  required: number;
  agreed: boolean;
  legacySide?: SportsOddsLayerSide;
  powerSide?: SportsOddsLayerSide;
  thirdSide?: SportsOddsLayerSide;
  thirdSource?: string;
  agreementMode?: "value";
  valueSides?: SportsOddsLayerSide[];
  valueOutcomes?: SportsOddsLayerSide[];
}

export interface SportsOddsModelPrediction {
  algorithm?: string;
  blendMode?: string;
  blendLayers?: number;
  favoriteSide: "away" | "home";
  winProbability: number;
  awayProjection?: number;
  homeProjection?: number;
  /** Soccer 3-way model probabilities when present on the slate. */
  threeway?: boolean;
  homeWinProbability?: number;
  drawProbability?: number;
  awayWinProbability?: number;
  drawProjection?: number;
  legacy?: {
    algorithm?: string;
    totalScore?: number;
    winProbability?: number;
    favoriteSide?: "away" | "home";
  };
  power?: {
    algorithm?: string;
    homePower?: number;
    awayPower?: number;
    homeWinProbability?: number;
    param?: number;
  };
  basketballPred?: {
    algorithm?: string;
    source?: string;
    homeWinProbability?: number;
    predictedHomeScore?: number;
    predictedAwayScore?: number;
    predictedMargin?: number;
    param?: number;
  };
  baseballPred?: {
    algorithm?: string;
    source?: string;
    homeWinProbability?: number;
    eloExp?: number;
    homePythagorean?: number;
    awayPythagorean?: number;
    formDiff?: number;
    predictedMargin?: number;
    predictedHomeRuns?: number;
    predictedAwayRuns?: number;
    param?: number;
  };
  soccerPred?: {
    algorithm?: string;
    source?: string;
    homeWinProbability?: number;
    drawProbability?: number;
    awayWinProbability?: number;
    expectedHomeGoals?: number;
    expectedAwayGoals?: number;
    eloHome?: number;
    eloAway?: number;
    piExpectedGd?: number;
  };
  legacyThreeway?: {
    homeWinProbability?: number;
    drawProbability?: number;
    awayWinProbability?: number;
  };
  powerThreeway?: {
    homeWinProbability?: number;
    drawProbability?: number;
    awayWinProbability?: number;
  };
  modelAgreement?: SportsOddsModelAgreement;
}

export interface SportsOddsTopPick {
  side: "away" | "home" | "draw";
  teamName: string;
  edge: number;
  marketOdds: number;
  modelProjection: number;
  /** Win probability for the picked side (used to revalidate ML edge). */
  outcomeWinProbability?: number;
  betType?: "spread" | "moneyline" | "total";
  spreadLine?: number;
  spreadOdds?: number;
  consensusSpread?: number;
  modelMargin?: number;
  consensusLabel?: string;
  strategy?: string;
  reason?: string;
}

export interface SportsOddsMarketLines {
  provider?: string;
  spread?: number;
  awayMoneyline?: number;
  homeMoneyline?: number;
  drawMoneyline?: number;
  overUnder?: number;
}

export interface BookConsensus {
  provider?: string;
  moneyline?: number;
  spread?: number;
  total?: number;
  label: string;
}

export interface SportsOddsGamePrediction {
  eventId: string;
  league: LeagueCode;
  awayTeam: string;
  homeTeam: string;
  model: SportsOddsModelPrediction;
  market?: SportsOddsMarketLines;
  /** Best value side vs the book (from Sports Odds top_pick). */
  topPick?: SportsOddsTopPick;
}

export interface SportsOddsSlate {
  fetchedAt: string;
  date: string;
  games: SportsOddsGamePrediction[];
  errors: string[];
  source: "live" | "cache" | "fixture";
}

interface RemoteSlateGame {
  event_id?: string;
  league?: string;
  matchup?: {
    away?: { name?: string; abbr?: string };
    home?: { name?: string; abbr?: string };
  };
  model?: {
    algorithm?: string;
    blend_mode?: string;
    blend_layers?: number;
    favorite_side?: "away" | "home";
    win_probability?: number;
    away_projection?: number;
    home_projection?: number;
    threeway?: boolean;
    home_win_probability?: number;
    draw_probability?: number;
    away_win_probability?: number;
    draw_projection?: number;
    legacy?: {
      algorithm?: string;
      total_score?: number;
      win_probability?: number;
      favorite_side?: "away" | "home";
    };
    power?: {
      algorithm?: string;
      home_power?: number;
      away_power?: number;
      home_win_probability?: number;
      param?: number;
    };
    basketball_pred?: {
      algorithm?: string;
      source?: string;
      home_win_probability?: number;
      predicted_home_score?: number;
      predicted_away_score?: number;
      predicted_margin?: number;
      param?: number;
    };
    baseball_pred?: {
      algorithm?: string;
      source?: string;
      home_win_probability?: number;
      elo_exp?: number;
      home_pythagorean?: number;
      away_pythagorean?: number;
      form_diff?: number;
      predicted_margin?: number;
      predicted_home_runs?: number;
      predicted_away_runs?: number;
      param?: number;
    };
    soccer_pred?: {
      algorithm?: string;
      source?: string;
      home_win_probability?: number;
      draw_probability?: number;
      away_win_probability?: number;
      expected_home_goals?: number;
      expected_away_goals?: number;
      elo_home?: number;
      elo_away?: number;
      pi_expected_gd?: number;
    };
    legacy_threeway?: {
      home_win_probability?: number;
      draw_probability?: number;
      away_win_probability?: number;
    };
    power_threeway?: {
      home_win_probability?: number;
      draw_probability?: number;
      away_win_probability?: number;
    };
    model_agreement?: {
      required?: number;
      agreed?: boolean;
      legacy_side?: SportsOddsLayerSide;
      power_side?: SportsOddsLayerSide;
      third_side?: SportsOddsLayerSide;
      third_source?: string;
      agreement_mode?: "value";
      value_sides?: SportsOddsLayerSide[];
      value_outcomes?: SportsOddsLayerSide[];
    };
  };
  top_pick?: {
    side?: "away" | "home" | "draw";
    team_name?: string;
    edge?: number;
    market_odds?: number;
    model_projection?: number;
    bet_type?: "spread" | "moneyline" | "total";
    spread_line?: number;
    spread_odds?: number;
    consensus_spread?: number;
    consensus_odds?: number;
    consensus_label?: string;
    model_margin?: number;
    strategy?: string;
    reason?: string;
  };
  market?: {
    provider?: string;
    spread?: number;
    away_moneyline?: number;
    home_moneyline?: number;
    draw_moneyline?: number;
    over_under?: number;
  };
}

interface RemoteSlate {
  generated_at?: string;
  date_label?: string;
  games?: RemoteSlateGame[];
  errors?: Array<{ league?: string; game?: string; error?: string }>;
}

function normalizeKeyTeam(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildSportsOddsGameKey(
  league: LeagueCode,
  awayTeam: string,
  homeTeam: string
): string {
  const away = normalizeKeyTeam(awayTeam);
  const home = normalizeKeyTeam(homeTeam);
  return `${league}:${[away, home].sort().join("|")}`;
}

function coachLeagueFromRemote(league?: string): LeagueCode | null {
  if (!league) return null;
  const key = league.toLowerCase();
  if (SPORTS_ODDS_LEAGUE_TO_COACH[key]) {
    return SPORTS_ODDS_LEAGUE_TO_COACH[key];
  }
  const upper = league.toUpperCase();
  if (SPORTS_ODDS_SUPPORTED_LEAGUES.includes(upper as (typeof SPORTS_ODDS_SUPPORTED_LEAGUES)[number])) {
    return upper as LeagueCode;
  }
  return null;
}

const SPREAD_POINT_TO_EDGE = 20;

const LEAGUE_MARGIN_SCALE: Record<string, number> = {
  nba: 0.14,
  wnba: 0.12,
  cbb: 0.16,
  nfl: 0.22,
  cfb: 0.18,
};

const SOCCER_DRAW_BASE: Record<string, number> = {
  default: 25.0,
  epl: 24.0,
  laliga: 26.5,
  mls: 23.0,
  worldcup: 25.0,
};

const THREE_LAYER_BASKETBALL_LEAGUES = ["NBA", "WNBA", "CBB"] as const;
const THREE_LAYER_BASEBALL_LEAGUES = ["MLB"] as const;

function favoriteSideFromHomeWinProb(homeWinProb: number): SportsOddsLayerSide {
  return homeWinProb >= 50 ? "home" : "away";
}

function homeWinProbToTotalScore(homeWinProb: number): number {
  if (homeWinProb >= 50) return -homeWinProb;
  return 100 - homeWinProb;
}

function layerBinaryTotalScore(layer?: {
  totalScore?: number;
  homeWinProbability?: number;
  winProbability?: number;
  favoriteSide?: "away" | "home";
}): number | undefined {
  if (layer?.totalScore != null) return Number(layer.totalScore);
  if (layer?.homeWinProbability != null) {
    return homeWinProbToTotalScore(Number(layer.homeWinProbability));
  }
  if (layer?.winProbability != null && layer.favoriteSide != null) {
    const prob = Number(layer.winProbability);
    return layer.favoriteSide === "home" ? -prob : prob;
  }
  return undefined;
}

function layerSideWinProbs(totalScore: number): { awayProb: number; homeProb: number } {
  const winProb = Math.abs(totalScore);
  const homeIsFavorite = totalScore <= 0;
  const homeProb = homeIsFavorite ? winProb : 100 - winProb;
  return { awayProb: 100 - homeProb, homeProb };
}

function modelMoneylines(totalScore: number): { awayProj: number; homeProj: number } {
  const { awayProb, homeProb } = layerSideWinProbs(totalScore);
  return {
    awayProj: probabilityToAmerican(awayProb),
    homeProj: probabilityToAmerican(homeProb),
  };
}

function soccerThreewayProbs(
  totalScore: number,
  league: LeagueCode
): { homeProb: number; drawProb: number; awayProb: number } {
  const winProb = Math.abs(totalScore);
  const homeIsFavorite = totalScore <= 0;
  const homeBinary = homeIsFavorite ? winProb : 100 - winProb;
  const awayBinary = 100 - homeBinary;
  const baseDraw =
    SOCCER_DRAW_BASE[league.toLowerCase()] ?? SOCCER_DRAW_BASE.default;
  const closeness = 1 - Math.abs(winProb - 50) / 50;
  const drawProb = Math.min(35, Math.max(18, baseDraw + closeness * 8));
  const scale = (100 - drawProb) / 100;
  return {
    homeProb: homeBinary * scale,
    drawProb,
    awayProb: awayBinary * scale,
  };
}

function soccerModelMoneylines(
  homeProb: number,
  drawProb: number,
  awayProb: number
): { awayProj: number; drawProj: number; homeProj: number } {
  return {
    awayProj: probabilityToAmerican(awayProb),
    drawProj: probabilityToAmerican(drawProb),
    homeProj: probabilityToAmerican(homeProb),
  };
}

function modelHomeMargin(totalScore: number, league: LeagueCode): number {
  const winProb = Math.abs(totalScore);
  const scale = LEAGUE_MARGIN_SCALE[league.toLowerCase()] ?? 0.14;
  const margin = (winProb - 50) * scale;
  return totalScore < 0 ? margin : -margin;
}

function bestValueSideBinary(
  totalScore: number,
  awayMarket?: number,
  homeMarket?: number
): SportsOddsLayerSide | undefined {
  const { awayProb, homeProb } = layerSideWinProbs(totalScore);
  const { awayProj, homeProj } = modelMoneylines(totalScore);
  const edges: Array<[SportsOddsLayerSide, number]> = [];
  if (awayMarket != null) {
    const edge = oddsEdge(awayProj, awayMarket, awayProb);
    if (edge > 0) edges.push(["away", edge]);
  }
  if (homeMarket != null) {
    const edge = oddsEdge(homeProj, homeMarket, homeProb);
    if (edge > 0) edges.push(["home", edge]);
  }
  if (!edges.length) return undefined;
  return edges.reduce((best, current) => (current[1] > best[1] ? current : best))[0];
}

function bestValueOutcomeThreeway(
  homeProb: number,
  drawProb: number,
  awayProb: number,
  awayMarket?: number,
  drawMarket?: number,
  homeMarket?: number
): SportsOddsLayerSide | undefined {
  const { awayProj, drawProj, homeProj } = soccerModelMoneylines(
    homeProb,
    drawProb,
    awayProb
  );
  const edges: Array<[SportsOddsLayerSide, number]> = [];
  if (awayMarket != null) {
    const edge = oddsEdge(awayProj, awayMarket, awayProb);
    if (edge > 0) edges.push(["away", edge]);
  }
  if (drawMarket != null) {
    const edge = oddsEdge(drawProj, drawMarket, drawProb);
    if (edge > 0) edges.push(["draw", edge]);
  }
  if (homeMarket != null) {
    const edge = oddsEdge(homeProj, homeMarket, homeProb);
    if (edge > 0) edges.push(["home", edge]);
  }
  if (!edges.length) return undefined;
  return edges.reduce((best, current) => (current[1] > best[1] ? current : best))[0];
}

function layerHasValueOnSideBinary(
  totalScore: number,
  side: SportsOddsLayerSide,
  awayMarket?: number,
  homeMarket?: number
): boolean {
  const { awayProb, homeProb } = layerSideWinProbs(totalScore);
  const { awayProj, homeProj } = modelMoneylines(totalScore);
  if (side === "away") {
    return awayMarket != null && oddsEdge(awayProj, awayMarket, awayProb) > 0;
  }
  return homeMarket != null && oddsEdge(homeProj, homeMarket, homeProb) > 0;
}

function layerHasValueOnOutcomeThreeway(
  homeProb: number,
  drawProb: number,
  awayProb: number,
  outcome: SportsOddsLayerSide,
  awayMarket?: number,
  drawMarket?: number,
  homeMarket?: number
): boolean {
  const { awayProj, drawProj, homeProj } = soccerModelMoneylines(
    homeProb,
    drawProb,
    awayProb
  );
  if (outcome === "away") {
    return awayMarket != null && oddsEdge(awayProj, awayMarket, awayProb) > 0;
  }
  if (outcome === "draw") {
    return drawMarket != null && oddsEdge(drawProj, drawMarket, drawProb) > 0;
  }
  return homeMarket != null && oddsEdge(homeProj, homeMarket, homeProb) > 0;
}

function layerHasSpreadValueOnSide(
  totalScore: number,
  league: LeagueCode,
  side: SportsOddsLayerSide,
  consensusSpread: number
): boolean {
  const margin = modelHomeMargin(totalScore, league);
  return spreadPointEdge(margin, consensusSpread, side) > 0;
}

function bestValueSpreadSide(
  totalScore: number,
  league: LeagueCode,
  consensusSpread: number
): SportsOddsLayerSide | undefined {
  const margin = modelHomeMargin(totalScore, league);
  const edges: Array<[SportsOddsLayerSide, number]> = [];
  for (const side of ["away", "home"] as const) {
    const pointEdge = spreadPointEdge(margin, consensusSpread, side);
    if (pointEdge > 0) edges.push([side, pointEdge]);
  }
  if (!edges.length) return undefined;
  return edges.reduce((best, current) => (current[1] > best[1] ? current : best))[0];
}

function sportsOddsUsesSpreadBets(league: LeagueCode): boolean {
  return SPORTS_ODDS_SPREAD_LEAGUES.includes(
    league as (typeof SPORTS_ODDS_SPREAD_LEAGUES)[number]
  );
}

function resolveModelAgreement(
  prediction: SportsOddsGamePrediction
): SportsOddsModelAgreement {
  return (
    prediction.model.modelAgreement ??
    computeSportsOddsModelAgreement(
      prediction.model,
      prediction.league,
      prediction.market
    )
  );
}

export function sportsOddsEffectiveMinEdge(
  prediction: SportsOddsGamePrediction
): number {
  const agreement = resolveModelAgreement(prediction);
  if (agreement.required === 3 && agreement.agreed) return 0;
  return sportsOddsForceMinEdge();
}

function meetsSportsOddsEdgeThreshold(
  edge: number,
  prediction: SportsOddsGamePrediction
): boolean {
  const minEdge = sportsOddsEffectiveMinEdge(prediction);
  return minEdge === 0 ? edge > 0 : edge >= minEdge;
}

export function sportsOddsRequiresThreeLayerAgreement(league: LeagueCode): boolean {
  return (
    (THREE_LAYER_BASKETBALL_LEAGUES as readonly string[]).includes(league) ||
    (THREE_LAYER_BASEBALL_LEAGUES as readonly string[]).includes(league) ||
    (SOCCER_SCHEDULE_LEAGUES as readonly string[]).includes(league)
  );
}

function thirdLayerFromModel(
  model: SportsOddsModelPrediction
): { key: string; payload: NonNullable<SportsOddsModelPrediction["basketballPred"]> | NonNullable<SportsOddsModelPrediction["baseballPred"]> | NonNullable<SportsOddsModelPrediction["soccerPred"]> } | undefined {
  if (model.basketballPred) {
    return { key: "basketball_pred", payload: model.basketballPred };
  }
  if (model.baseballPred) {
    return { key: "baseball_pred", payload: model.baseballPred };
  }
  if (model.soccerPred) {
    return { key: "soccer_pred", payload: model.soccerPred };
  }
  return undefined;
}

export function computeSportsOddsModelAgreement(
  model: SportsOddsModelPrediction,
  league: LeagueCode,
  market?: SportsOddsMarketLines,
  _topPickSide?: SportsOddsLayerSide
): SportsOddsModelAgreement {
  if (!sportsOddsRequiresThreeLayerAgreement(league)) {
    return { required: 0, agreed: true, agreementMode: "value" };
  }

  const legacy = model.legacy;
  const power = model.power;
  const third = thirdLayerFromModel(model);
  const isSoccer = (SOCCER_SCHEDULE_LEAGUES as readonly string[]).includes(league);
  const awayMarket = market?.awayMoneyline;
  const homeMarket = market?.homeMoneyline;
  const drawMarket = market?.drawMoneyline;
  const consensusSpread = market?.spread;
  const useSpread =
    sportsOddsUsesSpreadBets(league) && consensusSpread != null;

  const incompletePayload = (): SportsOddsModelAgreement => {
    const legacyTotal = layerBinaryTotalScore(legacy);
    const powerTotal = layerBinaryTotalScore(power);
    const thirdTotal = layerBinaryTotalScore(third?.payload);
    if (useSpread && consensusSpread != null) {
      return {
        required: 3,
        agreed: false,
        legacySide:
          legacyTotal == null
            ? undefined
            : bestValueSpreadSide(legacyTotal, league, consensusSpread),
        powerSide:
          powerTotal == null
            ? undefined
            : bestValueSpreadSide(powerTotal, league, consensusSpread),
        thirdSide:
          thirdTotal == null
            ? undefined
            : bestValueSpreadSide(thirdTotal, league, consensusSpread),
        thirdSource: third?.key,
        agreementMode: "value",
        valueSides: [],
        valueOutcomes: [],
      };
    }
    return {
      required: 3,
      agreed: false,
      legacySide:
        legacyTotal == null
          ? undefined
          : bestValueSideBinary(legacyTotal, awayMarket, homeMarket),
      powerSide:
        powerTotal == null
          ? undefined
          : bestValueSideBinary(powerTotal, awayMarket, homeMarket),
      thirdSide:
        thirdTotal == null
          ? undefined
          : bestValueSideBinary(thirdTotal, awayMarket, homeMarket),
      thirdSource: third?.key,
      agreementMode: "value",
      valueSides: [],
      valueOutcomes: [],
    };
  };

  const hasThreeLayers =
    model.blendLayers === 3 &&
    third != null &&
    (isSoccer
      ? Boolean(model.legacyThreeway && model.powerThreeway)
      : Boolean(legacy && power));

  if (!hasThreeLayers) {
    return incompletePayload();
  }

  if (isSoccer) {
    const legacyTw = model.legacyThreeway;
    const powerTw = model.powerThreeway;
    const soccerPred = model.soccerPred;
    if (!legacyTw || !powerTw || !soccerPred) {
      return incompletePayload();
    }
    const legacyProbs = {
      home: legacyTw.homeWinProbability ?? 0,
      draw: legacyTw.drawProbability ?? 0,
      away: legacyTw.awayWinProbability ?? 0,
    };
    const powerProbs = {
      home: powerTw.homeWinProbability ?? 0,
      draw: powerTw.drawProbability ?? 0,
      away: powerTw.awayWinProbability ?? 0,
    };
    const thirdProbs = {
      home: soccerPred.homeWinProbability ?? 0,
      draw: soccerPred.drawProbability ?? 0,
      away: soccerPred.awayWinProbability ?? 0,
    };
    const valueOutcomes = (["home", "draw", "away"] as const).filter(
      (outcome) =>
        layerHasValueOnOutcomeThreeway(
          legacyProbs.home,
          legacyProbs.draw,
          legacyProbs.away,
          outcome,
          awayMarket,
          drawMarket,
          homeMarket
        ) &&
        layerHasValueOnOutcomeThreeway(
          powerProbs.home,
          powerProbs.draw,
          powerProbs.away,
          outcome,
          awayMarket,
          drawMarket,
          homeMarket
        ) &&
        layerHasValueOnOutcomeThreeway(
          thirdProbs.home,
          thirdProbs.draw,
          thirdProbs.away,
          outcome,
          awayMarket,
          drawMarket,
          homeMarket
        )
    );
    return {
      required: 3,
      agreed: valueOutcomes.length > 0,
      legacySide: bestValueOutcomeThreeway(
        legacyProbs.home,
        legacyProbs.draw,
        legacyProbs.away,
        awayMarket,
        drawMarket,
        homeMarket
      ),
      powerSide: bestValueOutcomeThreeway(
        powerProbs.home,
        powerProbs.draw,
        powerProbs.away,
        awayMarket,
        drawMarket,
        homeMarket
      ),
      thirdSide: bestValueOutcomeThreeway(
        thirdProbs.home,
        thirdProbs.draw,
        thirdProbs.away,
        awayMarket,
        drawMarket,
        homeMarket
      ),
      thirdSource: third.key,
      agreementMode: "value",
      valueOutcomes,
      valueSides: valueOutcomes,
    };
  }

  const legacyTotal = layerBinaryTotalScore(legacy);
  const powerTotal = layerBinaryTotalScore(power);
  const thirdTotal = layerBinaryTotalScore(third.payload);
  if (legacyTotal == null || powerTotal == null || thirdTotal == null) {
    return incompletePayload();
  }

  if (useSpread && consensusSpread != null) {
    const valueSides = (["away", "home"] as const).filter(
      (side) =>
        layerHasSpreadValueOnSide(legacyTotal, league, side, consensusSpread) &&
        layerHasSpreadValueOnSide(powerTotal, league, side, consensusSpread) &&
        layerHasSpreadValueOnSide(thirdTotal, league, side, consensusSpread)
    );
    return {
      required: 3,
      agreed: valueSides.length > 0,
      legacySide: bestValueSpreadSide(legacyTotal, league, consensusSpread),
      powerSide: bestValueSpreadSide(powerTotal, league, consensusSpread),
      thirdSide: bestValueSpreadSide(thirdTotal, league, consensusSpread),
      thirdSource: third.key,
      agreementMode: "value",
      valueSides,
      valueOutcomes: valueSides,
    };
  }

  const valueSides = (["away", "home"] as const).filter(
    (side) =>
      layerHasValueOnSideBinary(legacyTotal, side, awayMarket, homeMarket) &&
      layerHasValueOnSideBinary(powerTotal, side, awayMarket, homeMarket) &&
      layerHasValueOnSideBinary(thirdTotal, side, awayMarket, homeMarket)
  );
  return {
    required: 3,
    agreed: valueSides.length > 0,
    legacySide: bestValueSideBinary(legacyTotal, awayMarket, homeMarket),
    powerSide: bestValueSideBinary(powerTotal, awayMarket, homeMarket),
    thirdSide: bestValueSideBinary(thirdTotal, awayMarket, homeMarket),
    thirdSource: third.key,
    agreementMode: "value",
    valueSides,
    valueOutcomes: valueSides,
  };
}

export function sportsOddsModelLayersAgree(
  prediction: SportsOddsGamePrediction
): boolean {
  const agreement = resolveModelAgreement(prediction);
  if (agreement.required !== 3) return true;
  return agreement.agreed;
}

function spreadPointEdge(
  modelMarginHome: number,
  homeSpread: number,
  side: "away" | "home"
): number {
  if (side === "home") return modelMarginHome + homeSpread;
  return -modelMarginHome - homeSpread;
}

function sideWinProbabilityFromRemote(
  raw: RemoteSlateGame,
  side: "away" | "home" | "draw"
): number | undefined {
  const model = raw.model;
  if (!model) return undefined;

  if (side === "draw") {
    return model.draw_probability == null
      ? undefined
      : Number(model.draw_probability);
  }

  if (model.threeway) {
    if (side === "home") {
      return model.home_win_probability == null
        ? undefined
        : Number(model.home_win_probability);
    }
    if (side === "away") {
      return model.away_win_probability == null
        ? undefined
        : Number(model.away_win_probability);
    }
  }

  const winProb = model.win_probability;
  const favoriteSide = model.favorite_side;
  if (winProb == null || !favoriteSide) return undefined;
  const probability = Number(winProb);
  return side === favoriteSide ? probability : 100 - probability;
}

export function outcomeWinProbabilityForPick(
  prediction: SportsOddsGamePrediction,
  side: "away" | "home" | "draw"
): number | undefined {
  const model = prediction.model;

  if (side === "draw") {
    return model.drawProbability;
  }

  if (model.threeway) {
    if (side === "home") return model.homeWinProbability;
    if (side === "away") return model.awayWinProbability;
  }

  return side === model.favoriteSide
    ? model.winProbability
    : 100 - model.winProbability;
}

function computeMoneylineEdge(
  modelProjection: number,
  marketOdds: number,
  modelProbPct: number
): number {
  return oddsEdge(modelProjection, marketOdds, modelProbPct);
}

function validatedSpreadEdge(raw: RemoteSlateGame): number | undefined {
  const pick = raw.top_pick;
  if (pick?.bet_type !== "spread") return undefined;
  const side = pick.side;
  if (side !== "away" && side !== "home") return undefined;
  const modelMargin = pick.model_margin;
  const consensus = pick.consensus_spread;
  if (modelMargin == null || consensus == null) return undefined;
  const pointEdge = spreadPointEdge(Number(modelMargin), Number(consensus), side);
  if (pointEdge <= 0) return 0;
  return pointEdge * SPREAD_POINT_TO_EDGE;
}

function formatSpreadMargin(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

function spreadPickLabel(pick: SportsOddsTopPick): string {
  const juice =
    pick.spreadOdds != null
      ? pick.spreadOdds > 0
        ? `+${pick.spreadOdds}`
        : `${pick.spreadOdds}`
      : "";
  const line =
    pick.spreadLine != null ? formatSpreadMargin(pick.spreadLine) : "?";
  const margin =
    pick.modelMargin != null
      ? `model margin ${formatSpreadMargin(
          pick.side === "home" ? pick.modelMargin : -pick.modelMargin
        )}`
      : "";
  return `${line}${juice ? ` (${juice})` : ""}${margin ? ` · ${margin}` : ""}`;
}

function buildRemoteModelPayload(raw: RemoteSlateGame): SportsOddsModelPrediction {
  const favoriteSide = raw.model?.favorite_side ?? "home";
  const modelAgreement = raw.model?.model_agreement
    ? {
        required: raw.model.model_agreement.required ?? 3,
        agreed: Boolean(raw.model.model_agreement.agreed),
        legacySide: raw.model.model_agreement.legacy_side,
        powerSide: raw.model.model_agreement.power_side,
        thirdSide: raw.model.model_agreement.third_side,
        thirdSource: raw.model.model_agreement.third_source,
        agreementMode: raw.model.model_agreement.agreement_mode,
        valueSides:
          raw.model.model_agreement.value_sides ??
          raw.model.model_agreement.value_outcomes,
        valueOutcomes:
          raw.model.model_agreement.value_outcomes ??
          raw.model.model_agreement.value_sides,
      }
    : undefined;

  return {
    algorithm: raw.model?.algorithm,
    blendMode: raw.model?.blend_mode,
    blendLayers: raw.model?.blend_layers,
    favoriteSide,
    winProbability: Number(raw.model?.win_probability ?? 0),
    awayProjection: raw.model?.away_projection,
    homeProjection: raw.model?.home_projection,
    threeway: raw.model?.threeway,
    homeWinProbability: raw.model?.home_win_probability,
    drawProbability: raw.model?.draw_probability,
    awayWinProbability: raw.model?.away_win_probability,
    drawProjection: raw.model?.draw_projection,
    legacy: raw.model?.legacy
      ? {
          algorithm: raw.model.legacy.algorithm,
          totalScore: raw.model.legacy.total_score,
          winProbability: raw.model.legacy.win_probability,
          favoriteSide: raw.model.legacy.favorite_side,
        }
      : undefined,
    power: raw.model?.power
      ? {
          algorithm: raw.model.power.algorithm,
          homePower: raw.model.power.home_power,
          awayPower: raw.model.power.away_power,
          homeWinProbability: raw.model.power.home_win_probability,
          param: raw.model.power.param,
        }
      : undefined,
    basketballPred: raw.model?.basketball_pred
      ? {
          algorithm: raw.model.basketball_pred.algorithm,
          source: raw.model.basketball_pred.source,
          homeWinProbability: raw.model.basketball_pred.home_win_probability,
          predictedHomeScore: raw.model.basketball_pred.predicted_home_score,
          predictedAwayScore: raw.model.basketball_pred.predicted_away_score,
          predictedMargin: raw.model.basketball_pred.predicted_margin,
          param: raw.model.basketball_pred.param,
        }
      : undefined,
    baseballPred: raw.model?.baseball_pred
      ? {
          algorithm: raw.model.baseball_pred.algorithm,
          source: raw.model.baseball_pred.source,
          homeWinProbability: raw.model.baseball_pred.home_win_probability,
          eloExp: raw.model.baseball_pred.elo_exp,
          homePythagorean: raw.model.baseball_pred.home_pythagorean,
          awayPythagorean: raw.model.baseball_pred.away_pythagorean,
          formDiff: raw.model.baseball_pred.form_diff,
          predictedMargin: raw.model.baseball_pred.predicted_margin,
          predictedHomeRuns: raw.model.baseball_pred.predicted_home_runs,
          predictedAwayRuns: raw.model.baseball_pred.predicted_away_runs,
          param: raw.model.baseball_pred.param,
        }
      : undefined,
    soccerPred: raw.model?.soccer_pred
      ? {
          algorithm: raw.model.soccer_pred.algorithm,
          source: raw.model.soccer_pred.source,
          homeWinProbability: raw.model.soccer_pred.home_win_probability,
          drawProbability: raw.model.soccer_pred.draw_probability,
          awayWinProbability: raw.model.soccer_pred.away_win_probability,
          expectedHomeGoals: raw.model.soccer_pred.expected_home_goals,
          expectedAwayGoals: raw.model.soccer_pred.expected_away_goals,
          eloHome: raw.model.soccer_pred.elo_home,
          eloAway: raw.model.soccer_pred.elo_away,
          piExpectedGd: raw.model.soccer_pred.pi_expected_gd,
        }
      : undefined,
    legacyThreeway: raw.model?.legacy_threeway
      ? {
          homeWinProbability: raw.model.legacy_threeway.home_win_probability,
          drawProbability: raw.model.legacy_threeway.draw_probability,
          awayWinProbability: raw.model.legacy_threeway.away_win_probability,
        }
      : undefined,
    powerThreeway: raw.model?.power_threeway
      ? {
          homeWinProbability: raw.model.power_threeway.home_win_probability,
          drawProbability: raw.model.power_threeway.draw_probability,
          awayWinProbability: raw.model.power_threeway.away_win_probability,
        }
      : undefined,
    modelAgreement:
      modelAgreement ??
      (coachLeagueFromRemote(raw.league)
        ? computeSportsOddsModelAgreement(
            {
              favoriteSide,
              winProbability: Number(raw.model?.win_probability ?? 0),
              blendLayers: raw.model?.blend_layers,
              legacy: raw.model?.legacy
                ? {
                    favoriteSide: raw.model.legacy.favorite_side,
                    totalScore: raw.model.legacy.total_score,
                    winProbability: raw.model.legacy.win_probability,
                  }
                : undefined,
              power: raw.model?.power
                ? { homeWinProbability: raw.model.power.home_win_probability }
                : undefined,
              basketballPred: raw.model?.basketball_pred
                ? {
                    homeWinProbability:
                      raw.model.basketball_pred.home_win_probability,
                  }
                : undefined,
              baseballPred: raw.model?.baseball_pred
                ? {
                    homeWinProbability:
                      raw.model.baseball_pred.home_win_probability,
                  }
                : undefined,
              soccerPred: raw.model?.soccer_pred
                ? {
                    homeWinProbability:
                      raw.model.soccer_pred.home_win_probability,
                    drawProbability: raw.model.soccer_pred.draw_probability,
                    awayWinProbability:
                      raw.model.soccer_pred.away_win_probability,
                  }
                : undefined,
              legacyThreeway: raw.model?.legacy_threeway,
              powerThreeway: raw.model?.power_threeway,
            },
            coachLeagueFromRemote(raw.league)!,
            raw.market
              ? {
                  awayMoneyline: raw.market.away_moneyline,
                  homeMoneyline: raw.market.home_moneyline,
                  drawMoneyline: raw.market.draw_moneyline,
                  spread:
                    raw.market.spread == null
                      ? undefined
                      : Number(raw.market.spread),
                }
              : undefined
          )
        : undefined),
  };
}

function remoteModelLayersAgree(raw: RemoteSlateGame): boolean {
  const league = coachLeagueFromRemote(raw.league);
  if (!league) return true;
  const awayTeam = raw.matchup?.away?.name ?? "";
  const homeTeam = raw.matchup?.home?.name ?? "";
  const market = raw.market
    ? {
        awayMoneyline: raw.market.away_moneyline,
        homeMoneyline: raw.market.home_moneyline,
        drawMoneyline: raw.market.draw_moneyline,
        spread:
          raw.market.spread == null ? undefined : Number(raw.market.spread),
      }
    : undefined;
  return sportsOddsModelLayersAgree({
    eventId: raw.event_id || "",
    league,
    awayTeam,
    homeTeam,
    model: buildRemoteModelPayload(raw),
    market,
  });
}

function mapRemoteTopPick(raw: RemoteSlateGame): SportsOddsTopPick | undefined {
  const pick = raw.top_pick;
  const side = pick?.side;
  const teamName = pick?.team_name;
  if (!side || !teamName) return undefined;
  if (side !== "away" && side !== "home" && side !== "draw") return undefined;

  const betType = pick?.bet_type;
  const spreadLine =
    pick?.spread_line == null ? undefined : Number(pick.spread_line);
  const spreadOdds =
    pick?.spread_odds == null
      ? pick?.consensus_odds == null
        ? undefined
        : Number(pick.consensus_odds)
      : Number(pick.spread_odds);
  const modelMargin =
    pick?.model_margin == null ? undefined : Number(pick.model_margin);

  const marketOdds = Number(pick?.market_odds ?? spreadOdds ?? 0);
  const modelProjection = Number(pick?.model_projection ?? 0);
  const outcomeWinProbability = sideWinProbabilityFromRemote(raw, side);

  let edge = Number(pick?.edge ?? 0);
  const spreadEdge = validatedSpreadEdge(raw);
  if (spreadEdge != null) {
    edge = spreadEdge;
  } else if (
    betType !== "spread" &&
    marketOdds !== 0 &&
    modelProjection !== 0 &&
    outcomeWinProbability != null
  ) {
    edge = computeMoneylineEdge(
      modelProjection,
      marketOdds,
      outcomeWinProbability
    );
  }
  const league = coachLeagueFromRemote(raw.league);
  const remotePrediction: SportsOddsGamePrediction | undefined =
    league != null
      ? {
          eventId: raw.event_id || "",
          league,
          awayTeam: raw.matchup?.away?.name ?? "",
          homeTeam: raw.matchup?.home?.name ?? "",
          model: buildRemoteModelPayload(raw),
          market: raw.market
            ? {
                awayMoneyline: raw.market.away_moneyline,
                homeMoneyline: raw.market.home_moneyline,
                drawMoneyline: raw.market.draw_moneyline,
                spread:
                  raw.market.spread == null
                    ? undefined
                    : Number(raw.market.spread),
              }
            : undefined,
        }
      : undefined;
  if (
    remotePrediction &&
    !meetsSportsOddsEdgeThreshold(edge, remotePrediction)
  ) {
    return undefined;
  }
  if (!remoteModelLayersAgree(raw)) return undefined;

  return {
    side,
    teamName,
    edge,
    marketOdds,
    modelProjection,
    outcomeWinProbability,
    betType,
    spreadLine,
    spreadOdds,
    consensusSpread:
      pick?.consensus_spread == null
        ? undefined
        : Number(pick.consensus_spread),
    modelMargin,
    consensusLabel: pick?.consensus_label,
    strategy: pick?.strategy,
    reason: pick?.reason,
  };
}

export function mapRemoteSlateGame(
  raw: RemoteSlateGame
): SportsOddsGamePrediction | null {
  const game = mapRemoteGame(raw);
  return game ? revalidateGamePrediction(game) : null;
}

function mapRemoteGame(raw: RemoteSlateGame): SportsOddsGamePrediction | null {
  const league = coachLeagueFromRemote(raw.league);
  const awayTeam = raw.matchup?.away?.name;
  const homeTeam = raw.matchup?.home?.name;
  const favoriteSide = raw.model?.favorite_side;
  if (!league || !awayTeam || !homeTeam || !favoriteSide) return null;

  return {
    eventId: raw.event_id || "",
    league,
    awayTeam,
    homeTeam,
    model: buildRemoteModelPayload(raw),
    topPick: mapRemoteTopPick(raw),
    market: raw.market
      ? {
          provider: raw.market.provider ?? undefined,
          spread:
            raw.market.spread == null ? undefined : Number(raw.market.spread),
          awayMoneyline: raw.market.away_moneyline,
          homeMoneyline: raw.market.home_moneyline,
          drawMoneyline: raw.market.draw_moneyline,
          overUnder:
            raw.market.over_under == null
              ? undefined
              : Number(raw.market.over_under),
        }
      : undefined,
  };
}

export function formatAmericanOdds(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

export function sportsOddsConsensusForBet(
  bet: ParsedBet,
  game: CalendarGame,
  prediction: SportsOddsGamePrediction
): BookConsensus | undefined {
  const market = prediction.market;
  if (!market) return undefined;

  const side = teamSideForBet(bet, game);
  if (!side) return undefined;

  const provider = market.provider?.trim() || "Consensus";
  const moneyline =
    side === "home"
      ? market.homeMoneyline
      : side === "away"
        ? market.awayMoneyline
        : market.drawMoneyline;

  if (bet.betType === "spread") {
    const homeSpread =
      prediction.topPick?.consensusSpread ?? market.spread ?? undefined;
    if (homeSpread == null) return undefined;

    const line =
      bet.spread != null && Number.isFinite(bet.spread)
        ? bet.spread
        : sportsOddsSpreadLineForSide(homeSpread, side);
    const juice =
      bet.odds ??
      prediction.topPick?.spreadOdds ??
      prediction.topPick?.marketOdds ??
      DEFAULT_JUICE;
    const label =
      prediction.topPick?.consensusLabel ??
      `${formatAmericanOdds(line)} (${formatAmericanOdds(juice)})`;
    return {
      provider,
      moneyline,
      spread: line,
      label,
    };
  }

  if (
    bet.betType === "total" &&
    market.overUnder != null &&
    bet.totalLine != null
  ) {
    const direction = bet.totalDirection === "over" ? "Over" : "Under";
    const juice = bet.odds ?? DEFAULT_JUICE;
    return {
      provider,
      total: market.overUnder,
      label: `${direction} ${bet.totalLine} (${formatAmericanOdds(juice)}) · O/U ${market.overUnder}`,
    };
  }

  const bookMl =
    moneyline ??
    (prediction.topPick?.side === side ? prediction.topPick.marketOdds : undefined) ??
    bet.odds;

  if (bookMl == null || !Number.isFinite(bookMl)) return undefined;

  return {
    provider,
    moneyline: bookMl,
    label: formatAmericanOdds(bookMl),
  };
}

export function sportsOddsUsesSpread(league: LeagueCode): boolean {
  return SPORTS_ODDS_SPREAD_LEAGUES.includes(
    league as (typeof SPORTS_ODDS_SPREAD_LEAGUES)[number]
  );
}

export function sportsOddsSpreadLineForSide(
  homeSpread: number,
  side: "away" | "home"
): number {
  return side === "home" ? homeSpread : -homeSpread;
}

export function buildSportsOddsSpreadBet(
  side: "away" | "home",
  game: CalendarGame,
  homeSpread: number,
  spreadOdds?: number,
  spreadLine?: number
): ParsedBet {
  const team =
    side === "home"
      ? game.homeAbbr || game.homeTeam
      : game.awayAbbr || game.awayTeam;
  const spread =
    spreadLine != null && Number.isFinite(spreadLine)
      ? spreadLine
      : sportsOddsSpreadLineForSide(homeSpread, side);
  const bet: ParsedBet = {
    betType: "spread",
    team,
    rawText: `${team} ${spread}`,
    spread,
    odds: spreadOdds,
    displayText: "",
  };
  bet.displayText = resolveBetDisplay(bet);
  return bet;
}

function buildSportsOddsMoneylineBet(
  side: "away" | "home",
  game: CalendarGame
): ParsedBet {
  const team =
    side === "home"
      ? game.homeAbbr || game.homeTeam
      : game.awayAbbr || game.awayTeam;
  return {
    betType: "moneyline",
    team,
    rawText: team,
    displayText: team,
  };
}

function buildSportsOddsSideBet(
  side: "away" | "home" | "draw",
  game: CalendarGame,
  prediction: SportsOddsGamePrediction
): ParsedBet {
  if (side === "draw") {
    return {
      betType: "moneyline",
      team: "Draw",
      rawText: "Draw",
      displayText: "Draw",
    };
  }

  const pick = prediction.topPick;
  if (pick?.betType === "spread" && pick.consensusSpread != null) {
    return buildSportsOddsSpreadBet(
      side,
      game,
      pick.consensusSpread,
      pick.spreadOdds,
      pick.spreadLine
    );
  }

  const homeSpread = prediction.market?.spread;
  if (
    sportsOddsUsesSpread(prediction.league) &&
    homeSpread != null &&
    Number.isFinite(homeSpread)
  ) {
    return buildSportsOddsSpreadBet(side, game, homeSpread);
  }
  return buildSportsOddsMoneylineBet(side, game);
}

function cachePathForDate(displayDate: string): string {
  return path.join(CACHE_DIR, `sports-odds-${displayDate}.json`);
}

function slateUrl(): string {
  const base = SPORTS_ODDS_BASE_URL.replace(/\/$/, "");
  if (base.includes("github.io")) {
    return `${base}/api/daily-slate.json`;
  }
  return `${base}/api/daily/slate`;
}

export function matchPredictionToCalendarGame(
  game: CalendarGame,
  predictions: SportsOddsGamePrediction[]
): SportsOddsGamePrediction | undefined {
  const key = buildSportsOddsGameKey(game.league, game.awayTeam, game.homeTeam);
  return predictions.find(
    (prediction) =>
      buildSportsOddsGameKey(
        prediction.league,
        prediction.awayTeam,
        prediction.homeTeam
      ) === key
  );
}

export function canonicalEventKeyForGame(game: CalendarGame): string {
  return buildSportsOddsGameKey(game.league, game.awayTeam, game.homeTeam);
}

export function teamSideForBet(
  ourBet: ParsedBet,
  game: CalendarGame
): "away" | "home" | "draw" | null {
  if (ourBet.betType === "total") return null;

  const candidates = new Set<string>();
  if (ourBet.team) candidates.add(ourBet.team);
  if (ourBet.displayText) candidates.add(ourBet.displayText);
  if (ourBet.rawText) candidates.add(ourBet.rawText);

  for (const text of candidates) {
    const normalized = normalizeKeyTeam(text);
    if (normalized === "draw" || normalized === "tie") {
      return "draw";
    }
  }

  for (const text of candidates) {
    const parsed = parsePickBet(text);
    const team = parsed?.team ?? text;
    const resolved = resolveGameTeamDisplay(team, game);
    if (!resolved) continue;
    if (normalizeKeyTeam(resolved) === normalizeKeyTeam(game.awayTeam)) {
      return "away";
    }
    if (normalizeKeyTeam(resolved) === normalizeKeyTeam(game.homeTeam)) {
      return "home";
    }
  }

  return null;
}

function sportsOddsAgreementSide(
  prediction: SportsOddsGamePrediction,
  game: CalendarGame
): "away" | "home" | "draw" {
  const pickSide = prediction.topPick?.side;
  if (pickSide === "away" || pickSide === "home" || pickSide === "draw") {
    return pickSide;
  }
  const agreement = resolveModelAgreement(prediction);
  const valueSide =
    agreement.valueSides?.[0] ?? agreement.valueOutcomes?.[0];
  if (agreement.agreed && valueSide) {
    return valueSide;
  }
  if (sportsOddsUsesSpread(game.league) && prediction.topPick?.side) {
    return prediction.topPick.side;
  }
  return prediction.model.favoriteSide;
}

export function sportsOddsAgreesWithBet(
  ourBet: ParsedBet | undefined,
  game: CalendarGame | undefined,
  prediction: SportsOddsGamePrediction | undefined
): boolean {
  if (!ourBet || !game || !prediction) return false;
  const side = teamSideForBet(ourBet, game);
  if (!side) return false;
  if (side === "draw") {
    return prediction.topPick?.side === "draw";
  }
  if (prediction.topPick?.side === "draw") {
    return false;
  }
  return side === sportsOddsAgreementSide(prediction, game);
}

export function sportsOddsAppliesToLeague(league: LeagueCode): boolean {
  return SPORTS_ODDS_SUPPORTED_LEAGUES.includes(
    league as (typeof SPORTS_ODDS_SUPPORTED_LEAGUES)[number]
  );
}

export function sportsOddsStatusForBet(
  ourBet: ParsedBet | undefined,
  game: CalendarGame | undefined,
  prediction: SportsOddsGamePrediction | undefined
): SportsOddsAgreementStatus {
  if (!isSportsOddsEnabled() || !game) return "unavailable";
  if (!sportsOddsAppliesToLeague(game.league)) return "unavailable";
  if (!ourBet) return "unavailable";

  if (ourBet.betType === "total") {
    return "unavailable";
  }

  if (!prediction) return "unavailable";
  return sportsOddsAgreesWithBet(ourBet, game, prediction) ? "agrees" : "disagrees";
}

export function sportsOddsBreakdownDetail(
  status: SportsOddsAgreementStatus,
  prediction?: SportsOddsGamePrediction,
  bet?: ParsedBet,
  game?: CalendarGame
): string {
  if (!isSportsOddsEnabled()) return "Sports Odds: filter disabled";
  if (!game || !sportsOddsAppliesToLeague(game.league)) {
    return "Sports Odds: not required for this league";
  }
  if (bet?.betType === "total") {
    return "Sports Odds: totals unsupported — dual algo cannot confirm (no bet)";
  }
  if (status === "unavailable") {
    return "Sports Odds: prediction unavailable — dual algo requires agreement (no bet)";
  }

  const agreement = prediction ? resolveModelAgreement(prediction) : undefined;
  const valueSide =
    prediction && game
      ? sportsOddsAgreementSide(prediction, game)
      : prediction?.model.favoriteSide;
  const valueTeam =
    valueSide === "home"
      ? prediction?.homeTeam
      : valueSide === "away"
        ? prediction?.awayTeam
        : valueSide === "draw"
          ? "Draw"
          : undefined;
  const favorite =
    prediction?.model.favoriteSide === "home"
      ? prediction.homeTeam
      : prediction?.awayTeam;
  const probability = prediction?.model.winProbability?.toFixed(1) ?? "?";
  const pickEdge = prediction?.topPick
    ? effectiveTopPickEdge(prediction.topPick, prediction)
    : undefined;

  if (status === "agrees") {
    if (agreement?.required === 3 && agreement.agreed && valueTeam) {
      const edgeNote =
        pickEdge != null && pickEdge > 0
          ? ` (+${pickEdge.toFixed(0)} edge)`
          : "";
      return `Sports Odds: agrees — all 3 layers find value on ${valueTeam}${edgeNote}`;
    }
    return `Sports Odds: agrees — favors ${favorite} (${probability}% win chance)`;
  }
  if (agreement?.required === 3 && valueTeam && valueTeam !== favorite) {
    return `Sports Odds: disagrees — model value is on ${valueTeam}, not your pick`;
  }
  return `Sports Odds: disagrees — model favors ${favorite} (${probability}% win chance)`;
}

export function sportsOddsTrendLabel(prediction: SportsOddsGamePrediction): string {
  const favorite =
    prediction.model.favoriteSide === "home"
      ? prediction.homeTeam
      : prediction.awayTeam;
  const layers = prediction.model.blendLayers;
  const modelTag =
    prediction.model.algorithm === "Unified"
      ? layers === 3
        ? "Unified 3-layer"
        : "Unified"
      : "Sports Odds";
  return `${modelTag}: ${favorite} (${prediction.model.winProbability.toFixed(1)}%)`;
}

export function sportsOddsFavoriteTeamName(
  prediction: SportsOddsGamePrediction
): string {
  return prediction.model.favoriteSide === "home"
    ? prediction.homeTeam
    : prediction.awayTeam;
}

export function sportsOddsFavoriteBet(
  prediction: SportsOddsGamePrediction,
  game: CalendarGame
): ParsedBet {
  return buildSportsOddsSideBet(prediction.model.favoriteSide, game, prediction);
}

export function sportsOddsValueBet(
  prediction: SportsOddsGamePrediction,
  game: CalendarGame
): ParsedBet {
  const side = prediction.topPick?.side ?? prediction.model.favoriteSide;
  return buildSportsOddsSideBet(side, game, prediction);
}

export function sportsOddsPreferredBetForCoach(
  coachBet: ParsedBet,
  game: CalendarGame,
  prediction: SportsOddsGamePrediction
): ParsedBet {
  if (!sportsOddsUsesSpread(game.league) || coachBet.betType === "spread") {
    return coachBet;
  }
  if (coachBet.betType === "total") return coachBet;

  const side = teamSideForBet(coachBet, game);
  const pick = prediction.topPick;
  const homeSpread = pick?.consensusSpread ?? prediction.market?.spread;
  if (side == null || homeSpread == null || !Number.isFinite(homeSpread)) {
    return coachBet;
  }
  return buildSportsOddsSpreadBet(
    side,
    game,
    homeSpread,
    pick?.spreadOdds,
    pick?.spreadLine
  );
}

export function sportsOddsValueTrendLabel(
  prediction: SportsOddsGamePrediction
): string {
  const pick = prediction.topPick;
  if (!pick) return sportsOddsTrendLabel(prediction);

  const edge = effectiveTopPickEdge(pick, prediction);

  if (pick.betType === "spread") {
    return `${pick.teamName} (+${edge.toFixed(0)} spread edge, ${spreadPickLabel(pick)})`;
  }

  const odds =
    pick.marketOdds > 0 ? `+${pick.marketOdds}` : `${pick.marketOdds}`;
  const model =
    pick.modelProjection > 0
      ? `+${pick.modelProjection}`
      : `${pick.modelProjection}`;
  return `${pick.teamName} (+${edge.toFixed(0)} edge, book ${odds} vs model ${model})`;
}

export function sportsOddsForceConfidence(
  prediction: SportsOddsGamePrediction
): number {
  const pick = prediction.topPick;
  const edge = pick ? effectiveTopPickEdge(pick, prediction) : 0;
  return Math.min(92, Math.round(75 + edge / 10));
}

export function effectiveTopPickEdge(
  pick: SportsOddsTopPick,
  prediction?: SportsOddsGamePrediction
): number {
  if (
    pick.betType === "spread" &&
    pick.consensusSpread != null &&
    pick.modelMargin != null &&
    (pick.side === "away" || pick.side === "home")
  ) {
    const pointEdge = spreadPointEdge(
      pick.modelMargin,
      pick.consensusSpread,
      pick.side
    );
    if (pointEdge <= 0) return 0;
    return pointEdge * SPREAD_POINT_TO_EDGE;
  }

  const { modelProjection, marketOdds } = pick;
  if (!modelProjection || !marketOdds) return pick.edge;

  const outcomeProb =
    pick.outcomeWinProbability ??
    (prediction
      ? outcomeWinProbabilityForPick(prediction, pick.side)
      : undefined);
  if (outcomeProb == null) return pick.edge;

  return computeMoneylineEdge(modelProjection, marketOdds, outcomeProb);
}

function revalidateGamePrediction(
  game: SportsOddsGamePrediction
): SportsOddsGamePrediction {
  const pick = game.topPick;
  if (!pick) return game;

  const outcomeWinProbability =
    pick.outcomeWinProbability ??
    outcomeWinProbabilityForPick(game, pick.side);
  const edge = effectiveTopPickEdge(
    { ...pick, outcomeWinProbability },
    game
  );

  if (!meetsSportsOddsEdgeThreshold(edge, game) || !sportsOddsModelLayersAgree(game)) {
    return { ...game, topPick: undefined };
  }

  if (edge === pick.edge && outcomeWinProbability === pick.outcomeWinProbability) {
    return game;
  }

  return {
    ...game,
    topPick: {
      ...pick,
      edge,
      outcomeWinProbability,
    },
  };
}

export function isSportsOddsForcePick(
  prediction: SportsOddsGamePrediction | undefined
): boolean {
  if (!prediction || !isSportsOddsEnabled()) return false;
  if (!sportsOddsModelLayersAgree(prediction)) return false;
  const pick = prediction.topPick;
  if (!pick) return false;
  return meetsSportsOddsEdgeThreshold(
    effectiveTopPickEdge(pick, prediction),
    prediction
  );
}

export function sportsOddsForceBreakdownDetail(
  prediction: SportsOddsGamePrediction
): string {
  const threshold = sportsOddsEffectiveMinEdge(prediction);
  const agreement = resolveModelAgreement(prediction);
  const pick = prediction.topPick;
  if (!pick) {
    return `Sports Odds: force pick unavailable — no book edge data`;
  }
  const edge = effectiveTopPickEdge(pick, prediction);
  const thresholdNote =
    threshold === 0 && agreement.required === 3 && agreement.agreed
      ? "3-layer value agreement"
      : `+${threshold} edge threshold`;

  if (pick.betType === "spread") {
    return `Sports Odds: force pick — ${pick.teamName} +${edge.toFixed(0)} spread edge (${spreadPickLabel(pick)}) via ${thresholdNote}`;
  }

  const odds =
    pick.marketOdds > 0 ? `+${pick.marketOdds}` : `${pick.marketOdds}`;
  const model =
    pick.modelProjection > 0
      ? `+${pick.modelProjection}`
      : `${pick.modelProjection}`;
  return `Sports Odds: force pick — ${pick.teamName} +${edge.toFixed(0)} edge (book ${odds} vs model ${model}) via ${thresholdNote}`;
}

export async function fetchSportsOddsSlate(
  displayDate: string
): Promise<SportsOddsSlate> {
  const cachePath = cachePathForDate(displayDate);

  if (!isSportsOddsEnabled()) {
    return {
      fetchedAt: new Date().toISOString(),
      date: displayDate,
      games: [],
      errors: ["Sports Odds filter disabled"],
      source: "cache",
    };
  }

  try {
    const response = await fetch(slateUrl(), {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Sports Odds API ${response.status}`);
    }
    const payload = (await response.json()) as RemoteSlate;
    const games = (payload.games || [])
      .map(mapRemoteGame)
      .filter((game): game is SportsOddsGamePrediction => game != null);

    const slate: SportsOddsSlate = {
      fetchedAt: payload.generated_at || new Date().toISOString(),
      date: payload.date_label || displayDate,
      games: games.map(revalidateGamePrediction),
      errors: (payload.errors || []).map(
        (entry) => `${entry.league || "?"} ${entry.game || ""}: ${entry.error || "error"}`.trim()
      ),
      source: "live",
    };

    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(slate, null, 2));
    return slate;
  } catch (error) {
    try {
      const cached = JSON.parse(await fs.readFile(cachePath, "utf8")) as SportsOddsSlate;
      return {
        ...cached,
        games: cached.games.map(revalidateGamePrediction),
        source: "cache",
      };
    } catch {
      const message = error instanceof Error ? error.message : String(error);
      return {
        fetchedAt: new Date().toISOString(),
        date: displayDate,
        games: [],
        errors: [message],
        source: "live",
      };
    }
  }
}
