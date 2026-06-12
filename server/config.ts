import path from "node:path";

export const TIMEZONE = process.env.TZ || "America/Toronto";

export const CACHE_DIR = path.join(process.cwd(), "data", "cache");
export const RAW_DIR = path.join(process.cwd(), "data", "raw");
/** Git-tracked cumulative bet log; survives CI and daily static rebuilds. */
export const TRACKING_STORE_FILE = path.join(process.cwd(), "data", "tracking.json");

export const SHEET_PUBLISH_ID =
  "2PACX-1vQhcSEQNuCQXAcxhQUeCI0mD0MTxNRkRaY4fm5dJuB8_49x95ecGVrukhe65QIoMtyKSXKogBcNYp8b";

export const SHEET_EDIT_ID = "1MHiDdyZ8MEDe2HwRXMPjDOwc8mAMZsaKm67NE2txIIM";

export interface SheetTabConfig {
  id: string;
  name: string;
  gid: string;
  type:
    | "daily_picks"
    | "archive"
    | "performance_daily"
    | "performance_yearly"
    | "performance_history";
}

export const SHEET_TABS: SheetTabConfig[] = [
  {
    id: "daily_picks",
    name: "Daily picks",
    gid: "0",
    type: "daily_picks",
  },
  {
    id: "archive",
    name: "Archives",
    gid: "1883403692",
    type: "archive",
  },
  {
    id: "performance_daily",
    name: "Daily performance",
    gid: "0",
    type: "performance_daily",
  },
  {
    id: "performance_yearly",
    name: "Yearly performance",
    gid: "1887286192",
    type: "performance_yearly",
  },
  {
    id: "performance_history",
    name: "Monthly/weekly performance",
    gid: "1234539794",
    type: "performance_history",
  },
];

export function getSheetCsvUrl(tab: SheetTabConfig): string {
  if (
    tab.type === "performance_daily" ||
    tab.type === "performance_yearly" ||
    tab.type === "performance_history"
  ) {
    return `https://docs.google.com/spreadsheets/d/${SHEET_EDIT_ID}/export?format=csv&gid=${tab.gid}`;
  }
  return `https://docs.google.com/spreadsheets/d/e/${SHEET_PUBLISH_ID}/pub?output=csv&gid=${tab.gid}`;
}

/** DRatings prediction list pages (HTML scrape — no public API). */
export const DRATINGS_BASE = "https://dratings.com";

export const DRATINGS_LEAGUE_PATHS: Partial<
  Record<import("./types.js").LeagueCode, string>
> = {
  MLB: "/predictions/mlb-baseball-predictions/",
  NBA: "/predictions/nba-basketball-predictions/",
  NHL: "/predictions/nhl-hockey-predictions/",
  WNBA: "/predictions/wnba-basketball-predictions/",
  NFL: "/predictions/nfl-football-predictions/",
  CFB: "/predictions/ncaa-football-predictions/",
  CBB: "/predictions/ncaa-mens-basketball-predictions/",
};

export const DRATINGS_USER_AGENT =
  process.env.DRATINGS_USER_AGENT || "sports-bet-coach/1.0 (+https://github.com/sports-bet-coach)";

/** When false, skip DRatings confirmation filter. Default: disabled. */
export function isDratingsEnabled(): boolean {
  const v = process.env.DRATINGS_ENABLED;
  if (v == null || v === "") return false;
  return !/^false|0|no$/i.test(v);
}

/** Live FastAPI server or GitHub Pages root for Sports Odds Algorithms. */
export const SPORTS_ODDS_BASE_URL =
  process.env.SPORTS_ODDS_BASE_URL ||
  "https://samuellachance.github.io/Sports-Odds-Algorithms";

export const SPORTS_ODDS_SUPPORTED_LEAGUES = [
  "MLB",
  "NBA",
  "NHL",
  "NFL",
  "WNBA",
  "CBB",
  "CFB",
  "MLS",
  "EPL",
  "LALIGA",
  "BUNDESLIGA",
  "SERIEA",
  "LIGUE1",
  "WORLDCUP",
  "FIFA_FRIENDLIES",
  "CONCACAF_WCQ",
  "CONCACAF_GOLD",
  "CONCACAF_NATIONS",
  "UEFA_EURO",
  "UEFA_NATIONS",
  "COPA_AMERICA",
] as const;

