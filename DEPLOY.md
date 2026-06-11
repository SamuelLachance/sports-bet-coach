# Hébergement pro en 15 minutes

Ce guide vous mène de l'URL GitHub (`samuellachance.github.io/sports-bet-coach/`) à une adresse professionnelle : **https://sharpsheettips.com**

Le code est déjà prêt (`VITE_BASE=/`). Il ne reste que l'achat du domaine et la configuration DNS.

---

## Pourquoi changer d'URL ?

L'URL actuelle expose votre nom d'utilisateur GitHub et le nom technique du dépôt. Pour un produit public (Sharp Sheet Tips), une adresse du type `sharpsheettips.com` inspire plus confiance et se partage plus facilement.

---

## Étape 1 — Acheter le domaine (~10 $/an)

1. Créez un compte sur [Cloudflare Registrar](https://www.cloudflare.com/products/registrar/) (recommandé — prix au coût, sans marge).
2. Recherchez **sharpsheettips.com** et achetez-le (~**10 $ USD/an**).
3. Cloudflare devient automatiquement votre gestionnaire DNS.

**Si le domaine est déjà pris :** alternatives possibles — `sharpsheetpicks.com`, `sheetsignals.com`.

---

## Étape 2 — Configurer le DNS (GitHub Pages)

Dans Cloudflare → **DNS → Records**, ajoutez :

| Type    | Nom | Contenu / Cible              | Proxy |
|---------|-----|------------------------------|-------|
| **A**   | `@` | `185.199.108.153`            | DNS only (nuage gris) |
| **A**   | `@` | `185.199.109.153`            | DNS only |
| **A**   | `@` | `185.199.110.153`            | DNS only |
| **A**   | `@` | `185.199.111.153`            | DNS only |
| **CNAME** | `www` | `samuellachance.github.io` | DNS only |

> **Important :** désactivez le proxy Cloudflare (nuage gris) sur ces enregistrements — GitHub Pages exige des IP directes pour la validation.

---

## Étape 3 — Domaine custom dans GitHub

1. Ouvrez le dépôt : https://github.com/samuellachance/sports-bet-coach
2. **Settings → Pages → Custom domain**
3. Entrez `sharpsheettips.com` et cliquez **Save**
4. Attendez la vérification DNS (quelques minutes à 24 h)
5. Cochez aussi `www.sharpsheettips.com` si proposé, ou ajoutez un redirect `www` → racine dans Cloudflare

---

## Étape 4 — Forcer HTTPS

Une fois le domaine validé (coche verte dans GitHub Pages) :

1. **Settings → Pages → Enforce HTTPS** — cochez la case
2. Attendez quelques minutes que le certificat Let's Encrypt soit émis

---

## Étape 5 — Pousser le code (déjà configuré)

Le workflow `.github/workflows/pages.yml` utilise déjà `VITE_BASE: /` (chemin racine pour domaine custom).

```bash
git push origin master
```

GitHub Actions reconstruit le site automatiquement (~2–3 min). Vérifiez dans **Actions → Deploy to GitHub Pages** que le workflow est vert.

---

## Vérifier que tout fonctionne

1. Ouvrez https://sharpsheettips.com — la page d'accueil Sharp Sheet Tips s'affiche
2. Rafraîchissez les picks — les données JSON se chargent (onglet Réseau du navigateur)
3. Le cadenas HTTPS est actif

---

## Mise à jour quotidienne (sans action de votre part)

- **Push sur `master`** → redéploiement automatique
- **Cron quotidien** (midi UTC) → rafraîchit les données Google Sheets / ESPN

---

## Coût total

| Poste                         | Coût        |
|-------------------------------|-------------|
| Hébergement GitHub Pages      | **0 $**     |
| Domaine sharpsheettips.com    | **~10 $/an** |
| Certificat HTTPS              | **0 $** (inclus) |
| **Total**                     | **~10 $/an** |

---

## Option gratuite (URL GitHub)

Si vous ne souhaitez pas acheter de domaine, vous pouvez garder l'URL GitHub — mais il faudra remettre `VITE_BASE: /sports-bet-coach/` dans `.github/workflows/pages.yml` :

**Adresse :** https://samuellachance.github.io/sports-bet-coach/

Coût : **0 $**. Voir la section ci-dessus pour le compromis entre URL pro et URL GitHub.

---

## Limitations GitHub Pages

Pas d'API Express en direct — pas de sync manuelle ni refresh live entre les déploiements. Pour l'expérience complète (sync, ESPN live), lancez `npm run dev` en local ou hébergez le serveur Node (`npm start`) séparément.
