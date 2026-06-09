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
  type: "daily_picks" | "archive" | "performance_daily" | "performance_yearly";
}

export const SHEET_TABS: SheetTabConfig[] = [
  {
    id: "daily_picks",
    name: "Picks du jour",
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
    name: "Performance quotidienne",
    gid: "0",
    type: "performance_daily",
  },
  {
    id: "performance_yearly",
    name: "Performance annuelle",
    gid: "1887286192",
    type: "performance_yearly",
  },
];

export function getSheetCsvUrl(tab: SheetTabConfig): string {
  if (tab.type === "performance_daily" || tab.type === "performance_yearly") {
    return `https://docs.google.com/spreadsheets/d/${SHEET_EDIT_ID}/export?format=csv&gid=${tab.gid}`;
  }
  return `https://docs.google.com/spreadsheets/d/e/${SHEET_PUBLISH_ID}/pub?output=csv&gid=${tab.gid}`;
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
    label: "Basket universitaire",
  },
  CFB: { sport: "football", league: "college-football", label: "Football universitaire" },
};
