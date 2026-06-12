import fs from "node:fs/promises";
import path from "node:path";
import { endOfWeek, parseISO, startOfWeek } from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { CACHE_DIR, ESPN_LEAGUES, TIMEZONE, TRACKING_STORE_FILE } from "../config.js";
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
import { DEFAULT_JUICE } from "../parsers/pickBetParser.js";
import { SIGNAL_LABELS } from "./signalMapping.js";

export type BetResult = "pending" | "win" | "loss" | "push";

export { DEFAULT_JUICE };

/** Profit/loss in units for a 1u bet at American odds. Push returns 0. */
export function calculateUnits(
  stake: number,
  americanOdds: number,
  result: "win" | "loss" | "push"
): number {
  if (result === "push") return 0;
  if (result === "loss") return -stake;
  if (americanOdds > 0) return stake * (americanOdds / 100);
  return stake * (100 / Math.abs(americanOdds));
}

function betTypeForBet(bet: {
  betType?: BetType;
  recommendedBet?: ParsedBet;
}): BetType {
  return bet.betType ?? bet.recommendedBet?.betType ?? "moneyline";
}

/** Book consensus American odds (juice or moneyline) used for unit P/L. */
export function resolveAmericanOdds(bet: TrackedBet): number {
  const betType = betTypeForBet(bet);
  if (betType === "spread" || betType === "total") {
    return (
      bet.consensusOdds ??
      bet.odds ??
      bet.recommendedBet?.odds ??
      bet.americanOdds ??
      DEFAULT_JUICE
    );
  }
  if (bet.consensusOdds != null) return bet.consensusOdds;
  if (bet.americanOdds != null) return bet.americanOdds;
  if (bet.odds != null) return bet.odds;
  if (bet.recommendedBet?.odds != null) return bet.recommendedBet.odds;
  return DEFAULT_JUICE;
}

function resolveAmericanOddsForRec(rec: GameConsolidatedRecommendation): number {
  const betMeta = rec.recommendedBet;
  const betType = betMeta?.betType ?? rec.betType ?? "moneyline";
  if (betType === "spread" || betType === "total") {
    return rec.consensusOdds ?? betMeta?.odds ?? DEFAULT_JUICE;
  }
  if (rec.consensusOdds != null && Number.isFinite(rec.consensusOdds)) {
    return rec.consensusOdds;
  }
  if (betMeta?.odds != null) return betMeta.odds;
  return DEFAULT_JUICE;
}

/** Spread line from book consensus when available; otherwise the sheet pick line. */
export function resolveGradingSpread(bet: TrackedBet): number | undefined {
  if (bet.consensusSpread != null) return bet.consensusSpread;
  return bet.spread ?? bet.recommendedBet?.spread;
}

/** Total line from book consensus when available; otherwise the sheet pick line. */
export function resolveGradingTotal(bet: TrackedBet): number | undefined {
  if (bet.consensusTotal != null) return bet.consensusTotal;
  return bet.totalLine ?? bet.recommendedBet?.totalLine;
}

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
  /** Resolved American odds used for unit grading (pick, fade, or -110 default). */
  americanOdds?: number;
  /** Book consensus display (e.g. +103 or -9.5 (-110)). */
  consensusLabel?: string;
  consensusOdds?: number;
  /** Book spread/total line used for win-loss grading. */
  consensusSpread?: number;
  consensusTotal?: number;
  bookProvider?: string;
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

const TRACKING_CACHE_FILE = path.join(CACHE_DIR, "tracking.json");

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Union bet stores by date+gameKey; existing entries are never removed. */
export function mergeStores(base: TrackingStore, overlay: TrackingStore): TrackingStore {
  const index = new Map(base.bets.map((b) => [betKey(b.date, b.gameKey), b]));
  for (const bet of overlay.bets) {
    const key = betKey(bet.date, bet.gameKey);
    if (!index.has(key)) {
      index.set(key, bet);
    }
  }
  return { version: 1, bets: [...index.values()] };
}

async function loadStore(): Promise<TrackingStore> {
  let store: TrackingStore = { version: 1, bets: [] };
  for (const file of [TRACKING_STORE_FILE, TRACKING_CACHE_FILE]) {
    try {
      const raw = await fs.readFile(file, "utf-8");
      store = mergeStores(store, JSON.parse(raw) as TrackingStore);
    } catch {
      // missing or unreadable — try next source
    }
  }
  return store;
}

async function saveStore(store: TrackingStore): Promise<void> {
  const payload = JSON.stringify(store, null, 2);
  await fs.mkdir(path.dirname(TRACKING_STORE_FILE), { recursive: true });
  await fs.writeFile(TRACKING_STORE_FILE, payload, "utf-8");
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(TRACKING_CACHE_FILE, payload, "utf-8");
}

/** Merge baked or remote tracking into the active store (browser sync seed). */
export async function seedTrackingStore(overlay: TrackingStore): Promise<void> {
  const store = mergeStores(await loadStore(), overlay);
  await saveStore(store);
}

function betKey(date: string, gameKey: string): string {
  return `${date}:${gameKey}`;
}

/** ESPN sport league used to fetch scores (MODEL/WHALE picks use gameKey prefix or matched game). */
export function resolveGradingLeague(bet: TrackedBet): LeagueCode | undefined {
  if (ESPN_LEAGUES[bet.league]) return bet.league;
  const prefix = bet.gameKey.split(":")[0];
  if (ESPN_LEAGUES[prefix]) return prefix as LeagueCode;
  return undefined;
}

