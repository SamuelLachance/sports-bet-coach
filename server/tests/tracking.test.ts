import assert from "node:assert/strict";
import { fadeParsedBet, parsePickBet } from "../parsers/pickBetParser.js";
import {
  buildPeriodRollups,
  buildTrackingResponse,
  calculateUnits,
  DEFAULT_JUICE,
  gradeBet,
  mergeStores,
  recordRecommendations,
  refreshSettledUnits,
  resolveAmericanOdds,
  resolveGradingLeague,
  resolveGradingSpread,
  type TrackedBet,
  type TrackingStore,
} from "../services/tracking.js";
import {
  selectMainScreenGameRecommendations,
  selectMainScreenStandalonePicks,
  selectTrackableGameRecommendations,
} from "../services/mainScreenPicks.js";
import type { CalendarGame, GameConsolidatedRecommendation, MatchedRecommendation } from "../types.js";
import type { GameResult } from "../services/calendar.js";

function emptyStore(): TrackingStore {
  return { version: 1, bets: [] };
}

function sampleGameRec(overrides: Partial<GameConsolidatedRecommendation> = {}): GameConsolidatedRecommendation {
  return {
    gameKey: "mlb:test",
    league: "MLB",
    awayTeam: "New York Yankees",
    homeTeam: "Boston Red Sox",
    recommendedTeam: "New York Yankees",
    confidence: 72,
    confidenceBreakdown: [],
    hasConflict: false,
    pickIds: ["pick-1"],
    reasoning: "Sharp money",
    ...overrides,
  };
}

function sampleRec(): MatchedRecommendation {
  return {
    id: "pick-1",
    league: "MLB",
    signalType: "sharp_money",
    signalLabel: "Sharp Money",
    pick: "Yankees",
    confidence: 72,
    confidenceBreakdown: [],
    signalPolarity: "positive",
    edgeLabel: "Edge",
    reasoning: "Sharp",
    status: "recommended",
    gameDate: "2026-06-11",
    gameKey: "mlb:test",
  };
}

function finalResult(winner: "home" | "away"): GameResult {
  return {
    id: "espn-1",
    league: "MLB",
    awayTeam: "New York Yankees",
    homeTeam: "Boston Red Sox",
    awayAbbr: "NYY",
    homeAbbr: "BOS",
    startTime: "2026-06-11T23:00:00Z",
    status: "Final",
    isFinal: true,
    awayScore: winner === "away" ? 5 : 2,
    homeScore: winner === "home" ? 4 : 1,
    winnerTeam: winner === "away" ? "New York Yankees" : "Boston Red Sox",
  };
}

function nbaDallasPortlandResult(
  awayScore: number,
  homeScore: number
): GameResult {
  return {
    id: "espn-nba-dal-por",
    league: "NBA",
    awayTeam: "Dallas Wings",
    homeTeam: "Portland Fire",
    awayAbbr: "DAL",
    homeAbbr: "POR",
    startTime: "2026-06-11T23:00:00Z",
    status: "Final",
    isFinal: true,
    awayScore,
    homeScore,
    winnerTeam:
      awayScore > homeScore
        ? "Dallas Wings"
        : homeScore > awayScore
          ? "Portland Fire"
          : undefined,
  };
}

function spreadBetFromParsed(
  parsed: NonNullable<ReturnType<typeof parsePickBet>>,
  overrides: Partial<TrackedBet> = {}
): TrackedBet {
  return {
    id: overrides.id ?? "spread-test",
    date: overrides.date ?? "2026-06-11",
    gameKey: overrides.gameKey ?? "nba:spread",
    league: overrides.league ?? "NBA",
    awayTeam: overrides.awayTeam ?? "Dallas Wings",
    homeTeam: overrides.homeTeam ?? "Portland Fire",
    recommendedTeam: parsed.displayText,
    betType: "spread",
    spread: parsed.spread,
    recommendedBet: parsed,
    confidence: 75,
    signalTypes: ["sharp_money"],
    signalLabels: ["Sharp Money"],
    status: "pending",
    units: 0,
    stakeUnits: 1,
    recordedAt: new Date().toISOString(),
    ...overrides,
  };
}

// Recording a new date keeps prior dates (cumulative bet log)
{
  let store = emptyStore();
  store = recordRecommendations(store, [sampleGameRec()], [sampleRec()], "2026-06-11");
  store = recordRecommendations(
    store,
    [sampleGameRec({ gameKey: "mlb:next-day", homeTeam: "Tampa Bay Rays" })],
    [sampleRec()],
    "2026-06-12"
  );
  assert.equal(store.bets.length, 2);
  assert.equal(store.bets.filter((b) => b.date === "2026-06-11").length, 1);
  assert.equal(store.bets.filter((b) => b.date === "2026-06-12").length, 1);
}

// mergeStores unions bets without dropping either date
{
  const dayOne = recordRecommendations(
    emptyStore(),
    [sampleGameRec()],
    [sampleRec()],
    "2026-06-11"
  );
  const dayTwo = recordRecommendations(
    emptyStore(),
    [sampleGameRec({ gameKey: "mlb:next-day", homeTeam: "Tampa Bay Rays" })],
    [sampleRec()],
    "2026-06-12"
  );
  const merged = mergeStores(dayOne, dayTwo);
  assert.equal(merged.bets.length, 2);
}

