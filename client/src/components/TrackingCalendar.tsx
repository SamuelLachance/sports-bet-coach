import { useMemo } from "react";
import type { PeriodRollup, TrackingResponse } from "../types";
import {
  type CalendarViewMode,
  type DayBetStatus,
  currentPeriodRollup,
  dayBetStatus,
  dayLabel,
  dayOfMonth,
  filterBetsByPeriod,
  findRollup,
  formatDelta,
  formatRoi,
  formatUnits,
  getPeriodLabel,
  monthGridDays,
  monthLabel,
  monthRollupKey,
  navigateAnchor,
  previousPeriodRollup,
  rollupRecord,
  weekDayKeys,
  weekdayShort,
  yearMonthKeys,
  yearRollupKey,
} from "../utils/trackingCalendar";

interface TrackingCalendarProps {
  tracking: TrackingResponse;
  viewMode: CalendarViewMode;
  anchorDate: string;
  onViewModeChange: (mode: CalendarViewMode) => void;
  onAnchorDateChange: (date: string) => void;
}

const VIEW_MODES: { id: CalendarViewMode; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
  { id: "all", label: "All time" },
];

const DAY_STATUS_DOT: Record<DayBetStatus, string> = {
  win: "bg-success",
  loss: "bg-danger",
  mixed: "bg-warning",
  pending: "bg-slate-500",
  none: "bg-transparent",
};

export function TrackingCalendar({
  tracking,
  viewMode,
  anchorDate,
  onViewModeChange,
  onAnchorDateChange,
}: TrackingCalendarProps) {
  const dailyMap = useMemo(() => {
    const map = new Map<string, PeriodRollup>();
    for (const row of tracking.daily ?? []) map.set(row.key, row);
    return map;
  }, [tracking.daily]);

  const monthlyMap = useMemo(() => {
    const map = new Map<string, PeriodRollup>();
    for (const row of tracking.monthly) map.set(row.key, row);
    return map;
  }, [tracking.monthly]);

  const current = currentPeriodRollup(tracking, anchorDate, viewMode);
  const previous = previousPeriodRollup(tracking, anchorDate, viewMode);
  const periodLabel = getPeriodLabel(anchorDate, viewMode);
  const filteredCount = filterBetsByPeriod(tracking.bets, anchorDate, viewMode).length;

  return (
    <section className="card space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="font-display font-semibold text-lg">Bet calendar</h3>
        <div className="flex flex-wrap gap-1">
          {VIEW_MODES.map(({ id, label }) => (
            <ModeToggle
              key={id}
              active={viewMode === id}
              onClick={() => onViewModeChange(id)}
              label={label}
            />
          ))}
        </div>
      </div>

      {viewMode !== "all" && (
        <div className="flex items-center justify-between gap-2">
          <NavButton
            label="Previous period"
            onClick={() => onAnchorDateChange(navigateAnchor(anchorDate, viewMode, -1))}
          />
          <div className="text-center min-w-0 flex-1">
            <div className="font-display font-semibold text-white truncate">{periodLabel}</div>
            <div className="text-xs text-slate-500">{filteredCount} bet{filteredCount !== 1 ? "s" : ""}</div>
          </div>
          <NavButton
            label="Next period"
            onClick={() => onAnchorDateChange(navigateAnchor(anchorDate, viewMode, 1))}
            reverse
          />
        </div>
      )}

      <PeriodStatsRow current={current} />
      {viewMode !== "all" && current && (
        <ComparisonRow current={current} previous={previous} viewMode={viewMode} />
      )}

      {viewMode === "day" && (
        <DayView
          anchorDate={anchorDate}
          daily={dailyMap.get(anchorDate)}
          onSelectDay={onAnchorDateChange}
        />
      )}

      {viewMode === "week" && (
        <WeekView
          anchorDate={anchorDate}
          dailyMap={dailyMap}
          selectedDate={anchorDate}
          onSelectDay={onAnchorDateChange}
        />
      )}

      {viewMode === "month" && (
        <MonthView
          anchorDate={anchorDate}
          dailyMap={dailyMap}
          selectedDate={anchorDate}
          onSelectDay={(dateStr) => {
            onAnchorDateChange(dateStr);
            onViewModeChange("day");
          }}
        />
      )}

      {viewMode === "year" && (
        <YearView
          anchorDate={anchorDate}
          monthlyMap={monthlyMap}
          selectedMonth={monthRollupKey(anchorDate)}
          onSelectMonth={(monthKey) => {
            onAnchorDateChange(`${monthKey}-01`);
            onViewModeChange("month");
          }}
        />
      )}

      {viewMode === "all" && (
        <p className="text-sm text-slate-500 text-center py-2">
          Full bet history · use Day, Week, Month, or Year to drill into a period
        </p>
      )}
    </section>
  );
}

