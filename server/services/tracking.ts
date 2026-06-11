import fs from "node:fs/promises";
import path from "node:path";
import { endOfWeek, parseISO, startOfWeek } from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { CACHE_DIR, TIMEZONE } from "../config.js";
import type {
  BetType,
  GameConsolidatedRecommendation,
  LeagueCode,
  MatchedRecommendation,
  ParsedBet,
  SignalType,
  TotalDirection,
} from "../types.js";
import {
  displayDateToEspnKey,
  fetchResultsForDate,
  pickTeamInGame,
  resolveGameTeamDisplay,
  type GameResult,
} from "./calendar.js";
import { SIGNAL_LABELS } from "./signalMapping.js";

export type BetResult = "pending" | "win" | "loss" | "push";

export interface TrackedBet {
  id: string;
  date: string;
  gameKey: string;
  league: LeagueCode;
  awayTeam: string;
  homeTeam: string;
  /** Full bet display text */
  recommendedTeam: string;
  recommendedBet?: ParsedBet;
  betType?: BetType;
  spread?: number;
  odds?: number;
  totalLine?: number;
  totalDirection?: TotalDirection;
  confidence: number;
  signalTypes: SignalType[];
  signalLabels: string[];
  status: BetResult;
  units: number;
  stakeUnits: number;
  gradedAt?: string;
  espnGameId?: string;
  finalScore?: string;
  highConviction?: boolean;
  recordedAt: string;
}

export interface PeriodRollup {
  key: string;
  label: string;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  units: number;
  bets: number;
}

export interface TrackingSummary {
  totalUnits: number;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  roiPercent: number;
  record: string;
  currentStreak: { type: "win" | "loss"; count: number } | null;
}

export interface TrackingResponse {
  bets: TrackedBet[];
  summary: TrackingSummary;
  weekly: PeriodRollup[];
  monthly: PeriodRollup[];
  trackingSince: string | null;
  note?: string;
  timezone: string;
  lastUpdated: string;
}

interface TrackingStore {
  version: 1;
  bets: TrackedBet[];
}

const TRACKING_FILE = path.join(CACHE_DIR, "tracking.json");

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

async function loadStore(): Promise<TrackingStore> {
  try {
    const raw = await fs.readFile(TRACKING_FILE, "utf-8");
    return JSON.parse(raw) as TrackingStore;
  } catch {
    return { version: 1, bets: [] };
  }
}

async function saveStore(store: TrackingStore): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(TRACKING_FILE, JSON.stringify(store, null, 2), "utf-8");
}

function betKey(date: string, gameKey: string): string {
  return `${date}:${gameKey}`;
}

function isActionable(rec: GameConsolidatedRecommendation): boolean {
  return !rec.noBet && Boolean(rec.recommendedTeam?.trim());
}

function signalInfoForGame(
  gameRec: GameConsolidatedRecommendation,
  recommendations: MatchedRecommendation[]
): { signalTypes: SignalType[]; signalLabels: string[] } {
  const pickIdSet = new Set(gameRec.pickIds);
  const related = recommendations.filter((r) => pickIdSet.has(r.id));
  const signalTypes = [...new Set(related.map((r) => r.signalType))];
  const signalLabels = signalTypes.map((s) => SIGNAL_LABELS[s]);
  return { signalTypes, signalLabels };
}

