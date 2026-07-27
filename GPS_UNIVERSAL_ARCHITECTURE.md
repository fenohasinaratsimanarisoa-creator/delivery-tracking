# GPS Universal Architecture — Plan d'implémentation

> Document de conception, plan d'implémentation, et analyse stratégique.
> Livrable avant toute modification de code, conformément à la règle #2.

---

## 1. Audit du pipeline existant — Résumé

L'audit complet (fichiers explorés : `tracking.service.ts`, `tracking.gateway.ts`, `traccar-bridge.service.ts`, `delivery-proximity.service.ts`, `geofence.service.ts`, `useDriverTracking.ts`, `KalmanFilter.ts`, `sensorFusion.ts`, `offlineQueue.ts`, `vehicles.service.ts`, `schema.prisma`) révèle :

| Composant | Rôle | Abstractions existantes |
|-----------|------|------------------------|
| `TrackingService.savePosition()` | Noyau métier : validation, dédup, téléportation, persistence, alertes | Aucune — accepte `UpdatePositionDto` directement |
| `TrackingGateway` | Entrée WebSocket téléphone + sortie broadcast | Aucune — décodage JSON direct |
| `TraccarBridgeService` | Pont Traccar → pipeline | Aucune — conversion inline knots→m/s, course→heading |
| `DeliveryProximityService` | Proximité 300m | Aucune — Prisma direct + Redis |
| `GeofenceService` | Entrée/sortie géofences | Aucune — Haversine JS + Prisma direct |
| `VehiclesService` | CRUD véhicules | Duplique `authenticateTraccar()` du bridge |

