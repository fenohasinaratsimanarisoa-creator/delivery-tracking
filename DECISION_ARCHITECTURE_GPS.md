# DÉCISION D'ARCHITECTURE GPS — DelivTrack

## Constat

Deux architectures GPS coexistent dans le codebase. Une seule est déployable et testée contre la topologie réelle (Render).

---

## 1. Diagnostic de la chaîne (B) — Protocol TCP natif

### 1.1 Inventaire des fichiers (24 fichiers, ~2000 lignes)

| Fichier | Lignes | Enregistré dans un module ? | Appelé hors de sa propre définition ? | Test unitaire ? | Exposé au frontend ? |
|---|---|---|---|---|---|
| `protocol/tracker-gateway.service.ts` | 221 | Oui — `TrackingModule` | Oui — importé dans `TrackingModule` | Oui (spec) | Non |
| `protocol/tracker-device.service.ts` | 189 | **NON** | **Non** — importé uniquement dans `tracker-security.service.ts` (lui-même non enregistré) | Non | Non |
| `protocol/drivers/gt06.driver.ts` | 139 | Pas un provider — instancié manuellement dans `TrackerGatewayService` | Oui — par `TrackerGatewayService.registerBuiltinDrivers()` | Oui (spec) | Non |
| `protocol/drivers/teltonika.driver.ts` | 96 | Idem | Idem | Oui (spec) | Non |
| `protocol/drivers/tk103.driver.ts` | 89 | Idem | Idem | Oui (spec) | Non |
| `protocol/drivers/h02.driver.ts` | 84 | Idem | Idem | Oui (spec) | Non |
| `protocol/security/tracker-security.service.ts` | 83 | **NON** | **Non** — nulle part | Oui (spec) | Non |
| `protocol/registry/gps-protocol-registry.ts` | 37 | Oui — `TrackingModule` | Oui — `TrackerGatewayService`, `TrackerDeviceService`, `DeviceCommandService` | Oui (spec) | Non |
| `protocol/detection/protocol-detection-layer.ts` | 28 | Oui — `TrackingModule` | Oui — `TrackerGatewayService` | Oui (spec) | Non |
| `protocol/gps-event-processor.service.ts` | 25 | Oui — `TrackingModule` | **Non** — sa méthode `process()` n'est appelée nulle part | Non | Non |
| `protocol/interfaces/unified-gps-event.ts` | 73 | N/A (interface) | N/A | Non | Non |
| `protocol/commands/device-command.service.ts` | 91 | Oui — `TrackingModule` | Oui — `TrackingController` (endpoint `POST /tracker-devices/:deviceId/command`) | Oui (spec) | Non |
| `protocol/commands/device-command.processor.ts` | 48 | Oui — `QueueModule` | Oui — BullMQ `device-commands` queue | Non | Non |
| `protocol/interfaces/gps-protocol-driver.ts` | 19 | N/A (interface) | N/A | Non | Non |
| `protocol/interfaces/gps-event-adapter.ts` | 14 | N/A (interface) | N/A | Non | Non |
| `protocol/drivers/gt06.driver.spec.ts` | 155 | — | — | — | — |
| `protocol/drivers/teltonika.driver.spec.ts` | 105 | — | — | — | — |
| `protocol/drivers/tk103.driver.spec.ts` | 43 | — | — | — | — |
| `protocol/drivers/h02.driver.spec.ts` | 33 | — | — | — | — |
| `protocol/registry/gps-protocol-registry.spec.ts` | 79 | — | — | — | — |
| `protocol/security/tracker-security.service.spec.ts` | 99 | — | — | — | — |
| `protocol/detection/protocol-detection-layer.spec.ts` | 58 | — | — | — | — |
| `protocol/tracker-gateway.service.spec.ts` | 60 | — | — | — | — |
| `protocol/commands/device-command.service.spec.ts` | 65 | — | — | — | — |

### 1.2 Preuves d'inexploitabilité sur l'infrastructure réelle

#### (a) Aucun port TCP exposé sur Render

