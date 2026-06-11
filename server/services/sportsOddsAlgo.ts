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
  SPORTS_ODDS_SUPPORTED_LEAGUES,
  isSportsOddsEnabled,
} from "../config.js";
import type { CalendarGame, LeagueCode, ParsedBet } from "../types.js";
import { resolveGameTeamDisplay } from "./calendar.js";

export type SportsOddsAgreementStatus = "agrees" | "disagrees" | "unavailable";

export interface SportsOddsModelPrediction {
  favoriteSide: "away" | "home";
  winProbability: number;
  awayProjection?: number;
  homeProjection?: number;
}

export interface SportsOddsGamePrediction {
  eventId: string;
  league: LeagueCode;
  awayTeam: string;
  homeTeam: string;
  model: SportsOddsModelPrediction;
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
  const upper = league.toUpperCase();
  if (SPORTS_ODDS_SUPPORTED_LEAGUES.includes(upper as (typeof SPORTS_ODDS_SUPPORTED_LEAGUES)[number])) {
    return upper as LeagueCode;
  }
  return null;
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
    },
  };
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

function recommendedSideForBet(
  ourBet: ParsedBet,
  game: CalendarGame
): "away" | "home" | null {
  if (ourBet.betType === "total") return null;
  const team = ourBet.team ?? ourBet.displayText;
  const resolved = resolveGameTeamDisplay(team, game);
  if (!resolved) return null;
  if (normalizeKeyTeam(resolved) === normalizeKeyTeam(game.awayTeam)) return "away";
  if (normalizeKeyTeam(resolved) === normalizeKeyTeam(game.homeTeam)) return "home";
  return null;
}

export function sportsOddsAgreesWithBet(
  ourBet: ParsedBet | undefined,
  game: CalendarGame | undefined,
  prediction: SportsOddsGamePrediction | undefined
): boolean {
  if (!ourBet || !game || !prediction) return false;
  const side = recommendedSideForBet(ourBet, game);
  if (!side) return false;
  return side === prediction.model.favoriteSide;
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
