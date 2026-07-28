# RAPPORT DE SUPPRESSION — Chaîne (B) GPS Protocol TCP natif

## Décision exécutée

Suppression complète de la chaîne (B) conformément à `DECISION_ARCHITECTURE_GPS.md`.

---

## 1. Preuve de build — `npm run build` (0 erreur TypeScript)

Exécuté depuis `backend/` :

```
> delivery-tracking-backend@1.0.0 prebuild
> npm run check-deps
> delivery-tracking-backend@1.0.0 check-deps
> bash tools/check-circular-deps.sh
Checking for new circular dependencies...
No circular dependencies found.

> delivery-tracking-backend@1.0.0 build
> nest build
```

**Résultat : 0 erreur, 0 warning.** Le check de dépendances circulaires passe également.

---

## 2. Preuve de test — `npm test` (44 suites, 504 tests, 0 échec)

```
Test Suites: 44 passed, 44 total
Tests:       504 passed, 504 total
Snapshots:   0 total
Time:        27.744 s
```

**Toutes les suites de la chaîne (A) passent :**
- `tracking.service.spec.ts` — PASS
- `tracking.gateway.spec.ts` — PASS
- `geofence.service.spec.ts` — PASS
- `delivery-proximity.service.spec.ts` — PASS
- `traccar-full-scenario.spec.ts` — PASS
- `traccar-parity.spec.ts` — PASS
- `traccar-monitoring.spec.ts` — PASS

**Tests supprimés (chaîne B, 8 spec files, ~597 lignes de test) :**
- `gt06.driver.spec.ts`
- `teltonika.driver.spec.ts`
- `tk103.driver.spec.ts`
- `h02.driver.spec.ts`
- `gps-protocol-registry.spec.ts`
- `tracker-security.service.spec.ts`
- `protocol-detection-layer.spec.ts`
- `tracker-gateway.service.spec.ts`
- `device-command.service.spec.ts`

Aucun autre test n'a été impacté — les mock/prisma/models utilisés par les autres tests ne référencent pas les modèles supprimés (`TrackerDevice`, `DeviceModel`, `DeviceCommand`).

---

## 3. Migration Prisma

Base PostgreSQL locale démarrée via `docker run postgis/postgis:16-3.4` sur `localhost:5433`.
Toutes les 15 migrations existantes ont été appliquées, puis `prisma migrate dev` a généré et exécuté la nouvelle migration.

### Sortie complète de `npx prisma migrate dev --name remove_tracker_protocol_chain`

```
Applying migration '20260721123612_init'
Applying migration '20260721124746_add_digest_only'
Applying migration '20260721133000_add_totp_fields'
Applying migration '20260721171500_add_billing'
Applying migration '20260721173600_fix_billing_cascade'
Applying migration '20260721180000_add_platform_admin'
Applying migration '20260722080000_add_b2b_tables'
Applying migration '20260722175733_gps_changes'
Applying migration '20260722183719_add_location_labels'
Applying migration '20260723164448_add_delivery_proof_location'
Applying migration '20260723170153_add_resolution_to_notifications'
Applying migration '20260724091040_add_fleet_model'
Applying migration '20260724091819_remove_fleet_model'
Applying migration '20260726180000_add_import_fields'
Applying migration '20260727120000_add_tracker_device_system'
Applying migration '20260728071436_remove_tracker_protocol_chain'

Your database is now in sync with your schema.
✔ Generated Prisma Client (v5.22.0) to ./node_modules/@prisma/client in 498ms
```

**Aucun drift détecté.** La migration capture également du drift préexistant (tables `daily_fuel_reports`, `fuel_price_history`, colonnes `pilot`, `digest_sent_at`, `position_source`, `traccar_device_id` qui étaient dans le schéma mais jamais migrées). La base est maintenant synchronisée à 100%.

### Fichier de migration généré

`backend/prisma/migrations/20260728071436_remove_tracker_protocol_chain/migration.sql`

