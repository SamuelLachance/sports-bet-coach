/**
 * Unit tests for American-odds edge (matches Sports-Odds-Algorithms bet_advisor).
 * Run: npx tsx server/tests/oddsEdge.test.ts
 */
import assert from "node:assert/strict";
import {
  breakevenAmerican,
  oddsEdge,
  probabilityToAmerican,
} from "../utils/oddsEdge.js";

// Same-sign underdog (Bosnia screenshot)
assert.equal(oddsEdge(253, 380, 28.33), 127);

// Same-sign favorite
const awayProj = probabilityToAmerican(55.68);
const homeProj = probabilityToAmerican(44.32);
assert.ok(awayProj < 0);
assert.ok(homeProj > 0);
assert.equal(oddsEdge(awayProj, -171, 55.68), 0);
assert.equal(oddsEdge(awayProj, -110, 55.68), -110 - awayProj);
assert.equal(oddsEdge(homeProj, 120, 44.32), 0);

// Padres cross-sign: +109 market vs -121 model is ~+26, not +230
const padresProb = 54.79;
const padresEdge = oddsEdge(-121, 109, padresProb);
const fairUnderdog = breakevenAmerican(padresProb, { asUnderdog: true });
assert.ok(Math.abs(padresEdge - (109 - fairUnderdog)) < 0.5);
assert.ok(padresEdge < 40);
assert.notEqual(padresEdge, 230);

console.log("oddsEdge.test.ts: all tests passed");
