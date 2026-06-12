import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  endOfMonth,
  endOfWeek,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import type { PeriodRollup, TrackedBet, TrackingResponse } from "../types";

export const TRACKING_TIMEZONE = "America/Toronto";

export type CalendarViewMode = "day" | "week" | "month" | "year" | "all";

export type DayBetStatus = "win" | "loss" | "mixed" | "pending" | "none";

function zonedDate(dateStr: string): Date {
  return toZonedTime(parseISO(`${dateStr}T12:00:00`), TRACKING_TIMEZONE);
}

export function weekRollupKey(dateStr: string): string {
  const d = zonedDate(dateStr);
  const weekStart = startOfWeek(d, { weekStartsOn: 1 });
  return formatInTimeZone(weekStart, TRACKING_TIMEZONE, "yyyy-MM-dd");
}

export function monthRollupKey(dateStr: string): string {
  return formatInTimeZone(zonedDate(dateStr), TRACKING_TIMEZONE, "yyyy-MM");
}

export function yearRollupKey(dateStr: string): string {
  return formatInTimeZone(zonedDate(dateStr), TRACKING_TIMEZONE, "yyyy");
}

export function weekLabel(weekStartKey: string): string {
  const start = parseISO(`${weekStartKey}T12:00:00`);
  const end = endOfWeek(start, { weekStartsOn: 1 });
  const startLabel = formatInTimeZone(start, TRACKING_TIMEZONE, "MMM d");
  const endLabel = formatInTimeZone(end, TRACKING_TIMEZONE, "MMM d, yyyy");
  return `${startLabel} – ${endLabel}`;
}

