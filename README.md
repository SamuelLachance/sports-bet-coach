# Sharp Sheet Tips

Daily sports betting recommendations synced with Google Sheets and ESPN schedules (MLB, NBA, NHL, NFL, WNBA, CBB, CFB).

Interface en fran?ais ? Fuseau horaire America/Toronto (Qu?bec).

## Pr?requis

- Node.js 20+ (LTS recommand?)
- npm

## Installation

```bash
cd C:\Users\Admin\Projects\sports-bet-coach
npm install
cd client && npm install && cd ..
```

Copiez `.env.example` vers `.env` si vous souhaitez personnaliser le port ou le fuseau.

## Lancement

```bash
# Terminal unique ? API (3001) + interface (5173)
npm run dev
```

- **Interface:** http://localhost:5173
- **API:** http://localhost:3001/api/health

### Scripts utiles

| Commande | Description |
|----------|-------------|
| `npm run dev` | API + client en mode d?veloppement |
| `npm run dev:server` | API seule |
| `npm run dev:client` | Client Vite seul |
| `npm run sync` | Synchroniser les Google Sheets vers le cache local |
| `npm run build` | Build production du client |

## Sources Google Sheets

L'application lit **4 onglets** via export CSV :

| Onglet | GID | Type | URL |
|--------|-----|------|-----|
| Picks du jour | 0 | Feuille publi?e | `/e/2PACX-?/pub?output=csv&gid=0` |
| Archives | 1883403692 | Feuille publi?e | `/e/2PACX-?/pub?output=csv&gid=1883403692` |
| Performance quotidienne | 0 | Feuille ?ditable | `/d/1MHiDdyZ?/export?format=csv&gid=0` |
| Performance annuelle | 1887286192 | Feuille ?ditable | `/d/1MHiDdyZ?/export?format=csv&gid=1887286192` |

Les CSV bruts sont mis en cache dans `data/raw/`. Les donn?es pars?es sont dans `data/cache/sheets.json`.

### Structure des feuilles

**Picks du jour** ? Colonnes par signal :
- Sharp Money
- Book Needs (Fade Plays)
- Square Top Position (Fade)
- Reverse Line Movement
- Sections sp?ciales : Mega Sharps, Whale Plays, Model Best Values, Mega RLM

Chaque section liste des ligues (MLB, WNBA, NHL, NBA?) avec heures de match et s?lections (?quipe + cote, ou OVER/UNDER).

**Archives** ? Liste historique des dates de publication.

**Performance quotidienne** ? W/L/Retour par ligue et cat?gorie (Sharp Money, Sportsbook, Squares, Model, Whale) avec totaux MTD.

**Performance annuelle** ? Retours mensuels par ann?e (2022?2026) et all-time par cat?gorie/ligue.

## Calendriers sportifs

API ESPN gratuite (aucune cl? requise) :

- MLB, NBA, NHL, NFL, WNBA, CBB (basket universitaire), CFB (football universitaire)

Les picks sont associ?s aux matchs du jour par correspondance de noms d'?quipes.

## Dual-algo gate (Coach + Sports Odds)

For **MLB, NBA, NHL, NFL, WNBA, CBB, and CFB**, a bet is only recommended when **both** algorithms agree:

