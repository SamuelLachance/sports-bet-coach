import { formatInTimeZone } from "date-fns-tz";
import NodeCache from "node-cache";
import { ESPN_LEAGUES, TIMEZONE } from "../config.js";
import type { CalendarGame, LeagueCode } from "../types.js";

const cache = new NodeCache({ stdTTL: 300 });

interface EspnCompetitor {
  homeAway: string;
  winner?: boolean;
  score?: string;
  team: { displayName: string; abbreviation: string };
}

interface EspnScoreboard {
  events?: Array<{
    id: string;
    date: string;
    status?: { type?: { description?: string; completed?: boolean } };
    competitions?: Array<{
      venue?: { fullName?: string };
      competitors?: EspnCompetitor[];
    }>;
  }>;
}

export interface GameResult extends CalendarGame {
  homeScore?: number;
  awayScore?: number;
  winnerTeam?: string;
  isFinal: boolean;
}

function espnUrl(sport: string, league: string, date?: string): string {
  const base = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard`;
  if (date) return `${base}?dates=${date}`;
  return base;
}

function parseScore(value?: string): number | undefined {
  if (value == null || value === "") return undefined;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

function mapEspnEvent(
  event: NonNullable<EspnScoreboard["events"]>[number],
  league: LeagueCode
): GameResult {
  const comp = event.competitions?.[0];
  const home = comp?.competitors?.find((c) => c.homeAway === "home");
  const away = comp?.competitors?.find((c) => c.homeAway === "away");
  const statusDesc = event.status?.type?.description || "Scheduled";
  const isFinal =
    event.status?.type?.completed === true ||
    /final/i.test(statusDesc);

  const homeScore = parseScore(home?.score);
  const awayScore = parseScore(away?.score);
  let winnerTeam: string | undefined;
  if (isFinal && homeScore != null && awayScore != null) {
    if (homeScore > awayScore) winnerTeam = home?.team.displayName;
    else if (awayScore > homeScore) winnerTeam = away?.team.displayName;
  } else if (isFinal) {
    if (home?.winner) winnerTeam = home.team.displayName;
    else if (away?.winner) winnerTeam = away.team.displayName;
  }

  return {
    id: event.id,
    league,
    homeTeam: home?.team.displayName || "TBD",
    awayTeam: away?.team.displayName || "TBD",
    homeAbbr: home?.team.abbreviation || "",
    awayAbbr: away?.team.abbreviation || "",
    startTime: event.date,
    status: statusDesc,
    venue: comp?.venue?.fullName,
    homeScore,
    awayScore,
    winnerTeam,
    isFinal,
  };
}

function mapEspnToGames(data: EspnScoreboard, league: LeagueCode): CalendarGame[] {
  return (data.events || []).map((event) => mapEspnEvent(event, league));
}

export async function fetchLeagueSchedule(
  league: LeagueCode,
  date?: string
): Promise<CalendarGame[]> {
  const config = ESPN_LEAGUES[league];
  if (!config) return [];

  const cacheKey = `${league}-${date || "today"}`;
  const cached = cache.get<CalendarGame[]>(cacheKey);
  if (cached) return cached;

  const url = espnUrl(config.sport, config.league, date);
  const res = await fetch(url, { headers: { "User-Agent": "sports-bet-coach/1.0" } });
  if (!res.ok) return [];

  const data = (await res.json()) as EspnScoreboard;
  const games = mapEspnToGames(data, league);
  cache.set(cacheKey, games);
  return games;
}

export async function fetchAllSchedules(
  leagues: LeagueCode[],
  date?: string
): Promise<CalendarGame[]> {
  const unique = [...new Set(leagues.filter((l) => ESPN_LEAGUES[l]))];
  const results = await Promise.all(unique.map((l) => fetchLeagueSchedule(l, date)));
  return results.flat().sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
}

export async function fetchLeagueResults(
  league: LeagueCode,
  date: string
): Promise<GameResult[]> {
  const config = ESPN_LEAGUES[league];
  if (!config) return [];

  const cacheKey = `results-${league}-${date}`;
  const cached = cache.get<GameResult[]>(cacheKey);
  if (cached) return cached;

  const url = espnUrl(config.sport, config.league, date);
  const res = await fetch(url, { headers: { "User-Agent": "sports-bet-coach/1.0" } });
  if (!res.ok) return [];

  const data = (await res.json()) as EspnScoreboard;
  const games = (data.events || []).map((event) => mapEspnEvent(event, league));
  cache.set(cacheKey, games);
  return games;
}

export async function fetchResultsForDate(
  leagues: LeagueCode[],
  dateKey: string
): Promise<GameResult[]> {
  const unique = [...new Set(leagues.filter((l) => ESPN_LEAGUES[l]))];
  const results = await Promise.all(unique.map((l) => fetchLeagueResults(l, dateKey)));
  return results.flat();
}

/** yyyy-MM-dd → yyyyMMdd for ESPN */
export function displayDateToEspnKey(displayDate: string): string {
  return displayDate.replace(/-/g, "");
}

export function todayDateKey(): string {
  return formatInTimeZone(new Date(), TIMEZONE, "yyyyMMdd");
}

export function todayDisplayDate(): string {
  return formatInTimeZone(new Date(), TIMEZONE, "yyyy-MM-dd");
}

const TEAM_ALIASES: Record<string, string[]> = {
  "ny yankees": ["yankees", "new york yankees", "nyy"],
  "ny mets": ["mets", "new york mets", "nym"],
  "chicago cubs": ["cubs", "chc"],
  "chicago sky": ["sky", "chi sky", "chi"],
  "indiana fever": ["fever", "ind", "indiana"],
  "san diego padres": ["padres", "san diego", "sd"],
  "milwaukee brewers": ["brewers", "milwaukee", "mil"],
  "baltimore orioles": ["orioles", "baltimore", "bal"],
  "seattle mariners": ["mariners", "seattle", "sea"],
  "cleveland guardians": ["guardians", "cleveland", "cle"],
  "colorado rockies": ["rockies", "colorado", "col"],
  "washington nationals": ["nationals", "washington", "wsh"],
  "vegas golden knights": ["golden knights", "vegas", "vgk", "las vegas"],
  "dallas wings": ["wings", "dallas", "dal"],
  "pittsburgh pirates": ["pirates", "pit", "pittsburgh"],
  "los angeles dodgers": ["dodgers", "lad", "la dodgers"],
  "atlanta braves": ["braves", "atl", "atlanta"],
  "chicago white sox": ["white sox", "white", "cws", "chw"],
  "kansas city royals": ["royals", "kc"],
  "philadelphia phillies": ["phillies", "philadelphia", "phi"],
  "golden state valkyries": ["valkyries", "golden state", "gsv", "gs"],
  "los angeles angels": ["angels", "laa", "la angels"],
  "athletics": ["oakland athletics", "oak", "ath"],
  "tampa bay rays": ["rays", "tb", "tampa bay"],
};

/** City/region tokens — too broad to match teams on their own */
const GENERIC_LOCATION_WORDS = new Set([
  "chicago",
  "baltimore",
  "seattle",
  "cleveland",
  "colorado",
  "washington",
  "milwaukee",
  "philadelphia",
  "dallas",
  "vegas",
  "san",
  "diego",
  "angeles",
  "new",
  "york",
  "golden",
  "kansas",
  "city",
  "los",
  "las",
  "pittsburgh",
  "atlanta",
  "kansas",
  "philadelphia",
]);

function normalizeTeam(name: string): string {
  return name
    .replace(/\s*[+-]?\d+\.?\d*\s*$/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function abbrMatchesPick(pick: string, abbr: string): boolean {
  if (!abbr || abbr.length < 2) return false;
  if (pick === abbr) return true;
  const re = new RegExp(`(^|\\s)${abbr}(\\s|$)`);
  return re.test(pick);
}

function aliasMatchesName(name: string, alias: string): boolean {
  if (name === alias) return true;
  if (name.startsWith(`${alias} `) || name.endsWith(` ${alias}`)) return true;
  if (alias.startsWith(`${name} `) || alias.endsWith(` ${name}`)) return true;
  return false;
}

function teamMatches(pickTeam: string, gameTeam: string, gameAbbr: string): boolean {
  const pick = normalizeTeam(pickTeam);
  const team = normalizeTeam(gameTeam);
  const abbr = gameAbbr.toLowerCase();

  if (pick === team) return true;
  if (abbr && abbrMatchesPick(pick, abbr)) return true;

  for (const [canonical, aliases] of Object.entries(TEAM_ALIASES)) {
    const forms = [canonical, ...aliases].map(normalizeTeam);
    for (const form of forms) {
      if (aliasMatchesName(pick, form) && aliasMatchesName(team, form)) {
        return true;
      }
    }
  }

  const pickWords = pick.split(" ").filter((w) => w.length > 3 && !GENERIC_LOCATION_WORDS.has(w));
  return pickWords.some((w) => team.includes(w));
}

export function pickTeamInGame(teamName: string, game: CalendarGame): boolean {
  return (
    teamMatches(teamName, game.homeTeam, game.homeAbbr) ||
    teamMatches(teamName, game.awayTeam, game.awayAbbr)
  );
}

/** A sheet pick belongs to an ESPN game only when its team (and opponent, if set) are in that matchup. */
export function pickBelongsToGame(
  pick: string,
  opponent: string | undefined,
  game: CalendarGame
): boolean {
  if (!pickTeamInGame(pick, game)) return false;
  if (opponent) return pickTeamInGame(opponent, game);
  return true;
}

export function resolveGameTeamDisplay(
  teamName: string,
  game: CalendarGame
): string | undefined {
  if (teamMatches(teamName, game.awayTeam, game.awayAbbr)) return game.awayTeam;
  if (teamMatches(teamName, game.homeTeam, game.homeAbbr)) return game.homeTeam;
  return undefined;
}

export function validateRecommendedTeam(
  recommendedTeam: string,
  game: CalendarGame
): boolean {
  return pickTeamInGame(recommendedTeam, game);
}

export function matchPickToGame(
  pick: string,
  opponent: string | undefined,
  games: CalendarGame[]
): CalendarGame | undefined {
  for (const game of games) {
    if (pickBelongsToGame(pick, opponent, game)) return game;
  }
  return undefined;
}
