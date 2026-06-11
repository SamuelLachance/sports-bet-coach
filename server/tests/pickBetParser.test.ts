/**
 * Unit tests for spread / moneyline / over-under pick parsing.
 * Run: npx tsx server/tests/pickBetParser.test.ts
 */
import assert from "node:assert/strict";
import {
  betKey,
  classifyNumericSuffix,
  fadeParsedBet,
  parsePickBet,
  parsePickCell,
} from "../parsers/pickBetParser.js";

function main() {
  // Spread vs moneyline classification
  assert.equal(classifyNumericSuffix(-6), "spread");
  assert.equal(classifyNumericSuffix(9.5), "spread");
  assert.equal(classifyNumericSuffix(-9.5), "spread");
  assert.equal(classifyNumericSuffix(-101), "moneyline");
  assert.equal(classifyNumericSuffix(-145), "moneyline");
  assert.equal(classifyNumericSuffix(140), "moneyline");
  assert.equal(classifyNumericSuffix(-120), "moneyline");
  assert.equal(classifyNumericSuffix(-110), "moneyline");

  const dallasSpread = parsePickBet("DALLAS -6");
  assert.equal(dallasSpread?.betType, "spread");
  assert.equal(dallasSpread?.team, "DALLAS");
  assert.equal(dallasSpread?.spread, -6);

  const portlandSpread = parsePickBet("PORTLAND +9.5");
  assert.equal(portlandSpread?.betType, "spread");
  assert.equal(portlandSpread?.spread, 9.5);

  const skySpread = parsePickBet("CHICAGO SKY +9.5");
  assert.equal(skySpread?.betType, "spread");
  assert.equal(skySpread?.team, "CHICAGO SKY");

  const whiteSoxMl = parsePickBet("WHITE SOX -101");
  assert.equal(whiteSoxMl?.betType, "moneyline");
  assert.equal(whiteSoxMl?.odds, -101);

  const carolinaMl = parsePickBet("CAROLINA -145");
  assert.equal(carolinaMl?.betType, "moneyline");

  const pitMl = parsePickBet("PITTSBURGH +140");
  assert.equal(pitMl?.betType, "moneyline");
  assert.equal(pitMl?.odds, 140);

  const cubsOver = parsePickBet("CUBS OVER 11");
  assert.equal(cubsOver?.betType, "total");
  assert.equal(cubsOver?.totalDirection, "over");
  assert.equal(cubsOver?.totalLine, 11);

  const torontoOver = parsePickBet("TORONTO OVER 167.5");
  assert.equal(torontoOver?.betType, "total");
  assert.equal(torontoOver?.totalLine, 167.5);

  const saUnder = parsePickBet("SAN ANTONIO UNDER 217.6");
  assert.equal(saUnder?.betType, "total");
  assert.equal(saUnder?.totalDirection, "under");

  const dodgersUnder = parsePickBet("DODGERS UNDER 9.5");
  assert.equal(dodgersUnder?.betType, "total");
  assert.equal(dodgersUnder?.totalLine, 9.5);

  // Split cell: team + line field
  const splitTotal = parsePickBet("CUBS", "OVER 11");
  assert.equal(splitTotal?.betType, "total");
  assert.equal(splitTotal?.totalLine, 11);

  const cell = parsePickCell("PORTLAND +9.5");
  assert.equal(cell.parsedBet?.betType, "spread");
  assert.equal(cell.pick, "PORTLAND +9.5");

  // Fade OVER → UNDER
  const faded = fadeParsedBet(torontoOver!);
  assert.equal(faded?.betType, "total");
  assert.equal(faded?.totalDirection, "under");
  assert.equal(faded?.totalLine, 167.5);
  assert.ok(faded?.displayText.toUpperCase().includes("UNDER"));

  // Fade spread → opponent inverse spread
  const spreadFade = fadeParsedBet(dallasSpread!, "PORTLAND");
  assert.equal(spreadFade?.betType, "spread");
  assert.equal(spreadFade?.team, "PORTLAND");
  assert.equal(spreadFade?.spread, 6);

  // Bet keys differ for conflicting sides
  assert.notEqual(betKey(torontoOver!), betKey(faded!));

  console.log("✓ All pickBetParser tests passed");
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
