/**
 * Unit tests for DRatings Bet Trends agreement logic.
 * Run: npx tsx server/tests/dratingsTrends.test.ts
 */
import assert from "node:assert/strict";
import {
  dratingsAgreesWithBet,
  dratingsStatusForBet,
  parseDratingsDetailPage,
  parseDratingsListPage,
  buildDratingsGameKey,
} from "../services/dratingsTrends.js";
import { applyDratingsFilter } from "../services/recommendations.js";
import type { CalendarGame, GameConsolidatedRecommendation, ParsedBet } from "../types.js";

const ROYALS_GAME: CalendarGame = {
  id: "401815701",
  league: "MLB",
  homeTeam: "Kansas City Royals",
  awayTeam: "Texas Rangers",
  homeAbbr: "KC",
  awayAbbr: "TEX",
  startTime: "2026-06-11T22:40:00Z",
  status: "Scheduled",
};

const DODGERS_GAME: CalendarGame = {
  id: "401815700",
  league: "MLB",
  homeTeam: "Pittsburgh Pirates",
  awayTeam: "Los Angeles Dodgers",
  homeAbbr: "PIT",
  awayAbbr: "LAD",
  startTime: "2026-06-11T18:40:00Z",
  status: "Scheduled",
};

const royalsTrend = parseDratingsDetailPage(
  `<div id="scroll-money-line-bet-trends"><div class="bar-progress" style="width: 10.0%"></div><span class="srt">Rangers: 10.0%</span></div>
   <div id="home-money-line-bet-trends"><div class="bar-progress" style="width: 40.0%"></div><span class="srt">Royals: 40.0%</span></div>
   <div id="scroll-ou-bet-trends"><div class="bar-progress" style="width: 30.0%"></div><span class="srt">Over: 30.0%</span></div>
   <div id="under-ou-bet-trends"><div class="bar-progress" style="width: 10.0%"></div><span class="srt">Under: 10.0%</span></div>`,
  {
    league: "MLB",
    awayTeam: "Texas Rangers",
    homeTeam: "Kansas City Royals",
  }
);

const dodgersTrend = parseDratingsDetailPage(
  `<div id="scroll-money-line-bet-trends"><div class="bar-progress" style="width: 60.0%"></div><span class="srt">Dodgers: 60.0%</span></div>
   <div id="home-money-line-bet-trends"><div class="bar-progress" style="width: 40.0%"></div><span class="srt">Pirates: 40.0%</span></div>
   <div id="scroll-ou-bet-trends"><div class="bar-progress" style="width: 0.0%"></div><span class="srt">Over: 0.0%</span></div>
   <div id="under-ou-bet-trends"><div class="bar-progress" style="width: 0.0%"></div><span class="srt">Under: 0.0%</span></div>`,
  {
    league: "MLB",
    awayTeam: "Los Angeles Dodgers",
    homeTeam: "Pittsburgh Pirates",
  }
);

const royalsMlBet: ParsedBet = {
  betType: "moneyline",
  team: "Royals",
  rawText: "Royals",
  displayText: "Royals",
};

const rangersMlBet: ParsedBet = {
  betType: "moneyline",
  team: "Rangers",
  rawText: "Rangers",
  displayText: "Rangers",
};

const dodgersMlBet: ParsedBet = {
  betType: "moneyline",
  team: "Dodgers",
  rawText: "Dodgers",
  displayText: "Dodgers",
};

const overBet: ParsedBet = {
  betType: "total",
  totalDirection: "over",
  totalLine: 9,
  rawText: "Over 9",
  displayText: "Over 9",
};

// --- parseDratingsDetailPage ---
assert.equal(royalsTrend.moneyLine.trendSide, "home", "Royals should be ML trend side");
assert.equal(royalsTrend.total.trendSide, "over", "Over should be O/U trend side");
assert.equal(dodgersTrend.moneyLine.trendSide, "away", "Dodgers should be ML trend side");