// resolveGradingLeague maps sheet-only leagues via gameKey prefix
{
  const modelBet: TrackedBet = {
    id: "model-wnba",
    date: "2026-06-11",
    gameKey: "WNBA:espn-401856980",
    league: "MODEL",
    awayTeam: "Chicago Sky",
    homeTeam: "Indiana Fever",
    recommendedTeam: "Indiana Fever -9.5",
    confidence: 75,
    signalTypes: ["model_best_values"],
    signalLabels: ["Model Best Values (Fade)"],
    status: "pending",
    units: 0,
    stakeUnits: 1,
    espnGameId: "401856980",
    recordedAt: new Date().toISOString(),
  };
  assert.equal(resolveGradingLeague(modelBet), "WNBA");
  assert.equal(resolveGradingLeague({ ...modelBet, league: "MLB", gameKey: "MLB:espn-1" }), "MLB");
}

// Record actionable recommendations
{
  let store = emptyStore();
  store = recordRecommendations(
    store,
    [sampleGameRec()],
    [sampleRec()],
    "2026-06-11"
  );
  assert.equal(store.bets.length, 1);
  assert.equal(store.bets[0].status, "pending");
  assert.deepEqual(store.bets[0].signalTypes, ["sharp_money"]);
}

// Record book consensus odds on tracked bets
{
  let store = emptyStore();
  store = recordRecommendations(
    store,
    [
      sampleGameRec({
        recommendedTeam: "Chicago White Sox",
        consensusLabel: "+103",
        consensusOdds: 103,
        bookProvider: "ESPN",
        betType: "moneyline",
      }),
    ],
    [sampleRec()],
    "2026-06-11"
  );
  assert.equal(store.bets[0].consensusLabel, "+103");
  assert.equal(store.bets[0].consensusOdds, 103);
  assert.equal(store.bets[0].americanOdds, 103);
  assert.equal(store.bets[0].bookProvider, "ESPN");
}

// Record consensus spread line for spread grading
{
  let store = emptyStore();
  store = recordRecommendations(
    store,
    [
      sampleGameRec({
        recommendedTeam: "Las Vegas Aces -9.5",
        betType: "spread",
        recommendedBet: {
          betType: "spread",
          team: "Las Vegas Aces",
          rawText: "PORTLAND +9.5",
          spread: -9.5,
          odds: -110,
          displayText: "Las Vegas Aces -9.5",
        },
        consensusSpread: -10.5,
        consensusOdds: -110,
        consensusLabel: "-10.5 (-110)",
        bookProvider: "DraftKings",
      }),
    ],
    [sampleRec()],
    "2026-06-11"
  );
  assert.equal(store.bets[0].consensusSpread, -10.5);
  assert.equal(resolveGradingSpread(store.bets[0]), -10.5);
}

// Skip no-bet games
{
  let store = emptyStore();
  store = recordRecommendations(
    store,
    [sampleGameRec({ noBet: true, recommendedTeam: "" })],
    [],
    "2026-06-11"
  );
  assert.equal(store.bets.length, 0);
}

// Only main-screen game recommendations are tracked (not standalone sheet picks)
{
  const matchedGame: CalendarGame = {
    id: "401",
    league: "MLB",
    awayTeam: "New York Yankees",
    homeTeam: "Boston Red Sox",
    awayAbbr: "NYY",
    homeAbbr: "BOS",
    startTime: "2026-06-11T23:00:00Z",
    status: "Scheduled",
  };
  const gameRec = sampleGameRec({ matchedGame, pickIds: ["pick-1"] });
  const standalonePick: MatchedRecommendation = {
    ...sampleRec(),
    id: "standalone-pick",
    gameKey: "mlb:other",
    pick: "Dodgers",
    matchedGame: {
      ...matchedGame,
      awayTeam: "Los Angeles Dodgers",
      homeTeam: "San Francisco Giants",
    },
  };
  let store = emptyStore();
  store = recordRecommendations(store, [gameRec], [sampleRec(), standalonePick], "2026-06-11");
  assert.equal(store.bets.length, 1);
  assert.equal(store.bets[0].gameKey, "mlb:test");
}

// Sports Odds force picks (no sheet pickIds) are tracked when shown as game rec cards
{
  const matchedGame: CalendarGame = {
    id: "402",
    league: "NBA",
    awayTeam: "Boston Celtics",
    homeTeam: "New York Knicks",
    awayAbbr: "BOS",
    homeAbbr: "NYK",
    startTime: "2026-06-11T23:00:00Z",
    status: "Scheduled",
  };
  const forcedRec = sampleGameRec({
    gameKey: "nba:espn-402",
    league: "NBA",
    awayTeam: "Boston Celtics",
    homeTeam: "New York Knicks",
    recommendedTeam: "Boston Celtics -3.5",
    pickIds: [],
    sportsOddsForced: true,
    matchedGame,
  });
  let store = emptyStore();
  store = recordRecommendations(store, [forcedRec], [], "2026-06-11");
  assert.equal(store.bets.length, 1);
  assert.equal(store.bets[0].gameKey, "nba:espn-402");
}

