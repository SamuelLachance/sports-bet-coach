import { formatInTimeZone } from "date-fns-tz";
import { TIMEZONE } from "../config.js";
import type {
  CalendarGame,
  LeagueCode,
  MatchedRecommendation,
  ParsedSheets,
  SheetPick,
  SignalType,
} from "../types.js";
import { matchPickToGame, todayDisplayDate } from "./calendar.js";

const SIGNAL_LABELS: Record<SignalType, string> = {
  sharp_money: "Sharp Money",
  book_needs_fade: "Book Needs (Fade)",
  square_fade: "Square Top (Fade)",
  reverse_line_movement: "Reverse Line Movement",
  mega_sharps: "Mega Sharps (4+)",
  whale_plays: "Whale Plays 🐳",
  model_best_values: "Model Best Values",
  mega_rlm: "Mega RLM (4+)",
};

const SIGNAL_CONFIDENCE: Record<SignalType, number> = {
  sharp_money: 85,
  mega_sharps: 92,
  whale_plays: 88,
  model_best_values: 80,
  mega_rlm: 78,
  reverse_line_movement: 75,
  book_needs_fade: 70,
  square_fade: 65,
};

const SIGNAL_EDGE: Record<SignalType, string> = {
  sharp_money: "Argent intelligent",
  book_needs_fade: "Fade bookmaker",
  square_fade: "Fade public",
  reverse_line_movement: "Mouvement de ligne inverse",
  mega_sharps: "Consensus sharps",
  whale_plays: "Gros parieur",
  model_best_values: "Valeur modèle",
  mega_rlm: "RLM fort",
};

function buildReasoning(pick: SheetPick, game?: CalendarGame): string {
  const signal = SIGNAL_LABELS[pick.signalType];
  const parts = [`Signal: ${signal}`];

  if (pick.opponent) {
    parts.push(`Matchup fade: ${pick.pick} vs ${pick.opponent}`);
  } else if (pick.line) {
    parts.push(`Ligne: ${pick.pick} ${pick.line}`);
  } else {
    parts.push(`Sélection: ${pick.pick}`);
  }

  if (pick.gameTime) parts.push(`Heure affichée: ${pick.gameTime}`);
  if (pick.postingTime) parts.push(`Publié: ${pick.postingTime}`);

  if (game) {
    parts.push(
      `Match confirmé: ${game.awayTeam} @ ${game.homeTeam} (${formatInTimeZone(
        new Date(game.startTime),
        TIMEZONE,
        "HH:mm"
      )} HE)`
    );
  }

  return parts.join(" · ");
}

function inferStatus(game?: CalendarGame): MatchedRecommendation["status"] {
  if (!game) return "pending";
  const status = game.status.toLowerCase();
  if (status.includes("final") || status.includes("termin")) return "settled";
  if (status.includes("in progress") || status.includes("en cours")) return "matched";
  return "recommended";
}

const SPECIAL_TO_SPORT: Partial<Record<LeagueCode, LeagueCode>> = {
  MEGA_SHARPS: "MLB",
  WHALE: "MLB",
  MODEL: "MLB",
  RLM: "MLB",
};

function sportLeagueForPick(pick: SheetPick): LeagueCode {
  return SPECIAL_TO_SPORT[pick.league] || pick.league;
}

export function buildRecommendations(
  sheets: ParsedSheets,
  games: CalendarGame[],
  targetDate?: string
): MatchedRecommendation[] {
  const gameDate = targetDate || todayDisplayDate();

  return sheets.dailyPicks.map((pick) => {
    const sportLeague = sportLeagueForPick(pick);
    const leagueGames = games.filter((g) => g.league === sportLeague);
    const matchedGame = matchPickToGame(pick.pick, pick.opponent, leagueGames);

    return {
      id: pick.id,
      league: pick.league,
      signalType: pick.signalType,
      signalLabel: SIGNAL_LABELS[pick.signalType],
      pick: pick.pick,
      opponent: pick.opponent,
      gameTime: pick.gameTime,
      postingTime: pick.postingTime,
      line: pick.line,
      confidence: SIGNAL_CONFIDENCE[pick.signalType],
      edgeLabel: SIGNAL_EDGE[pick.signalType],
      reasoning: buildReasoning(pick, matchedGame),
      status: inferStatus(matchedGame),
      matchedGame,
      gameDate,
    };
  });
}

export function getActiveLeagues(sheets: ParsedSheets): LeagueCode[] {
  const leagues = new Set<LeagueCode>();
  for (const pick of sheets.dailyPicks) {
    if (pick.league !== "UNKNOWN") leagues.add(pick.league);
  }
  return [...leagues];
}

export function filterByLeague(
  recs: MatchedRecommendation[],
  league: LeagueCode | "ALL"
): MatchedRecommendation[] {
  if (league === "ALL") return recs;
  return recs.filter((r) => r.league === league);
}

export function groupBySignal(
  recs: MatchedRecommendation[]
): Record<string, MatchedRecommendation[]> {
  return recs.reduce(
    (acc, rec) => {
      const key = rec.signalType;
      if (!acc[key]) acc[key] = [];
      acc[key].push(rec);
      return acc;
    },
    {} as Record<string, MatchedRecommendation[]>
  );
}