// --- dratingsAgreesWithBet ---
assert.equal(
  dratingsAgreesWithBet(royalsMlBet, ROYALS_GAME, royalsTrend),
  true,
  "Royals ML agrees when DRatings favors Royals"
);
assert.equal(
  dratingsAgreesWithBet(rangersMlBet, ROYALS_GAME, royalsTrend),
  false,
  "Rangers ML disagrees when DRatings favors Royals"
);
assert.equal(
  dratingsAgreesWithBet(dodgersMlBet, DODGERS_GAME, dodgersTrend),
  true,
  "Dodgers ML agrees when DRatings favors Dodgers"
);
assert.equal(
  dratingsAgreesWithBet(overBet, ROYALS_GAME, royalsTrend),
  true,
  "Over agrees when DRatings O/U trend favors over"
);

// --- dratingsStatusForBet ---
assert.equal(
  dratingsStatusForBet(royalsMlBet, ROYALS_GAME, royalsTrend),
  "agrees"
);
assert.equal(
  dratingsStatusForBet(rangersMlBet, ROYALS_GAME, royalsTrend),
  "disagrees"
);
assert.equal(dratingsStatusForBet(royalsMlBet, ROYALS_GAME, undefined), "unavailable");

// --- parseDratingsListPage ---
const listHtml = `
<h2>Upcoming Games for June 11, 2026</h2>
<table><tbody>
<tr>
  <td><a href="/teams/mlb-baseball-ratings/1-la-dodgers">Los Angeles Dodgers</a>
  <a href="/teams/mlb-baseball-ratings/24-pittsburgh-pirates">Pittsburgh Pirates</a></td>
  <td><a href="/predictor/mlb-baseball-predictions/abc-123">details</a></td>
</tr>
</tbody></table>`;
const listGames = parseDratingsListPage(listHtml, "MLB");
assert.equal(listGames.length, 1);
assert.equal(listGames[0]?.awayTeam, "Los Angeles Dodgers");

// --- applyDratingsFilter integration ---
const actionableCard: GameConsolidatedRecommendation = {
  gameKey: "MLB:test",
  league: "MLB",
  awayTeam: ROYALS_GAME.awayTeam,
  homeTeam: ROYALS_GAME.homeTeam,
  recommendedTeam: "Royals",
  recommendedBet: royalsMlBet,
  betType: "moneyline",
  confidence: 78,
  confidenceBreakdown: [],
  hasConflict: false,
  pickIds: ["p1"],
  reasoning: "Game: Rangers @ Royals",
  matchedGame: ROYALS_GAME,
};

const filteredAgree = applyDratingsFilter(
  { recommendations: [], gameRecommendations: [actionableCard] },
  [royalsTrend]
);
assert.equal(filteredAgree.gameRecommendations[0]?.dratingsConfirmed, true);
assert.ok(!filteredAgree.gameRecommendations[0]?.noBet);

const disagreeCard = { ...actionableCard, recommendedTeam: "Rangers", recommendedBet: rangersMlBet };
const filteredDisagree = applyDratingsFilter(
  { recommendations: [], gameRecommendations: [disagreeCard] },
  [royalsTrend]
);
assert.ok(filteredDisagree.gameRecommendations[0]?.noBet, "Disagreeing side → no bet");
assert.equal(filteredDisagree.gameRecommendations[0]?.dratingsStatus, "disagrees");

const unavailableFiltered = applyDratingsFilter(
  { recommendations: [], gameRecommendations: [actionableCard] },
  []
);
assert.ok(unavailableFiltered.gameRecommendations[0]?.noBet, "Missing trend → no bet");
assert.equal(unavailableFiltered.gameRecommendations[0]?.dratingsStatus, "unavailable");

assert.equal(
  buildDratingsGameKey("MLB", "Texas Rangers", "Kansas City Royals"),
  buildDratingsGameKey("MLB", "Kansas City Royals", "Texas Rangers"),
  "game key is order-independent"
);

console.log("dratingsTrends.test.ts — all assertions passed");