export function recordRecommendations(
  store: TrackingStore,
  gameRecommendations: GameConsolidatedRecommendation[],
  recommendations: MatchedRecommendation[],
  date: string
): TrackingStore {
  const now = new Date().toISOString();
  const index = new Map(store.bets.map((b) => [betKey(b.date, b.gameKey), b]));

  for (const rec of gameRecommendations) {
    if (!isActionable(rec)) continue;
    const key = betKey(date, rec.gameKey);
    const { signalTypes, signalLabels } = signalInfoForGame(rec, recommendations);
    const existing = index.get(key);

    if (existing) {
      existing.confidence = rec.confidence;
      existing.signalTypes = signalTypes;
      existing.signalLabels = signalLabels;
      existing.highConviction = rec.highConviction;
      existing.recommendedTeam = rec.recommendedTeam;
      existing.recommendedBet = rec.recommendedBet;
      existing.betType = rec.recommendedBet?.betType ?? rec.betType;
      existing.spread = rec.recommendedBet?.spread;
      existing.odds = rec.recommendedBet?.odds;
      existing.totalLine = rec.recommendedBet?.totalLine;
      existing.totalDirection = rec.recommendedBet?.totalDirection;
      if (rec.matchedGame?.id) existing.espnGameId = rec.matchedGame.id;
      continue;
    }

    const betMeta = rec.recommendedBet;
    const bet: TrackedBet = {
      id: key,
      date,
      gameKey: rec.gameKey,
      league: rec.league,
      awayTeam: rec.awayTeam,
      homeTeam: rec.homeTeam,
      recommendedTeam: rec.recommendedTeam,
      recommendedBet: betMeta,
      betType: betMeta?.betType ?? rec.betType,
      spread: betMeta?.spread,
      odds: betMeta?.odds,
      totalLine: betMeta?.totalLine,
      totalDirection: betMeta?.totalDirection,
      confidence: rec.confidence,
      signalTypes,
      signalLabels,
      status: "pending",
      units: 0,
      stakeUnits: 1,
      espnGameId: rec.matchedGame?.id,
      highConviction: rec.highConviction,
      recordedAt: now,
    };
    store.bets.push(bet);
    index.set(key, bet);
  }

  return store;
}

function findMatchingResult(bet: TrackedBet, results: GameResult[]): GameResult | undefined {
  if (bet.espnGameId) {
    const byId = results.find((g) => g.id === bet.espnGameId);
    if (byId) return byId;
  }
  return results.find(
    (g) =>
      g.league === bet.league &&
      ((pickTeamInGame(bet.homeTeam, g) && pickTeamInGame(bet.awayTeam, g)) ||
        (g.homeTeam === bet.homeTeam && g.awayTeam === bet.awayTeam))
  );
}

function betSpread(bet: TrackedBet): number | undefined {
  return bet.spread ?? bet.recommendedBet?.spread;
}

function betTotalLine(bet: TrackedBet): number | undefined {
  return bet.totalLine ?? bet.recommendedBet?.totalLine;
}

function betTotalDirection(bet: TrackedBet): TotalDirection | undefined {
  return bet.totalDirection ?? bet.recommendedBet?.totalDirection;
}

function betTypeForGrading(bet: TrackedBet): BetType {
  return bet.betType ?? bet.recommendedBet?.betType ?? "moneyline";
}

function teamNameForGrading(bet: TrackedBet): string | undefined {
  const raw = bet.recommendedBet?.team ?? bet.recommendedTeam;
  return raw?.trim() || undefined;
}

function teamScoreForBet(bet: TrackedBet, result: GameResult): {
  teamScore: number;
  opponentScore: number;
} | null {
  const teamName = teamNameForGrading(bet);
  if (!teamName || result.homeScore == null || result.awayScore == null) return null;

  const resolved = resolveGameTeamDisplay(teamName, result);
  if (!resolved) return null;

  if (resolved === result.homeTeam) {
    return { teamScore: result.homeScore, opponentScore: result.awayScore };
  }
  return { teamScore: result.awayScore, opponentScore: result.homeScore };
}

function gradeSpreadBet(
  bet: TrackedBet,
  result: GameResult
): BetResult | null {
  const spread = betSpread(bet);
  if (spread == null) return null;
  const scores = teamScoreForBet(bet, result);
  if (!scores) return null;

  const adjusted = scores.teamScore + spread;
  if (adjusted === scores.opponentScore) return "push";
  return adjusted > scores.opponentScore ? "win" : "loss";
}

