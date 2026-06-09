import type { SignalType } from "../types.js";

/** Maps Google Sheets category labels → internal signal types */
export const CATEGORY_TO_SIGNAL: Record<string, SignalType> = {
  "Sharp Money": "sharp_money",
  Sportsbook: "book_needs_fade",
  Squares: "square_fade",
  "Model Best Values": "model_best_values",
  "Model Best Plays": "model_best_values",
  "Whale 🐳": "whale_plays",
  Whale: "whale_plays",
  "Mega sharps": "mega_sharps",
  RLM: "reverse_line_movement",
  "RLM MS": "mega_rlm",
  "MEGA RLM": "mega_rlm",
};

export const SIGNAL_TO_CATEGORY: Record<SignalType, string> = {
  sharp_money: "Sharp Money",
  book_needs_fade: "Sportsbook",
  square_fade: "Squares",
  model_best_values: "Model Best Values",
  whale_plays: "Whale 🐳",
  mega_sharps: "Mega sharps",
  reverse_line_movement: "RLM",
  mega_rlm: "RLM MS",
};

/** Fade-style signals: pick targets the faded side; invert when historically unprofitable */
export const FADE_SIGNALS = new Set<SignalType>([
  "book_needs_fade",
  "square_fade",
]);

export const SIGNAL_LABELS_FR: Record<SignalType, string> = {
  sharp_money: "Sharp Money",
  book_needs_fade: "Book Needs (Fade)",
  square_fade: "Square Top (Fade)",
  reverse_line_movement: "Reverse Line Movement",
  mega_sharps: "Mega Sharps (4+)",
  whale_plays: "Whale Plays 🐳",
  model_best_values: "Model Best Values",
  mega_rlm: "Mega RLM (4+)",
};

export function categoryForSignal(signal: SignalType): string {
  return SIGNAL_TO_CATEGORY[signal];
}

export function signalForCategory(category: string): SignalType | null {
  const normalized = category.trim();
  if (CATEGORY_TO_SIGNAL[normalized]) return CATEGORY_TO_SIGNAL[normalized];
  for (const [key, value] of Object.entries(CATEGORY_TO_SIGNAL)) {
    if (normalized.startsWith(key.replace(" 🐳", ""))) return value;
  }
  return null;
}
