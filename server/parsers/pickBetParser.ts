import type { BetType, ParsedBet, TotalDirection } from "../types.js";

export interface ParsePickCellResult {
  pick: string;
  opponent?: string;
  line?: string;
  parsedBet?: ParsedBet;
}

function titleCaseTeam(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function formatSpreadDisplay(team: string, spread: number): string {
  const sign = spread > 0 ? "+" : "";
  return `${titleCaseTeam(team)} ${sign}${spread}`;
}

function formatOddsDisplay(team: string, odds: number): string {
  const sign = odds > 0 ? "+" : "";
  return `${titleCaseTeam(team)} ${sign}${odds}`;
}

function formatTotalDisplay(direction: TotalDirection, line: number, team?: string): string {
  const label = direction === "over" ? "Over" : "Under";
  if (team) return `${titleCaseTeam(team)} ${label} ${line}`;
  return `${label} ${line}`;
}

/** Spreads are typically |value| < 100; moneyline American odds are |value| >= 100. */
export function classifyNumericSuffix(value: number): "spread" | "moneyline" {
  return Math.abs(value) >= 100 ? "moneyline" : "spread";
}

/** Standard -110 consensus juice for spreads/totals when odds are not listed. */
export const DEFAULT_JUICE = -110;

/** No-vig mirror of listed moneyline odds for the faded opponent side. */
export function impliedOpponentAmericanOdds(listedOdds: number): number {
  const pListed =
    listedOdds > 0
      ? 100 / (listedOdds + 100)
      : Math.abs(listedOdds) / (Math.abs(listedOdds) + 100);
  const pOpp = 1 - pListed;
  if (pOpp >= 0.5) {
    return Math.round(-100 * (pOpp / (1 - pOpp)));
  }
  return Math.round(100 * ((1 - pOpp) / pOpp));
}

function parseTotalFromText(
  text: string,
  rawText: string
): ParsedBet | undefined {
  const match = text.match(/^(.+?)\s+(OVER|UNDER)\s+([\d.]+)\s*$/i);
  if (!match) return undefined;

  const team = match[1].trim();
  const direction = match[2].toLowerCase() as TotalDirection;
  const totalLine = parseFloat(match[3]);
  if (!Number.isFinite(totalLine)) return undefined;

  return {
    betType: "total",
    team,
    rawText,
    totalDirection: direction,
    totalLine,
    displayText: formatTotalDisplay(direction, totalLine, team),
  };
}

function parseTeamNumberSuffix(
  text: string,
  rawText: string
): ParsedBet | undefined {
  const match = text.match(/^(.+?)\s+([+-][\d.]+)\s*$/);
  if (!match) return undefined;

  const team = match[1].trim();
  const value = parseFloat(match[2]);
  if (!Number.isFinite(value)) return undefined;

  const kind = classifyNumericSuffix(value);
  if (kind === "moneyline") {
    return {
      betType: "moneyline",
      team,
      rawText,
      odds: value,
      displayText: formatOddsDisplay(team, value),
    };
  }

  return {
    betType: "spread",
    team,
    rawText,
    spread: value,
    displayText: formatSpreadDisplay(team, value),
  };
}

function parseStandaloneLine(line: string, team: string, rawText: string): ParsedBet | undefined {
  const trimmed = line.trim();
  const totalMatch = trimmed.match(/^(OVER|UNDER)\s+([\d.]+)\s*$/i);
  if (totalMatch) {
    const direction = totalMatch[1].toLowerCase() as TotalDirection;
    const totalLine = parseFloat(totalMatch[2]);
    if (!Number.isFinite(totalLine)) return undefined;
    return {
      betType: "total",
      team,
      rawText,
      totalDirection: direction,
      totalLine,
      displayText: formatTotalDisplay(direction, totalLine, team),
    };
  }
  return undefined;
}

/** Parse a sheet pick cell into structured bet metadata. */
export function parsePickBet(text: string, lineField?: string): ParsedBet | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  const rawText = lineField ? `${trimmed} ${lineField}`.trim() : trimmed;

  const totalBet = parseTotalFromText(trimmed, rawText);
  if (totalBet) return totalBet;

  const teamNumber = parseTeamNumberSuffix(trimmed, rawText);
  if (teamNumber) return teamNumber;

  if (lineField) {
    const fromLine = parseStandaloneLine(lineField, trimmed, rawText);
    if (fromLine) return fromLine;
  }

  return {
    betType: "moneyline",
    team: trimmed,
    rawText,
    displayText: titleCaseTeam(trimmed),
  };
}

