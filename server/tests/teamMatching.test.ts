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

const DODGERS_PIRATES: CalendarGame = {
  id: "401815700",
  league: "MLB",
  homeTeam: "Pittsburgh Pirates",
  awayTeam: "Los Angeles Dodgers",
  homeAbbr: "PIT",
  awayAbbr: "LAD",
  startTime: "2026-06-11T18:40:00Z",
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

const SKY_FEVER: CalendarGame = {
  id: "401856980",
  league: "WNBA",
  homeTeam: "Indiana Fever",
  awayTeam: "Chicago Sky",
  homeAbbr: "IND",
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
    pickBelongsToGame("PITTSBURGH +140", undefined, DODGERS_PIRATES),
    "PITTSBURGH +140 belongs to Dodgers @ Pirates (odds stripped)"
  );
  assert.ok(
    pickBelongsToGame("LA DODGERS", undefined, DODGERS_PIRATES),
    "LA DODGERS belongs to Dodgers @ Pirates"
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
  assert.ok(
    pickBelongsToGame("SKY +10.5", undefined, SKY_FEVER),
    "SKY +10.5 belongs to Sky @ Fever"
  );
  assert.ok(
    pickBelongsToGame("FEVER -9.5", undefined, SKY_FEVER),
    "FEVER -9.5 belongs to Sky @ Fever"
  );

  console.log("✓ All team matching tests passed");
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