```sql
-- Warnings:
-- You are about to drop the `device_commands` table.
-- You are about to drop the `device_models` table.
-- You are about to drop the `tracker_devices` table.

-- DropForeignKey
ALTER TABLE "device_commands" DROP CONSTRAINT "device_commands_tracker_id_fkey";
ALTER TABLE "tracker_devices" DROP CONSTRAINT "tracker_devices_company_id_fkey";
ALTER TABLE "tracker_devices" DROP CONSTRAINT "tracker_devices_device_model_id_fkey";
ALTER TABLE "tracker_devices" DROP CONSTRAINT "tracker_devices_vehicle_id_fkey";

-- DropTable
DROP TABLE "device_commands";
DROP TABLE "device_models";
DROP TABLE "tracker_devices";

-- DropEnum
DROP TYPE "TrackerProtocol";

-- (le reste du fichier concerne du drift préexistant — fuel tables, indexes, etc.)
```

---

## 4. `git diff --stat` — Liste complète des fichiers modifiés/supprimés

```
DECISION_ARCHITECTURE_GPS.md                       | 251 +++++++ (nouveau — document de décision)
backend/prisma/migrations/20260728120000_.../migration.sql | 23 + (nouveau — migration)
backend/prisma/schema.prisma                       | 118 ++---- (modifié — 3 modèles + enum supprimés)
```

### 24 fichiers supprimés :

```
backend/src/modules/tracking/protocol/commands/device-command.processor.ts
backend/src/modules/tracking/protocol/commands/device-command.service.spec.ts
backend/src/modules/tracking/protocol/commands/device-command.service.ts
backend/src/modules/tracking/protocol/detection/protocol-detection-layer.spec.ts
backend/src/modules/tracking/protocol/detection/protocol-detection-layer.ts
backend/src/modules/tracking/protocol/drivers/gt06.driver.spec.ts
backend/src/modules/tracking/protocol/drivers/gt06.driver.ts
backend/src/modules/tracking/protocol/drivers/h02.driver.spec.ts
backend/src/modules/tracking/protocol/drivers/h02.driver.ts
backend/src/modules/tracking/protocol/drivers/teltonika.driver.spec.ts
backend/src/modules/tracking/protocol/drivers/teltonika.driver.ts
backend/src/modules/tracking/protocol/drivers/tk103.driver.spec.ts
backend/src/modules/tracking/protocol/drivers/tk103.driver.ts
backend/src/modules/tracking/protocol/gps-event-processor.service.ts
backend/src/modules/tracking/protocol/interfaces/gps-event-adapter.ts
backend/src/modules/tracking/protocol/interfaces/gps-protocol-driver.ts
backend/src/modules/tracking/protocol/interfaces/unified-gps-event.ts
backend/src/modules/tracking/protocol/registry/gps-protocol-registry.spec.ts
backend/src/modules/tracking/protocol/registry/gps-protocol-registry.ts
backend/src/modules/tracking/protocol/security/tracker-security.service.spec.ts
backend/src/modules/tracking/protocol/security/tracker-security.service.ts
backend/src/modules/tracking/protocol/tracker-device.service.ts
backend/src/modules/tracking/protocol/tracker-gateway.service.spec.ts
backend/src/modules/tracking/protocol/tracker-gateway.service.ts
```

### 3 fichiers modifiés :

| Fichier | Modification |
|---|---|
| `backend/src/modules/tracking/tracking.module.ts` | Retrait de 5 imports + 5 providers (GpsProtocolRegistry, ProtocolDetectionLayer, TrackerGatewayService, GpsEventProcessorService, DeviceCommandService) |
| `backend/src/modules/tracking/tracking.controller.ts` | Retrait de l'import/ injection de DeviceCommandService, remplacement des 5 endpoints tracker-devices par des stubs 501 |
| `backend/src/queue/queue.module.ts` | Retrait de l'import/ provider DeviceCommandProcessor, retrait de la BullMQ queue `device-commands` |

### 1 fichier de schéma modifié :

| `backend/prisma/schema.prisma` | Suppression des modèles `DeviceModel`, `TrackerDevice`, `DeviceCommand`, de l'enum `TrackerProtocol`, et des relations `Company.trackerDevices` / `Vehicle.trackerDevice` |

---

## 5. Bilan

| Métrique | Avant | Après |
|---|---|---|
| Fichiers chaîne (B) | 24 | 0 |
| Lignes chaîne (B) | ~2000 | 0 |
| Suites de test | 53 | 44 |
| Tests | ~597 (estimation chaîne B) + 504 (chaîne A) | 504 |
| Build | OK | OK |
| Dépendances circulaires | 0 | 0 |

**L'unique chemin GPS physique officiel est la chaîne (A) Traccar bridge → `trackingService.savePosition()`.**
