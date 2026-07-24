# Déploiement DeliveryTrack — Render + GitHub

## Architecture

```
Navigateur → deliverytrack-web.onrender.com (nginx)
                  │
                  ├── /api/*   → deliverytrack-api.onrender.com (NestJS)
                  ├── /socket.io → deliverytrack-api.onrender.com (Socket.IO)
                  └── /*        → fichiers statiques (React SPA)
```

- **Frontend** : Docker Web Service (nginx qui sert le build React + proxy `/api` et `/socket.io`)
- **Backend** : Docker Web Service (NestJS, port 3000)
- **Base de données** : PostgreSQL managé (Render)
- **Cache/Queue** : Redis managé (Render)
- **Déploiement** : automatique sur chaque `git push` sur la branche `main`

---

## 1. Créer le dépôt GitHub

1. Aller sur [github.com/new](https://github.com/new)
2. Nom : `delivery-tracking` (ou autre)
3. **Ne pas cocher** "Add a README" (on a déjà le projet)
4. Créer le dépôt

5. Dans le terminal, exécuter :

```bash
cd /home/fenohasina/projects/delivery-tracking

git remote add origin https://github.com/<VOTRE_USER>/delivery-tracking.git
git branch -M main
git push -u origin main
```

> **Important** : Le `.gitignore` existe déjà — les fichiers `.env`, `node_modules/`, `dist/` ne seront pas commités.

---

## 2. Modifier render.yaml

Avant de pousser, éditer `render.yaml` à la racine du projet :

```yaml
repo: https://github.com/<VOTRE_USER>/delivery-tracking
```

Remplacer `CHANGE_ME` par votre nom d'utilisateur GitHub.

---

## 3. Créer un compte Render

1. Aller sur [render.com](https://render.com)
2. S'inscrire avec **GitHub** (recommendé) — Render aura directement accès à vos dépôts
3. Plan gratuit suffisant pour le staging

---

## 4. Déployer avec le Blueprint

1. Dans le dashboard Render : **New → Blueprint**
2. Sélectionner le dépôt `delivery-tracking`
3. Render détecte automatiquement `render.yaml` et propose les services :
   - `deliverytrack-db` (PostgreSQL) — **starter** ($7/mois)
   - `deliverytrack-redis` (Redis) — **free** ($0/mois)
   - `deliverytrack-api` (Docker Web Service) — **starter** ($7/mois)
   - `deliverytrack-web` (Docker Web Service) — **starter** ($7/mois)
4. Cliquer **Apply**

Render va :
1. Provisionner la base PostgreSQL et Redis
2. Build et déployer le backend
3. Build et déployer le frontend

**Temps estimé** : 5-8 minutes (premier build, avec cache Docker → 2-3 min ensuite)

---

## 5. Variables d'environnement

Le Blueprint génère automatiquement :
- `DATABASE_URL` et `REDIS_URL` (liées aux bases provisionnées)
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CSRF_SECRET`, `ENCRYPTION_KEY` (valeurs aléatoires)
- `CORS_ORIGIN` et `BACKEND_URL` (liées aux URLs des services)

### Optionnelles (à configurer dans le Dashboard si nécessaire)

Aller dans **Dashboard → deliverytrack-api → Environment** :

| Variable | Description |
|---|---|
| `RESEND_API_KEY` | Clé API Resend pour les emails transactionnels |
| `EMAIL_FROM` | Expéditeur des emails (ex: `noreply@deliverytrack.app`) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_CALLBACK_URL` | `https://deliverytrack-api.onrender.com/auth/google/callback` |
| `SENTRY_DSN` | Sentry DSN pour le monitoring d'erreurs |

### Pour le frontend

Aller dans **Dashboard → deliverytrack-web → Environment** :

| Variable | Description |
|---|---|
| `BACKEND_URL` | Déjà défini automatiquement par le Blueprint |
| `VITE_GOOGLE_MAPS_API_KEY` | Si vous utilisez Google Maps |

> `VITE_API_URL` n'est pas nécessaire ici car le nginx du frontend proxy `/api` vers le backend.

---

## 6. Vérifier le déploiement

1. Aller sur `https://deliverytrack-web.onrender.com`
2. La page d'accueil doit s'afficher
3. Vérifier que l'API répond : `https://deliverytrack-api.onrender.com/health`
4. Tenter de créer un compte / connexion

### Commandes de vérification rapide

```bash
# Health check backend
curl https://deliverytrack-api.onrender.com/health

# Page d'accueil frontend
curl -I https://deliverytrack-web.onrender.com
```

---

## 7. Déploiement automatique (Git push)

Render est connecté à GitHub. Chaque `git push` sur `main` déclenche automatiquement :

1. CI Pipeline (GitHub Actions : lint + tests)
2. Build des images Docker
3. Exécution des migrations Prisma (via `prisma migrate deploy`)
4. Redéploiement avec zéro downtime

### Attendre que les tests CI passent

Pour éviter de déployer un code qui échoue aux tests :

1. Aller dans **Dashboard Render → deliverytrack-api → Settings → Deploy**
2. Dans **GitHub commit status checks**, sélectionner les checks requis :
   - `ci-summary` (ou tous les jobs CI)
3. Render ne déploiera que si les checks GitHub passent

Pour déployer une mise à jour :

```bash
git add .
git commit -m "feat: description du changement"
git push
```

Render détecte le push et déploie automatiquement (après CI).

---

## 8. Ajouter un nom de domaine personnalisé (optionnel)

1. Acheter un domaine (ex: `deliverytrack.app` sur Namecheap, GoDaddy, etc.)
2. Dans Render :
   - **Dashboard → deliverytrack-web → Settings → Custom Domain**
   - Ajouter `app.deliverytrack.app`
   - Suivre les instructions pour ajouter un enregistrement CNAME
3. Même chose pour l'API :
   - **Dashboard → deliverytrack-api → Settings → Custom Domain**
   - Ajouter `api.deliverytrack.app`
4. Mettre à jour les variables d'environnement :
   - `CORS_ORIGIN` → `https://app.deliverytrack.app`
   - `BACKEND_URL` → `https://api.deliverytrack.app`
   - `APP_URL` → `https://app.deliverytrack.app`

---

## 9. Rollback

En cas de problème avec un déploiement :

1. Aller dans **Dashboard → deliverytrack-api → Deploy History**
2. Cliquer **Manual Rollback** sur la version précédente
3. Même chose pour `deliverytrack-web`

---

## 10. Sauvegardes

Render fournit des sauvegardes automatiques pour PostgreSQL (plan Starter : daily backups, 7 jours de rétention).

Pour une sauvegarde manuelle :

```bash
pg_dump "$DATABASE_URL" > backup_$(date +%Y%m%d).sql
```

---

## Coût estimé (staging)

| Service | Plan | Coût/mois |
|---|---|---|
| PostgreSQL | Starter | $7 |
| Redis | Free | $0 |
| API Web Service | Starter | $7 |
| Frontend Web Service | Starter | $7 |
| **Total** | | **$21/mois** |

> Conseil : Pour réduire les coûts, on peut mettre le frontend et backend dans le **même** service Docker (multi-stage), ce qui divise par 2 le nombre de Web Services.

---

## Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| `503 Service Unavailable` | Build en cours | Attendre 2-3 min, refresh |
| `ENCRYPTION_KEY is required` | Secret manquant | Vérifier les env vars du backend |
| `Refresh token not found` | Cookie cross-origin bloqué | Navigateur : vérifier cookies tiers autorisés |
| Prisma migration fails | Schéma modifié mais pas migré | Render exécute `migrate deploy` automatiquement au démarrage |
| API 404 sur `/api/*` | Nginx ne trouve pas le backend | Vérifier `BACKEND_URL` dans frontend env vars |
| CORS error | `CORS_ORIGIN` pas à jour | Vérifier qu'il correspond exactement au frontend URL |
