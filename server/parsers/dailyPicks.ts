import { parse } from "csv-parse/sync";
import type { LeagueCode, SheetPick, SignalType } from "../types.js";

const LEAGUE_MAP: Record<string, LeagueCode> = {
  MLB: "MLB",
  NBA: "NBA",
  NHL: "NHL",
  NFL: "NFL",
  WNBA: "WNBA",
  CBB: "CBB",
  CFB: "CFB",
};

const SIGNAL_BY_COLUMN: Record<number, SignalType> = {
  2: "sharp_money",
  4: "book_needs_fade",
  6: "square_fade",
  8: "reverse_line_movement",
};

const PREMIUM_SIGNAL_COLS: { col: number; type: SignalType; league: LeagueCode }[] = [
  { col: 2, type: "mega_sharps", league: "MEGA_SHARPS" },
  { col: 4, type: "whale_plays", league: "WHALE" },
  { col: 6, type: "model_best_values", league: "MODEL" },
  { col: 8, type: "mega_rlm", league: "RLM" },
];

function cleanCell(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function parsePickCell(text: string): { pick: string; opponent?: string; line?: string } {
  const trimmed = text.trim();
  if (!trimmed) return { pick: "" };

  const vsMatch = trimmed.match(/^(.+?)\s+VS\s+(.+)$/i);
  if (vsMatch) {
    return { pick: vsMatch[1].trim(), opponent: vsMatch[2].trim() };
  }

  const lineMatch = trimmed.match(/^(.+?)\s+((?:OVER|UNDER)\s+[\d.]+.*)$/i);
  if (lineMatch) {
    return { pick: lineMatch[1].trim(), line: lineMatch[2].trim() };
  }

  return { pick: trimmed };
}

function isLeagueHeaderRow(row: string[]): LeagueCode | null {
  const leagueCell = cleanCell(row[2]).toUpperCase();
  if (!leagueCell) return null;

  if (LEAGUE_MAP[leagueCell]) return LEAGUE_MAP[leagueCell];

  const sorted = Object.entries(LEAGUE_MAP).sort(([a], [b]) => b.length - a.length);
  for (const [key, code] of sorted) {
    if (leagueCell === key) return code;
  }
  return null;
}

function isPremiumSectionHeader(row: string[]): boolean {
  const c2 = cleanCell(row[2]).toUpperCase();
  const c6 = cleanCell(row[6]).toUpperCase();
  return c2.includes("MEGA SHARPS") && c6.includes("MODEL BEST");
}

function isTopSectionHeader(row: string[]): boolean {
  const joined = row.map(cleanCell).join(" ").toUpperCase();
  return (
    joined.includes("SHARP MONEY") ||
    joined.includes("BOOK NEEDS") ||
    joined.includes("SQUARE") ||
    joined.includes("REVERSE LINE MOVEMENT")
  );
}

function addPick(
  picks: SheetPick[],
  pickIndex: { n: number },
  opts: Omit<SheetPick, "id">
) {
  pickIndex.n += 1;
  picks.push({ id: `pick-${pickIndex.n}`, ...opts });
}

export function parseDailyPicksCsv(csv: string): SheetPick[] {
  const rows: string[][] = parse(csv, { relax_column_count: true, skip_empty_lines: false });
  const picks: SheetPick[] = [];
  let currentLeague: LeagueCode = "UNKNOWN";
  let inPremiumSection = false;
  const pickIndex = { n: 0 };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => !cleanCell(c))) continue;

    if (isTopSectionHeader(row) && !cleanCell(row[0]).toUpperCase().includes("GAME TIME")) {
      continue;
    }

    if (isPremiumSectionHeader(row)) {
      inPremiumSection = true;
      currentLeague = "MLB";
      continue;
    }

    const leagueFromHeader = isLeagueHeaderRow(row);
    if (leagueFromHeader) {
      inPremiumSection = false;
      currentLeague = leagueFromHeader;
      continue;
    }

    const col0 = cleanCell(row[0]).toUpperCase();
    if (col0 === "GAME TIME") continue;

    const gameTime = cleanCell(row[0]);
    const postingTime = cleanCell(row[1]);

    const signalCols = inPremiumSection
      ? PREMIUM_SIGNAL_COLS.map(({ col, type, league }) => ({ col, type, league }))
      : Object.entries(SIGNAL_BY_COLUMN).map(([col, type]) => ({
          col: Number(col),
          type,
          league: currentLeague,
        }));

    for (const { col, type, league } of signalCols) {
      const cell = cleanCell(row[col]);
      if (!cell || cell.toUpperCase() === "VS") continue;

      const parsed = parsePickCell(cell);
      if (!parsed.pick) continue;

      addPick(picks, pickIndex, {
        league,
        signalType: type,
        pick: parsed.pick,
        opponent: parsed.opponent,
        line: parsed.line,
        gameTime: gameTime || undefined,
        postingTime: postingTime || undefined,
        rawRow: i + 1,
      });
    }

    if (!inPremiumSection) {
      for (const [colStr, type] of Object.entries(SIGNAL_BY_COLUMN)) {
        const col = Number(colStr);
        const cell = cleanCell(row[col]);
        const mid = cleanCell(row[col + 1]);
        const far = cleanCell(row[col + 2]);

        if (cell && mid.toUpperCase() === "VS" && far) {
          const bookPick = picks.find(
            (p) => p.rawRow === i + 1 && p.signalType === type && p.pick === cell
          );
          if (bookPick && !bookPick.opponent) {
            bookPick.opponent = far;
          }

          const squareCol = col + 2;
          const squareType = SIGNAL_BY_COLUMN[squareCol];
          if (squareType === "square_fade") {
            const squarePick = picks.find(
              (p) =>
                p.rawRow === i + 1 &&
                p.signalType === "square_fade" &&
                p.pick === far
            );
            if (squarePick && !squarePick.opponent) {
              squarePick.opponent = cell;
            }
          }
          continue;
        }

        const next = cleanCell(row[col + 1]);
        if (cell && next && cell.toUpperCase() !== "VS" && next.toUpperCase() !== "VS") {
          const existing = picks.find(
            (p) => p.rawRow === i + 1 && p.signalType === type && p.pick === cell
          );
          if (existing && !existing.opponent) {
            existing.opponent = next;
          }
        }
      }
    }
  }

  return picks;
}
