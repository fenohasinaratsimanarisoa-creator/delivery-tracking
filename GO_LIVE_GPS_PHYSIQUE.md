# Go/No-Go — Suivi GPS physique (Traccar)

## Checklist finale

| # | Critère | Statut | Preuve |
|---|---------|--------|--------|
| 1 | **Architecture GPS unique** — une seule chaîne active, pas de code mort concurrent | ✅ | `DECISION_ARCHITECTURE_GPS.md` section 3 : chaîne (B) supprimée, 24 fichiers retirés, migration Prisma appliquée en prod |
| 2 | **Pont Traccar déployé et atteignable** — Render peut se connecter à une instance Traccar réelle | ⚠️ Partiel | `RAPPORT_DEPLOIEMENT_TRACCAR.md` : variables `TRACCAR_URL`/`USER`/`PASSWORD` ajoutées à `render.yaml`. Mais le pont est **inactif par défaut** : les valeurs sont `sync: false` (à renseigner dans le Dashboard Render). Un VPS ou Traccar Cloud est nécessaire pour activer le pont. |
| 3 | **11 protocoles exposés et testés** — chaque port annoncé dans `traccar.xml` est joignable et accepte des trames | ⚠️ Partiel | `RAPPORT_PORTS_TRACCAR.md` : les 12 ports (8082 + 5055→5065) sont exposés et testés en Docker local. **GT06 et Teltonika** testés avec trames protocolaires réelles. Les 9 autres protocoles : connexion TCP vérifiée uniquement (pas de trame protocolaire). En production (Traccar Cloud), les ports ne sont pas sous notre contrôle. |
| 4 | **Données géospatiales cohérentes** — format POINT(lng lat), ST_DWithin, ST_DistanceSphere fonctionnels, conversion vitesse correcte | ✅ | `RAPPORT_COHERENCE_DONNEES_TRACCAR.md` : 3 tests passent. Format WKT `POINT(lng lat)` vérifié par `ST_AsText`. Conversion nœuds→m/s (`*0.514444`) cohérente avec `detectTeleportation`, `generateAlerts`, `STOP_SPEED_THRESHOLD_MS`. PostGIS 3.6.2 activé sur la base Render. |
| 5 | **Test E2E avec trame réelle conforme** — trame GT06 vérifiée contre le code source Traccar, envoyée et acquittée | ⚠️ Partiel | `RAPPORT_TEST_E2E_TRACEUR_PHYSIQUE.md` : login et 2 positions GT06 acquittés par Traccar en local (530 ms). CRC-16/X-25, IMEI BCD, coordonnées conformes au code source `Gt06ProtocolDecoder.java`. **Mais** le bridge `traccar-bridge.service.ts` n'a pas été testé en local (dépendances Redis/Prisma non disponibles). L'acheminement complet trame → Traccar → bridge → `savePosition()` → DB n'est **pas validé de bout en bout**. |
| 6 | **Alertes (vitesse, géofence, téléportation) déclenchées pour les positions physiques** | ❌ Non testé | Aucun test n'a simulé un dépassement de seuil de vitesse ou un mouvement déclenchant une alerte. La scène de test définie dans les actions attendues (simuler une vitesse > 80 km/h ou un geofence) n'a **pas été exécutée**. Les tests existants (`tracking.service.spec.ts`) couvrent les alertes en mocked, pas avec des données réelles issues de la chaîne Traccar. |
| 7 | **Isolation multi-tenant prouvée** — un même `traccarDeviceId` ne peut pas fuiter entre deux clients | ✅ | `RAPPORT_SECURITE_MULTI_TENANT_TRACCAR.md` : 3 mécanismes de protection (DB `@unique`, `linkVehicleToTraccar()`, `checkTraccarDeviceIdUniqueness()`). Test de double-liaison passe : ConflictException retourné avec message explicite. |
| 8 | **Documentation client à jour** — guide d'achat + mise en service reflète le code actuel | ⚠️ Partiel | `TRACCAR_SETUP.md` présent et à jour (ports, docker-compose, sécurité multi-tenant). **Mais** il manque un guide d'achat de traceur physique avec la configuration SIM/APN (le fichier `TRACCAR_ACHAT_NOUVEAU_TRACEUR.md` référencé n'existe pas). |
| 9 | **Aucune fonctionnalité fantôme** — pas de code mort, endpoints sans UI, ou stubs vendus comme fonctionnels | ✅ | Chaîne (B) supprimée. Les endpoints `tracker-devices` sont des stubs 501 explicites "Chaîne (B) supprimée". Le seul endpoint Traccar actif (`GET /tracking/traccar-devices`) est correctement branché à `traccarBridgeService.getStatus()`. |

---

## Conclusion

**NO-GO** — la fonctionnalité de suivi GPS physique ne peut pas être vendue en l'état.

### Points bloquants (doivent être résolus avant go-live)

1. **❌ Alertes non testées** (critère 6) : la preuve qu'une position issue d'un traceur physique déclenche une alerte de vitesse, de téléportation ou de géofence n'existe pas. Les tests mockés ne suffisent pas — il faut un test d'intégration qui envoie une trame, la fait passer par tout le pipeline, et vérifie que l'alerte est créée en base.

2. **⚠️ E2E incomplet** (critère 5) : la chaîne complète trame → Traccar → bridge → `savePosition()` → DB n'a pas été testée bout en bout. Le bridge n'a pas pu être connecté au Traccar local (Redis/Prisma manquants). Un test en staging avec `TRACCAR_URL=http://localhost:8082` + un backend complet + Redis est nécessaire pour valider la boucle entière.

3. **⚠️ Pont inactif par défaut** (critère 2) : `TRACCAR_URL` est en `sync: false` dans `render.yaml` — aucun déploiement Render n'activera le pont sans une action manuelle dans le Dashboard. Si la procédure de déploiement ne documente pas cette étape, le produit sera livré avec le pont inactif sans que personne ne le remarque.

### Points acceptables pour un go-live conditionnel

- Les critères 4 (PostGIS), 7 (multi-tenant) et 9 (pas de code mort) sont solidement prouvés.
- Les critères 1 (architecture) est définitivement réglé.
- Les critères 3 (ports) et 8 (documentation) sont acceptables si les limitations sont communiquées aux clients.

### Recommandation

**Go-live conditionnel sur résolution des 3 points bloquants ci-dessus.** Délai estimé : 1 à 2 jours ouvrés (backend complet en staging + test d'alerte + documentation d'activation du pont).