- `render.yaml` : le service `deliverytrack-api` est de type `web`. **Render ne route aucun port TCP autre que HTTP/HTTPS** vers l'extérieur pour les web services (documenté : https://render.com/docs/web-services).
- `Dockerfile` : seule instruction `EXPOSE 3000` (HTTP).
- Même si `TrackerGatewayService.onModuleInit()` démarre des serveurs TCP sur les ports 5055-5058, ces ports sont **inaccessibles depuis Internet**. Les traceurs GPS physiques ne peuvent donc pas s'y connecter.
- Aucune variable d'environnement `TRACKER_PORTS` n'est définie dans `render.yaml`.

#### (b) La chaîne (B) contourne toute la logique métier

`TrackerGatewayService.onPositionReceived()` (lignes 174-220) écrit directement dans la base avec :
```typescript
await this.prisma.gpsPosition.create({ ... })
await this.prisma.trackerDevice.update({ ... })
```
Elle **n'appelle pas** `trackingService.savePosition()`. Conséquences :
- Pas de déduplication des positions
- Pas de détection de téléportation
- Pas de détection d'anomalie de vitesse
- Pas d'alertes (device_offline, geofence, etc.)
- Pas de mise à jour du jeton public
- Pas d'isolation cross-tenant via `companyId` (le companyId vient du tracker, pas du contexte d'authentification)

#### (c) Services morts ou non câblés

| Service | Statut |
|---|---|
| `TrackerSecurityService` | **Non enregistré** dans aucun module NestJS. Ses méthodes `authenticate()`, `checkRateLimit()`, `validateEvent()` ne sont jamais invoquées. |
| `TrackerDeviceService` | **Non enregistré** dans aucun module NestJS. Sa méthode `seedDeviceModels()` n'est jamais appelée depuis `seed.ts`. |
| `GpsEventProcessorService` | Enregistré dans `TrackingModule` mais sa méthode `process()` **n'est invoquée nulle part**. Même si elle l'était, elle ne fait que logger — elle n'appelle pas `savePosition()`. |
| `DeviceCommandProcessor` | Enregistré dans `QueueModule`. Sa méthode `process()` marque les commandes comme "sent" puis "delivered" dans la base, mais **n'établit aucune connexion TCP réelle** pour transmettre la commande au dispositif. L'envoi nécessiterait un accès à `TrackerGatewayService.connections` (Map privée). |

#### (d) Aucune donnée en production

- La migration `20260727120000_add_tracker_device_system/migration.sql` crée les tables `device_models`, `tracker_devices`, `device_commands`.
- `backend/prisma/seed.ts` **ne peuple aucune de ces tables**.
- `TrackerDeviceService.seedDeviceModels()` existe mais n'est jamais invoquée.
- Aucune donnée réelle n'existe dans `tracker_devices` ou `device_commands` (confirmé : pas d'appel seed, pas d'UI pour en créer).

#### (e) Aucune interface utilisateur

```bash
grep -rln 'TrackerDevice\|DeviceCommand\|device-command\|tracker-device\|/protocol' frontend/src/
# → NO_FRONTEND_REFERENCES
```

**Résultat : zéro référence.** Aucune page, aucun hook, aucun composant frontend n'interagit avec la chaîne (B).

