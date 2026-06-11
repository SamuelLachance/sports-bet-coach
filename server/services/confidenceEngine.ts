/**
 * @deprecated Use betRulesEngine.ts — kept for backward-compatible imports.
 * Historical ROI / trend modifiers removed; rules-only logic lives in betRulesEngine.
 */
export {
  buildGameKey,
  collectFadeTargetsForGame,
  computeConfidence,
  computePickRules,
  resolveGameConflicts,
  runBetRulesEngine,
  RULE_CONFIDENCE,
} from "./betRulesEngine.js";

export { isOpposingDualFade, resolveDualFadeMatch } from "./dualFadeStats.js";

export const LEGACY_SIGNAL_CONFIDENCE: Record<
  import("../types.js").SignalType,
  number
> = {
  sharp_money: 85,
  mega_sharps: 85,
  whale_plays: 70,
  model_best_values: 70,
  mega_rlm: 70,
  reverse_line_movement: 70,
  book_needs_fade: 75,
  square_fade: 75,
};

/** @deprecated no-op — trends removed */
export function applyConfidenceToRecommendation<T extends object>(
  rec: T,
  result: { confidence?: number; confidenceBreakdown?: unknown; opponentPick?: string; opponentConfidence?: number; signalPolarity?: unknown; edgeLabel?: string }
): T & typeof result {
  return { ...rec, ...result };
}