// Actionable game recs without sheet linkage and not forced are excluded
{
  const matchedGame: CalendarGame = {
    id: "403",
    league: "MLB",
    awayTeam: "Chicago Cubs",
    homeTeam: "St. Louis Cardinals",
    awayAbbr: "CHC",
    homeAbbr: "STL",
    startTime: "2026-06-11T23:00:00Z",
    status: "Scheduled",
  };
  const orphanRec = sampleGameRec({
    gameKey: "mlb:espn-403",
    awayTeam: "Chicago Cubs",
    homeTeam: "St. Louis Cardinals",
    pickIds: [],
    matchedGame,
  });
  const trackable = selectTrackableGameRecommendations([orphanRec], []);
  assert.equal(trackable.length, 0);
  let store = emptyStore();
  store = recordRecommendations(store, trackable, [], "2026-06-11");
  assert.equal(store.bets.length, 0);
}

// Conflict-suppressed actionable recs on the same event are not tracked
{
  const sharedGame: CalendarGame = {
    id: "404",
    league: "MLB",
    awayTeam: "New York Yankees",
    homeTeam: "Boston Red Sox",
    awayAbbr: "NYY",
    homeAbbr: "BOS",
    startTime: "2026-06-11T23:00:00Z",
    status: "Scheduled",
  };
  const yankeesRec = sampleGameRec({
    gameKey: "mlb:yankees",
    recommendedTeam: "New York Yankees",
    pickIds: ["pick-yankees"],
    matchedGame: sharedGame,
  });
  const redSoxRec = sampleGameRec({
    gameKey: "mlb:redsox",
    recommendedTeam: "Boston Red Sox",
    pickIds: ["pick-redsox"],
    matchedGame: sharedGame,
  });
  const noBetRec = sampleGameRec({
    gameKey: "mlb:conflict",
    noBet: true,
    recommendedTeam: "",
    pickIds: ["pick-yankees", "pick-redsox"],
    matchedGame: sharedGame,
  });
  const recs = [
    { ...sampleRec(), id: "pick-yankees" },
    { ...sampleRec(), id: "pick-redsox", pick: "Red Sox" },
  ];
  const visible = selectMainScreenGameRecommendations(
    [yankeesRec, redSoxRec, noBetRec],
    recs
  );
  assert.ok(visible.every((g) => g.noBet), "conflict shows no-bet card only");

  const trackable = selectTrackableGameRecommendations(
    [yankeesRec, redSoxRec, noBetRec],
    recs
  );
  assert.equal(trackable.length, 0);

  let store = emptyStore();
  store = recordRecommendations(store, trackable, recs, "2026-06-11");
  assert.equal(store.bets.length, 0);
}

// Prune same-date bets that no longer qualify on re-sync
{
  const matchedGame: CalendarGame = {
    id: "405",
    league: "MLB",
    awayTeam: "New York Yankees",
    homeTeam: "Boston Red Sox",
    awayAbbr: "NYY",
    homeAbbr: "BOS",
    startTime: "2026-06-11T23:00:00Z",
    status: "Scheduled",
  };
  let store = emptyStore();
  store = recordRecommendations(
    store,
    [sampleGameRec({ matchedGame, pickIds: ["pick-1"] })],
    [sampleRec()],
    "2026-06-11"
  );
  assert.equal(store.bets.length, 1);

  const trackable = selectTrackableGameRecommendations(
    [sampleGameRec({ noBet: true, recommendedTeam: "", matchedGame, pickIds: ["pick-1"] })],
    [sampleRec()]
  );
  const trackableKeys = new Set(trackable.map((rec) => `2026-06-11:${rec.gameKey}`));
  store.bets = store.bets.filter(
    (b) => b.date !== "2026-06-11" || trackableKeys.has(`${b.date}:${b.gameKey}`)
  );
  assert.equal(store.bets.length, 0);
}

// Grade win / loss (moneyline)
{
  const bet = emptyStore().bets[0] ?? {
    id: "2026-06-11:mlb:test",
    date: "2026-06-11",
    gameKey: "mlb:test",
    league: "MLB" as const,
    awayTeam: "New York Yankees",
    homeTeam: "Boston Red Sox",
    recommendedTeam: "New York Yankees",
    betType: "moneyline" as const,
    recommendedBet: {
      betType: "moneyline" as const,
      team: "New York Yankees",
      rawText: "Yankees",
      displayText: "New York Yankees",
    },
    confidence: 72,
    signalTypes: ["sharp_money" as const],
    signalLabels: ["Sharp Money"],
    status: "pending" as const,
    units: 0,
    stakeUnits: 1,
    recordedAt: new Date().toISOString(),
  };

  const win = gradeBet(bet, finalResult("away"));
  assert.equal(win.status, "win");
  assert.equal(win.units, calculateUnits(1, DEFAULT_JUICE, "win"));

  const loss = gradeBet(bet, finalResult("home"));
  assert.equal(loss.status, "loss");
  assert.equal(loss.units, -1);
}

// Dallas -6 spread edge cases (Dallas away)
{
  const dallasSpread = parsePickBet("DALLAS -6");
  assert.ok(dallasSpread);
  assert.equal(dallasSpread.spread, -6);

  const bet = spreadBetFromParsed(dallasSpread);

  // Dallas wins 90-82 (win by 8) → cover win
  assert.equal(gradeBet(bet, nbaDallasPortlandResult(90, 82)).status, "win");

  // Dallas wins 90-86 (win by 4) → loss
  assert.equal(gradeBet(bet, nbaDallasPortlandResult(90, 86)).status, "loss");

  // Dallas wins 90-84 (win by 6) → push
  assert.equal(gradeBet(bet, nbaDallasPortlandResult(90, 84)).status, "push");
  assert.equal(gradeBet(bet, nbaDallasPortlandResult(90, 84)).units, 0);
}