Les endpoints `GET /tracker-devices`, `POST /tracker-devices`, `POST /tracker-devices/:deviceId/link/:vehicleId`, `POST /tracker-devices/:deviceId/unlink` dans `tracking.controller.ts` sont tous des **stubs** (retournent `getStatus()`, des messages codés en dur, ou délèguent à `linkVehicleToTraccar()` — qui est l'API Traccar, pas le protocol natif).

Seul `POST /tracker-devices/:deviceId/command` appelle réellement `DeviceCommandService.sendCommand()`, mais cette chaîne est non fonctionnelle car :
- Le `DeviceCommandProcessor` ne transmet jamais la commande par TCP
- Aucun tracker n'est connecté (pas de ports TCP exposés)
- `TrackerSecurityService` (qui authentifierait le device) n'est pas câblé

#### (f) Tests insuffisants pour la production

- Les tests unitaires des drivers protocolaires (`gt06.driver.spec.ts`, `teltonika.driver.spec.ts`, etc.) mockent les entrées/sorties.
- **Aucun test d'intégration** avec un vrai firmware GT06, Teltonika, H02 ou TK103.
- **Aucun test e2e** avec du trafic TCP réel.
- Les tests ne couvrent pas le déploiement sur Render (ports, réseau).

---

## 2. Confirmations de la chaîne (A) — Traccar Bridge

| Critère | État |
|---|---|
| `TraccarBridgeService` enregistré dans `TrackingModule` | Oui — et exporté |
| Appelle `trackingService.savePosition()` | Oui — ligne 509 |
| Déduplication, téléportation, alertes, cross-tenant | Oui — via `savePosition()` |
| Exposé au frontend | Indirectement — les positions Traccar arrivent via les endpoints `/tracking/positions/:deliveryId`, WebSocket, et l'API Traccar |
| Endpoint de statut `/platform-admin/traccar/status` | Oui |
| Endpoints de linking `/vehicles/available-traccar-devices`, `/vehicles/traccar-devices` | Oui |
| Fonctionne sur Render | Oui — le bridge se connecte en outbound vers le serveur Traccar (pas besoin de ports entrants) |
| Testé en production | Oui — plusieurs spec files de bout en bout (`traccar-full-scenario.spec.ts`, `traccar-parity.spec.ts`) |

---

## 3. DÉCISION : SUPPRESSION complète de la chaîne (B)

### Justification

1. **Code non fonctionnel en production** : les ports TCP ne sont pas exposés sur Render → aucun traceur GPS ne peut se connecter.
2. **Contournement de la logique métier** : écriture directe en base sans passer par `savePosition()` → perte de déduplication, téléportation, alertes, sécurité cross-tenant.
3. **Maintien coûteux** : ~2000 lignes de code mort qu'il faut maintenir, compiler, déployer, mais qui ne sert à rien.
4. **Risque de confusion** : un développeur pourrait croire que la chaîne (B) est fonctionnelle et l'utiliser, créant des incohérences de données.
5. **Dette technique** : `TrackerSecurityService` et `TrackerDeviceService` non injectés, `GpsEventProcessorService` mort, `DeviceCommandProcessor` qui simule l'envoi sans connexion TCP.
6. **Alternative fonctionnelle existante** : la chaîne (A) Traccar gère déjà tous les traceurs physiques via un serveur Traccar externe, avec toute la logique métier.

### 3.1 Fichiers à supprimer (24 fichiers)

```
backend/src/modules/tracking/protocol/
├── commands/
│   ├── device-command.processor.ts
│   ├── device-command.service.spec.ts
│   └── device-command.service.ts
├── detection/
│   ├── protocol-detection-layer.spec.ts
│   └── protocol-detection-layer.ts
├── drivers/
│   ├── gt06.driver.spec.ts
│   ├── gt06.driver.ts
│   ├── h02.driver.spec.ts
│   ├── h02.driver.ts
│   ├── teltonika.driver.spec.ts
│   ├── teltonika.driver.ts
│   ├── tk103.driver.spec.ts
│   └── tk103.driver.ts
├── interfaces/
│   ├── gps-event-adapter.ts
│   ├── gps-protocol-driver.ts
│   └── unified-gps-event.ts
├── registry/
│   ├── gps-protocol-registry.spec.ts
│   └── gps-protocol-registry.ts
├── security/
│   ├── tracker-security.service.spec.ts
│   └── tracker-security.service.ts
├── gps-event-processor.service.ts
├── tracker-device.service.ts
├── tracker-gateway.service.spec.ts
└── tracker-gateway.service.ts
```

### 3.2 Entrées à retirer de `tracking.module.ts`

```typescript
// À SUPPRIMER — imports
import { GpsProtocolRegistry } from './protocol/registry/gps-protocol-registry';
import { ProtocolDetectionLayer } from './protocol/detection/protocol-detection-layer';
import { TrackerGatewayService } from './protocol/tracker-gateway.service';
import { GpsEventProcessorService } from './protocol/gps-event-processor.service';
import { DeviceCommandService } from './protocol/commands/device-command.service';

// À SUPPRIMER — providers
GpsProtocolRegistry,
ProtocolDetectionLayer,
TrackerGatewayService,
GpsEventProcessorService,
DeviceCommandService,
```

### 3.3 Entrée à retirer de `queue.module.ts`

```typescript
// À SUPPRIMER — import
import { DeviceCommandProcessor } from '../modules/tracking/protocol/commands/device-command.processor';

// À SUPPRIMER — providers
DeviceCommandProcessor,
```

### 3.4 Modifications dans `tracking.controller.ts`

- Supprimer l'import de `DeviceCommandService` (ligne 25)
- Supprimer l'injection de `deviceCommandService` du constructeur (ligne 34)
- Supprimer la méthode `sendTrackerCommand()` (lignes 275-283)
- Remplacer les stubs `listTrackerDevices()`, `registerTrackerDevice()`, `linkTrackerDevice()`, `unlinkTrackerDevice()` par un simple retour 501 Not Implemented (ou les supprimer si le frontend ne les utilise pas)

### 3.5 Schéma Prisma — 3 options

#### Option A (recommandée) : Supprimer les modèles ET l'enum

Supprimer les modèles `DeviceModel`, `TrackerDevice`, `DeviceCommand` **ainsi que l'enum `TrackerProtocol`** du schéma, et créer une migration qui drop tout.

**Justification :** L'enum `TrackerProtocol` n'est utilisée par aucun modèle ou champ de la chaîne (A). La chaîne Traccar ne s'en sert pas — elle utilise uniquement `Vehicle.traccarDeviceId` (texte libre) et `Vehicle.positionSource` (`"physical_tracker"`). Un `grep -rn 'TrackerProtocol' src/` confirme que toutes les références sont dans les fichiers de la chaîne (B) qui sont supprimés. `TRACCAR_BRIDGE` comme valeur d'enum n'a aucun sens une fois les drivers natifs partis.

**Impact :**
- La colonne `trackerDevices` sur `Company` est supprimée
- La colonne `trackerDevice` sur `Vehicle` est supprimée
- La colonne `positionSource` sur `Vehicle` est conservée (utilisée par la chaîne Traccar avec la valeur `"physical_tracker"`)
- L'enum `TrackerProtocol` et sa table de mapping PostgreSQL sont supprimées

#### Option B (prudente) : Marquer @deprecated

Ajouter `@deprecated` dans les commentaires du schéma Prisma sans supprimer les tables. Les données existantes (si elles existent) ne seront pas perdues, mais l'intention est claire pour les développeurs.

#### Option C (moyen terme) : Geler sans supprimer

Garder le schéma et les fichiers marqués `// NON DÉPLOYÉ — NE PAS UTILISER EN PRODUCTION`. Déconseillé car le code continuera d'être compilé et déployé, consommant des ressources inutilement.

### 3.6 Étapes de suppression recommandées

1. Créer une branche `remove/gps-protocol-chain`
2. Supprimer les 24 fichiers du répertoire `protocol/`
3. Modifier `tracking.module.ts` (retirer imports + providers)
4. Modifier `queue.module.ts` (retirer import + provider de `DeviceCommandProcessor`)
5. Modifier `tracking.controller.ts` (retirer endpoint command + stubber les endpoints tracker-devices)
6. Créer une migration Prisma supprimant les 3 modèles
7. Supprimer les spec files des tests associés
8. Vérifier que `npm run build` passe
9. Vérifier que `npm run test` passe encore (les tests supprimés étaient uniquement sur la chaîne B)
10. Merge → Render déploie automatiquement

---

## 4. Risques résiduels

| Risque | Mitigation |
|---|---|
| Besoin futur de protocoles natifs | Solution : déployer un VPS dédié avec un serveur Traccar (qui supporte GT06, Teltonika, etc.) et brancher le bridge existant. Le code supprimé est remplaçable par Traccar. |
| `positionSource = 'physical_tracker'` déjà utilisé | Conservé — la chaîne (A) utilise cette valeur pour identifier les véhicules équipés d'un traceur Traccar. |
| Commandes vers les traceurs | Traccar expose une API de commandes. Implémenter le passage d'ordres via l'API REST Traccar plutôt que par connexion TCP directe. |

---

## 5. Conclusion

**La chaîne (B) est supprimée.** L'unique chemin GPS physique officiel est la chaîne (A) Traccar bridge → `trackingService.savePosition()`. Tout développement futur de connectivité GPS passera par Traccar, jamais par des drivers TCP natifs dans l'API NestJS.
