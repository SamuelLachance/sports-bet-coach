import type { CalendarGame } from "../types";

interface CalendarViewProps {
  games: CalendarGame[];
  date: string;
}

const LEAGUE_COLORS: Record<string, string> = {
  MLB: "border-red-500/50",
  NBA: "border-orange-500/50",
  NHL: "border-blue-500/50",
  NFL: "border-green-500/50",
  WNBA: "border-purple-500/50",
  CBB: "border-amber-500/50",
};

export function CalendarView({ games, date }: CalendarViewProps) {
  const byLeague = games.reduce(
    (acc, g) => {
      if (!acc[g.league]) acc[g.league] = [];
      acc[g.league].push(g);
      return acc;
    },
    {} as Record<string, CalendarGame[]>
  );

  return (
    <div className="space-y-6">
      <div className="card">
        <h2 className="font-display text-lg font-semibold mb-1">
          Calendrier du {date}
        </h2>
        <p className="text-sm text-slate-400">
          {games.length} matchs programmés · Fuseau America/Toronto
        </p>
      </div>

      {games.length === 0 ? (
        <div className="card text-center py-12 text-slate-400">
          Aucun match trouvé pour aujourd'hui dans les ligues actives.
        </div>
      ) : (
        Object.entries(byLeague).map(([league, leagueGames]) => (
          <section key={league}>
            <h3 className="font-display text-sm font-semibold text-accent-glow mb-3 uppercase tracking-wider">
              {league} ({leagueGames.length})
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {leagueGames.map((game) => (
                <GameCard key={game.id} game={game} league={league} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function GameCard({ game, league }: { game: CalendarGame; league: string }) {
  const border = LEAGUE_COLORS[league] || "border-surface-border";
  const time = new Date(game.startTime).toLocaleString("fr-CA", {
    timeZone: "America/Toronto",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={`card border-l-4 ${border}`}>
      <div className="text-xs text-slate-500 mb-2">{time} HE</div>
      <div className="font-medium">
        <span className="text-slate-300">{game.awayAbbr || game.awayTeam}</span>
        <span className="text-slate-500 mx-2">@</span>
        <span className="text-white">{game.homeAbbr || game.homeTeam}</span>
      </div>
      <div className="text-xs text-slate-500 mt-2">{game.status}</div>
      {game.venue && (
        <div className="text-xs text-slate-600 mt-1 truncate">{game.venue}</div>
      )}
    </div>
  );
}
