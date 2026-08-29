# 🛰️ Audit approfondi du système GPS — DelivTrack — 25 août 2026

**Périmètre intégral** : ingestion (app mobile chauffeur + pont Traccar), serveur Traccar (Fly.io/Docker), transmission temps réel (gateway Socket.IO), traitement/validation (tracking.service + utils geo), stockage (PostgreSQL/PostGIS + archive), diffusion (broadcasts rooms), consommation aval (carte live, géofences, proximité, carburant, rapports PDF, suivi public), sécurité multi-tenant, résilience, performance.
**Méthode** : lecture approfondie du code (tracking.service.ts 2 141 l., traccar-bridge.service.ts 1 653 l., tracking.gateway.ts 558 l., controlleurs, utils geo, config Traccar/Fly/nginx, frontend carte/socket), exécution de la suite complète (**857 tests PASS, 0 échec**, dont ~40 suites traccar/tracking), recoupement avec les audits précédents (GPS_AUDIT_COMPLET_2026-08-15, TRACCAR_UNIVERSAL_AUDIT_2026-08-15, RELIABILITE_GPS).
**Référentiel corrigés antérieurs** : bugs B1–B5 du 15/08 **vérifiés appliqués** (B3 : signature `handlePosition(pos)` mono-paramètre ✓ ; B4 : proximité sur le dernier point de chaque véhicule ✓ L1270-1285).

---

## 1. Architecture — cartographie validée

```
Traceur physique ──TCP 5055-5065──► Traccar (Fly.io fra, image 6.14, H2 embarquée)
   (GT06/Teltonika/H02…)                  │
                                          │ ①WS push /api/socket (bridge L903)
                                          │ ②REST backfill /api/positions (L1065)
App chauffeur ──socket.io updatePosition/batchPosition──► TrackingGateway (WsJwtGuard)
                                          │                     │
                                          ▼                     ▼
                    TraccarBridge.handlePosition      TrackingService.savePosition/saveBatch
                    (mutex PAR device L1346,          (dédup 1s + UNIQUE(vehicleId,ts),
                    driver résolu AU timestamp        téléportation partagée RT/batch,
                    via VehicleAssignmentHistory)     isolation stricte phone/tracker)
                                          │                     │
                                          ▼                     ▼
                              PostgreSQL gps_positions (+ gps_positions_archive)
                                          │
                        broadcast positionUpdate → rooms delivery:{id} / company:{id}
                                          │
                       RealTimeMap (snapshot GET /tracking/live + merge socket)
```

Points d'entrée **uniquement** ces deux canaux : aucun endpoint HTTP public n'accepte de position brute, aucun webhook Traccar entrant — surface d'attaque minimale et maîtrisée.

---

## 2. Points forts confirmés ✅ (ce qui est vraiment bien fait)

