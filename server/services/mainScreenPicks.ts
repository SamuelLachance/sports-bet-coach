import type {
  CalendarGame,
  GameConsolidatedRecommendation,
  MatchedRecommendation,
} from "../types.js";

export interface MainScreenFilterOptions {
  /** "ALL" or a league code */
  leagueFilter?: string;
  /** "all" or a signal type id */
  signalFilter?: string;
}

export function isActionableGameRec(rec: GameConsolidatedRecommendation): boolean {
  return !rec.noBet && Boolean(rec.recommendedTeam?.trim());
}

export function isVisiblePick(rec: MatchedRecommendation): boolean {
  return !rec.dratingsBlocked && !rec.sportsOddsBlocked;
}

function eventKeyForGame(game: CalendarGame): string {
  const away = game.awayTeam.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const home = game.homeTeam.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  return `${game.league}:${[away, home].sort().join("|")}`;
}

function filterRecommendations(
  recommendations: MatchedRecommendation[],
  options: MainScreenFilterOptions
): MatchedRecommendation[] {
  const leagueFilter = options.leagueFilter ?? "ALL";
  const signalFilter = options.signalFilter ?? "all";

  return recommendations.filter((r) => {
    if (leagueFilter !== "ALL" && r.league !== leagueFilter) return false;
    if (signalFilter !== "all" && r.signalType !== signalFilter) return false;
    return true;
  });
}

/**
 * Game recommendations shown as GameRecommendationCard on the Daily Picks tab
 * (default filters: all leagues, all signals). Standalone PickCard rows are excluded.
 */
export function selectMainScreenGameRecommendations(
  gameRecommendations: GameConsolidatedRecommendation[],
  recommendations: MatchedRecommendation[],
  options: MainScreenFilterOptions = {}
): GameConsolidatedRecommendation[] {
  if (!gameRecommendations.length) return [];

  const filtered = filterRecommendations(recommendations, options);
  const filteredIds = new Set(filtered.map((r) => r.id));

  const candidates = gameRecommendations.filter(
    (g) =>
      isActionableGameRec(g) &&
      (g.sportsOddsForced || g.pickIds.some((id) => filteredIds.has(id)))
  );

  const actionableByEvent = new Map<string, GameConsolidatedRecommendation[]>();
  for (const game of candidates) {
    if (!game.matchedGame) continue;
    const key = eventKeyForGame(game.matchedGame);
    const bucket = actionableByEvent.get(key) ?? [];
    bucket.push(game);
    actionableByEvent.set(key, bucket);
  }

  const suppressedEvents = new Set<string>();
  for (const [key, games] of actionableByEvent) {
    if (games.length > 1) suppressedEvents.add(key);
  }

  if (suppressedEvents.size === 0) {
    return candidates.sort((a, b) => b.confidence - a.confidence);
  }

  const resolved: GameConsolidatedRecommendation[] = [];
  for (const game of gameRecommendations) {
    if (!game.matchedGame) continue;
    const key = eventKeyForGame(game.matchedGame);
    if (!suppressedEvents.has(key)) continue;
    if (!game.noBet) continue;
    if (game.sportsOddsForced || game.pickIds.some((id) => filteredIds.has(id))) {
      resolved.push(game);
    }
  }

  const safe = candidates.filter((game) => {
    if (!game.matchedGame) return true;
    const key = eventKeyForGame(game.matchedGame);
    return !suppressedEvents.has(key);
  });

  return [...resolved, ...safe].sort((a, b) => b.confidence - a.confidence);
}

/**
 * Actionable GameRecommendationCard rows eligible for bet tracking.
 * Excludes no-bet conflict cards and standalone PickCard signals.
 */
export function selectTrackableGameRecommendations(
  gameRecommendations: GameConsolidatedRecommendation[],
  recommendations: MatchedRecommendation[],
  options: MainScreenFilterOptions = {}
): GameConsolidatedRecommendation[] {
  if (!gameRecommendations.length) return [];

  const filtered = filterRecommendations(recommendations, options);
  const filteredIds = new Set(filtered.map((r) => r.id));

  const candidates = gameRecommendations.filter(
    (g) =>
      isActionableGameRec(g) &&
      (g.sportsOddsForced || g.pickIds.some((id) => filteredIds.has(id)))
  );

  const actionableByEvent = new Map<string, GameConsolidatedRecommendation[]>();
  for (const game of candidates) {
    if (!game.matchedGame) continue;
    const key = eventKeyForGame(game.matchedGame);
    const bucket = actionableByEvent.get(key) ?? [];
    bucket.push(game);
    actionableByEvent.set(key, bucket);
  }

  const suppressedEvents = new Set<string>();
  for (const [key, games] of actionableByEvent) {
    if (games.length > 1) suppressedEvents.add(key);
  }

  if (suppressedEvents.size === 0) {
    return candidates.sort((a, b) => b.confidence - a.confidence);
  }

  const safe = candidates.filter((game) => {
    if (!game.matchedGame) return true;
    const key = eventKeyForGame(game.matchedGame);
    return !suppressedEvents.has(key);
  });

  return safe.sort((a, b) => b.confidence - a.confidence);
}

/** Standalone sheet picks shown as PickCard — excluded from bet tracking. */
export function selectMainScreenStandalonePicks(
  gameRecommendations: GameConsolidatedRecommendation[],
  recommendations: MatchedRecommendation[],
  options: MainScreenFilterOptions = {}
): MatchedRecommendation[] {
  const filtered = filterRecommendations(recommendations, options);

  const noBetPickIds = new Set<string>();
  for (const g of gameRecommendations) {
    if (!isActionableGameRec(g)) {
      for (const id of g.pickIds) noBetPickIds.add(id);
    }
  }

  return filtered
    .filter((r) => !noBetPickIds.has(r.id) && !r.gameConflict && isVisiblePick(r))
    .sort((a, b) => b.confidence - a.confidence);
}
