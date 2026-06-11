/**
 * DRatings Bet Trends integration (HTML scrape).
 *
 * Bet Trends bars live on each game's detail page under "Bet Trends" — horizontal
 * bars showing DRatings' analytic edge % per side (money line: away/home; totals: over/under).
 * There is no public JSON API; we cache parsed results aggressively.
 *
 * Maintenance: DRatings HTML/CSS changes can break parsers — see server/scripts/probe-dratings*.mjs.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  CACHE_DIR,
  DRATINGS_BASE,
  DRATINGS_LEAGUE_PATHS,
  DRATINGS_USER_AGENT,
  isDratingsEnabled,
} from "../config.js";
import type { CalendarGame, LeagueCode, ParsedBet } from "../types.js";
import { pickTeamInGame, resolveGameTeamDisplay } from "./calendar.js";

export type DratingsTrendSide = "away" | "home" | "over" | "under" | "none";

export type DratingsAgreementStatus = "agrees" | "disagrees" | "unavailable";

export interface DratingsSideTrend {
  awayPct: number;
  homePct: number;
  trendSide: "away" | "home" | "none";
  trendLabel: string;
  confidence: number;
}

export interface DratingsTotalTrend {
  overPct: number;
  underPct: number;
  trendSide: "over" | "under" | "none";
  trendLabel: string;
  confidence: number;
}

export interface DratingsGameTrend {
  gameKey: string;
  league: LeagueCode;
  awayTeam: string;
  homeTeam: string;
  detailUrl?: string;
  moneyLine: DratingsSideTrend;
  total: DratingsTotalTrend;
}

export interface DratingsCacheFile {
  fetchedAt: string;
  date: string;
  trends: DratingsGameTrend[];
  errors: string[];
  source: "live" | "cache" | "fixture";
}

const FETCH_DELAY_MS = 350;
const DETAIL_CONCURRENCY = 3;

function normalizeKeyTeam(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildDratingsGameKey(
  league: LeagueCode,
  awayTeam: string,
  homeTeam: string
): string {
  const away = normalizeKeyTeam(awayTeam);
  const home = normalizeKeyTeam(homeTeam);
  return `${league}:${[away, home].sort().join("|")}`;
}

function cachePathForDate(displayDate: string): string {
  return path.join(CACHE_DIR, `dratings-${displayDate}.json`);
}

function extractBar(html: string, elementId: string): { pct: number; label: string } {
  const marker = `id="${elementId}"`;
  const idx = html.indexOf(marker);
  if (idx < 0) return { pct: 0, label: "" };

  const chunk = html.slice(idx, idx + 500);
  const pct = parseFloat(chunk.match(/width:\s*([\d.]+)%/)?.[1] ?? "0");
  const label = chunk.match(/class="srt">([^<]+)/)?.[1]?.trim() ?? "";
  return { pct: Number.isFinite(pct) ? pct : 0, label };
}

function resolveSideTrend(
  away: { pct: number; label: string },
  home: { pct: number; label: string },
  awayTeam: string,
  homeTeam: string
): DratingsSideTrend {
  let trendSide: "away" | "home" | "none" = "none";
  if (away.pct > home.pct) trendSide = "away";
  else if (home.pct > away.pct) trendSide = "home";

  const favoredTeam = trendSide === "away" ? awayTeam : trendSide === "home" ? homeTeam : "";
  const favoredPct = trendSide === "away" ? away.pct : trendSide === "home" ? home.pct : 0;
  const otherPct = trendSide === "away" ? home.pct : trendSide === "home" ? away.pct : 0;

  const trendLabel =
    trendSide === "none"
      ? "No clear ML trend"
      : `${favoredTeam} (${favoredPct.toFixed(1)}% vs ${otherPct.toFixed(1)}%)`;

  return {
    awayPct: away.pct,
    homePct: home.pct,
    trendSide,
    trendLabel,
    confidence: favoredPct,
  };
}

function resolveTotalTrend(
  over: { pct: number; label: string },
  under: { pct: number; label: string }
): DratingsTotalTrend {
  let trendSide: "over" | "under" | "none" = "none";
  if (over.pct > under.pct) trendSide = "over";
  else if (under.pct > over.pct) trendSide = "under";

  const favoredPct = trendSide === "over" ? over.pct : trendSide === "under" ? under.pct : 0;
  const otherPct = trendSide === "over" ? under.pct : trendSide === "under" ? over.pct : 0;

  const trendLabel =
    trendSide === "none"
      ? "No clear O/U trend"
      : `${trendSide === "over" ? "Over" : "Under"} (${favoredPct.toFixed(1)}% vs ${otherPct.toFixed(1)}%)`;

  return {
    overPct: over.pct,
    underPct: under.pct,
    trendSide,
    trendLabel,
    confidence: favoredPct,
  };
}

export function parseDratingsDetailPage(
  html: string,
  meta: { league: LeagueCode; awayTeam: string; homeTeam: string; detailUrl?: string }
): DratingsGameTrend {
  const awayMl = extractBar(html, "scroll-money-line-bet-trends");
  const homeMl = extractBar(html, "home-money-line-bet-trends");
  const overOu = extractBar(html, "scroll-ou-bet-trends");
  const underOu = extractBar(html, "under-ou-bet-trends");

  return {
    gameKey: buildDratingsGameKey(meta.league, meta.awayTeam, meta.homeTeam),
    league: meta.league,
    awayTeam: meta.awayTeam,
    homeTeam: meta.homeTeam,
    detailUrl: meta.detailUrl,
    moneyLine: resolveSideTrend(awayMl, homeMl, meta.awayTeam, meta.homeTeam),
    total: resolveTotalTrend(overOu, underOu),
  };
}

interface ListGameStub {
  awayTeam: string;
  homeTeam: string;
  detailPath: string;
}

export function parseDratingsListPage(html: string, league: LeagueCode): ListGameStub[] {
  const headerMatch = html.match(/Upcoming Games for ([^<]+)</i);
  if (!headerMatch) return [];

  const sectionStart = html.indexOf(headerMatch[0]);
  const section = html.slice(sectionStart, sectionStart + 120_000);
  const tbodyMatch = section.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) return [];

  const games: ListGameStub[] = [];
  for (const rowMatch of tbodyMatch[1].matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
    const row = rowMatch[0];
    if (/Postponed/i.test(row) && !row.match(/href="\/predictor\//)) continue;

    const teams = [...row.matchAll(/<a href="\/teams\/[^"]+">([^<]+)<\/a>/g)].map((m) => m[1].trim());
    if (teams.length < 2) continue;

    const detailPaths = [...row.matchAll(/href="(\/predictor\/[^"]+)"/g)].map((m) => m[1]);
    const detailPath = detailPaths.find((p) => /\/[a-f0-9-]{36}$/i.test(p)) ?? detailPaths.at(-1);
    if (!detailPath) continue;

    games.push({
      awayTeam: teams[0]!,
      homeTeam: teams[1]!,
      detailPath,
    });
  }

  return games;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": DRATINGS_USER_AGENT, Accept: "text/html" },
  });
  if (!res.ok) throw new Error(`DRatings fetch failed (${res.status}): ${url}`);
  return res.text();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]!, i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function fetchLeagueTrends(league: LeagueCode, errors: string[]): Promise<DratingsGameTrend[]> {
  const listPath = DRATINGS_LEAGUE_PATHS[league];
  if (!listPath) return [];

  let listHtml: string;
  try {
    listHtml = await fetchText(`${DRATINGS_BASE}${listPath}`);
  } catch (err) {
    errors.push(`${league} list: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }

  const stubs = parseDratingsListPage(listHtml, league);
  const trends = await mapWithConcurrency(stubs, DETAIL_CONCURRENCY, async (stub, index) => {
    if (index > 0) await sleep(FETCH_DELAY_MS);
    const detailUrl = `${DRATINGS_BASE}${stub.detailPath}`;
    try {
      const detailHtml = await fetchText(detailUrl);
      return parseDratingsDetailPage(detailHtml, {
        league,
        awayTeam: stub.awayTeam,
        homeTeam: stub.homeTeam,
        detailUrl,
      });
    } catch (err) {
      errors.push(
        `${league} ${stub.awayTeam} @ ${stub.homeTeam}: ${err instanceof Error ? err.message : String(err)}`
      );
      return parseDratingsDetailPage("", {
        league,
        awayTeam: stub.awayTeam,
        homeTeam: stub.homeTeam,
        detailUrl,
      });
    }
  });

  return trends;
}

export async function loadDratingsCache(displayDate: string): Promise<DratingsCacheFile | null> {
  try {
    const raw = await fs.readFile(cachePathForDate(displayDate), "utf8");
    return JSON.parse(raw) as DratingsCacheFile;
  } catch {
    return null;
  }
}

async function saveDratingsCache(payload: DratingsCacheFile): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(cachePathForDate(payload.date), JSON.stringify(payload, null, 2));
}

export async function fetchDratingsTrends(
  leagues: LeagueCode[],
  displayDate: string,
  options?: { forceRefresh?: boolean }
): Promise<DratingsCacheFile> {
  if (!isDratingsEnabled()) {
    return {
      fetchedAt: new Date().toISOString(),
      date: displayDate,
      trends: [],
      errors: ["DRatings filter disabled (DRATINGS_ENABLED=false)"],
      source: "cache",
    };
  }

  if (!options?.forceRefresh) {
    const cached = await loadDratingsCache(displayDate);
    if (cached?.date === displayDate && cached.trends.length > 0) {
      return { ...cached, source: "cache" };
    }
  }

  const uniqueLeagues = [...new Set(leagues.filter((l) => DRATINGS_LEAGUE_PATHS[l]))];
  const errors: string[] = [];
  const trendGroups = await Promise.all(uniqueLeagues.map((l) => fetchLeagueTrends(l, errors)));
  const trends = trendGroups.flat();

  const payload: DratingsCacheFile = {
    fetchedAt: new Date().toISOString(),
    date: displayDate,
    trends,
    errors,
    source: "live",
  };

  if (trends.length > 0) {
    await saveDratingsCache(payload);
  }

  return payload;
}

export function matchTrendToCalendarGame(
  game: CalendarGame,
  trends: DratingsGameTrend[]
): DratingsGameTrend | undefined {
  const directKey = buildDratingsGameKey(game.league, game.awayTeam, game.homeTeam);
  const byKey = trends.find((t) => t.gameKey === directKey);
  if (byKey) return byKey;

  return trends.find(
    (t) =>
      t.league === game.league &&
      pickTeamInGame(t.awayTeam, game) &&
      pickTeamInGame(t.homeTeam, game)
  );
}

function teamMatchesTrendSide(
  teamName: string | undefined,
  side: "away" | "home",
  trend: DratingsGameTrend,
  game: CalendarGame
): boolean {
  if (!teamName) return false;
  const favoredTeam = side === "away" ? trend.awayTeam : trend.homeTeam;
  const resolvedBet = resolveGameTeamDisplay(teamName, game);
  const resolvedFavored = resolveGameTeamDisplay(favoredTeam, game);
  if (!resolvedBet || !resolvedFavored) return false;
  return normalizeKeyTeam(resolvedBet) === normalizeKeyTeam(resolvedFavored);
}

/**
 * True when DRatings Bet Trends bar favors the same side as our parsed bet.
 * ML/spread → money-line bet trends; totals → over/under bet trends.
 */
