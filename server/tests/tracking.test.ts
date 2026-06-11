import assert from "node:assert/strict";
import { fadeParsedBet, parsePickBet } from "../parsers/pickBetParser.js";
import {
  buildTrackingResponse,
  calculateUnits,
  DEFAULT_JUICE,
  gradeBet,
  recordRecommendations,
  refreshSettledUnits,
  resolveAmericanOdds,
  resolveGradingSpread,
  type TrackedBet,
  type TrackingStore,
} from "../services/tracking.js";
import type { GameConsolidatedRecommendation, MatchedRecommendation } from "../types.js";
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

console.log("tracking.test.ts: all assertions passed");