function gradingLeaguesForBets(bets: TrackedBet[]): LeagueCode[] {
  const leagues = new Set<LeagueCode>();
  for (const bet of bets) {
    const league = resolveGradingLeague(bet);
    if (league) leagues.add(league);
  }
  return [...leagues];
}

function trackingLeagueForRec(rec: GameConsolidatedRecommendation): LeagueCode {
  if (ESPN_LEAGUES[rec.league]) return rec.league;
  if (rec.matchedGame?.league && ESPN_LEAGUES[rec.matchedGame.league]) {
    return rec.matchedGame.league;
  }
  const prefix = rec.gameKey.split(":")[0];
  if (ESPN_LEAGUES[prefix]) return prefix as LeagueCode;
  return rec.league;
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
      existing.americanOdds = resolveAmericanOddsForRec(rec);
      existing.consensusLabel = rec.consensusLabel;
      existing.consensusOdds = rec.consensusOdds;
      existing.consensusSpread = rec.consensusSpread;
      existing.consensusTotal = rec.consensusTotal;
      existing.bookProvider = rec.bookProvider;
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
      league: trackingLeagueForRec(rec),
      awayTeam: rec.awayTeam,
      homeTeam: rec.homeTeam,
      recommendedTeam: rec.recommendedTeam,
      recommendedBet: betMeta,
      betType: betMeta?.betType ?? rec.betType,
      spread: betMeta?.spread,
      odds: betMeta?.odds,
      americanOdds: resolveAmericanOddsForRec(rec),
      consensusLabel: rec.consensusLabel,
      consensusOdds: rec.consensusOdds,
      consensusSpread: rec.consensusSpread,
      consensusTotal: rec.consensusTotal,
      bookProvider: rec.bookProvider,
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
  const gradingLeague = resolveGradingLeague(bet);
  return results.find(
    (g) =>
      (!gradingLeague || g.league === gradingLeague) &&
      ((pickTeamInGame(bet.homeTeam, g) && pickTeamInGame(bet.awayTeam, g)) ||
        (g.homeTeam === bet.homeTeam && g.awayTeam === bet.awayTeam))
  );
}

function betSpread(bet: TrackedBet): number | undefined {
  return resolveGradingSpread(bet);
}

function betTotalLine(bet: TrackedBet): number | undefined {
  return resolveGradingTotal(bet);
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
  const americanOdds = resolveAmericanOdds(bet);
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

  if (status === "win" || status === "loss" || status === "push") {
    units = calculateUnits(stake, americanOdds, status);
  }

  return {
    ...bet,
    status,
    units,
    americanOdds,
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
    const leagues = gradingLeaguesForBets(bets);
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

/** Recompute units for already-settled bets when consensus odds change. */
export function refreshSettledUnits(store: TrackingStore): TrackingStore {
  store.bets = store.bets.map((bet) => {
    if (bet.status !== "win" && bet.status !== "loss" && bet.status !== "push") {
      return bet;
    }
    const americanOdds = resolveAmericanOdds(bet);
    const units = calculateUnits(bet.stakeUnits, americanOdds, bet.status);
    if (units === bet.units && bet.americanOdds === americanOdds) return bet;
    return { ...bet, units, americanOdds };
  });
  return store;
}

/** Re-grade settled bets using latest consensus spread/total lines and odds. */
export async function regradeSettledBets(store: TrackingStore): Promise<TrackingStore> {
  const settled = store.bets.filter(
    (b) => b.status === "win" || b.status === "loss" || b.status === "push"
  );
  if (settled.length === 0) return store;

  const byDate = new Map<string, TrackedBet[]>();
  for (const bet of settled) {
    const list = byDate.get(bet.date) ?? [];
    list.push(bet);
    byDate.set(bet.date, list);
  }

  for (const [date, bets] of byDate) {
    const leagues = gradingLeaguesForBets(bets);
    const results = await fetchResultsForDate(leagues, displayDateToEspnKey(date));

    for (const bet of bets) {
      const result = findMatchingResult(bet, results);
      if (!result?.isFinal) continue;
      const graded = gradeBet({ ...bet, status: "pending", units: 0 }, result);
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
  let totalStaked = 0;

  for (const bet of bets) {
    totalUnits += bet.units;
    if (bet.status === "win") wins += 1;
    else if (bet.status === "loss") losses += 1;
    else if (bet.status === "push") pushes += 1;
    else pending += 1;

    if (bet.status === "win" || bet.status === "loss" || bet.status === "push") {
      totalStaked += bet.stakeUnits;
    }
  }

  const roiPercent = totalStaked > 0 ? (totalUnits / totalStaked) * 100 : 0;

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
  store = await regradeSettledBets(store);
  store = refreshSettledUnits(store);
  await saveStore(store);
  return buildTrackingResponse(store);
}

export async function getTracking(): Promise<TrackingResponse> {
  let store = await loadStore();
  store = await gradePendingBets(store);
  store = await regradeSettledBets(store);
  store = refreshSettledUnits(store);
  await saveStore(store);
  return buildTrackingResponse(store);
}

/** Re-grade all pending bets (e.g. after server restart) */
export async function refreshTrackingGrades(): Promise<void> {
  let store = await loadStore();
  store = await gradePendingBets(store);
  store = await regradeSettledBets(store);
  store = refreshSettledUnits(store);
  await saveStore(store);
}