// Portland +9.5 cover (Portland home, loses 95-90 = lose by 5)
{
  const portlandSpread = parsePickBet("PORTLAND +9.5");
  assert.ok(portlandSpread);
  assert.equal(portlandSpread.spread, 9.5);

  const bet = spreadBetFromParsed(portlandSpread);
  // Dallas away 95, Portland home 90
  assert.equal(gradeBet(bet, nbaDallasPortlandResult(95, 90)).status, "win");
}

// Fade DALLAS -6 → Portland +6 grades opponent spread correctly
{
  const listed = parsePickBet("DALLAS -6");
  assert.ok(listed);
  const faded = fadeParsedBet(listed, "PORTLAND");
  assert.ok(faded);
  assert.equal(faded.team, "PORTLAND");
  assert.equal(faded.spread, 6);
  assert.ok(faded.displayText.includes("+6"), "display shows inverted spread");

  const bet = spreadBetFromParsed(faded, {
    signalTypes: ["book_needs_fade"],
    signalLabels: ["Book Needs (Fade)"],
  });
  assert.equal(bet.spread, 6);
  assert.equal(bet.recommendedBet?.spread, 6);
  assert.equal(bet.recommendedTeam, faded.displayText);

  // Portland home 90, Dallas away 95 — Portland +6 covers (96 > 95)
  assert.equal(gradeBet(bet, nbaDallasPortlandResult(95, 90)).status, "win");

  // Portland home 84, Dallas away 95 — Portland +6 does not cover (90 < 95)
  assert.equal(gradeBet(bet, nbaDallasPortlandResult(95, 84)).status, "loss");
}

// Grading uses recommendedBet.spread when top-level spread is unset
{
  const listed = parsePickBet("DALLAS -6");
  assert.ok(listed);
  const bet = spreadBetFromParsed(listed);
  delete (bet as { spread?: number }).spread;
  assert.equal(gradeBet(bet, nbaDallasPortlandResult(90, 82)).status, "win");
}

// Under 217.5
{
  const underBet: TrackedBet = {
    id: "total-under",
    date: "2026-06-11",
    gameKey: "nba:total-under",
    league: "NBA",
    awayTeam: "San Antonio Spurs",
    homeTeam: "Los Angeles Lakers",
    recommendedTeam: "Under 217.5",
    betType: "total",
    totalLine: 217.5,
    totalDirection: "under",
    recommendedBet: {
      betType: "total",
      team: "SAN ANTONIO",
      rawText: "SAN ANTONIO UNDER 217.5",
      totalDirection: "under",
      totalLine: 217.5,
      displayText: "San Antonio Under 217.5",
    },
    confidence: 75,
    signalTypes: ["book_needs_fade"],
    signalLabels: ["Book Needs (Fade)"],
    status: "pending",
    units: 0,
    stakeUnits: 1,
    recordedAt: new Date().toISOString(),
  };

  const underHit: GameResult = {
    id: "espn-under",
    league: "NBA",
    awayTeam: "San Antonio Spurs",
    homeTeam: "Los Angeles Lakers",
    awayAbbr: "SAS",
    homeAbbr: "LAL",
    startTime: "2026-06-11T23:00:00Z",
    status: "Final",
    isFinal: true,
    awayScore: 100,
    homeScore: 110,
    winnerTeam: "Los Angeles Lakers",
  };
  assert.equal(gradeBet(underBet, underHit).status, "win");

  const underMiss: GameResult = { ...underHit, awayScore: 115, homeScore: 105 };
  assert.equal(gradeBet(underBet, underMiss).status, "loss");
}

// Cubs Over 11 — team prefix is context; grades game total (6-5 = 11 push)
{
  const cubsOver = parsePickBet("CUBS OVER 11");
  assert.ok(cubsOver);
  assert.equal(cubsOver.totalLine, 11);
  assert.equal(cubsOver.totalDirection, "over");

  const overBet: TrackedBet = {
    id: "total-over-push",
    date: "2026-06-11",
    gameKey: "mlb:cubs-over",
    league: "MLB",
    awayTeam: "Chicago Cubs",
    homeTeam: "St. Louis Cardinals",
    recommendedTeam: cubsOver.displayText,
    betType: "total",
    totalLine: cubsOver.totalLine,
    totalDirection: cubsOver.totalDirection,
    recommendedBet: cubsOver,
    confidence: 75,
    signalTypes: ["sharp_money"],
    signalLabels: ["Sharp Money"],
    status: "pending",
    units: 0,
    stakeUnits: 1,
    recordedAt: new Date().toISOString(),
  };

  const pushResult: GameResult = {
    id: "espn-cubs",
    league: "MLB",
    awayTeam: "Chicago Cubs",
    homeTeam: "St. Louis Cardinals",
    awayAbbr: "CHC",
    homeAbbr: "STL",
    startTime: "2026-06-11T23:00:00Z",
    status: "Final",
    isFinal: true,
    awayScore: 6,
    homeScore: 5,
    winnerTeam: "Chicago Cubs",
  };
  assert.equal(gradeBet(overBet, pushResult).status, "push");

  const overWin: GameResult = { ...pushResult, awayScore: 7, homeScore: 5 };
  assert.equal(gradeBet(overBet, overWin).status, "win");
}

