# DeliveryTrack

Plateforme B2B multi-tenant de **gestion de flotte et de suivi de livraisons** :
tracking GPS temps réel (téléphone + traceurs physiques via Traccar), gestion des
livraisons, consommation de carburant, rapports, facturation, API d'intégration et
application mobile Android.

- **Backend** — NestJS 11 + Prisma 5 (PostgreSQL/PostGIS) + Redis + BullMQ, WebSocket (Socket.IO)
- **Frontend** — React 18 + Vite 7 + React Query + Leaflet + i18next (fr/en)
- **Mobile** — Capacitor 8 (Android), mode « app = site web »
- **GPS** — pont Traccar (protocoles GT06, Teltonika…) + tracking natif Android en arrière-plan

> Français : le code, les commentaires et la documentation de ce dépôt sont en français.

---

## Démarrage rapide (dev)

Prérequis : Node 20.19+, Docker (pour Postgres + Redis).

```bash
# 1. Infra locale (Postgres/PostGIS + Redis)
docker compose up -d postgres redis

# 2. Backend
cd backend
cp .env.example .env            # renseigner les secrets (openssl rand -hex 32/64)
npm ci
npm run prisma:generate
npm run prisma:migrate          # applique les migrations
npm run prisma:seed             # compte admin de démo (SEED_ADMIN_EMAIL/PASSWORD)
npm run start:dev               # http://localhost:3000

# 3. Frontend (autre terminal)
cd frontend
npm ci
npm run dev                     # http://localhost:5173 (proxy /api -> :3000)
```

Raccourci tout-en-un (build + lancement + health-check) : `./start.sh`.

### Vérification visuelle sans backend

```bash
cd frontend
VITE_ENABLE_MOCKS=1 npx vite --config vite.mock.config.ts
```

---

## Tests, lint, typecheck

| | Backend (`cd backend`) | Frontend (`cd frontend`) |
|---|---|---|
| Tests unitaires | `npm test` | `npm test` |
| Couverture | `npm run test:cov` | `npm run test:coverage` |
| Tests e2e | `npm run test:e2e` (Postgres + Redis requis) | — |
| Lint (CI, ratchet) | `npm run lint:check` | `npm run lint:check` |
| Lint (avec `--fix`) | `npm run lint` | `npm run lint` |
| Typecheck | `npx tsc --noEmit` | `npx tsc -b --noEmit` |

La CI (`.github/workflows/ci.yml`) exécute l'ensemble sur chaque push / PR vers
`main`. Les deux `lint:check` figent la dette de warnings existante par un
**ratchet à sens unique** : toute nouvelle occurrence casse le build.

---

## Architecture

```
backend/src/
  common/            transverse : auth, guards, tenant-scoping, prisma, redis,
                     encryption (PII at-rest), alerting, i18n, monitoring
  modules/           1 dossier par domaine métier (25 modules)
    auth/            JWT + refresh rotation + détection de réutilisation, 2FA TOTP, Google OAuth
    tracking/        cœur GPS : ingestion positions, dédup, téléportation, geofences,
                     pont Traccar, rapports de trajet, fiabilité
    deliveries/      cycle de vie livraison + preuves + suivi public
    fuel-consumption/ logs carburant, prix, rapports journaliers, analyse (queue)
    billing/         Stripe + Mobile Money, quotas (UsageGuard), webhooks idempotents
    webhooks/        souscriptions sortantes + retries (queue) + validation anti-SSRF
    api-keys/        accès machine en lecture seule, scopes
    platform-admin/  back-office plateforme (SuperAdminGuard)
    ...
  queue/             workers BullMQ (fuel-analysis, webhook-retry, company-purge)
frontend/src/
  pages/ features/   écrans (lazy-loadés, code-split par route)
  hooks/             useDriverTracking (tracking natif), ...
  services/          api (axios), socket, i18n, pwa, monitoring (Sentry)
  android/           shell natif Capacitor + plugins Java (BackgroundLocation, SMS fallback…)
```

**Isolation multi-tenant — défense en profondeur :**
1. `JwtAuthGuard` + `CompanyScopeGuard` sur les contrôleurs
2. `CompanyScopedContext` (AsyncLocalStorage) propage le `companyId` de la requête
3. `tenantScopeMiddleware` (Prisma) — dernier rempart : injecte `where: { companyId }`
   sur ~20 modèles pour toute lecture/mutation, même si le scoping applicatif est oublié

Documents de conception : `DECISION_ARCHITECTURE_GPS.md`,
`GPS_UNIVERSAL_ARCHITECTURE.md`, `TRACCAR_SETUP.md`, `backend/INTEGRATION.md`
(API B2B), `backend/OBSERVABILITY.md`, `backend/SECURITY_AUDIT.md`.
Les rapports datés (audits, incidents, go-live) sont archivés dans `docs/archive/`.

---

## Configuration

Chaque service a son `.env` (voir `.env.example`). En **production**, le backend
refuse de démarrer sans : `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET`, `CSRF_SECRET`, `ENCRYPTION_KEY` (garde-fous *fail-fast* dans
`backend/src/main.ts`).

---

## Déploiement

Voir **`DEPLOYMENT.md`** pour le guide complet.

- **Production** — VPS (Contabo) : `scripts/deploy-contabo.sh` en SSH
  (`git pull` → build → health-gate → `prisma migrate deploy` → rollback auto),
  stack `docker-compose.contabo.yml`.
- **APK Android** — voir `AGENTS.md` (`npx cap sync android` + `gradlew assembleDebug`).

---

## Licence

Projet privé — tous droits réservés.
