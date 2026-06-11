import assert from "node:assert/strict";
import {
  buildTrackingResponse,
  gradeBet,
  recordRecommendations,
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

// Grade win / loss
{
  const bet = emptyStore().bets[0] ?? {
    id: "2026-06-11:mlb:test",
    date: "2026-06-11",
    gameKey: "mlb:test",
    league: "MLB" as const,
    awayTeam: "New York Yankees",
    homeTeam: "Boston Red Sox",
    recommendedTeam: "New York Yankees",
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
  assert.equal(win.units, 1);

  const loss = gradeBet(bet, finalResult("home"));
  assert.equal(loss.status, "loss");
  assert.equal(loss.units, -1);
}

// Summary rollup
{
  let store = emptyStore();
  store = recordRecommendations(store, [sampleGameRec()], [sampleRec()], "2026-06-11");
  store.bets[0] = gradeBet(store.bets[0], finalResult("away"));
  const response = buildTrackingResponse(store);
  assert.equal(response.summary.wins, 1);
  assert.equal(response.summary.totalUnits, 1);
  assert.equal(response.weekly.length, 1);
  assert.equal(response.monthly.length, 1);
}

console.log("tracking.test.ts: all assertions passed");
