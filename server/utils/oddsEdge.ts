/**
 * American-odds edge vs model fair line (matches Sports-Odds-Algorithms bet_advisor).
 *
 * Same-sign lines (+/+ or -/-) compare directly. When favorite/underdog signs
 * differ, compare the market quote to the model breakeven line on that side
 * instead of subtracting across zero (e.g. +109 vs -121 is not +230).
 */

export function probabilityToAmerican(probabilityPct: number): number {
  const probability = Math.min(Math.max(probabilityPct, 0.1), 99.9);
  if (probability >= 50) {
    return -Math.round((probability / (100 - probability)) * 100);
  }
  return Math.round(((100 - probability) / probability) * 100);
}

export function breakevenAmerican(
  probabilityPct: number,
  options: { asUnderdog: boolean }
): number {
  const probability = Math.min(Math.max(probabilityPct, 0.1), 99.9) / 100;
  if (options.asUnderdog) {
    return ((1 - probability) / probability) * 100;
  }
  return -((probability / (1 - probability)) * 100);
}

export function oddsEdge(
  modelProjection: number,
  marketOdds: number,
  modelProbPct: number
): number {
  const fairOdds = probabilityToAmerican(modelProbPct);
  if (marketOdds <= fairOdds) {
    return 0;
  }

  if (
    (fairOdds >= 0 && marketOdds >= 0) ||
    (fairOdds <= 0 && marketOdds <= 0)
  ) {
    return marketOdds - fairOdds;
  }

  if (marketOdds > 0) {
    const breakeven = breakevenAmerican(modelProbPct, { asUnderdog: true });
    if (marketOdds > breakeven) {
      return marketOdds - breakeven;
    }
    return 0;
  }

  const breakeven = breakevenAmerican(modelProbPct, { asUnderdog: false });
  if (marketOdds > breakeven) {
    return marketOdds - breakeven;
  }
  return 0;
}