function gradeTotalBet(bet: TrackedBet, result: GameResult): BetResult | null {
  const totalLine = betTotalLine(bet);
  const totalDirection = betTotalDirection(bet);
  if (totalLine == null || !totalDirection) return null;
  if (result.homeScore == null || result.awayScore == null) return null;

  const gameTotal = result.homeScore + result.awayScore;
  if (gameTotal === totalLine) return "push";
  if (totalDirection === "over") {
    return gameTotal > totalLine ? "win" : "loss";
  }
  return gameTotal < totalLine ? "win" : "loss";
}

function recommendedSideWon(recommendedTeam: string, result: GameResult): boolean {
  if (!result.winnerTeam) return false;
  const winnerOnly: GameResult = {
    ...result,
    homeTeam: result.winnerTeam,
    awayTeam: result.winnerTeam,
    homeAbbr: "",
    awayAbbr: "",
  };
  return pickTeamInGame(recommendedTeam, winnerOnly);
}

export function gradeBet(bet: TrackedBet, result: GameResult): TrackedBet {
  if (!result.isFinal) return bet;
  if (result.homeScore == null || result.awayScore == null) return bet;

  const stake = bet.stakeUnits;
  let status: BetResult = "pending";
  let units = 0;
  const betType = betTypeForGrading(bet);

  if (betType === "spread") {
    const spreadResult = gradeSpreadBet(bet, result);
    if (spreadResult == null) return bet;
    status = spreadResult;
  } else if (betType === "total") {
    const totalResult = gradeTotalBet(bet, result);
    if (totalResult == null) return bet;
    status = totalResult;
  } else if (result.homeScore === result.awayScore) {
    status = "push";
  } else if (result.winnerTeam) {
    const teamName = teamNameForGrading(bet);
    if (!teamName) return bet;
    status = recommendedSideWon(teamName, result) ? "win" : "loss";
  } else {
    return bet;
  }

  if (status === "win") units = stake;
  else if (status === "loss") units = -stake;

  return {
    ...bet,
    status,
    units,
    gradedAt: new Date().toISOString(),
    espnGameId: result.id,
    finalScore: `${result.awayTeam} ${result.awayScore} – ${result.homeTeam} ${result.homeScore}`,
  };
}

export async function gradePendingBets(store: TrackingStore): Promise<TrackingStore> {
  const pending = store.bets.filter((b) => b.status === "pending");
  if (pending.length === 0) return store;

  const byDate = new Map<string, TrackedBet[]>();
  for (const bet of pending) {
    const list = byDate.get(bet.date) ?? [];
    list.push(bet);
    byDate.set(bet.date, list);
  }

  for (const [date, bets] of byDate) {
    const leagues = [...new Set(bets.map((b) => b.league))] as LeagueCode[];
    const dateKey = displayDateToEspnKey(date);
    const results = await fetchResultsForDate(leagues, dateKey);

    for (const bet of bets) {
      const result = findMatchingResult(bet, results);
      if (!result) continue;
      const graded = gradeBet(bet, result);
      const idx = store.bets.findIndex((b) => b.id === bet.id);
      if (idx >= 0) store.bets[idx] = graded;
    }
  }

  return store;
}

function zonedDate(dateStr: string): Date {
  return toZonedTime(parseISO(`${dateStr}T12:00:00`), TIMEZONE);
}

function weekRollupKey(dateStr: string): string {
  const d = zonedDate(dateStr);
  const weekStart = startOfWeek(d, { weekStartsOn: 1 });
  return formatInTimeZone(weekStart, TIMEZONE, "yyyy-MM-dd");
}

function weekLabel(weekStartKey: string): string {
  const start = parseISO(`${weekStartKey}T12:00:00`);
  const end = endOfWeek(start, { weekStartsOn: 1 });
  const startLabel = formatInTimeZone(start, TIMEZONE, "MMM d");
  const endLabel = formatInTimeZone(end, TIMEZONE, "MMM d");
  return `${startLabel} – ${endLabel}`;
}

function monthRollupKey(dateStr: string): string {
  return formatInTimeZone(zonedDate(dateStr), TIMEZONE, "yyyy-MM");
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  const idx = parseInt(month, 10) - 1;
  return `${MONTH_SHORT[idx] ?? month} ${year}`;
}