export function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  const idx = parseInt(month, 10) - 1;
  const names = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${names[idx] ?? month} ${year}`;
}

export function dayLabel(dateStr: string): string {
  return formatInTimeZone(parseISO(`${dateStr}T12:00:00`), TRACKING_TIMEZONE, "MMM d, yyyy");
}

export function findRollup(rollups: PeriodRollup[], key: string): PeriodRollup | undefined {
  return rollups.find((r) => r.key === key);
}

export function rollupRecord(row: PeriodRollup): string {
  return `${row.wins}-${row.losses}${row.pushes > 0 ? `-${row.pushes}` : ""}`;
}

export function dayBetStatus(rollup: PeriodRollup | undefined): DayBetStatus {
  if (!rollup || rollup.bets === 0) return "none";
  const settled = rollup.wins + rollup.losses + rollup.pushes;
  if (rollup.pending > 0 && settled === 0) return "pending";
  if (rollup.wins > 0 && rollup.losses > 0) return "mixed";
  if (rollup.units > 0) return "win";
  if (rollup.units < 0) return "loss";
  if (rollup.pending > 0) return "pending";
  return "mixed";
}

export function getPeriodKey(anchorDate: string, mode: CalendarViewMode): string | null {
  if (mode === "all") return null;
  if (mode === "day") return anchorDate;
  if (mode === "week") return weekRollupKey(anchorDate);
  if (mode === "month") return monthRollupKey(anchorDate);
  return yearRollupKey(anchorDate);
}

export function getPeriodLabel(anchorDate: string, mode: CalendarViewMode): string {
  if (mode === "all") return "All time";
  if (mode === "day") return dayLabel(anchorDate);
  if (mode === "week") return weekLabel(weekRollupKey(anchorDate));
  if (mode === "month") return monthLabel(monthRollupKey(anchorDate));
  return yearRollupKey(anchorDate);
}

export function navigateAnchor(
  anchorDate: string,
  mode: CalendarViewMode,
  direction: -1 | 1
): string {
  const d = zonedDate(anchorDate);
  if (mode === "day") {
    return formatInTimeZone(addDays(d, direction), TRACKING_TIMEZONE, "yyyy-MM-dd");
  }
  if (mode === "week") {
    return formatInTimeZone(addWeeks(d, direction), TRACKING_TIMEZONE, "yyyy-MM-dd");
  }
  if (mode === "month") {
    return formatInTimeZone(addMonths(d, direction), TRACKING_TIMEZONE, "yyyy-MM-dd");
  }
  if (mode === "year") {
    return formatInTimeZone(addYears(d, direction), TRACKING_TIMEZONE, "yyyy-MM-dd");
  }
  return anchorDate;
}

export function filterBetsByPeriod(
  bets: TrackedBet[],
  anchorDate: string,
  mode: CalendarViewMode
): TrackedBet[] {
  if (mode === "all") return bets;
  const key = getPeriodKey(anchorDate, mode);
  if (!key) return bets;

  return bets.filter((bet) => {
    if (mode === "day") return bet.date === key;
    if (mode === "week") return weekRollupKey(bet.date) === key;
    if (mode === "month") return monthRollupKey(bet.date) === key;
    return yearRollupKey(bet.date) === key;
  });
}

export function rollupsForMode(
  tracking: TrackingResponse,
  mode: CalendarViewMode
): PeriodRollup[] {
  switch (mode) {
    case "day":
      return tracking.daily ?? [];
    case "week":
      return tracking.weekly;
    case "month":
      return tracking.monthly;
    case "year":
      return tracking.yearly ?? [];
    default:
      return [];
  }
}

export function currentPeriodRollup(
  tracking: TrackingResponse,
  anchorDate: string,
  mode: CalendarViewMode
): PeriodRollup | null {
  if (mode === "all") {
    const s = tracking.summary;
    return {
      key: "all",
      label: "All time",
      wins: s.wins,
      losses: s.losses,
      pushes: s.pushes,
      pending: s.pending,
      units: s.totalUnits,
      bets: tracking.bets.length,
      roiPercent: s.roiPercent,
    };
  }
  const key = getPeriodKey(anchorDate, mode);
  if (!key) return null;
  const rollups = rollupsForMode(tracking, mode);
  const found = findRollup(rollups, key);
  if (found) return found;
  return {
    key,
    label: getPeriodLabel(anchorDate, mode),
    wins: 0,
    losses: 0,
    pushes: 0,
    pending: 0,
    units: 0,
    bets: 0,
    roiPercent: 0,
  };
}

export function previousPeriodRollup(
  tracking: TrackingResponse,
  anchorDate: string,
  mode: CalendarViewMode
): PeriodRollup | null {
  if (mode === "all") return null;
  const prevAnchor = navigateAnchor(anchorDate, mode, -1);
  return currentPeriodRollup(tracking, prevAnchor, mode);
}

export function monthGridDays(anchorDate: string): (string | null)[] {
  const d = zonedDate(anchorDate);
  const monthStart = startOfMonth(d);
  const monthEnd = endOfMonth(d);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const days: (string | null)[] = [];
  let cursor = gridStart;
  while (cursor <= gridEnd) {
    if (cursor < monthStart || cursor > monthEnd) {
      days.push(null);
    } else {
      days.push(formatInTimeZone(cursor, TRACKING_TIMEZONE, "yyyy-MM-dd"));
    }
    cursor = addDays(cursor, 1);
  }
  return days;
}

export function weekDayKeys(anchorDate: string): string[] {
  const d = zonedDate(anchorDate);
  const weekStart = startOfWeek(d, { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) =>
    formatInTimeZone(addDays(weekStart, i), TRACKING_TIMEZONE, "yyyy-MM-dd")
  );
}

export function yearMonthKeys(anchorDate: string): string[] {
  const year = yearRollupKey(anchorDate);
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
}

export function formatUnits(units: number): string {
  const rounded = Math.round(units * 100) / 100;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(2)}u`;
}

export function formatRoi(roi: number): string {
  return `${roi > 0 ? "+" : ""}${roi.toFixed(1)}%`;
}

export function formatDelta(current: number, previous: number, suffix = "u"): string {
  const delta = current - previous;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(2)}${suffix}`;
}

export function weekdayShort(dateStr: string): string {
  return format(zonedDate(dateStr), "EEE");
}

export function dayOfMonth(dateStr: string): string {
  return format(zonedDate(dateStr), "d");
}