/** Always fetch ESPN schedules for soccer (algo-driven, not sheet-driven). */
export const SOCCER_SCHEDULE_LEAGUES = [
  "MLS",
  "EPL",
  "LALIGA",
  "BUNDESLIGA",
  "SERIEA",
  "LIGUE1",
  "WORLDCUP",
  "FIFA_FRIENDLIES",
  "CONCACAF_WCQ",
  "CONCACAF_GOLD",
  "CONCACAF_NATIONS",
  "UEFA_EURO",
  "UEFA_NATIONS",
  "COPA_AMERICA",
] as const;

/** Sports Odds API league id → Sharp Sheet league code. */
export const SPORTS_ODDS_LEAGUE_TO_COACH: Record<string, import("./types.js").LeagueCode> = {
  mlb: "MLB",
  nba: "NBA",
  nhl: "NHL",
  nfl: "NFL",
  wnba: "WNBA",
  cbb: "CBB",
  cfb: "CFB",
  mls: "MLS",
  epl: "EPL",
  laliga: "LALIGA",
  bundesliga: "BUNDESLIGA",
  seriea: "SERIEA",
  ligue1: "LIGUE1",
  worldcup: "WORLDCUP",
  fifa_friendlies: "FIFA_FRIENDLIES",
  concacaf_wcq: "CONCACAF_WCQ",
  concacaf_gold: "CONCACAF_GOLD",
  concacaf_nations: "CONCACAF_NATIONS",
  uefa_euro: "UEFA_EURO",
  uefa_nations: "UEFA_NATIONS",
  copa_america: "COPA_AMERICA",
};

/** Basketball and American football — recommend spread instead of moneyline. */
export const SPORTS_ODDS_SPREAD_LEAGUES = [
  "NBA",
  "WNBA",
  "CBB",
  "NFL",
  "CFB",
] as const;

/** Dual-algo gate: coach rules + Sports Odds Algo V2 must agree. Default: enabled. */
export function isSportsOddsEnabled(): boolean {
  const v = process.env.SPORTS_ODDS_ENABLED;
  if (v == null || v === "") return true;
  return !/^false|0|no$/i.test(v);
}

/** Min American-odds edge vs book to force-recommend when coach disagrees. Default: 100. */
export function sportsOddsForceMinEdge(): number {
  const raw =
    process.env.SPORTS_ODDS_FORCE_MIN_EDGE ??
    process.env.SPORTS_ODDS_FORCE_MIN_WIN_PROB;
  if (raw == null || raw === "") return 100;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
}

export const ESPN_LEAGUES: Record<
  string,
  { sport: string; league: string; label: string }
> = {
  MLB: { sport: "baseball", league: "mlb", label: "MLB" },
  NBA: { sport: "basketball", league: "nba", label: "NBA" },
  NHL: { sport: "hockey", league: "nhl", label: "NHL" },
  NFL: { sport: "football", league: "nfl", label: "NFL" },
  WNBA: { sport: "basketball", league: "wnba", label: "WNBA" },
  CBB: {
    sport: "basketball",
    league: "mens-college-basketball",
    label: "College basketball",
  },
  CFB: { sport: "football", league: "college-football", label: "College football" },
  MLS: { sport: "soccer", league: "usa.1", label: "MLS" },
  EPL: { sport: "soccer", league: "eng.1", label: "Premier League" },
  LALIGA: { sport: "soccer", league: "esp.1", label: "La Liga" },
  BUNDESLIGA: { sport: "soccer", league: "ger.1", label: "Bundesliga" },
  SERIEA: { sport: "soccer", league: "ita.1", label: "Serie A" },
  LIGUE1: { sport: "soccer", league: "fra.1", label: "Ligue 1" },
  WORLDCUP: { sport: "soccer", league: "fifa.world", label: "FIFA World Cup" },
  FIFA_FRIENDLIES: { sport: "soccer", league: "fifa.friendly", label: "FIFA Friendlies" },
  CONCACAF_WCQ: {
    sport: "soccer",
    league: "fifa.worldq.concacaf",
    label: "CONCACAF WCQ",
  },
  CONCACAF_GOLD: { sport: "soccer", league: "concacaf.gold", label: "CONCACAF Gold Cup" },
  CONCACAF_NATIONS: {
    sport: "soccer",
    league: "concacaf.nations.league",
    label: "CONCACAF Nations League",
  },
  UEFA_EURO: { sport: "soccer", league: "uefa.euro", label: "UEFA Euro" },
  UEFA_NATIONS: { sport: "soccer", league: "uefa.nations", label: "UEFA Nations League" },
  COPA_AMERICA: { sport: "soccer", league: "conmebol.america", label: "Copa América" },
};