export function dratingsAgreesWithBet(
  ourBet: ParsedBet | undefined,
  game: CalendarGame | undefined,
  trend: DratingsGameTrend | undefined
): boolean {
  if (!ourBet || !game || !trend) return false;

  if (ourBet.betType === "total") {
    const dir = ourBet.totalDirection;
    if (!dir) return false;
    if (trend.total.trendSide === "none") return false;
    return trend.total.trendSide === dir;
  }

  if (trend.moneyLine.trendSide === "none") return false;

  const team = ourBet.team ?? ourBet.displayText;
  return teamMatchesTrendSide(team, trend.moneyLine.trendSide, trend, game);
}

export function dratingsStatusForBet(
  ourBet: ParsedBet | undefined,
  game: CalendarGame | undefined,
  trend: DratingsGameTrend | undefined
): DratingsAgreementStatus {
  if (!isDratingsEnabled()) return "unavailable";
  if (!ourBet || !game) return "unavailable";
  if (!trend) return "unavailable";

  const sideTrend =
    ourBet.betType === "total" ? trend.total.trendSide : trend.moneyLine.trendSide;
  if (sideTrend === "none") return "unavailable";

  return dratingsAgreesWithBet(ourBet, game, trend) ? "agrees" : "disagrees";
}

export function dratingsBreakdownDetail(
  status: DratingsAgreementStatus,
  trend?: DratingsGameTrend,
  bet?: ParsedBet
): string {
  if (!isDratingsEnabled()) return "DRatings trends: filter disabled";
  if (status === "unavailable") {
    return "DRatings trends: unavailable — cannot verify (no bet)";
  }
  const label =
    bet?.betType === "total"
      ? trend?.total.trendLabel
      : trend?.moneyLine.trendLabel;
  if (status === "agrees") {
    return `DRatings trends: agrees — ${label ?? "same side"}`;
  }
  return `DRatings trends: disagrees — favors ${label ?? "other side"}`;
}
