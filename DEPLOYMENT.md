# Deployment Guide — Delivery Tracking

La **production tourne sur un VPS Contabo** (x86_64), stack Docker Compose
auto-hébergée, HTTPS automatique via Caddy + sslip.io (aucun domaine acheté).

- Section [Production — VPS Contabo](#production--vps-contabo) : provisioning initial + déploiement courant.
- Section [Alternative — Oracle Cloud Always Free](#alternative--oracle-cloud-always-free-arm64) : stack ARM64 gratuite à vie (environnement parallèle / plan B).
- Section [Historique — Render](#historique--render-désaffecté) : ancienne prod, désaffectée (juillet–août 2026).

---

## Production — VPS Contabo

### Vue d'ensemble

| Élément | Détail |
|---|---|
| Hôte | VPS Contabo x86_64, IP publique fixe |
| Orchestration | `docker-compose.contabo.yml` — postgres/postgis, redis, traccar, backend, worker, frontend, caddy, backup |
| Source de build | clone git dans `/opt/delivery-tracking` sur le VPS (build **sur l'hôte**, pas d'images GHCR) |
| HTTPS | Caddy obtient/renouvelle seul un cert Let's Encrypt pour `<IP-tirets>.sslip.io` (voir `Caddyfile`) |
| Accès API direct | backend aussi exposé en clair sur `127.0.0.1:8080` (debug/tests, hors chemin Caddy) |
| OSRM (itinéraires) | **omis** volontairement (choix RGPD — `routing.service.ts` renvoie 503 sans fallback public) |

### Déploiement courant

Tout passe par `scripts/deploy-contabo.sh`, exécuté **depuis le VPS** :

```bash
ssh root@<IP-VPS> '/opt/delivery-tracking/scripts/deploy-contabo.sh'
```

Le script (voir ses commentaires pour le détail) :

1. `git pull origin main` — sort en 0 sans rien faire si déjà à jour.
2. `docker compose -f docker-compose.contabo.yml build --no-cache backend worker frontend`
   (seulement les services applicatifs ; l'infra n'est jamais reconstruite par ce dépôt).
   Si le build échoue → aucun service redémarré, l'ancien build continue de tourner.
3. `up -d` des services applicatifs, puis attente 15 s.
4. **Health-gate** : `docker compose ps` doit montrer `backend` + `frontend` *healthy*,
   et `GET http://localhost:8080/health` doit répondre 200.
5. `npx prisma migrate deploy` (idempotent) **après** que le nouveau backend soit sain.
6. En cas d'échec à une des vérifs 4–5 : **rollback automatique** au commit précédent
   (`git reset --hard` + rebuild + redémarrage), puis sortie en 1.

Avant de pousser, vérifier les builds en local (identique à la CI) :

```bash
cd backend  && npm run build
cd ../frontend && npx tsc -b --noEmit && npm run build
git add -A && git commit -m "…" && git push origin main
```

> Il n'y a **pas** de déploiement automatique sur push : le `git pull` + build
> est déclenché manuellement par la commande SSH ci-dessus. `.github/workflows/ci.yml`
> valide chaque push (lint, typecheck, tests, e2e) mais ne déploie rien.

### Provisioning initial d'un nouveau VPS

1. **Système** : Docker + plugin compose, pare-feu (ports 80, 443, 22, et
   `5055`–`5065` TCP pour les protocoles traceurs Traccar).
2. **Clone** :
   ```bash
   sudo mkdir -p /opt/delivery-tracking && sudo chown "$USER" /opt/delivery-tracking
   git clone https://github.com/<org>/delivery-tracking.git /opt/delivery-tracking
   cd /opt/delivery-tracking
   ```
3. **Configuration** :
   ```bash
   cp .env.contabo.example .env
   nano .env   # générer chaque secret (openssl rand -hex 24/32/64), mettre
               # CORS_ORIGIN / APP_URL = https://<IP-tirets>.sslip.io
   ```
   Éditer aussi `Caddyfile` et `traccar/traccar.xml` (mot de passe admin `users.default`)
   avec l'IP / les identifiants réels.
4. **Premier lancement** :
   ```bash
   docker compose -f docker-compose.contabo.yml build
   docker compose -f docker-compose.contabo.yml up -d
   docker compose -f docker-compose.contabo.yml exec backend npx prisma migrate deploy
   docker compose -f docker-compose.contabo.yml exec backend npm run prisma:seed   # compte admin initial
   ```
5. **Vérifier** :
   ```bash
   curl -sf http://localhost:8080/health          # backend
   curl -sf https://<IP-tirets>.sslip.io/         # frontend via Caddy (HTTPS)
   docker compose -f docker-compose.contabo.yml ps
   ```
6. **Traceurs GPS** : reconfigurer chaque boîtier (IP/port serveur) vers
   `<IP-VPS>:<port protocole>` — voir `TRACCAR_SETUP.md` et `GT06_SETUP_GUIDE.md`.

### Sauvegardes

Le service `backup` de `docker-compose.contabo.yml` fait un `pg_dump` planifié
(+ upload S3-compatible optionnel si `BACKUP_S3_*` est renseigné dans `.env`).
Script : `scripts/backup.sh`. Rétention via `BACKUP_RETENTION_DAYS`.

### Santé / observabilité

```
GET https://<IP-tirets>.sslip.io/api/health   (public, via Caddy)
GET http://<IP-VPS>:8080/health               (direct, en clair)
→ {"status":"ok","checks":{"database":"ok","redis":"ok","queue":"ok"}}
```

Métriques Prometheus sur `/metrics` (backend). Erreurs → Sentry si `SENTRY_DSN`
est défini. Alertes critiques → `ALERT_SLACK_WEBHOOK` / `ALERT_DISCORD_WEBHOOK`.

### Dépannage

| Symptôme | Cause probable | Action |
|---|---|---|
| 502/504 via Caddy | backend pas *healthy* / en cours de rebuild | `docker compose -f docker-compose.contabo.yml ps` ; `logs --tail=100 backend` |
| Cookies non conservés (login en boucle) | `CORS_ORIGIN`/`APP_URL` en `http://` alors que l'app est servie en HTTPS | mettre `https://<IP-tirets>.sslip.io`, redémarrer backend |
| Certificat TLS absent | port 80/443 non joignable depuis Internet, ou nom sslip.io incorrect | vérifier pare-feu + valeur exacte dans `Caddyfile` ; `logs caddy` |
| 503 sur les itinéraires | OSRM non déployé (volontaire) | ajouter le service `osrm` depuis `docker-compose.oracle.yml` si besoin |
| Migration Prisma bloquée | schéma divergent | `docker compose ... exec backend npx prisma migrate status` |
| Backend démarre puis meurt | secret obligatoire manquant en prod | lire le log de boot : `JWT_*`, `CSRF_SECRET`, `ENCRYPTION_KEY`, `REDIS_URL` requis (garde-fous `main.ts`) |

---

## Alternative — Oracle Cloud Always Free (ARM64)

> Environnement **alternatif / plan B** : VM ARM (Ampere A1) jusqu'à 4 OCPU /
> 24 Go RAM, gratuite à vie. Fichiers dédiés : `docker-compose.oracle.yml`,
> `.env.oracle.example`, `scripts/oracle-vm-setup.sh`.

Différences notables avec Contabo (ARM64) :

- **PostGIS** : l'image officielle `postgis/postgis` n'a **pas** de variante arm64 ;
  `docker-compose.oracle.yml` utilise `imresamu/postgis` (fork multi-arch, même tag `16-3.4`).
- **Moteur Prisma** : `backend/entrypoint.sh` détecte l'architecture (`uname -m`) et
  sélectionne le bon moteur natif.
- **OSRM** : présent dans `docker-compose.oracle.yml` (compilé depuis les sources
  au premier build, ~10–20 min, données routières Madagascar).

### Étape 1 — Créer le compte Oracle Cloud

1. https://www.oracle.com/cloud/free/ → **Start for free**.
2. Email, pays, carte bancaire (vérification d'identité — le tier Always Free
   n'est jamais facturé sauf upgrade explicite vers "Pay As You Go").
3. **Home Region** proche de vous (`eu-frankfurt-1`, `eu-paris-1`, `eu-marseille-1`) — choix définitif.
4. Valider email + téléphone.

⚠️ **"Out of host capacity"** : la capacité Ampere A1 gratuite est limitée par
zone. Réessayer plus tard, changer d'*Availability Domain*, ou essayer une autre
région proche.

### Étape 2 — Provisionner la VM Ampere A1 (ARM64, Always Free)

1. Console → **Compute** → **Instances** → **Create Instance**.
2. **Name** : `delivery-tracking-oracle`.
3. **Image** : Canonical Ubuntu (22.04/24.04, **aarch64**). **Shape** →
   **Ampere** → `VM.Standard.A1.Flex` → **4 OCPU / 24 Go RAM**.
4. **Networking** : VCN par défaut, cocher **Assign a public IPv4 address**.
5. **SSH keys** : générer une paire (garder la clé privée `.key`) ou coller votre clé publique.
6. **Boot volume** : défaut (~50 Go) suffit.
7. **Create** — noter l'IP publique.

### Étape 3 — Ouvrir les ports (DEUX pare-feux)

1. **Security List du VCN** : Console → **Networking** → **Virtual Cloud
   Networks** → votre VCN → **Security Lists** → *Default* → **Add Ingress
   Rules** : une règle par port (`80`, `443`, `8082`, `5055`–`5065`), Source
   `0.0.0.0/0`, TCP.
2. **iptables OS** (les images Ubuntu d'Oracle bloquent tout sauf SSH) — géré
   par `scripts/oracle-vm-setup.sh` (étape 4).

### Étape 4 — Préparer la VM

```bash
ssh -i /chemin/vers/cle.key ubuntu@<IP-PUBLIQUE>
sudo mkdir -p /opt/delivery-tracking && sudo chown "$USER" /opt/delivery-tracking
git clone https://github.com/<org>/delivery-tracking.git /opt/delivery-tracking
cd /opt/delivery-tracking
bash scripts/oracle-vm-setup.sh   # Docker + compose, iptables, clé de déploiement
```

### Étape 5 — Configurer et lancer

```bash
cp .env.oracle.example .env
nano .env    # secrets (openssl rand -hex ...), IP publique dans CORS_ORIGIN / APP_URL

docker compose -f docker-compose.oracle.yml build          # ~10-20 min au 1er build (OSRM)
docker compose -f docker-compose.oracle.yml up -d
docker compose -f docker-compose.oracle.yml exec backend npx prisma migrate deploy

curl http://localhost:3000/health
curl http://localhost/
```

Traccar : `http://<IP>:8082` (`admin`/`admin` par défaut — **changez-les**
dans `traccar/traccar.xml`, clé `users.default`, puis redémarrez le conteneur).

### Étape 6 — Domaine + HTTPS

1. Enregistrement DNS `A` du domaine → IP publique de la VM.
2. `Caddyfile` : commenter le bloc `:80 { … }`, décommenter le bloc domaine
   (remplacer `app.example.com`).
3. `docker compose -f docker-compose.oracle.yml restart caddy` (cert Let's Encrypt automatique).
4. `.env` : `CORS_ORIGIN`/`APP_URL` en `https://…`, `ENFORCE_HTTPS=true`, puis
   `docker compose -f docker-compose.oracle.yml up -d`.

---

## Historique — Render (désaffecté)

La production a d'abord tourné sur **Render** (juillet–août 2026 :
`deliverytrack-api` + `deliverytrack-web` + Postgres/Redis free tier,
`render.yaml`). Migrée vers Contabo car :

- le free tier Postgres expirait au bout de 90 jours (provisionné ~20 juillet 2026) ;
- le *cold start* après 15 min d'inactivité provoquait des 504 intermittents
  (mitigé un temps par `keepalive.yml`, un cron GitHub Actions qui pingait `/health`).

Migration des données effectuée **une seule fois** par
`scripts/migrate-from-render.sh` (lit la base Render via son *External Database
URL*, refuse d'écraser une base cible non vide).

`render.yaml`, `keepalive.yml` et le job Render de `deploy.yml` sont conservés
à titre de référence mais ne sont plus utilisés.