export function parsePickCell(text: string): ParsePickCellResult {
  const trimmed = text.trim();
  if (!trimmed) return { pick: "" };

  const vsMatch = trimmed.match(/^(.+?)\s+VS\s+(.+)$/i);
  if (vsMatch) {
    const pick = vsMatch[1].trim();
    const opponent = vsMatch[2].trim();
    return {
      pick,
      opponent,
      parsedBet: parsePickBet(pick),
    };
  }

  const lineMatch = trimmed.match(/^(.+?)\s+((?:OVER|UNDER)\s+[\d.]+.*)$/i);
  if (lineMatch) {
    const pick = lineMatch[1].trim();
    const line = lineMatch[2].trim();
    return {
      pick,
      line,
      parsedBet: parsePickBet(pick, line),
    };
  }

  const embeddedTotal = parseTotalFromText(trimmed, trimmed);
  if (embeddedTotal) {
    const team = embeddedTotal.team ?? trimmed;
    return { pick: team, parsedBet: embeddedTotal };
  }

  const embeddedNumber = parseTeamNumberSuffix(trimmed, trimmed);
  if (embeddedNumber) {
    return { pick: trimmed, parsedBet: embeddedNumber };
  }

  return { pick: trimmed, parsedBet: parsePickBet(trimmed) };
}

export function betKey(bet: ParsedBet): string {
  if (bet.betType === "total") {
    return `total:${bet.totalDirection}:${bet.totalLine}`;
  }
  const team = (bet.team ?? "").toUpperCase().replace(/\s+/g, " ").trim();
  if (bet.betType === "spread") {
    return `spread:${team}:${bet.spread}`;
  }
  return `ml:${team}`;
}

export function fadeParsedBet(
  bet: ParsedBet,
  opponent?: string,
  resolveTeam?: (name: string) => string | undefined
): ParsedBet | undefined {
  const resolve = (name: string) => {
    const resolved = resolveTeam?.(name) ?? name;
    return resolved;
  };

  if (bet.betType === "total" && bet.totalDirection && bet.totalLine != null) {
    const nextDirection: TotalDirection = bet.totalDirection === "over" ? "under" : "over";
    const team = bet.team ? resolve(bet.team) : bet.team;
    return {
      betType: "total",
      team,
      rawText: bet.rawText,
      totalDirection: nextDirection,
      totalLine: bet.totalLine,
      odds: DEFAULT_JUICE,
      displayText: formatTotalDisplay(nextDirection, bet.totalLine, team),
    };
  }

  if (bet.betType === "spread" && bet.team && bet.spread != null) {
    if (!opponent) return undefined;
    const opp = resolve(opponent);
    const invertedSpread = -bet.spread;
    return {
      betType: "spread",
      team: opp,
      rawText: bet.rawText,
      spread: invertedSpread,
      odds: DEFAULT_JUICE,
      displayText: formatSpreadDisplay(opp, invertedSpread),
    };
  }

  if (bet.team && opponent) {
    const opp = resolve(opponent);
    const fadedOdds =
      bet.odds != null ? impliedOpponentAmericanOdds(bet.odds) : undefined;
    return {
      betType: "moneyline",
      team: opp,
      rawText: bet.rawText,
      odds: fadedOdds,
      displayText:
        fadedOdds != null
          ? formatOddsDisplay(opp, fadedOdds)
          : titleCaseTeam(opp),
    };
  }

  return undefined;
}

export function resolveBetDisplay(
  bet: ParsedBet,
  resolveTeam?: (name: string) => string | undefined
): string {
  const team = bet.team ? resolveTeam?.(bet.team) ?? bet.team : bet.team;

  if (bet.betType === "total" && bet.totalDirection && bet.totalLine != null) {
    return formatTotalDisplay(bet.totalDirection, bet.totalLine, team);
  }
  if (bet.betType === "spread" && team && bet.spread != null) {
    return formatSpreadDisplay(team, bet.spread);
  }
  if (bet.betType === "moneyline" && team && bet.odds != null) {
    return formatOddsDisplay(team, bet.odds);
  }
  if (team) return titleCaseTeam(team);
  return bet.displayText;
}
