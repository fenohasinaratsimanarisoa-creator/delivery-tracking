# Deployment Guide — Delivery Tracking

## Render (Production)

Render auto-deploys both services from `main` branch.

- **Backend**: `deliverytrack-api` — Dockerfile in `./backend`
- **Frontend**: `deliverytrack-web` — Dockerfile in `./frontend`

### Environment
- **Plan**: Free tier (both services)
- **Database**: PostgreSQL on Render, free tier (90-day limit)
- **Redis**: Render Redis, free tier

### ⚠️ Free Tier Limitations

**Service Sleep**: On the free plan, Render puts web services to sleep after 15 minutes of inactivity. The first request after sleep triggers a cold start that can take 30-60 seconds — the user sees a 504 Gateway Timeout during this period. The service then works normally on subsequent requests.

**Mitigation**: A GitHub Actions cron workflow (`keepalive.yml`) pings the health endpoint every 5 minutes to prevent sleep. This keeps the service awake continuously.

**Database Expiration**: The free PostgreSQL tier expires after 90 days. The database for this project was provisioned around July 20, 2026. Expected expiration: ~October 18, 2026. **Migrate to a paid DB plan before this date to avoid data loss.**

### Troubleshooting 504 Errors

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| 504 on first request after idle period | Free tier sleep | Wait 30-60s, retry. Keepalive should prevent this. |
| 504 on all requests | DB connection pool exhausted | Check Render logs, restart service |
| 504 on Google OAuth | Google OAuth misconfig | Verify GOOGLE_CALLBACK_URL in Render env vars |
| Buttons disappear on login | Google status check failed | Fixed — "Créer un compte" always visible now |
| Generic "un problème est survenu" | Backend error (check logs) | Check Render logs for exact error |

### Deployment Commands

```bash
# Verify builds
cd backend && npm run build
cd ../frontend && npx tsc --noEmit && npm run build

# Commit & push (triggers Render auto-deploy)
git add -A && git commit -m "description" && git push origin master:main
```

### Manual Deploy

If auto-deploy doesn't trigger:
1. Go to Render dashboard → `deliverytrack-api` → Manual Deploy → Deploy latest commit
2. Same for `deliverytrack-web`
3. Wait for both to show "Live"

### Health Check

```
GET https://deliverytrack-api.onrender.com/health
→ {"status":"ok","timestamp":"...","checks":{"database":"ok","redis":"ok","queue":"ok"}}
```

### Upgrading from Free Tier

To eliminate sleep and DB expiration:
1. **Web services** (~$7/mo each): Upgrade from "Free" to "Starter" plan
2. **PostgreSQL** (~$7/mo): Upgrade from "Free" to "Starter" plan  
3. **Redis** (~$0/mo): Free tier has no expiration, keep as-is

Total: ~$21/mo for production-ready hosting.

### Infrastructure History

| Date | Event |
|------|-------|
| July 20, 2026 | Database provisioned (90-day timer starts) |
| July 24, 2026 | Login 504 diagnosed as free tier sleep |
| July 25, 2026 | Keepalive cron added to prevent sleep |
| ~Oct 18, 2026 | **DB free tier expires — migrate before this date** |

---

## Oracle Cloud (Always Free) — Environnement parallèle

