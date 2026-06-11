# Héberger Sharp Sheet Tips — guide simple

Votre site est **déjà en ligne**, gratuitement, sur GitHub Pages.

**Adresse actuelle :** https://samuellachance.github.io/sports-bet-coach/

---

## Option A — GitHub Pages (recommandé, 0 $)

C’est la solution déjà en place. Rien à acheter, rien à installer sur un serveur.

### Comment mettre le site à jour

1. Modifiez votre code localement (ou directement sur GitHub).
2. **Poussez vos changements sur la branche `master`** (ou fusionnez une pull request vers `master`).
3. GitHub déploie automatiquement — vous n’avez rien d’autre à faire.

### Vérifier que le déploiement a réussi

1. Ouvrez votre dépôt sur GitHub : `https://github.com/samuellachance/sports-bet-coach`
2. Cliquez sur l’onglet **Actions**.
3. Cherchez le workflow **« Deploy to GitHub Pages »** — il doit être **vert** (succès).
4. Attendez **2 à 3 minutes** après un push, puis rafraîchissez le site dans votre navigateur.

> **Astuce :** Le site se reconstruit aussi **tous les jours à midi UTC** (environ 7 h ou 8 h du matin au Québec selon l’heure d’été) pour rafraîchir les données sans que vous ayez à pousser du code.

### Coût

**0 $** — hébergement et certificat HTTPS inclus.

---

## Option B — Domaine personnalisé (ex. sharpsheettips.com, ~10 $/an)

Si vous voulez une adresse du type `https://sharpsheettips.com` au lieu de l’URL GitHub :

### Étape 1 — Acheter le domaine

Achetez le nom sur un registrar simple, par exemple :

- [Cloudflare Registrar](https://www.cloudflare.com/products/registrar/)
- [Porkbun](https://porkbun.com/)

Budget typique : **environ 10 à 15 $ CAD par an** pour un `.com`.

### Étape 2 — Configurer le DNS

Dans le panneau DNS de votre registrar, ajoutez :

| Type  | Nom | Valeur |
|-------|-----|--------|
| **A** | `@` | `185.199.108.153` |
| **A** | `@` | `185.199.109.153` |
| **A** | `@` | `185.199.110.153` |
| **A** | `@` | `185.199.111.153` |
| **CNAME** | `www` | `samuellachance.github.io` |

*(Ce sont les adresses IP officielles de GitHub Pages.)*

### Étape 3 — Indiquer le domaine à GitHub

1. Sur GitHub : **Settings → Pages → Custom domain**
2. Entrez `sharpsheettips.com` (ou votre domaine)
3. Attendez la validation DNS (quelques minutes à 24 h)
4. Cochez **Enforce HTTPS** une fois disponible

### Étape 4 — Modifier le projet (obligatoire pour un domaine custom)

Avec un domaine à la racine (`sharpsheettips.com`), le chemin de base du site change.

Dans `.github/workflows/pages.yml`, remplacez :

```yaml
VITE_BASE: /sports-bet-coach/
```

par :

```yaml
VITE_BASE: /
```

Puis poussez sur `master`. Sans ce changement, les liens et ressources du site ne fonctionneront pas correctement sur le domaine custom.

### Coût total avec domaine custom

- Hébergement GitHub Pages : **0 $**
- Nom de domaine : **~10 $/an**
- **Total : ~10 $/an**

---

## Résumé rapide

| | Option A (GitHub Pages) | Option B (domaine custom) |
|--|-------------------------|---------------------------|
| URL | `samuellachance.github.io/sports-bet-coach/` | `sharpsheettips.com` |
| Coût | **0 $** | **~10 $/an** |
| Mise à jour | Push sur `master` | Push sur `master` + DNS + changement `VITE_BASE` |
| Difficulté | Très simple | Un peu plus de configuration |

**Pour la plupart des usages, l’option A suffit amplement.**