function buildPeriodRollups(
  bets: TrackedBet[],
  keyFn: (date: string) => string,
  labelFn: (key: string) => string
): PeriodRollup[] {
  const map = new Map<string, PeriodRollup>();

  for (const bet of bets) {
    const key = keyFn(bet.date);
    if (!map.has(key)) {
      map.set(key, {
        key,
        label: labelFn(key),
        wins: 0,
        losses: 0,
        pushes: 0,
        pending: 0,
        units: 0,
        bets: 0,
      });
    }
    const row = map.get(key)!;
    row.bets += 1;
    row.units += bet.units;
    if (bet.status === "win") row.wins += 1;
    else if (bet.status === "loss") row.losses += 1;
    else if (bet.status === "push") row.pushes += 1;
    else row.pending += 1;
  }

  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function buildSummary(bets: TrackedBet[]): TrackingSummary {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let pending = 0;
  let totalUnits = 0;

  for (const bet of bets) {
    totalUnits += bet.units;
    if (bet.status === "win") wins += 1;
    else if (bet.status === "loss") losses += 1;
    else if (bet.status === "push") pushes += 1;
    else pending += 1;
  }

  const settled = wins + losses + pushes;
  const staked = wins + losses;
  const roiPercent = staked > 0 ? (totalUnits / staked) * 100 : 0;

  const settledSorted = bets
    .filter((b) => b.status === "win" || b.status === "loss")
    .sort((a, b) => {
      const da = a.gradedAt ?? a.date;
      const db = b.gradedAt ?? b.date;
      return db.localeCompare(da);
    });

  let currentStreak: TrackingSummary["currentStreak"] = null;
  if (settledSorted.length > 0) {
    const first = settledSorted[0].status as "win" | "loss";
    let count = 0;
    for (const bet of settledSorted) {
      if (bet.status !== first) break;
      count += 1;
    }
    currentStreak = { type: first, count };
  }

  return {
    totalUnits,
    wins,
    losses,
    pushes,
    pending,
    roiPercent,
    record: `${wins}-${losses}${pushes > 0 ? `-${pushes}` : ""}`,
    currentStreak,
  };
}

export function buildTrackingResponse(store: TrackingStore): TrackingResponse {
  const sorted = [...store.bets].sort((a, b) => {
    const dateCmp = b.date.localeCompare(a.date);
    if (dateCmp !== 0) return dateCmp;
    return b.confidence - a.confidence;
  });

  const trackingSince =
    sorted.length > 0 ? sorted[sorted.length - 1].date : null;

  return {
    bets: sorted,
    summary: buildSummary(sorted),
    weekly: buildPeriodRollups(sorted, weekRollupKey, weekLabel),
    monthly: buildPeriodRollups(sorted, monthRollupKey, monthLabel),
    trackingSince,
    note:
      sorted.length === 0
        ? "Tracking begins when recommendations are generated. Sync or load Daily Picks to start logging bets."
        : "Bet log tracks consolidated game recommendations from this app. Historical sheet performance is not backfilled per bet.",
    timezone: TIMEZONE,
    lastUpdated: new Date().toISOString(),
  };
}

export async function updateTracking(
  gameRecommendations: GameConsolidatedRecommendation[],
  recommendations: MatchedRecommendation[],
  date: string
): Promise<TrackingResponse> {
  let store = await loadStore();
  store = recordRecommendations(store, gameRecommendations, recommendations, date);
  store = await gradePendingBets(store);
  await saveStore(store);
  return buildTrackingResponse(store);
}

export async function getTracking(): Promise<TrackingResponse> {
  let store = await loadStore();
  store = await gradePendingBets(store);
  await saveStore(store);
  return buildTrackingResponse(store);
}

/** Re-grade all pending bets (e.g. after server restart) */
export async function refreshTrackingGrades(): Promise<void> {
  let store = await loadStore();
  store = await gradePendingBets(store);
  await saveStore(store);
}
