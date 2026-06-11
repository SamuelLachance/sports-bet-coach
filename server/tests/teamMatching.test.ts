/**
 * Team matching regression tests.
 * Run: npx tsx server/tests/teamMatching.test.ts
 */
import assert from "node:assert/strict";
import {
  matchPickToGame,
  pickBelongsToGame,
  validateRecommendedTeam,
} from "../services/calendar.js";
import type { CalendarGame } from "../types.js";

const CUBS_ROCKIES: CalendarGame = {
  id: "401815688",
  league: "MLB",
  homeTeam: "Chicago Cubs",
  awayTeam: "Colorado Rockies",
  homeAbbr: "CHC",
  awayAbbr: "COL",
  startTime: "2026-06-11T19:10:00Z",
  status: "Scheduled",
};

const WHITE_SOX_BRAVES: CalendarGame = {
  id: "401815699",
  league: "MLB",
  homeTeam: "Atlanta Braves",
  awayTeam: "Chicago White Sox",
  homeAbbr: "ATL",
  awayAbbr: "CWS",
  startTime: "2026-06-11T18:10:00Z",
  status: "Scheduled",
};

const SKY_MYSTICS: CalendarGame = {
  id: "401800001",
  league: "WNBA",
  homeTeam: "Washington Mystics",
  awayTeam: "Chicago Sky",
  homeAbbr: "WAS",
  awayAbbr: "CHI",
  startTime: "2026-06-11T23:00:00Z",
  status: "Scheduled",
};

function main() {
  assert.ok(
    pickBelongsToGame("CUBS", "COLORADO", CUBS_ROCKIES),
    "CUBS vs COLORADO belongs to Cubs @ Rockies"
  );
  assert.ok(
    pickBelongsToGame("COLORADO", "CUBS", CUBS_ROCKIES),
    "COLORADO vs CUBS belongs to Cubs @ Rockies"
  );
  assert.ok(
    !pickBelongsToGame("CHICAGO SKY", undefined, CUBS_ROCKIES),
    "Chicago Sky must NOT match Cubs @ Rockies MLB game"
  );
  assert.ok(
    !validateRecommendedTeam("CHICAGO SKY", CUBS_ROCKIES),
    "Chicago Sky is not a valid recommendation for MLB game"
  );
  assert.ok(
    pickBelongsToGame("CHICAGO SKY", undefined, SKY_MYSTICS),
    "Chicago Sky belongs to WNBA game"
  );
  assert.ok(
    pickBelongsToGame("WHITE SOX", "ATLANTA", WHITE_SOX_BRAVES),
    "WHITE SOX vs ATLANTA belongs to White Sox @ Braves"
  );
  assert.ok(
    pickBelongsToGame("ATLANTA", "WHITE SOX", WHITE_SOX_BRAVES),
    "ATLANTA vs WHITE SOX belongs to White Sox @ Braves"
  );

  const mlbGames = [CUBS_ROCKIES];
  const allGames = [CUBS_ROCKIES, SKY_MYSTICS];

  assert.equal(
    matchPickToGame("CHICAGO SKY", undefined, mlbGames),
    undefined,
    "Chicago Sky must not match any MLB game"
  );
  assert.equal(
    matchPickToGame("CHICAGO SKY", undefined, allGames)?.league,
    "WNBA",
    "Chicago Sky matches WNBA schedule when available"
  );

  console.log("✓ All team matching tests passed");
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
