# Sports Bet Coach

Application de recommandations de paris sportifs quotidiennes, synchronisée avec Google Sheets et les calendriers ESPN (MLB, NBA, NHL, NFL, WNBA, CBB, CFB).

Interface en français · Fuseau horaire America/Toronto (Québec).

## Prérequis

- Node.js 20+ (LTS recommandé)
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
# Terminal unique — API (3001) + interface (5173)
npm run dev
```

- **Interface:** http://localhost:5173
- **API:** http://localhost:3001/api/health

### Scripts utiles

| Commande | Description |
|----------|-------------|
| `npm run dev` | API + client en mode développement |
| `npm run dev:server` | API seule |
| `npm run dev:client` | Client Vite seul |
| `npm run sync` | Synchroniser les Google Sheets vers le cache local |
| `npm run build` | Build production du client |

## Sources Google Sheets

L'application lit **4 onglets** via export CSV :

| Onglet | GID | Type | URL |
|--------|-----|------|-----|
| Picks du jour | 0 | Feuille publiée | `/e/2PACX-…/pub?output=csv&gid=0` |
| Archives | 1883403692 | Feuille publiée | `/e/2PACX-…/pub?output=csv&gid=1883403692` |
| Performance quotidienne | 0 | Feuille éditable | `/d/1MHiDdyZ…/export?format=csv&gid=0` |
| Performance annuelle | 1887286192 | Feuille éditable | `/d/1MHiDdyZ…/export?format=csv&gid=1887286192` |

Les CSV bruts sont mis en cache dans `data/raw/`. Les données parsées sont dans `data/cache/sheets.json`.

### Structure des feuilles

**Picks du jour** — Colonnes par signal :
- Sharp Money
- Book Needs (Fade Plays)
- Square Top Position (Fade)
- Reverse Line Movement
- Sections spéciales : Mega Sharps, Whale Plays, Model Best Values, Mega RLM

Chaque section liste des ligues (MLB, WNBA, NHL, NBA…) avec heures de match et sélections (équipe + cote, ou OVER/UNDER).

**Archives** — Liste historique des dates de publication.

**Performance quotidienne** — W/L/Retour par ligue et catégorie (Sharp Money, Sportsbook, Squares, Model, Whale) avec totaux MTD.

**Performance annuelle** — Retours mensuels par année (2022–2026) et all-time par catégorie/ligue.

## Calendriers sportifs

API ESPN gratuite (aucune clé requise) :

- MLB, NBA, NHL, NFL, WNBA, CBB (basket universitaire), CFB (football universitaire)

Les picks sont associés aux matchs du jour par correspondance de noms d'équipes.

## Moteur de confiance dynamique

Le score de confiance (0–100) remplace l'ancienne table statique `SIGNAL_CONFIDENCE`. Il est recalculé à chaque sync à partir des données historiques Google Sheets.

### Sources utilisées

| Source | Rôle |
|--------|------|
| Performance annuelle (gid 1887286192) | ROI all-time et mensuel par catégorie de signal |
| Performance quotidienne (gid 0) | W/L, win rate et retour par ligue |
| Archives (467+ jours) | Taille d'échantillon et contexte temporel |
| Picks du jour | Croisement de signaux sur le même match (slate) |

### Composantes du score

1. **ROI historique** — retour blended (40 % all-time + 60 % récent avec decay sur 6 mois), pondéré par taille d'échantillon
2. **Inversion fade** — signaux ultra-négatifs (Square, Book Needs, Whale) : confiance basse sur le fade, **boost sur l'adversaire** (`opponentPick`)
3. **Croisement signaux** — confluence (Sharp + Mega Sharps) ou conflit (sharp vs fade) sur le même match
4. **Performance ligue** — modificateur si données disponibles pour MLB, NBA, etc.
5. **Match ESPN** — +5 si le pick est associé à un match confirmé

### Polarité du signal

- `positive` — ROI historique favorable
- `negative` — ROI défavorable (confiance réduite)
- `inverted` — fade historiquement perdant → jouer l'équipe adverse

### Cache

Stats pré-calculées dans `data/cache/confidence-stats.json` (régénéré au sync).

### Test

```bash
npm run test:confidence
```

Affiche la comparaison legacy vs dynamique pour les picks du jour.

## Moteur de recommandations

1. Parse les picks du jour depuis Google Sheets
2. Charge le calendrier ESPN pour les ligues actives
3. Associe chaque pick à un match (si possible)
4. Calcule confiance dynamique via `confidenceEngine.ts`
5. Affiche statut : recommandé / en attente / en cours / terminé

## Variables d'environnement

| Variable | Défaut | Description |
|----------|--------|-------------|
| `PORT` | `3001` | Port de l'API Express |
| `TZ` | `America/Toronto` | Fuseau pour les dates |

**Aucune clé API externe n'est requise** pour le fonctionnement de base.

## Architecture

```
sports-bet-coach/
├── client/          # Vite + React + TypeScript + Tailwind
├── server/
│   ├── parsers/     # CSV → modèles
│   ├── services/    # Sheets, calendrier, confiance, recommandations
│   └── index.ts     # API Express
└── data/
    ├── raw/         # CSV bruts
    └── cache/       # JSON parsé
```

## API Endpoints

- `GET /api/health` — Santé + date
- `GET /api/recommendations` — Picks du jour avec matchs
- `GET /api/calendar` — Calendrier du jour
- `GET /api/stats` — Bankroll / performance
- `GET /api/sync/status` — Statut de sync
- `POST /api/sync` — Forcer synchronisation