1. **Coach algo** ? sharp-sheet rules engine consolidates signals on the same game
2. **Sports Odds algo** ? [Sports-Odds-Algorithms](https://github.com/SamuelLachance/Sports-Odds-Algorithms) Algo V2 live model (ESPN schedules + win probability)

If the odds model favors a different side, the game becomes **No bet**. Totals are blocked on these leagues because the odds model is moneyline-focused. For basketball and MLB, all three unified model layers (legacy, power, sport-specific) must agree before a pick is recommended. Algo force picks appear when edge exceeds the +50 threshold even without sheet signals.

| Variable | Default | Purpose |
|----------|---------|---------|
| `SPORTS_ODDS_ENABLED` | `true` | Require dual-algo agreement on MLB/NBA/NHL/NFL/WNBA/CBB/CFB |
| `SPORTS_ODDS_BASE_URL` | GitHub Pages URL | Live FastAPI (`http://127.0.0.1:8000`) or static slate JSON |
| `SPORTS_ODDS_FORCE_MIN_EDGE` | `50` | Force-recommend when book edge (American odds pts) exceeds threshold (overrides coach) |

NBA, WNBA, CBB, NFL, and CFB recommendations use the **consensus book spread** from Sports Odds (`spread_line`, `consensus_spread`, `spread_odds` on `top_pick`) instead of moneyline when Sports Odds confirms or forces a pick.

Confirmed picks show a **Dual algo** badge in the UI.

## Moteur de confiance dynamique

Le score de confiance (0?100) remplace l'ancienne table statique `SIGNAL_CONFIDENCE`. Il est recalcul? ? chaque sync ? partir des donn?es historiques Google Sheets.

### Sources utilis?es

| Source | R?le |
|--------|------|
| Performance annuelle (gid 1887286192) | ROI all-time et mensuel par cat?gorie de signal |
| Performance quotidienne (gid 0) | W/L, win rate et retour par ligue |
| Archives (467+ jours) | Taille d'?chantillon et contexte temporel |
| Picks du jour | Croisement de signaux sur le m?me match (slate) |

### Composantes du score

1. **ROI historique** ? retour blended (40 % all-time + 60 % r?cent avec decay sur 6 mois), pond?r? par taille d'?chantillon
2. **Inversion fade** ? signaux ultra-n?gatifs (Square, Book Needs, Whale) : confiance basse sur le fade, **boost sur l'adversaire** (`opponentPick`)
3. **Croisement signaux** ? confluence (Sharp + Mega Sharps) ou conflit (sharp vs fade) sur le m?me match
4. **Performance ligue** ? modificateur si donn?es disponibles pour MLB, NBA, etc.
5. **Match ESPN** ? +5 si le pick est associ? ? un match confirm?

### Polarit? du signal

- `positive` ? ROI historique favorable
- `negative` ? ROI d?favorable (confiance r?duite)
- `inverted` ? fade historiquement perdant ? jouer l'?quipe adverse

### Cache

Stats pr?-calcul?es dans `data/cache/confidence-stats.json` (r?g?n?r? au sync).

### Test

```bash
npm run test:confidence
```

Affiche la comparaison legacy vs dynamique pour les picks du jour.

## Moteur de recommandations

1. Parse les picks du jour depuis Google Sheets
2. Charge le calendrier ESPN pour les ligues actives
3. Associe chaque pick ? un match (si possible)
4. Calcule confiance dynamique via `confidenceEngine.ts`
5. Affiche statut : recommand? / en attente / en cours / termin?

## Variables d'environnement

| Variable | D?faut | Description |
|----------|--------|-------------|
| `PORT` | `3001` | Port de l'API Express |
| `TZ` | `America/Toronto` | Fuseau pour les dates |

**Aucune cl? API externe n'est requise** pour le fonctionnement de base.

## Architecture

```
sports-bet-coach/
??? client/          # Vite + React + TypeScript + Tailwind
??? server/
?   ??? parsers/     # CSV ? mod?les
?   ??? services/    # Sheets, calendrier, confiance, recommandations
?   ??? index.ts     # API Express
??? data/
    ??? raw/         # CSV bruts
    ??? cache/       # JSON pars?
```

## API Endpoints

- `GET /api/health` ? Sant? + date
- `GET /api/recommendations` ? Picks du jour avec matchs
- `GET /api/calendar` ? Calendrier du jour
- `GET /api/stats` ? Bankroll / performance
- `GET /api/sync/status` ? Statut de sync
- `POST /api/sync` ? Forcer synchronisation

## GitHub Pages

Site public (snapshot des donnees au build CI) : **https://sharpsheettips.com**

> **Domaine custom :** le projet est configure avec `VITE_BASE=/` pour heberger a la racine du domaine. Configurez `sharpsheettips.com` dans GitHub (Settings ? Pages ? Custom domain) et le DNS chez votre registrar ? voir [DEPLOY.md](DEPLOY.md).
>
> **Sans domaine custom :** l'ancienne URL `https://samuellachance.github.io/sports-bet-coach/` ne fonctionne plus avec `VITE_BASE=/`. Pour la retrouver temporairement, remettez `VITE_BASE: /sports-bet-coach/` dans `.github/workflows/pages.yml`.

Le deploiement utilise GitHub Actions (`.github/workflows/pages.yml`) :

1. Sync Google Sheets + calendriers ESPN
2. Export JSON statique dans `client/public/api/`
3. Build Vite avec `VITE_STATIC_API=true` et base `/`

**Limitations sur Pages :** pas d'API Express en direct ? pas de sync manuelle ni refresh live entre les deploiements. Pour l'experience complete (sync, ESPN live), lancez `npm run dev` en local ou hebergez le serveur Node (`npm start`) separement.

Build local du bundle Pages :

```bash
set VITE_BASE=/
set VITE_STATIC_API=true
npm run build:pages
```

