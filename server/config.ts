import path from "node:path";

export const TIMEZONE = process.env.TZ || "America/Toronto";

export const CACHE_DIR = path.join(process.cwd(), "data", "cache");
export const RAW_DIR = path.join(process.cwd(), "data", "raw");

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
] as const;

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

/** Min American-odds edge vs book to force-recommend when coach disagrees. Default: 50. */
export function sportsOddsForceMinEdge(): number {
  const raw =
    process.env.SPORTS_ODDS_FORCE_MIN_EDGE ??
    process.env.SPORTS_ODDS_FORCE_MIN_WIN_PROB;
  if (raw == null || raw === "") return 50;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
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
};