**Pourquoi :** la base Postgres de Render (free tier) expire le ~18 octobre 2026, et
le cold start (15 min d'inactivité) provoque des 504 intermittents. Oracle Cloud
"Always Free" offre une VM ARM (Ampere A1) **jusqu'à 4 OCPU / 24 Go RAM, gratuite
à vie, sans expiration** — de quoi héberger toute la stack (Postgres, Redis,
backend, frontend, Traccar, OSRM) sur une seule machine.

Cette section met en place Oracle Cloud **en environnement parallèle** :
Render continue de servir la production pendant qu'on valide Oracle. Aucune
bascule DNS n'est faite tant que vous ne l'avez pas décidé explicitement.

Fichiers déjà prêts dans le repo pour cette migration :
- `docker-compose.oracle.yml` — stack complète (Postgres+PostGIS, Redis, backend,
  worker, frontend, Traccar, OSRM, Caddy en reverse-proxy, backups planifiés)
- `.env.oracle.example` — modèle de configuration à copier en `.env`
- `Caddyfile` — reverse-proxy HTTP (prêt pour HTTPS dès qu'un domaine existe)
- `scripts/oracle-vm-setup.sh` — provisioning de la VM (Docker, pare-feu, clé SSH)
- `.github/workflows/deploy.yml` (job `deploy-staging`) — déploiement automatique
  sur push vers `main`, une fois les secrets GitHub configurés

### Étape 1 — Créer le compte Oracle Cloud

1. Allez sur https://www.oracle.com/cloud/free/ → **Start for free**.
2. Renseignez email, pays, puis une carte bancaire (vérification d'identité
   uniquement — **le tier Always Free n'est jamais facturé**, sauf si vous
   upgradez explicitement vers "Pay As You Go").
3. Choisissez une **Home Region** proche de vous (ex. `eu-frankfurt-1`,
   `eu-paris-1`, `eu-marseille-1`). Ce choix est définitif pour ce compte.
4. Validez l'email et le téléphone (SMS).

⚠️ **Piège fréquent — "Out of host capacity"** : la capacité Ampere A1 gratuite
est limitée par région/zone et parfois indisponible au moment de la création.
Si l'instance refuse de se créer avec cette erreur : réessayez plus tard (la
capacité se libère régulièrement), changez d'*Availability Domain* dans le
formulaire, ou essayez une autre région proche si votre Home Region est saturée.

### Étape 2 — Provisionner la VM Ampere A1 (ARM64, Always Free)

1. Console Oracle Cloud → menu ☰ → **Compute** → **Instances** → **Create Instance**.
2. **Name** : `delivery-tracking-staging`.
3. **Image and shape** → *Edit* → **Image** : Canonical Ubuntu (dernière version
   22.04/24.04, variante **aarch64**). **Shape** → *Change shape* → onglet
   **Ampere** → `VM.Standard.A1.Flex` → réglez **4 OCPU / 24 Go RAM** (le
   maximum Always Free — vous pouvez répartir sur plusieurs VM plus petites,
   mais une seule VM est plus simple pour cette stack).
4. **Networking** : gardez le VCN par défaut (ou créez-en un), cochez
   **Assign a public IPv4 address**.
5. **Add SSH keys** : générez une nouvelle paire de clés dans le formulaire
   (téléchargez la clé privée `.key`, gardez-la précieusement) ou collez votre
   clé publique existante (`~/.ssh/id_ed25519.pub`).
6. **Boot volume** : la valeur par défaut (~50 Go) suffit largement (le
   quota Always Free autorise jusqu'à 200 Go de stockage bloc au total).
7. **Create**. Notez l'**adresse IP publique** une fois l'instance "Running".

### Étape 3 — Ouvrir les ports réseau (DEUX pare-feux à configurer)

Oracle Cloud a **deux couches de pare-feu indépendantes** — il faut ouvrir les
deux, sinon le port reste bloqué même si l'une des deux l'autorise :

1. **Security List du VCN** (pare-feu réseau, niveau console) :
   Console → **Networking** → **Virtual Cloud Networks** → votre VCN → onglet
   **Security Lists** → *Default Security List* → **Add Ingress Rules** :
   ajoutez une règle par port (`80`, `443`, `8082`, et `5055`-`5065` pour
   Traccar), Source `0.0.0.0/0`, protocole TCP.
2. **iptables au niveau de l'OS** (les images Ubuntu d'Oracle bloquent tout
   sauf SSH par défaut, même si la Security List autorise le port) — géré
   automatiquement par le script de l'étape 4.

### Étape 4 — Préparer la VM (Docker, pare-feu OS, clé de déploiement)

Connectez-vous en SSH :
```bash
ssh -i /chemin/vers/votre_cle.key ubuntu@<IP-PUBLIQUE-DE-LA-VM>
```

Clonez le repo puis lancez le script de provisioning :
```bash
sudo mkdir -p /opt/delivery-tracking-staging
sudo chown $USER:$USER /opt/delivery-tracking-staging
git clone https://github.com/<votre-org>/delivery-tracking.git /opt/delivery-tracking-staging
cd /opt/delivery-tracking-staging
bash scripts/oracle-vm-setup.sh
```

Le script installe Docker + le plugin compose, ouvre les ports côté OS
(iptables) et **affiche une clé SSH privée à copier dans un secret GitHub**
(voir étape 6) — gardez le terminal ouvert le temps de la copier.

### Étape 5 — Configurer et lancer la stack

```bash
cd /opt/delivery-tracking-staging
cp .env.oracle.example .env
nano .env   # générez les secrets indiqués en commentaire (openssl rand -hex ...)
            # et mettez l'IP publique de la VM dans CORS_ORIGIN et APP_URL
```

Premier build (compte ~10-20 min : compilation d'OSRM depuis les sources +
téléchargement des données routières de Madagascar — uniquement au premier
build, les builds suivants réutilisent le cache Docker) :
```bash
docker compose -f docker-compose.oracle.yml build
docker compose -f docker-compose.oracle.yml up -d
docker compose -f docker-compose.oracle.yml exec backend npx prisma migrate deploy
```

Vérifiez que tout tourne :
```bash
curl http://localhost:3000/health   # backend
curl http://localhost/              # frontend, via Caddy
docker compose -f docker-compose.oracle.yml ps
```

Depuis votre navigateur : `http://<IP-PUBLIQUE-DE-LA-VM>` doit afficher
l'application. L'interface Traccar est sur `http://<IP-PUBLIQUE-DE-LA-VM>:8082`
(identifiants par défaut `admin`/`admin` — **changez-les immédiatement** dans
`traccar/traccar.xml`, clé `users.default`, puis redémarrez le conteneur).

### Étape 6 — Automatiser les déploiements (GitHub Actions)

Dans GitHub → repo → **Settings → Secrets and variables → Actions**, ajoutez :
- `STAGING_HOST` = IP publique de la VM
- `STAGING_USER` = `ubuntu` (ou l'utilisateur SSH utilisé)
- `STAGING_SSH_KEY` = la clé privée affichée par `oracle-vm-setup.sh` à
  l'étape 4 (contenu complet, `-----BEGIN...-----` à `-----END...-----`)

Chaque push sur `main` déclenche ensuite le job `deploy-staging` (voir
`.github/workflows/deploy.yml`) : il se connecte en SSH, fait `git pull`,
reconstruit les images **sur la VM** (nécessaire : les runners GitHub Actions
sont amd64, les images publiées sur GHCR ne peuvent pas tourner sur cette VM
ARM64 — voir la note ci-dessous) et redémarre la stack.

### Étape 7 — Domaine + HTTPS (quand vous en aurez un)

1. Pointez un enregistrement DNS `A` de votre domaine vers l'IP publique de la VM.
2. Sur la VM, éditez `Caddyfile` : commentez le bloc `:80 { ... }`, décommentez
   le bloc domaine en remplaçant `app.example.com` par votre domaine.
3. `docker compose -f docker-compose.oracle.yml restart caddy` — Caddy obtient
   seul un certificat Let's Encrypt (aucune autre action requise).
4. Dans `.env` : passez `CORS_ORIGIN`/`APP_URL` en `https://votre-domaine`,
   `ENFORCE_HTTPS=true`, puis `docker compose -f docker-compose.oracle.yml up -d`
   pour recharger le backend avec la nouvelle config.

### Notes techniques importantes

- **PostGIS sur ARM64** : l'image officielle `postgis/postgis` ne publie
  **aucune** variante arm64 (vérifié sur Docker Hub). `docker-compose.oracle.yml`
  utilise `imresamu/postgis` à la place — fork communautaire multi-arch, même
  tag `16-3.4`, compatible avec les migrations existantes sans rien changer côté
  application.
- **Moteur Prisma sur ARM64** : `backend/entrypoint.sh` détecte désormais
  l'architecture CPU (`uname -m`) et sélectionne le bon moteur natif Prisma —
  le Dockerfile pointait en dur vers le moteur x86_64, ce qui aurait fait
  planter le backend au démarrage sur une image construite nativement sur ARM.
- **CI/CD "build on host"** : contrairement à `deploy-production` (qui pull des
  images GHCR amd64), `deploy-staging` reconstruit les images **sur la VM
  elle-même**, car les runners GitHub Actions sont amd64 et ne peuvent pas
  produire d'images arm64 sans configuration multi-arch (buildx + QEMU) —
  hors périmètre pour l'instant, à envisager si la VM Oracle devient la prod.
- **Traccar migre avec le reste** : les traceurs GPS déjà configurés pour
  parler à l'instance Fly.io devront être reconfigurés (IP/port serveur côté
  boîtier) une fois basculés sur cette VM — à faire uniquement quand vous
  validez définitivement l'environnement Oracle, pas avant.
- **Sauvegardes réparées au passage** : le service `backup` de
  `docker-compose.prod.yml` référençait un `scripts/backup.sh` qui n'existait
  pas dans le repo, et utilisait `apk` (Alpine) sur une image basée Debian —
  les deux bugs faisaient échouer silencieusement les sauvegardes planifiées
  depuis le début. Corrigé dans `docker-compose.prod.yml` ET
  `docker-compose.oracle.yml` ; `scripts/backup.sh` a été créé (pg_dump +
  upload S3-compatible optionnel, Oracle Object Storage fonctionne nativement
  en mode compatible S3).