// Grade over/under (fade UNDER from TORONTO OVER)
{
  const underBet: TrackedBet = {
    id: "total-test",
    date: "2026-06-11",
    gameKey: "nba:total",
    league: "NBA",
    awayTeam: "Toronto Raptors",
    homeTeam: "Boston Celtics",
    recommendedTeam: "Under 167.5",
    betType: "total",
    totalLine: 167.5,
    totalDirection: "under",
    recommendedBet: {
      betType: "total",
      team: "Toronto",
      rawText: "TORONTO OVER 167.5",
      totalDirection: "under",
      totalLine: 167.5,
      displayText: "Toronto Under 167.5",
    },
    confidence: 75,
    signalTypes: ["book_needs_fade"],
    signalLabels: ["Book Needs (Fade)"],
    status: "pending",
    units: 0,
    stakeUnits: 1,
    recordedAt: new Date().toISOString(),
  };

  const underHit: GameResult = {
    id: "espn-total",
    league: "NBA",
    awayTeam: "Toronto Raptors",
    homeTeam: "Boston Celtics",
    awayAbbr: "TOR",
    homeAbbr: "BOS",
    startTime: "2026-06-11T23:00:00Z",
    status: "Final",
    isFinal: true,
    awayScore: 80,
    homeScore: 82,
    winnerTeam: "Boston Celtics",
  };
  assert.equal(gradeBet(underBet, underHit).status, "win");

  const underMiss: GameResult = { ...underHit, awayScore: 90, homeScore: 85 };
  assert.equal(gradeBet(underBet, underMiss).status, "loss");
}

// Summary rollup
{
  let store = emptyStore();
  store = recordRecommendations(store, [sampleGameRec()], [sampleRec()], "2026-06-11");
  store.bets[0] = gradeBet(store.bets[0], finalResult("away"));
  const response = buildTrackingResponse(store);
  assert.equal(response.summary.wins, 1);
  assert.equal(
    response.summary.totalUnits,
    calculateUnits(1, DEFAULT_JUICE, "win")
  );
  assert.equal(response.weekly.length, 1);
  assert.equal(response.monthly.length, 1);
  assert.equal(response.daily.length, 1);
  assert.equal(response.yearly.length, 1);
  assert.equal(response.daily[0].roiPercent, response.summary.roiPercent);
}

// Daily, weekly, monthly, yearly rollups across dates
{
  let store = emptyStore();
  store = recordRecommendations(store, [sampleGameRec()], [sampleRec()], "2026-06-10");
  store = recordRecommendations(store, [sampleGameRec({ gameKey: "mlb:test2" })], [sampleRec()], "2026-06-11");
  store.bets[0] = gradeBet(store.bets[0], finalResult("away"));
  store.bets[1] = gradeBet(store.bets[1], finalResult("home"));

  const response = buildTrackingResponse(store);
  assert.equal(response.daily.length, 2);
  assert.equal(response.weekly.length, 1);
  assert.equal(response.monthly.length, 1);
  assert.equal(response.yearly.length, 1);

  const dailyKeys = response.daily.map((d) => d.key).sort();
  assert.deepEqual(dailyKeys, ["2026-06-10", "2026-06-11"]);

  for (const row of response.daily) {
    assert.equal(row.bets, 1);
    assert.ok(typeof row.roiPercent === "number");
  }
}

// buildPeriodRollups ROI on settled bets only
{
  const bets: TrackedBet[] = [
    {
      id: "win-1",
      date: "2026-01-15",
      gameKey: "mlb:a",
      league: "MLB",
      awayTeam: "A",
      homeTeam: "B",
      recommendedTeam: "A",
      confidence: 70,
      signalTypes: ["sharp_money"],
      signalLabels: ["Sharp Money"],
      status: "win",
      units: 0.909,
      stakeUnits: 1,
      recordedAt: new Date().toISOString(),
    },
    {
      id: "loss-1",
      date: "2026-01-16",
      gameKey: "mlb:b",
      league: "MLB",
      awayTeam: "C",
      homeTeam: "D",
      recommendedTeam: "C",
      confidence: 70,
      signalTypes: ["sharp_money"],
      signalLabels: ["Sharp Money"],
      status: "loss",
      units: -1,
      stakeUnits: 1,
      recordedAt: new Date().toISOString(),
    },
    {
      id: "pending-1",
      date: "2026-01-17",
      gameKey: "mlb:c",
      league: "MLB",
      awayTeam: "E",
      homeTeam: "F",
      recommendedTeam: "E",
      confidence: 70,
      signalTypes: ["sharp_money"],
      signalLabels: ["Sharp Money"],
      status: "pending",
      units: 0,
      stakeUnits: 1,
      recordedAt: new Date().toISOString(),
    },
  ];

  const daily = buildPeriodRollups(
    bets,
    (d) => d,
    (k) => k
  );
  assert.equal(daily.length, 3);
  const winDay = daily.find((d) => d.key === "2026-01-15")!;
  assert.ok(Math.abs(winDay.roiPercent - 90.9) < 0.1);
  const lossDay = daily.find((d) => d.key === "2026-01-16")!;
  assert.equal(lossDay.roiPercent, -100);
}