function ModeToggle({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        active
          ? "bg-accent/20 text-accent-glow border border-accent/30"
          : "text-slate-400 hover:text-slate-200 hover:bg-surface-raised border border-transparent"
      }`}
    >
      {label}
    </button>
  );
}

function NavButton({
  label,
  onClick,
  reverse,
}: {
  label: string;
  onClick: () => void;
  reverse?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-white hover:bg-surface-raised border border-surface-border/60 transition-colors"
    >
      <span className="sr-only">{label}</span>
      <svg
        className={`w-5 h-5 ${reverse ? "rotate-180" : ""}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
    </button>
  );
}

function PeriodStatsRow({ current }: { current: PeriodRollup | null }) {
  if (!current || current.bets === 0) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 py-2">
        <StatPill label="Record" value="—" />
        <StatPill label="Units" value="—" />
        <StatPill label="ROI" value="—" />
        <StatPill label="Bets" value="0" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <StatPill label="Record" value={rollupRecord(current)} />
      <StatPill
        label="Units"
        value={formatUnits(current.units)}
        positive={current.units > 0}
        negative={current.units < 0}
      />
      <StatPill
        label="ROI"
        value={formatRoi(current.roiPercent)}
        positive={current.roiPercent > 0}
        negative={current.roiPercent < 0}
      />
      <StatPill label="Bets" value={String(current.bets)} />
    </div>
  );
}

function StatPill({
  label,
  value,
  positive,
  negative,
}: {
  label: string;
  value: string;
  positive?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="rounded-lg bg-surface-raised/50 border border-surface-border/50 px-3 py-2 text-center">
      <div
        className={`text-sm font-semibold font-display ${
          positive ? "text-success" : negative ? "text-danger" : "text-white"
        }`}
      >
        {value}
      </div>
      <div className="text-[10px] text-slate-500 uppercase tracking-wide mt-0.5">{label}</div>
    </div>
  );
}

function ComparisonRow({
  current,
  previous,
  viewMode,
}: {
  current: PeriodRollup;
  previous: PeriodRollup | null;
  viewMode: CalendarViewMode;
}) {
  const prev = previous ?? {
    key: "",
    label: "",
    wins: 0,
    losses: 0,
    pushes: 0,
    pending: 0,
    units: 0,
    bets: 0,
    roiPercent: 0,
  };
  const periodWord =
    viewMode === "day"
      ? "day"
      : viewMode === "week"
        ? "week"
        : viewMode === "month"
          ? "month"
          : "year";

  const unitsDelta = formatDelta(current.units, prev.units);
  const roiDelta = formatDelta(current.roiPercent, prev.roiPercent, "%");
  const prevUnits = formatUnits(prev.units);
  const curUnits = formatUnits(current.units);

  return (
    <div className="rounded-lg border border-surface-border/60 bg-surface-raised/30 px-3 py-2.5 text-sm">
      <div className="text-xs text-slate-500 mb-1.5">vs previous {periodWord}</div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span>
          This {periodWord}:{" "}
          <span className={current.units >= 0 ? "text-success" : "text-danger"}>{curUnits}</span>
        </span>
        <span className="text-slate-500">
          Last {periodWord}: {prevUnits}
        </span>
        <span
          className={
            current.units - prev.units >= 0 ? "text-success" : "text-danger"
          }
        >
          Δ {unitsDelta}
        </span>
        <span className="text-slate-400 hidden sm:inline">
          ROI Δ {roiDelta}
        </span>
      </div>
    </div>
  );
}

function DayView({
  anchorDate,
  daily,
  onSelectDay,
}: {
  anchorDate: string;
  daily: PeriodRollup | undefined;
  onSelectDay: (date: string) => void;
}) {
  const status = dayBetStatus(daily);
  return (
    <button
      type="button"
      onClick={() => onSelectDay(anchorDate)}
      className="w-full rounded-lg border border-surface-border/60 bg-surface-raised/40 p-4 text-left hover:border-accent/40 transition-colors"
    >
      <div className="flex items-center gap-3">
        <DayStatusDot status={status} large />
        <div>
          <div className="font-medium text-white">{dayLabel(anchorDate)}</div>
          {daily ? (
            <div className="text-sm text-slate-400 mt-0.5">
              {rollupRecord(daily)} · {formatUnits(daily.units)} · {daily.bets} bet
              {daily.bets !== 1 ? "s" : ""}
            </div>
          ) : (
            <div className="text-sm text-slate-500 mt-0.5">No bets this day</div>
          )}
        </div>
      </div>
    </button>
  );
}

