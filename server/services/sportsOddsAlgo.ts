/**
 * Sports Odds Algorithms integration (James Quintero Algo V2).
 * Requires agreement between the coach rules engine and the odds model
 * before a bet is recommended on MLB / NBA / NHL.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  CACHE_DIR,
  SPORTS_ODDS_BASE_URL,
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
import { resolveGameTeamDisplay } from "./calendar.js";

export type SportsOddsAgreementStatus = "agrees" | "disagrees" | "unavailable";

export interface SportsOddsModelPrediction {
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
}

export interface SportsOddsTopPick {
  side: "away" | "home" | "draw";
  teamName: string;
  edge: number;
  marketOdds: number;
  modelProjection: number;
  betType?: "spread" | "moneyline" | "total";
  spreadLine?: number;
  spreadOdds?: number;
  consensusSpread?: number;
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
    favorite_side?: "away" | "home";
    win_probability?: number;
    away_projection?: number;
    home_projection?: number;
    threeway?: boolean;
    home_win_probability?: number;
    draw_probability?: number;
    away_win_probability?: number;
    draw_projection?: number;
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

const REMOTE_LEAGUE_TO_COACH: Record<string, LeagueCode> = {
  mlb: "MLB",
  nba: "NBA",
  nhl: "NHL",
  nfl: "NFL",
  wnba: "WNBA",
  cbb: "CBB",
  cfb: "CFB",
};

function coachLeagueFromRemote(league?: string): LeagueCode | null {
  if (!league) return null;
  const key = league.toLowerCase();
  if (REMOTE_LEAGUE_TO_COACH[key]) {
    return REMOTE_LEAGUE_TO_COACH[key];
  }
  const upper = league.toUpperCase();
  if (SPORTS_ODDS_SUPPORTED_LEAGUES.includes(upper as (typeof SPORTS_ODDS_SUPPORTED_LEAGUES)[number])) {
    return upper as LeagueCode;
  }
  return null;
}

function mapRemoteTopPick(raw: RemoteSlateGame): SportsOddsTopPick | undefined {
  const pick = raw.top_pick;
  const side = pick?.side;
  const teamName = pick?.team_name;
  const edge = Number(pick?.edge ?? 0);
  if (!side || !teamName || edge < sportsOddsForceMinEdge()) return undefined;
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

  return {
    side,
    teamName,
    edge,
    marketOdds: Number(pick?.market_odds ?? spreadOdds ?? 0),
    modelProjection: Number(pick?.model_projection ?? 0),
    betType,
    spreadLine,
    spreadOdds,
    consensusSpread:
      pick?.consensus_spread == null
        ? undefined
        : Number(pick.consensus_spread),
    consensusLabel: pick?.consensus_label,
    strategy: pick?.strategy,
    reason: pick?.reason,
  };
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
    model: {
      favoriteSide,
      winProbability: Number(raw.model?.win_probability ?? 0),
      awayProjection: raw.model?.away_projection,
      homeProjection: raw.model?.home_projection,
      threeway: raw.model?.threeway,
      homeWinProbability: raw.model?.home_win_probability,
      drawProbability: raw.model?.draw_probability,
      awayWinProbability: raw.model?.away_win_probability,
      drawProjection: raw.model?.draw_projection,
    },
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
  if (prediction.topPick?.side === "draw") {
    return "draw";
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

  const favorite =
    prediction?.model.favoriteSide === "home"
      ? prediction.homeTeam
      : prediction?.awayTeam;
  const probability = prediction?.model.winProbability?.toFixed(1) ?? "?";

  if (status === "agrees") {
    return `Sports Odds: agrees — favors ${favorite} (${probability}% win chance)`;
  }
  return `Sports Odds: disagrees — model favors ${favorite} (${probability}% win chance)`;
}

export function sportsOddsTrendLabel(prediction: SportsOddsGamePrediction): string {
  const favorite =
    prediction.model.favoriteSide === "home"
      ? prediction.homeTeam
      : prediction.awayTeam;
  return `${favorite} (${prediction.model.winProbability.toFixed(1)}%)`;
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

  const odds =
    pick.marketOdds > 0 ? `+${pick.marketOdds}` : `${pick.marketOdds}`;
  const model =
    pick.modelProjection > 0
      ? `+${pick.modelProjection}`
      : `${pick.modelProjection}`;
  return `${pick.teamName} (+${pick.edge.toFixed(0)} edge, book ${odds} vs model ${model})`;
}

export function sportsOddsForceConfidence(
  prediction: SportsOddsGamePrediction
): number {
  const edge = prediction.topPick?.edge ?? 0;
  return Math.min(92, Math.round(75 + edge / 10));
}

export function isSportsOddsForcePick(
  prediction: SportsOddsGamePrediction | undefined
): boolean {
  if (!prediction || !isSportsOddsEnabled()) return false;
  const edge = prediction.topPick?.edge ?? 0;
  return edge >= sportsOddsForceMinEdge();
}

export function sportsOddsForceBreakdownDetail(
  prediction: SportsOddsGamePrediction
): string {
  const threshold = sportsOddsForceMinEdge();
  const pick = prediction.topPick;
  if (!pick) {
    return `Sports Odds: force pick unavailable — no book edge data`;
  }
  const odds =
    pick.marketOdds > 0 ? `+${pick.marketOdds}` : `${pick.marketOdds}`;
  const model =
    pick.modelProjection > 0
      ? `+${pick.modelProjection}`
      : `${pick.modelProjection}`;
  return `Sports Odds: force pick — ${pick.teamName} +${pick.edge.toFixed(0)} edge (book ${odds} vs model ${model}) exceeds +${threshold} threshold`;
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
      games,
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
      return { ...cached, source: "cache" };
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
