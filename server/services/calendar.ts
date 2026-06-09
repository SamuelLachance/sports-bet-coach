import { formatInTimeZone } from "date-fns-tz";
import NodeCache from "node-cache";
import { ESPN_LEAGUES, TIMEZONE } from "../config.js";
import type { CalendarGame, LeagueCode } from "../types.js";

const cache = new NodeCache({ stdTTL: 300 });

interface EspnScoreboard {
  events?: Array<{
    id: string;
    date: string;
    status?: { type?: { description?: string } };
    competitions?: Array<{
      venue?: { fullName?: string };
      competitors?: Array<{
        homeAway: string;
        team: { displayName: string; abbreviation: string };
      }>;
    }>;
  }>;
}

function espnUrl(sport: string, league: string, date?: string): string {
  const base = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard`;
  if (date) return `${base}?dates=${date}`;
  return base;
}

function mapEspnToGames(data: EspnScoreboard, league: LeagueCode): CalendarGame[] {
  return (data.events || []).map((event) => {
    const comp = event.competitions?.[0];
    const home = comp?.competitors?.find((c) => c.homeAway === "home");
    const away = comp?.competitors?.find((c) => c.homeAway === "away");
    return {
      id: event.id,
      league,
      homeTeam: home?.team.displayName || "TBD",
      awayTeam: away?.team.displayName || "TBD",
      homeAbbr: home?.team.abbreviation || "",
      awayAbbr: away?.team.abbreviation || "",
      startTime: event.date,
      status: event.status?.type?.description || "Scheduled",
      venue: comp?.venue?.fullName,
    };
  });
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

export function todayDateKey(): string {
  return formatInTimeZone(new Date(), TIMEZONE, "yyyyMMdd");
}

export function todayDisplayDate(): string {
  return formatInTimeZone(new Date(), TIMEZONE, "yyyy-MM-dd");
}

const TEAM_ALIASES: Record<string, string[]> = {
  "ny yankees": ["yankees", "new york yankees", "nyy"],
  "ny mets": ["mets", "new york mets", "nym"],
  cubs: ["chicago cubs", "chc"],
  "san diego": ["padres", "san diego padres", "sd"],
  milwaukee: ["brewers", "milwaukee brewers", "mil"],
  baltimore: ["orioles", "baltimore orioles", "bal"],
  seattle: ["mariners", "seattle mariners", "sea"],
  cleveland: ["guardians", "cleveland guardians", "cle"],
  colorado: ["rockies", "colorado rockies", "col"],
  washington: ["nationals", "washington nationals", "wsh"],
  vegas: ["golden knights", "vegas golden knights", "vgk", "las vegas"],
  dallas: ["wings", "dallas wings", "dal"],
  chicago: ["sky", "chicago sky", "chi"],
  pirates: ["pittsburgh pirates", "pit"],
  braves: ["atlanta braves", "atl"],
  royals: ["kansas city royals", "kc"],
};

function normalizeTeam(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function teamMatches(pickTeam: string, gameTeam: string, gameAbbr: string): boolean {
  const pick = normalizeTeam(pickTeam);
  const team = normalizeTeam(gameTeam);
  const abbr = gameAbbr.toLowerCase();

  if (team.includes(pick) || pick.includes(team)) return true;
  if (abbr && pick.includes(abbr)) return true;

  for (const [key, aliases] of Object.entries(TEAM_ALIASES)) {
    const all = [key, ...aliases].map(normalizeTeam);
    const pickHit = all.some((a) => pick.includes(a) || a.includes(pick));
    const teamHit = all.some((a) => team.includes(a) || a.includes(team));
    if (pickHit && teamHit) return true;
  }

  const pickWords = pick.split(" ").filter((w) => w.length > 2);
  return pickWords.some((w) => team.includes(w));
}

export function matchPickToGame(
  pick: string,
  opponent: string | undefined,
  games: CalendarGame[]
): CalendarGame | undefined {
  for (const game of games) {
    const teams = [game.homeTeam, game.awayTeam, game.homeAbbr, game.awayAbbr];
    const pickHit = teams.some((t) => teamMatches(pick, t, ""));
    if (!pickHit) continue;

    if (opponent) {
      const oppHit =
        teamMatches(opponent, game.homeTeam, game.homeAbbr) ||
        teamMatches(opponent, game.awayTeam, game.awayAbbr);
      if (oppHit) return game;
    } else {
      return game;
    }
  }
  return undefined;
}