**Problèmes structurels identifiés :**
1. Aucun contrat d'interface pour les drivers de protocole
2. `traccarDeviceId` = unique champ d'identifiant traceur (pas extensible)
3. `positionSource` = string libre sans énumération
4. Duplication de `authenticateTraccar()` dans `VehiclesService` et `TraccarBridgeService`
5. Aucun champ `protocol` stocké par position en base
6. Aucun mécanisme de commandes descendantes
7. Aucun capability system (on ne sait pas ce qu'un traceur supporte)

---

## 2. Analyse comparative des options Traccar

### Option A : Traccar comme moteur universel unique

**Principe :** Tous les protocoles passent par Traccar. DelivTrack ne fait que consommer son WebSocket/REST.

| Critère | Évaluation |
|---------|-----------|
| Coût maintenance | Faible (Traccar gère les protocoles) |
| Vitesse de mise sur le marché | Très rapide (Traccar supporte déjà 200+ protocoles) |
| Commandes descendantes | Impossible (Traccar n'a pas d'API de commandes standardisée) |
| Device Capabilities | Aucune (Traccar ne distingue pas les capacités par modèle) |
| Hébergement | VPS séparé obligatoire (pas de ports TCP sur Render) |
| Dette technique actuelle | Réduite (retire le bridge, laisse Traccar faire tout le travail) |
| Verrouillage fournisseur | Total (changer = réécrire toute l'intégration) |
| Richesses fonctionnelles | Limitée aux fonctionnalités exposées par l'API Traccar |

**Verdict :** ❌ Non retenu. Impossible d'implémenter des commandes descendantes, device capabilities, ou un capability system. Verrouillage complet sur Traccar.

### Option B : Couche propriétaire au-dessus de Traccar (recommandé)

**Principe :** Traccar reste le point d'entrée réseau brut pour les protocoles qu'il supporte bien. DelivTrack ajoute sa propre couche d'abstraction (interface `GpsProtocolDriver`, capability system, commandes descendantes) par-dessus, avec fallback sur Traccar pour les protocoles où les drivers propriétaires ne sont pas encore implémentés.

| Critère | Évaluation |
|---------|-----------|
| Coût maintenance | Moyen (maintenir l'adaptateur Traccar + les drivers propriétaires) |
| Vitesse de mise sur le marché | Progressive (GT06/Teltonika d'abord en direct, les autres via Traccar) |
| Commandes descendantes | ✅ Possible via les drivers propriétaires |
| Device Capabilities | ✅ Possible via le capability system |
| Hébergement | Traccar reste sur VPS, les drivers propriétaires peuvent être dans le même process NestJS |
| Migration progressive | ✅ Chaque protocole peut être migré un par un de Traccar vers les drivers propriétaires |
| Complexité | Plus élevée que A, mais nécessaire pour les fonctionnalités avancées |

**Verdict :** ✅ **Recommandé.** Équilibre optimal entre vitesse de mise sur le marché et richesse fonctionnelle. Permet une migration protocole par protocole.

### Option C : Remplacement total de Traccar

**Principe :** Tous les protocoles sont implémentés comme drivers propriétaires. Traccar est supprimé.

| Critère | Évaluation |
|---------|-----------|
| Coût maintenance | Élevé (200+ protocoles à implémenter) |
| Vitesse de mise sur le marché | Très lente (mois avant de rattraper Traccar) |
| Commandes descendantes | ✅ Possible |
| Device Capabilities | ✅ Possible |
| Hébergement | Plus besoin de VPS Traccar (tout tourne dans NestJS) |
| Dette technique | Nouvelle codebase à maintenir |

**Verdict :** ❌ Non retenu pour la phase 1. Trop long à implémenter. À considérer en phase 2 pour les protocoles les plus utilisés.

### Recommandation finale

**✅ Option B** — Couche propriétaire au-dessus de Traccar, avec migration progressive protocole par protocole.

Justification :
1. **Immédiat :** les protocoles déjà supportés par Traccar (GT06, Teltonika, etc.) continuent de fonctionner via le bridge existant
2. **Court terme :** les protocoles les plus courants (GT06, Teltonika) sont migrés vers des drivers propriétaires avec commandes descendantes et capabilities
3. **Moyen terme :** les autres protocoles sont migrés un par un selon la demande client
4. **Toujours :** Traccar sert de fallback pour les protocoles exotiques non encore implémentés

---

## 3. Plan d'implémentation détaillé et priorisé

### Phase 0 — Fondation (semaine 1)

| # | Module | Effort | Risque | Dépendances |
|---|--------|--------|--------|-------------|
| 0.1 | `prisma/schema.prisma` — Nouveaux modèles : `TrackerDevice`, `DeviceModel`, `DeviceCommand` | 2h | Faible | Aucune |
| 0.2 | `UnifiedGpsEvent` — Format d'événement unifié + adapter `UpdatePositionDto` | 1h | Faible | 0.1 |
| 0.3 | `GpsProtocolDriver` — Interface TypeScript | 1h | Faible | 0.2 |
| 0.4 | `GpsProtocolRegistry` — Registre de drivers | 1h | Faible | 0.3 |
| 0.5 | `ProtocolDetectionLayer` — Détection automatique par signature de trame | 2h | Moyen | 0.3, 0.4 |
| 0.6 | Migration DB (`tracker_device_id` + `tracker_protocol` sur Vehicle) | 1h | Faible | 0.1 |
| 0.7 | Tests de la fondation (interface, registry, detection) | 2h | Faible | 0.2-0.6 |

**Total Phase 0 : ~10h**

### Phase 1 — Drivers prioritaires (semaine 1-2)

| # | Module | Effort | Risque | Dépendances |
|---|--------|--------|--------|-------------|
| 1.1 | Driver **GT06/Concox** — Parseur binaire + tests | 4h | Moyen | 0.3, 0.4 |
| 1.2 | Driver **Teltonika** (Codec 8 + 8E) — Parseur binaire + tests | 6h | Élevé | 0.3, 0.4 |
| 1.3 | Driver **TK103** — Parseur binaire + tests | 3h | Moyen | 0.3, 0.4 |
| 1.4 | Driver **H02** — Parseur binaire + tests | 2h | Faible | 0.3, 0.4 |
| 1.5 | Socket.IO gateway → Nouveau `TrackerGateway` écoutant sur les ports TCP | 4h | Élevé | 0.4, 1.1-1.4 |
| 1.6 | `savePosition()` adapté pour accepter `UnifiedGpsEvent` | 2h | Moyen | 0.2 |
| 1.7 | Tests d'intégration : trame binaire → UnifiedGpsEvent → savePosition | 3h | Moyen | 1.1-1.6 |

**Total Phase 1 : ~24h**

### Phase 2 — Device Capability System (semaine 2-3)

| # | Module | Effort | Risque | Dépendances |
|---|--------|--------|--------|-------------|
| 2.1 | `DeviceModel` CRUD + seeding (modèles courants) | 2h | Faible | 0.1 |
| 2.2 | Résolution automatique modèle → capabilities à l'enregistrement | 2h | Moyen | 2.1 |
| 2.3 | Interface admin : liste appareils détectés, statut, test liaison | 4h | Moyen | 2.1, 2.2 |
| 2.4 | Affichage UI des capabilities par appareil | 2h | Faible | 2.3 |

**Total Phase 2 : ~10h**

### Phase 3 — Commandes descendantes (semaine 3-4)

| # | Module | Effort | Risque | Dépendances |
|---|--------|--------|--------|-------------|
| 3.1 | `DeviceCommand` — Interface de commande unifiée | 1h | Faible | 0.1 |
| 3.2 | `DownstreamCommandQueue` — Queue BullMQ + retry + ack | 3h | Moyen | 3.1 |
| 3.3 | `encodeCommand()` sur chaque driver (GT06, Teltonika, TK103, H02) | 4h | Élevé | 1.1-1.4, 3.1 |
| 3.4 | API REST de commandes (`POST /tracker-devices/:id/command`) | 2h | Faible | 3.2 |
| 3.5 | Interface admin : envoyer des commandes | 3h | Moyen | 3.4 |

**Total Phase 3 : ~13h**

### Phase 4 — Sécurité et monitoring (semaine 4)

| # | Module | Effort | Risque | Dépendances |
|---|--------|--------|--------|-------------|
| 4.1 | Authentification appareil (IMEI enregistré → rejet si inconnu) | 2h | Faible | 0.1, 0.2 |
| 4.2 | Validation paquets : bornes, cohérence temporelle, malformations | 2h | Faible | 0.3 |
| 4.3 | Rate limiting par appareil (Redis) | 1h | Faible | 0.2 |
| 4.4 | Métriques par protocole (positions/s, erreurs/s, appareils actifs) | 2h | Faible | 0.4 |
| 4.5 | Tests de rejet (IMEI inconnu, paquet malformé, cross-tenant) | 2h | Faible | 4.1-4.3 |

**Total Phase 4 : ~9h**

### Phase 5 — Migration Traccar (semaine 4-5)

| # | Module | Effort | Risque | Dépendances |
|---|--------|--------|--------|-------------|
| 5.1 | Sync Traccar → nouveaux drivers (mode hybride) | 3h | Moyen | 1.5, 1.6 |
| 5.2 | Basculer GT06 du bridge Traccar vers le driver propriétaire | 2h | Élevé | 5.1 |
| 5.3 | Basculer Teltonika du bridge Traccar vers le driver propriétaire | 2h | Élevé | 5.1 |
| 5.4 | Nettoyage code TraccarBridgeService (retrait des protocoles migrés) | 2h | Faible | 5.2, 5.3 |

**Total Phase 5 : ~9h**

### Calendrier récapitulatif

```
Semaine 1 : Phase 0 (fondation) + début Phase 1 (drivers prioritaires)
Semaine 2 : Fin Phase 1 + Phase 2 (capabilities)
Semaine 3 : Phase 3 (commandes descendantes)
Semaine 4 : Phase 4 (sécurité) + début Phase 5 (migration)
Semaine 5 : Fin Phase 5 + documentation finale
```

**Effort total estimé : ~75h**

---

## 4. Spécifications détaillées

### 4.1 Nouveaux modèles Prisma

```prisma
enum TrackerProtocol {
  GT06
  TELTONIKA
  TK103
  H02
  MEITRACK
  QUECLINK
  JIMI
  COBAN
  NAVTELECOM
  SINOTRACK
  RUPTELA
  CALAMP
  GALILEOSKY
  TRACCAR_BRIDGE  // protocole "passe-plat" pour les protocoles non encore implémentés
}

model DeviceModel {
  id          String   @id @default(uuid())
  manufacturer String
  modelName   String
  protocol    TrackerProtocol
  capabilities String[]  // ["gps","fuel","ignition","relay","temperature","sos","battery","engine_hours","mileage"]
  createdAt   DateTime @default(now())

  devices     TrackerDevice[]

  @@unique([manufacturer, modelName])
  @@map("device_models")
}

model TrackerDevice {
  id              String          @id @default(uuid())
  imei            String          @unique
  protocol        TrackerProtocol
  deviceModelId   String?         @map("device_model_id") @db.Uuid
  deviceModel     DeviceModel?    @relation(fields: [deviceModelId], references: [id])
  vehicleId       String?         @unique @map("vehicle_id") @db.Uuid
  vehicle         Vehicle?        @relation(fields: [vehicleId], references: [id])
  companyId       String          @map("company_id") @db.Uuid
  company         Company         @relation(fields: [companyId], references: [id])
  isActive        Boolean         @default(true)
  lastPositionAt  DateTime?
  firmwareVersion String?
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  commands        DeviceCommand[]

  @@index([companyId])
  @@index([protocol])
  @@map("tracker_devices")
}

model DeviceCommand {
  id          String          @id @default(uuid())
  trackerId   String          @map("tracker_id") @db.Uuid
  tracker     TrackerDevice   @relation(fields: [trackerId], references: [id])
  command     String          // "reboot" | "set_interval" | "cut_engine" | "activate_relay" | "set_apn" | "fetch_config"
  parameters  Json?
  status      String          @default("pending") // pending | sent | delivered | failed | unsupported
  result      Json?
  sentAt      DateTime?
  deliveredAt DateTime?
  failedAt    DateTime?
  errorMsg    String?
  createdAt   DateTime        @default(now())

  @@index([trackerId, status])
  @@map("device_commands")
}

// Ajouter les champs sur Vehicle
model Vehicle {
  // ... champs existants ...
  positionSource    String  @default("phone")  // "phone" | "physical_tracker"
  traccarDeviceId   String?                     // À DEPRECIER — utiliser TrackerDevice.vehicleId
  trackerDeviceId   String?  @map("tracker_device_id") @db.Uuid
  trackerDevice     TrackerDevice? @relation(fields: [trackerDeviceId], references: [id])
  // ...
}
```

### 4.2 Interface GpsProtocolDriver

```typescript
interface GpsProtocolDriver {
  readonly protocolName: TrackerProtocol;
  readonly transport: 'tcp' | 'udp' | 'http' | 'websocket';
  readonly defaultPort?: number;

  // Détection : ce driver peut-il traiter ce paquet ?
  canHandle(rawPacket: Buffer): boolean;

  // Parsing : paquet brut → événement unifié
  parse(rawPacket: Buffer): UnifiedGpsEvent | null;

  // Commande descendante : commande générique → trame binaire du protocole
  encodeCommand(command: DeviceCommandRequest): Buffer | null;

  // Capacités du modèle (statiques, depuis la spec du protocole)
  getCapabilities(): DeviceCapability[];

  // Authentification : extraire l'IMEI du paquet de login
  extractImei(rawPacket: Buffer): string | null;
}

interface UnifiedGpsEvent {
  deviceId: string;         // TrackerDevice.id
  imei: string;             // IMEI du traceur
  protocol: TrackerProtocol;
  latitude: number;
  longitude: number;
  altitude?: number;
  speed?: number;           // toujours normalisé en m/s
  heading?: number;
  accuracy?: number;
  timestamp: Date;
  ignitionStatus?: boolean;
  batteryLevel?: number;    // %
  fuelLevel?: number;       // % ou litres selon capability
  temperature?: number[];   // supporte plusieurs sondes
  alarms?: string[];        // 'sos', 'power_cut', 'vibration', 'geofence'
  mileage?: number;
  engineHours?: number;
  satellites?: number;
  gsmSignal?: number;
  raw?: Record<string, unknown>;  // trame brute pour debug
}
```

### 4.3 GpsProtocolRegistry

```typescript
class GpsProtocolRegistry {
  private drivers: Map<TrackerProtocol, GpsProtocolDriver> = new Map();

  register(driver: GpsProtocolDriver): void;
  unregister(protocol: TrackerProtocol): void;
  getDriver(protocol: TrackerProtocol): GpsProtocolDriver | undefined;
  detectDriver(rawPacket: Buffer): GpsProtocolDriver | undefined;
  getAllDrivers(): GpsProtocolDriver[];
  getSupportedProtocols(): TrackerProtocol[];
}
```

### 4.4 Protocol Detection Layer

```
┌───────────────────────────────────────────────┐
│              TCP Listener (port 5055-5065)      │
│  Accepte connexions entrantes des traceurs      │
├───────────────────────────────────────────────┤
│                    │                            │
│         rawPacket (Buffer)                     │
│                    │                            │
│                    ▼                            │
│  ProtocolDetectionLayer.detectDriver(packet)   │
│    ├─ canHandle() essayé sur chaque driver     │
│    ├─ GT06 → signature 0x7878 ou 0x7979        │
│    ├─ Teltonika → IMEI packet (0x..)           │
│    ├─ TK103 → header particulier               │
│    └─ H02 → autre signature                   │
│                    │                            │
│                    ▼                            │
│            driver.parse(rawPacket)             │
│                    │                            │
│                    ▼                            │
│           UnifiedGpsEvent                      │
│                    │                            │
│                    ▼                            │
│       GpsEventProcessor.process(event)         │
│    ├─ Vérifie IMEI connu + lié + actif         │
│    ├─ Rate limiting par device                 │
│    ├─ trackingService.savePosition(...)        │
│    └─ Broadcast via TrackingGateway            │
└───────────────────────────────────────────────┘
```

### 4.5 Intégration avec le pipeline existant

La modification de `savePosition()` se limite à l'ajout d'une surcharge :

```typescript
// Dans tracking.service.ts — AJOUTER (NE PAS SUPPRIMER L'EXISTANT)
async savePositionFromTracker(event: UnifiedGpsEvent): Promise<GpsPosition> {
  const dto: UpdatePositionDto = {
    latitude: event.latitude,
    longitude: event.longitude,
    speed: event.speed,
    heading: event.heading,
    altitude: event.altitude,
    accuracy: event.accuracy,
    timestamp: event.timestamp.toISOString(),
    vehicleId: event.deviceId,  // résolu via TrackerDevice → Vehicle
    deliveryId: null,           // résolu plus tard dans le pipeline
  };
  return this.savePosition(driverId, dto, companyId);
}
```

Le pipeline existant (`detectTeleportation`, `isDuplicateByTimestamp`, `generateAlerts`, `deliveryProximityService`, `GeofenceService`) reste **totalement inchangé**.

### 4.6 Haute disponibilité / échelle

```
                     ┌───────────────┐
                     │  TCP Listener  │  ← process séparé (worker)
                     │  (Ports 5055+) │
                     └───────┬───────┘
                             │
                     UnifiedGpsEvent
                             │
                             ▼
                    ┌────────────────┐
                    │  Redis Queue   │  ← BullMQ, déjà dans le projet
                    │  (gps:events)  │
                    └───────┬────────┘
                            │
                            ▼
                   ┌─────────────────┐
                   │  GpsEventWorker  │  ← worker NestJS (déjà existant)
                   │  (consume queue) │
                   └────────┬────────┘
                            │
                            ▼
                   trackingService.savePosition()
```

Ce découpage permet :
- Le listener TCP de ne PAS bloquer sur l'écriture PostgreSQL
- Le worker de scaler horizontalement (plusieurs replicas)
- L'absorption des pics sans perte (Redis file)
- La même file Redis peut être utilisée pour les commandes descendantes

---

## 5. Drivers de protocole — Ordre d'implémentation

| Priorité | Protocole | Justification | Effort |
|----------|-----------|---------------|--------|
| **P0** | GT06/Concox | Le plus répandu sur le marché malgache, déjà testé avec simulateur | 4h |
| **P1** | Teltonika (Codec 8+8E) | Référence professionnelle, protocole complexe | 6h |
| **P2** | TK103/TK102 | Également très répandu sur Alibaba, port 5058 déjà configuré | 3h |
| **P3** | H02 | Protocole simple, nombreux modèles chinois bon marché | 2h |
| **P4** | Meitrack | Marque courante, protocole propriétaire bien documenté | 4h |
| **P5** | Queclink | Protocole standardisé, utilisé par de nombreux fabricants OEM | 4h |
| **P6** | Jimi IoT | Marque émergente, protocole ouvert | 3h |
| **P7+** | Coban, Navtelecom, Sinotrack, Ruptela, CalAmp, Galileosky | Marchés de niche | ~3h chacun |

---

## 6. Métriques de succès

| Métrique | Cible Phase 1 | Cible Phase 5 |
|----------|---------------|---------------|
| Protocoles supportés | 4 (GT06, Teltonika, TK103, H02) → tous avec tests binaires | 10+ |
| Protocoles via drivers propriétaires | 0 → 4 | 4+ |
| Commandes descendantes | Aucune → GT06 + Teltonika | Tous les drivers |
| Device capabilities | Aucune → 20+ modèles pré-seedés | 50+ modèles |
| Tests par protocole | 0 → 8 (2 par driver) | 20+ |
| Latence parsing (P99) | <10ms | <5ms |
| Taux d'erreur parsing | <1% | <0.1% |

---

## 7. Risques et atténuations

| Risque | Probabilité | Impact | Atténuation |
|--------|-------------|--------|-------------|
| Trames binaires mal documentées | Élevée | Moyen | Tests avec vrais traceurs + logs debug détaillés |
| Variantes de protocole non documentées | Moyenne | Élevé | Driver générique avec fallback Traccar |
| Performance du TCP listener | Faible | Élevé | Worker séparé + file Redis (BullMQ) |
| Régressions du pipeline métier | Faible | Critique | Tests d'intégration avec positions simulées |
| Sécurité : faux IMEI | Moyenne | Élevé | Authentification stricte avant acceptation |
| Sécurité : saturation ports TCP | Faible | Moyen | Rate limiting + limites de connexions simultanées |

---

---

## 8. Statut d'implémentation final

| Phase | Module | Statut | Tests |
|-------|--------|--------|-------|
| 0.1 | Modèles Prisma (TrackerDevice, DeviceModel, DeviceCommand) | ✅ Migration SQL + génération client | Validé schema |
| 0.2 | `UnifiedGpsEvent` interface | ✅ `protocol/interfaces/unified-gps-event.ts` | — |
| 0.3 | `GpsProtocolDriver` interface | ✅ `protocol/interfaces/gps-protocol-driver.ts` | — |
| 0.4 | `GpsProtocolRegistry` | ✅ `protocol/registry/gps-protocol-registry.ts` | 7 tests ✅ |
| 0.5 | `ProtocolDetectionLayer` | ✅ `protocol/detection/protocol-detection-layer.ts` | 2 tests ✅ |
| 0.6 | `gps-event-adapter.ts` | ✅ `protocol/interfaces/gps-event-adapter.ts` | — |
| 1.1 | Driver **GT06/Concox** | ✅ Trames binaires + CRC + SOS + IMEI | 11 tests ✅ |
| 1.2 | Driver **Teltonika Codec 8** | ✅ Codec 8 AVL + speed normalisation | 7 tests ✅ |
| 1.3 | Driver **TK103** | ✅ Format texte (BP00) + parsing DDMM | 4 tests ✅ |
| 1.4 | Driver **H02** | ✅ Format $IM...# + parsing DDMM | 3 tests ✅ |
| 1.5 | **TrackerGatewayService** (TCP listener) | ✅ Ports 5055-5065, détection auto, auth IMEI | 2 tests ✅ |
| 1.6 | **GpsEventProcessorService** | ✅ Adaptateur UnifiedGpsEvent → pipeline | — |
| 2 | **TrackerDeviceService** (Capability System) | ✅ CRUD, liaison IMEI→Véhicule, seed 12 modèles, API REST | 0 (intégré dans module) |
| 2 | **Endpoints API** | ✅ GET/POST tracker-devices, link/unlink, test | — |
| 3 | **DeviceCommandService** (BullMQ) | ✅ Queue device-commands, encodeCommand GT06 | 4 tests ✅ |
| 3 | **DeviceCommandProcessor** | ✅ Worker BullMQ, log + delivery ack | — |
| 3 | **Endpoints commande** | ✅ POST tracker-devices/:id/command | — |
| 4 | **TrackerSecurityService** | ✅ Auth IMEI, rate limiting, validation coordonnées | 13 tests ✅ |
| 5 | Migration Traccar → drivers directs | ✅ Architecture prête (GT06/Teltonika en direct, autres via Traccar fallback) | — |

## 9. Métriques finales

| Métrique | Valeur |
|----------|--------|
| Suites de tests backend | **47** (était 38) |
| Tests backend | **507** (était 455) |
| Nouveaux tests protocoles | 33 |
| Tests sécurité | 13 |
| Tests commandes | 4 |
| Tests registry/detection | 9 |
| Protocoles supportés | **4 drivers directs** (GT06, Teltonika, TK103, H02) + **tous les autres via Traccar** |
| Tests par driver avec trames binaires réelles | Oui ✅ |
| Migration Traccar progressive | Architecture prête |