function WeekView({
  anchorDate,
  dailyMap,
  selectedDate,
  onSelectDay,
}: {
  anchorDate: string;
  dailyMap: Map<string, PeriodRollup>;
  selectedDate: string;
  onSelectDay: (date: string) => void;
}) {
  const days = weekDayKeys(anchorDate);
  return (
    <div className="grid grid-cols-7 gap-1 sm:gap-2">
      {days.map((dateStr) => {
        const daily = dailyMap.get(dateStr);
        const status = dayBetStatus(daily);
        const selected = dateStr === selectedDate;
        return (
          <button
            key={dateStr}
            type="button"
            onClick={() => onSelectDay(dateStr)}
            className={`rounded-lg border p-2 text-center transition-colors min-h-[4.5rem] ${
              selected
                ? "border-accent/50 bg-accent/10"
                : "border-surface-border/50 bg-surface-raised/30 hover:border-surface-border"
            }`}
          >
            <div className="text-[10px] text-slate-500">{weekdayShort(dateStr)}</div>
            <div className="text-sm font-semibold text-white">{dayOfMonth(dateStr)}</div>
            <div className="flex justify-center mt-1">
              <DayStatusDot status={status} />
            </div>
            {daily && (
              <div
                className={`text-[10px] mt-1 font-medium ${
                  daily.units >= 0 ? "text-success" : "text-danger"
                }`}
              >
                {formatUnits(daily.units)}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

function MonthView({
  anchorDate,
  dailyMap,
  selectedDate,
  onSelectDay,
}: {
  anchorDate: string;
  dailyMap: Map<string, PeriodRollup>;
  selectedDate: string;
  onSelectDay: (date: string) => void;
}) {
  const days = monthGridDays(anchorDate);
  const weekHeaders = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {weekHeaders.map((h) => (
          <div key={h} className="text-center text-[10px] text-slate-500 py-1">
            {h}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((dateStr, i) => {
          if (!dateStr) {
            return <div key={`empty-${i}`} className="aspect-square" />;
          }
          const daily = dailyMap.get(dateStr);
          const status = dayBetStatus(daily);
          const selected = dateStr === selectedDate;
          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => onSelectDay(dateStr)}
              className={`aspect-square rounded-lg border flex flex-col items-center justify-center gap-0.5 transition-colors ${
                selected
                  ? "border-accent/50 bg-accent/10"
                  : "border-surface-border/40 bg-surface-raised/20 hover:border-surface-border"
              }`}
            >
              <span className="text-xs text-slate-300">{dayOfMonth(dateStr)}</span>
              <DayStatusDot status={status} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function YearView({
  anchorDate,
  monthlyMap,
  selectedMonth,
  onSelectMonth,
}: {
  anchorDate: string;
  monthlyMap: Map<string, PeriodRollup>;
  selectedMonth: string;
  onSelectMonth: (monthKey: string) => void;
}) {
  const months = yearMonthKeys(anchorDate);
  const year = yearRollupKey(anchorDate);

  return (
    <div>
      <div className="text-center text-sm text-slate-400 mb-3">{year}</div>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {months.map((monthKey) => {
          const monthly = monthlyMap.get(monthKey);
          const selected = monthKey === selectedMonth;
          return (
            <button
              key={monthKey}
              type="button"
              onClick={() => onSelectMonth(monthKey)}
              className={`rounded-lg border p-3 text-left transition-colors ${
                selected
                  ? "border-accent/50 bg-accent/10"
                  : "border-surface-border/50 bg-surface-raised/30 hover:border-surface-border"
              }`}
            >
              <div className="text-sm font-medium text-white">{monthLabel(monthKey)}</div>
              {monthly ? (
                <>
                  <div
                    className={`text-lg font-display font-bold mt-1 ${
                      monthly.units >= 0 ? "text-success" : "text-danger"
                    }`}
                  >
                    {formatUnits(monthly.units)}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {rollupRecord(monthly)} · {monthly.bets} bets
                  </div>
                </>
              ) : (
                <div className="text-xs text-slate-600 mt-2">—</div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DayStatusDot({ status, large }: { status: DayBetStatus; large?: boolean }) {
  const size = large ? "w-3 h-3" : "w-2 h-2";
  if (status === "none") {
    return <span className={`${size} rounded-full border border-surface-border/60`} />;
  }
  return <span className={`${size} rounded-full ${DAY_STATUS_DOT[status]}`} />;
}

export { findRollup };