// Odds-based unit calculation
{
  assert.equal(calculateUnits(1, 140, "win"), 1.4);
  assert.equal(calculateUnits(1, 140, "loss"), -1);
  assert.equal(
    Math.round(calculateUnits(1, -110, "win") * 1000) / 1000,
    0.909
  );
  assert.equal(calculateUnits(1, -110, "loss"), -1);
  assert.equal(calculateUnits(1, -110, "push"), 0);
}

// ML +140 win / loss
{
  const pitMl = parsePickBet("PITTSBURGH +140");
  assert.ok(pitMl);
  const bet: TrackedBet = {
    id: "ml-plus-140",
    date: "2026-06-11",
    gameKey: "mlb:pit",
    league: "MLB",
    awayTeam: "Los Angeles Dodgers",
    homeTeam: "Pittsburgh Pirates",
    recommendedTeam: pitMl.displayText,
    betType: "moneyline",
    odds: 140,
    americanOdds: 140,
    recommendedBet: pitMl,
    confidence: 72,
    signalTypes: ["sharp_money"],
    signalLabels: ["Sharp Money"],
    status: "pending",
    units: 0,
    stakeUnits: 1,
    recordedAt: new Date().toISOString(),
  };

  const win = gradeBet(bet, {
    ...finalResult("home"),
    awayTeam: "Los Angeles Dodgers",
    homeTeam: "Pittsburgh Pirates",
    homeScore: 5,
    awayScore: 2,
    winnerTeam: "Pittsburgh Pirates",
  });
  assert.equal(win.status, "win");
  assert.equal(win.units, 1.4);

  const loss = gradeBet(bet, {
    ...finalResult("away"),
    awayTeam: "Los Angeles Dodgers",
    homeTeam: "Pittsburgh Pirates",
    awayScore: 5,
    homeScore: 2,
    winnerTeam: "Los Angeles Dodgers",
  });
  assert.equal(loss.status, "loss");
  assert.equal(loss.units, -1);
}

// ML -110 win uses juice profit
{
  const bet: TrackedBet = {
    id: "ml-minus-110",
    date: "2026-06-11",
    gameKey: "mlb:ws",
    league: "MLB",
    awayTeam: "Chicago White Sox",
    homeTeam: "Boston Red Sox",
    recommendedTeam: "Chicago White Sox",
    betType: "moneyline",
    americanOdds: -110,
    recommendedBet: {
      betType: "moneyline",
      team: "Chicago White Sox",
      odds: -110,
      rawText: "WHITE SOX -110",
      displayText: "Chicago White Sox -110",
    },
    confidence: 72,
    signalTypes: ["sharp_money"],
    signalLabels: ["Sharp Money"],
    status: "pending",
    units: 0,
    stakeUnits: 1,
    recordedAt: new Date().toISOString(),
  };

  const win = gradeBet(bet, {
    ...finalResult("away"),
    awayTeam: "Chicago White Sox",
    homeTeam: "Boston Red Sox",
    winnerTeam: "Chicago White Sox",
  });
  assert.equal(win.status, "win");
  assert.equal(Math.round(win.units * 1000) / 1000, 0.909);
}

// Spread -110 default, push → 0u
{
  const dallasSpread = parsePickBet("DALLAS -6");
  assert.ok(dallasSpread);
  const bet = spreadBetFromParsed(dallasSpread);
  assert.equal(resolveAmericanOdds(bet), DEFAULT_JUICE);

  const push = gradeBet(bet, nbaDallasPortlandResult(90, 84));
  assert.equal(push.status, "push");
  assert.equal(push.units, 0);
  assert.equal(push.americanOdds, DEFAULT_JUICE);
}

// Spread graded on consensus line, not sheet pick line
{
  const dallasSpread = parsePickBet("DALLAS -6");
  assert.ok(dallasSpread);
  const bet = spreadBetFromParsed(dallasSpread, {
    consensusSpread: -7,
    consensusOdds: -110,
    consensusLabel: "-7 (-110)",
    bookProvider: "DraftKings",
  });
  // Dallas 90, Portland 84 → margin 6: pick -6 pushes, consensus -7 loses
  const pickLine = gradeBet(spreadBetFromParsed(dallasSpread), nbaDallasPortlandResult(90, 84));
  assert.equal(pickLine.status, "push");

  const consensusLine = gradeBet(bet, nbaDallasPortlandResult(90, 84));
  assert.equal(consensusLine.status, "loss");
  assert.equal(consensusLine.units, -1);
  assert.equal(consensusLine.americanOdds, DEFAULT_JUICE);
}

// Moneyline units use consensus odds (+141), not sheet pick
{
  const bet: TrackedBet = {
    id: "ml-consensus-141",
    date: "2026-06-11",
    gameKey: "mlb:pit",
    league: "MLB",
    awayTeam: "Los Angeles Dodgers",
    homeTeam: "Pittsburgh Pirates",
    recommendedTeam: "PIT",
    betType: "moneyline",
    odds: 140,
    consensusOdds: 141,
    consensusLabel: "+141",
    bookProvider: "DraftKings",
    recommendedBet: {
      betType: "moneyline",
      team: "Pittsburgh Pirates",
      rawText: "PIT",
      odds: 140,
      displayText: "PIT",
    },
    confidence: 92,
    signalTypes: ["sharp_money"],
    signalLabels: ["Sharp Money"],
    status: "pending",
    units: 0,
    stakeUnits: 1,
    recordedAt: new Date().toISOString(),
  };
  assert.equal(resolveAmericanOdds(bet), 141);

  const win = gradeBet(bet, {
    ...finalResult("home"),
    awayTeam: "Los Angeles Dodgers",
    homeTeam: "Pittsburgh Pirates",
    homeScore: 5,
    awayScore: 2,
    winnerTeam: "Pittsburgh Pirates",
  });
  assert.equal(win.status, "win");
  assert.equal(win.units, 1.41);
  assert.equal(win.americanOdds, 141);
}