| # | Mécanisme | Preuve |
|---|---|---|
| 1 | **Isolation stricte des sources** : véhicule `physical_tracker` refuse toute position `phone` (et réciproquement par construction) — jamais de flux mélangés | `tracking.service.ts:841-846`, `saveBatch:1010-1015` |
| 2 | **Anti-doublon à 3 étages** : fenêtre 1 s (temps réel) / fenêtre symétrique bi-référence DB+lot (batch) / contrainte UNIQUE(vehicleId,timestamp) + P2002 traitée comme doublon, jamais une erreur client | `isDuplicateByTimestamp:558`, `saveBatch:1097-1115`, `createManyAndReturn(skipDuplicates):1217` |
| 3 | **Téléportation : décision unique partagée** RT/batch (`evaluateTeleportation`), seuils plafonnés par accuracy (×1.5 max → 300 km/h borne haute), exemption documentée au changement de source | `teleportation.utils.ts:37-81`, `detectTeleportation:481-544` |
| 4 | **Tri chronologique du lot AVANT dédup/téléportation** : le rattrapage réseau hors-ordre ne fabrique plus de faux suspects ni de vitesses absurdes | `saveBatch:1077-1090` |
| 5 | **Vitesse de secours haversine/Δt** sur les deux chemins (sinon le rapport carburant sous-comptait la distance) | gateway:215-230, saveBatch:1130-1144 |
| 6 | **Pont Traccar robuste** : élection leader Redis (SET NX EX 50, cession après 2 échecs consécutifs — anti split-brain), backoff exponentiel+jitter, renouvellement session 30 min, moniteurs silence/santé/never-connected/déconnexion prolongée (>15 min → alerte critique) | bridge L228-380, L954-977 |
| 7 | **Mutex PAR device** autour de lookup→dédup→insertion : aucun backfill concurrent ne peut insérer le même fix en course | bridge L172-198, L1346 |
| 8 | **File de retry Redis** pour positions en échec (cap 1000, rétention 1 h, reprise périodique) | bridge L57-58, L1575-1650 |
| 9 | **Chauffeur résolu AU timestamp du fix** (VehicleAssignmentHistory), position conservée avec driverId null si aucun couvre l'instant — la trace n'est jamais perdue | bridge L985-999, L1362-1369 |
| 10 | **Rejet LBS** (`valid=false`) : seuls les fixes GPS réels sont acceptés, pas la géoloc cellulaire approximative | bridge L1331-1337 |
| 11 | **Télémétrie protocolo-agnostique** (power/battery/ignition en JSONB) + alertes temps réel coupure électrique/batterie critique + classification de la cause d'un silence pour le dashboard | tracker-telemetry.ts, bridge L1479-1491, tracking.service L105-120 |
| 12 | **Multi-tenant systématique** : rejet cross-tenant dans savePosition (L827-832), assertVehicleOwnership au gateway (L204), SQL getLivePositions/findNearestVehicle/archivage scopés par `company_id`, guards JWT+CompanyScope+Roles sur tous les endpoints REST, abonnement room `delivery:` vérifié contre la company (gateway L507) | partout |
| 13 | **Suivi public sain** : JWT scope `public-tracking` 24 h signé, révocation persistée (`publicTrackingRevokedAt`), aucune donnée hors livraison | controller L82-100, L329-361 |
| 14 | **Archivage SQL sûr** : `$executeRawUnsafe` à variables 100 % liées (commentaire d'audit en ligne), garde 48 h sur la version par entreprise | tracking.service L2010-2067 |
| 15 | **Observabilité rare à ce niveau** : métriques received/saved/deduped/teleported, rapport de fiabilité par véhicule (% couverture, gaps), endpoint `/tracking/silences`, test de device Traccar (never_connected/receiving/stale), rapport PDF listant explicitement les interruptions de signal | controller L152-224, L280-311 |
| 16 | **Frontend résilient** : snapshot REST + fusion socket, re-subscribe sur `'connect'`, refresh JWT avant expiration + reconnexion forcée, file offline IndexedDB (chunks ≤250), bannières diagnostic (SW cache, batterie) | RealTimeMap L786-820, socket.ts, useDriverTracking |
| 17 | **ACK explicites** `positionSaved`/`positionRejected{reason}`/`positionsSaved` : le téléphone sait toujours ce que devient sa position (jamais de perte silencieuse) | gateway L166-294 |
| 18 | Validation DTO stricte lat [-90,90], lng [-180,180], accuracy ≤1000 m, UUID v4, whitelist (strip des clés inconnues) — y compris manuellement dans les handlers WS (le ValidationPipe ne s'applique pas aux @SubscribeMessage) | dto/update-position.dto.ts, gateway L152-168 |

---

## 3. Nouveaux constats (cette passe)

### 🔴 ÉLEVÉ

#### G.1 — Interface admin Traccar exposée publiquement sur Internet
- **Où :** `traccar/fly.toml` L28-39 ([http_service] `internal_port=8082`, **pas de restriction d'accès**, `force_https=false`) + `traccar/traccar.xml` (creds par défaut `admin:admin` documentées dans le fichier, base **H2 embarquée**).
- **Constat :** `https://deliverytrack-traccar.fly.dev` sert l'UI d'administration Traccar à tout Internet. Le backend NestJS refuse certes les creds par défaut en prod (`traccar-bridge.service.ts:239-246`), mais :
  - l'UI est brute-forceable (pas de rate limit Traccar par défaut, pas de 2FA) ;
  - une compromission de cette UI = contrôle total des devices (réaffectation IMEI, lecture de toutes les traces brutes, modification des configs protocoles) ;
  - `force_https=false` autorise une session admin en HTTP clair.
- **Recommandations (par ordre de simplicité) :**
  1. Restreindre l'accès HTTP 8082 : `[env]` Fly + auth proxy (`fly proxy` / Fly Machines avec service **internal only**) ou allowlist IP ; le pont parle au backend via le réseau interne Fly (`deliverytrack-traccar.internal:8082`).
  2. Au minimum : `force_https=true`, mot de passe fort + rotation, et désactiver l'enregistrement ouvert.
  3. Les ports TCP 5055-5065 doivent rester publics (les traceurs y envoient) — cf. G.4 pour leur durcissement.

### 🟠 MOYEN

#### G.2 — Archivage global SANS la garde 48 h (incohérence destructrice)
- **Où :** `archiveAllCompaniesPositionsBefore()` (tracking.service L2010-2033) n'a **pas** le garde-fou `minAge 48h` que possède `archivePositionsBefore()` (L2039-2045). Le contrôleur `POST /admin/tracking/archive` (platform-admin.controller L176-184) ne valide que le format de date.
- **Impact :** un super-admin appelant `before=<maintenant>` archive/supprime immédiatement des positions < 48 h de TOUTES les entreprises — faussant les rapports carburant quotidiens (cron 22 h), la couverture GPS et les trip reports qui dépendent de ces lignes.
- **Fix :** répliquer la garde 48 h dans `archiveAllCompaniesPositionsBefore` (ou dans le contrôleur) — 5 lignes + test.

#### G.3 — Pagination non bornée sur `GET /tracking/positions/:deliveryId`
- **Où :** tracking.controller L54-57 : `+page, +limit` passés tels quels à Prisma (`skip=(page-1)*limit`).
- **Impact :** `?limit=10000000` charge potentiellement toute la table de la livraison en mémoire (DoS applicatif, OOM) ; `?page=-1` produit un `skip` négatif → exception Prisma → **500**.
- **Fix :** clamper `limit ∈ [1,1000]`, `page ≥ 1` (ou DTO class-validator `@Min(1) @Max(1000)`).

#### G.4 — Spoofing de positions côté protocoles traceurs (limite inhérente, à encadrer)
- **Où :** ports TCP publics 5055-5065 sur Fly.io ; GT06 & co authentifient un device par **IMEI seul** dans le paquet de login (sans mot de passe par défaut).
- **Scénario :** quiconque connaît (ou devine) l'IMEI d'un traceur peut ouvrir une connexion TCP vers Traccar et injecter de faux points, qui remonteront comme `physical_tracker` légitimes. La détection de téléportation marquera `suspect` (bon comportement) mais **n'empêche pas** l'affichage live ni la persistance.
- **Atténuations existantes :** suspect flag, seuils plafonnés, rejet LBS. 
- **Recommandations :** activer les mots de passe device dans Traccar lorsque le protocole le supporte ; alerter (dashboard) dès N positions `suspect` consécutives sur un véhicule (signal d'usurpation) ; surveiller les connexions multiples simultanées par device côté Traccar.

#### G.5 — Rate-limit `updatePosition` contournable via `batchPosition` (toujours ouvert)
- **Où :** gateway — `handlePosition` appelle `isRateLimited(user.id)` (L171) mais `handleBatchPosition` (L299-411) **aucune limite**.
- **Impact :** un client peut envoyer des batchs en boucle (250 pos/batch, validations class-validator coûteuses en CPU + lectures DB lastPositions par véhicule). Le dédoublonnage évite l'écriture mais pas le travail.
- **Note :** déjà signalé « à surveiller » le 15/08 (constat documenté #3) — toujours vrai aujourd'hui. Le canal est authentifié (driver rôle uniquement), ce qui borne l'exposition.
- **Fix :** budget par driver pour le batch (ex. Redis `batch_rl:{userId}`, 1 batch/5 s ou 3000 positions/15 min), réponse `positionsRejected{reason:'rate_limited'}` explicite.

### 🟡 BAS

#### G.6 — `GET /tracking/metrics` expose des compteurs GLOBAUX inter-tenant
- **Où :** controller L259-266 → `getMetrics()` retourne `{received,saved,deduped,…}` **cumulés toutes entreprises confondues**, accessibles à tout admin/dispatcher de n'importe quelle société. De plus, compteurs **en mémoire** : partiels en multi-réplica, remis à zéro au redéploiement (chiffres trompeurs).
- **Fix :** restreindre au super-admin (platform-admin) OU agréger depuis la DB par companyId ; idéalement remplacer les compteurs process-locaux par des compteurs Redis fenêtrés.

#### G.7 — `GET /tracking/traccar-devices` : statut global du pont sans scoping
- `getStatus()` (bridge L419-426) expose connected/reconnectAttempts/lastPositionReceivedAt à tout dispatcher — fuite opérationnelle mineure (même principe que G.6). Le endpoint `/:deviceId/test` est, lui, correctement scopé (L1398-1404 ✓).

#### G.8 — Dédoublonnage temps réel nuancé par deliveryId
- `isDuplicateByTimestamp` (L558-576) filtre `{vehicleId, deliveryId?}` : deux positions au même instant avec **deliveryId différents** ne se doublonnent pas entre elles à ce stade. En pratique la contrainte UNIQUE(vehicleId,timestamp) les rejette ensuite — comportement final correct, chemin redondant à connaître uniquement.

#### G.9 — Les chauffeurs rejoignent la room `company:{id}` et reçoivent tous les `dataUpdate`
- gateway `handleConnection` L105-108 : un driver entre dans la room entreprise → il reçoit tous les événements `dataUpdate` (livraisons créées/modifiées, etc.) destinés au dashboard. Pas de fuite inter-tenant, mais : bande passante mobile gaspillée + surface d'événements élargie inutilement.
- **Fix :** ne joindre que `driver:{id}` pour role=driver (le broadcast `positionUpdate` company reste nécessaire aux dispatchers uniquement ; le chauffeur reçoit déjà proximityAlert ciblé via `driver:{id}`).

#### G.10 — Traccar sur H2 embarqué : fragilité de la brique amont
- `traccar.xml` L5-8 : base H2 fichier. Un kill -9 / OOM Fly peut corrompre la base (perte devices/config historiques, récupération manuelle). **La source de vérité applicative reste PostgreSQL** (le pont duplique tout), donc l'impact se limite aux fonctions natives Traccar (rapports internes, events) — mais une corruption impose une réinscription manuelle des traceurs.
- **Reco moyen terme :** basculer Traccar sur PostgreSQL (support natif, `database.url` JDBC) — même instance Neon/Render ou base dédiée.

#### G.11 — `checkProximity.lastDeliveryMap` en mémoire (mono-instance assumé)
- Déjà documenté le 15/08 (#4) : OK tant qu'un seul replica sert le WS. Avec Redis présent pour les clés entered/snoozed, la map `en cours de livraison par chauffeur` reste process-locale → en multi-réplica, certains checks de proximité seraient ratés. À migrer vers Redis le jour du scaling horizontal.

---

## 4. Choix assumés (re-vérifiés, inchangés, valides)

| Point | Verdict |
|---|---|
| `getLivePositions` n'exclut pas les suspects — la carte marque « SIGNAL INSTABLE » | Assumé, bon trade-off (un point suspect prouve la vie du device) |
| Kalman côté front = affichage seul ; le backend exige le brut | Correct (intégrité analytique) |
| `flushQueue` vide la file après ack partiel | Acceptable (rejouer des rejetés serait pire) |
| Backfill sans generateAlerts (insertion directe createMany) | Assumé — pas de spam d'alertes sur rattrapage historique |

---

## 5. Tests & vérifications exécutés

- Suite backend complète : **69 suites / 857 tests PASS** (dont traccar-backfill, traccar-multitenant, traccar-outage-recovery, traccar-parity, traccar-postgis, trip-fidelity, tracking.gateway.integration…).
- Vérification statique des requêtes SQL brutes : toutes paramétrées (`CAST(${x} AS uuid)`) sauf l'archivage multi-instruction — variables liées, commentaire d'audit en ligne ✓. **Aucune injection possible identifiée.**
- Schéma Prisma : index pertinents présents (`[companyId,timestamp]`, `[deliveryId,timestamp]`, `[vehicleId]`, UNIQUE `[vehicleId,timestamp]`, archive `[timestamp]`). Le DISTINCT ON de `getLivePositions` s'appuie sur `(companyId→vehicle_id)` via jointure — suffisant à l'échelle actuelle ; prévoir une table `vehicle_last_position` matérialisée si >10⁶ positions/jour.
- Config nginx/vite : `/api` strip correct vers backend, WS upgrade `/socket.io` ✓ ; **aucune route frontend ne contourne le backend pour parler à Traccar** ✓.

---

## 6. Priorités d'action

| Priorité | Action | Effort |
|---|---|---|
| 🔴 1 | **G.1** — Fermer/restreindre l'UI admin Traccar sur Fly (service internal ou allowlist + force_https) | ~1 h |
| 🟠 2 | **G.2** — Garde 48 h sur `archiveAllCompaniesPositionsBefore` + test | 30 min |
| 🟠 3 | **G.3** — Clamp pagination `positions/:deliveryId` + test | 30 min |
| 🟠 4 | **G.5** — Rate-limit batch par driver + test | 1 h |
| 🟠 5 | **G.4** — Mots de passe device Traccar où supporté + alerte « N suspects consécutifs » | 2-4 h |
| 🟡 6 | **G.6/G.7** — Scoper ou restreindre metrics & statut pont | 1 h |
| 🟡 7 | **G.9** — Sortir les drivers de la room company | 30 min |
| 🟡 8 | **G.10/G.11** — Traccar→PostgreSQL ; proximité→Redis (au passage multi-réplica) | fond de roadmap |

**Verdict global :** pipeline GPS remarquablement solide sur le plan fonctionnel et de l'intégrité des données (dédoublonnage, téléportation, isolation des flux, multi-tenant, observabilité) — les vrais risques résiduels sont **périmétriques** (exposition admin Traccar, spoofing protocole) et deux incohérences de garde/pagination faciles à fermer.