// Under -110 win
{
  const underBet: TrackedBet = {
    id: "under-juice",
    date: "2026-06-11",
    gameKey: "nba:under-juice",
    league: "NBA",
    awayTeam: "San Antonio Spurs",
    homeTeam: "Los Angeles Lakers",
    recommendedTeam: "Under 217.5",
    betType: "total",
    totalLine: 217.5,
    totalDirection: "under",
    americanOdds: DEFAULT_JUICE,
    recommendedBet: {
      betType: "total",
      team: "SAN ANTONIO",
      rawText: "SAN ANTONIO UNDER 217.5",
      totalDirection: "under",
      totalLine: 217.5,
      odds: DEFAULT_JUICE,
      displayText: "San Antonio Under 217.5",
    },
    confidence: 75,
    signalTypes: ["book_needs_fade"],
    signalLabels: ["Book Needs (Fade)"],
    status: "pending",
    units: 0,
    stakeUnits: 1,
    recordedAt: new Date().toISOString(),
  };

  const underHit: GameResult = {
    id: "espn-under-juice",
    league: "NBA",
    awayTeam: "San Antonio Spurs",
    homeTeam: "Los Angeles Lakers",
    awayAbbr: "SAS",
    homeAbbr: "LAL",
    startTime: "2026-06-11T23:00:00Z",
    status: "Final",
    isFinal: true,
    awayScore: 100,
    homeScore: 110,
    winnerTeam: "Los Angeles Lakers",
  };

  const win = gradeBet(underBet, underHit);
  assert.equal(win.status, "win");
  assert.equal(Math.round(win.units * 1000) / 1000, 0.909);
}

{
  const store: TrackingStore = {
    version: 1,
    bets: [
      {
        id: "legacy-win",
        date: "2026-06-11",
        gameKey: "MLB:legacy",
        league: "MLB",
        awayTeam: "A",
        homeTeam: "B",
        recommendedTeam: "B -105",
        confidence: 75,
        signalTypes: ["book_needs_fade"],
        signalLabels: ["Book Needs (Fade)"],
        status: "win",
        units: 1,
        stakeUnits: 1,
        americanOdds: -105,
        betType: "moneyline",
        odds: -105,
      },
    ],
  };
  const refreshed = refreshSettledUnits(store);
  assert.equal(Math.round(refreshed.bets[0].units * 1000) / 1000, 0.952);
}

// buildTrackingResponse hides legacy bets without mainScreenGameRec
{
  const store: TrackingStore = {
    version: 1,
    bets: [
      {
        id: "legacy",
        date: "2026-06-10",
        gameKey: "mlb:legacy",
        league: "MLB",
        awayTeam: "A",
        homeTeam: "B",
        recommendedTeam: "A",
        confidence: 70,
        signalTypes: ["mega_sharps"],
        signalLabels: ["Mega Sharps"],
        status: "win",
        units: 1,
        stakeUnits: 1,
        recordedAt: new Date().toISOString(),
      },
      {
        id: "tracked",
        date: "2026-06-11",
        gameKey: "mlb:tracked",
        league: "MLB",
        awayTeam: "C",
        homeTeam: "D",
        recommendedTeam: "C",
        confidence: 80,
        signalTypes: ["sharp_money"],
        signalLabels: ["Sharp Money"],
        status: "pending",
        units: 0,
        stakeUnits: 1,
        mainScreenGameRec: true,
        recordedAt: new Date().toISOString(),
      },
    ],
  };
  const response = buildTrackingResponse(store);
  assert.equal(response.bets.length, 1);
  assert.equal(response.bets[0].gameKey, "mlb:tracked");
}

// recordRecommendations tags main-screen game rec bets
{
  let store = emptyStore();
  store = recordRecommendations(store, [sampleGameRec()], [sampleRec()], "2026-06-11");
  assert.equal(store.bets[0].mainScreenGameRec, true);
}

// Standalone sheet picks (PickCard) are not tracked
{
  const game: CalendarGame = {
    id: "401815688",
    league: "MLB",
    homeTeam: "Chicago Cubs",
    awayTeam: "Colorado Rockies",
    homeAbbr: "CHC",
    awayAbbr: "COL",
    startTime: "2026-06-11T22:40:00Z",
    status: "Scheduled",
  };
  const standaloneRec: MatchedRecommendation = {
    id: "mega-only",
    league: "MEGA_SHARPS",
    signalType: "mega_sharps",
    signalLabel: "Mega Sharps",
    pick: "CUBS",
    confidence: 85,
    confidenceBreakdown: [],
    signalPolarity: "positive",
    edgeLabel: "Edge",
    reasoning: "Mega",
    status: "recommended",
    gameDate: "2026-06-11",
    matchedGame: game,
    gameKey: "mega:cubs",
  };
  const trackable = selectTrackableGameRecommendations([], [standaloneRec]);
  assert.equal(trackable.length, 0);
  const standalone = selectMainScreenStandalonePicks([], [standaloneRec]);
  assert.equal(standalone.length, 1);

  let store = emptyStore();
  store = recordRecommendations(store, [], [standaloneRec], "2026-06-11");
  assert.equal(store.bets.length, 0);
}

// sportsOddsForced game rec is trackable without sheet pick ids
{
  const game: CalendarGame = {
    id: "401815699",
    league: "MLB",
    homeTeam: "Atlanta Braves",
    awayTeam: "Chicago White Sox",
    homeAbbr: "ATL",
    awayAbbr: "CWS",
    startTime: "2026-06-11T18:10:00Z",
    status: "Scheduled",
  };
  const forcedRec: GameConsolidatedRecommendation = {
    gameKey: "MLB:espn-401815699",
    league: "MLB",
    awayTeam: "Chicago White Sox",
    homeTeam: "Atlanta Braves",
    recommendedTeam: "Chicago White Sox",
    recommendedBet: {
      betType: "moneyline",
      team: "Chicago White Sox",
      rawText: "WHITE SOX",
      displayText: "Chicago White Sox",
    },
    confidence: 88,
    confidenceBreakdown: [],
    hasConflict: false,
    pickIds: [],
    reasoning: "Sports Odds force",
    matchedGame: game,
    sportsOddsForced: true,
  };
  const trackable = selectTrackableGameRecommendations([forcedRec], []);
  assert.equal(trackable.length, 1);
  assert.equal(trackable[0].sportsOddsForced, true);
}

// Event conflict suppresses actionable game recs from tracking
{
  const game: CalendarGame = {
    id: "401815700",
    league: "MLB",
    homeTeam: "Pittsburgh Pirates",
    awayTeam: "Los Angeles Dodgers",
    homeAbbr: "PIT",
    awayAbbr: "LAD",
    startTime: "2026-06-11T18:40:00Z",
    status: "Scheduled",
  };
  const pickA: MatchedRecommendation = {
    id: "pick-a",
    league: "MLB",
    signalType: "sharp_money",
    signalLabel: "Sharp Money",
    pick: "DODGERS",
    confidence: 80,
    confidenceBreakdown: [],
    signalPolarity: "positive",
    edgeLabel: "Edge",
    reasoning: "Sharp",
    status: "recommended",
    gameDate: "2026-06-11",
    matchedGame: game,
  };
  const pickB: MatchedRecommendation = {
    id: "pick-b",
    league: "MLB",
    signalType: "book_needs_fade",
    signalLabel: "Book Needs",
    pick: "PIRATES",
    confidence: 75,
    confidenceBreakdown: [],
    signalPolarity: "negative",
    edgeLabel: "Fade",
    reasoning: "Fade",
    status: "recommended",
    gameDate: "2026-06-11",
    matchedGame: game,
  };
  const recA: GameConsolidatedRecommendation = {
    gameKey: "mlb:dodgers",
    league: "MLB",
    awayTeam: "Los Angeles Dodgers",
    homeTeam: "Pittsburgh Pirates",
    recommendedTeam: "Los Angeles Dodgers",
    recommendedBet: {
      betType: "moneyline",
      team: "Los Angeles Dodgers",
      rawText: "DODGERS",
      displayText: "Los Angeles Dodgers",
    },
    confidence: 80,
    confidenceBreakdown: [],
    hasConflict: false,
    pickIds: ["pick-a"],
    reasoning: "Dodgers",
    matchedGame: game,
  };
  const recB: GameConsolidatedRecommendation = {
    gameKey: "mlb:pirates",
    league: "MLB",
    awayTeam: "Los Angeles Dodgers",
    homeTeam: "Pittsburgh Pirates",
    recommendedTeam: "Pittsburgh Pirates",
    recommendedBet: {
      betType: "moneyline",
      team: "Pittsburgh Pirates",
      rawText: "PIRATES",
      displayText: "Pittsburgh Pirates",
    },
    confidence: 75,
    confidenceBreakdown: [],
    hasConflict: false,
    pickIds: ["pick-b"],
    reasoning: "Pirates",
    matchedGame: game,
  };
  const noBetConflict: GameConsolidatedRecommendation = {
    gameKey: "mlb:conflict",
    league: "MLB",
    awayTeam: "Los Angeles Dodgers",
    homeTeam: "Pittsburgh Pirates",
    recommendedTeam: "",
    confidence: 0,
    noBet: true,
    confidenceBreakdown: [],
    hasConflict: true,
    pickIds: ["pick-a", "pick-b"],
    reasoning: "Conflict",
    matchedGame: game,
  };

  const uiVisible = selectMainScreenGameRecommendations(
    [recA, recB, noBetConflict],
    [pickA, pickB]
  );
  assert.ok(uiVisible.some((g) => g.noBet), "UI shows no-bet conflict card");

  const trackable = selectTrackableGameRecommendations(
    [recA, recB, noBetConflict],
    [pickA, pickB]
  );
  assert.equal(trackable.length, 0);

  let store = emptyStore();
  store = recordRecommendations(
    store,
    trackable,
    [pickA, pickB],
    "2026-06-11"
  );
  assert.equal(store.bets.length, 0);
}

console.log("tracking.test.ts: all assertions passed");
