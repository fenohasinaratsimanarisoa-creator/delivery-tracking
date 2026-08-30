# AUDIT GPS COMPLET — DelivTrack — 2026-08-15

**Périmètre** : acquisition (app mobile + pont Traccar), transmission (gateway/socket), traitement/validation (tracking.service + utils), stockage (Prisma + SQL brut), diffusion temps réel (broadcasts), consommation aval (carte, géofences, proximité, carburant, dashboard, rapport PDF).
**Méthode** : lecture intégrale de chaque fichier, AUCUNE correction appliquée dans cette passe. Bugs confirmés → prompts correctifs séparés (1 bug = 1 prompt = 1 commit possible). Attente de validation avant application.

---

## Synthèse exécutive

Le pipeline GPS est **globalement très sain** : les chemins critiques (dédoublonnage par fenêtre 1s, détection de téléportation partagée temps réel/batch, isolation stricte phone/physical_tracker, ACK explicites `positionSaved`/`positionsSaved`, résolution du chauffeur au timestamp du fix via `VehicleAssignmentHistory`, backfill anti-doublons, file de positions en échec Redis, leader election Redis) sont couverts par des tests et des commentaires de diagnostic détaillés.

**4 bugs fonctionnels confirmés** (2 majeurs, 2 mineurs), **1 point déjà corrigé** (importExcel), **1 problème confirmé hors périmètre GPS** (verifyPayment mobile money).

Ordre de correction recommandé (ce qui casse le suivi temps réel en premier) :

| # | Sévérité | Fichier | Problème | Priorité |
|---|---|---|---|---|
| B1 | **MAJEUR** | `deliveries.service.ts` `update()` | Réaffectation chauffeur via PATCH silencieuse (ni webhook ni broadcast) | 1 |
| B2 | **MAJEUR** | `vehicle-assignment-history.service.ts` `assign()` | No-op réaffectation → fermeture/réouverture de la ligne, `assignedAt` d'origine perdu | 2 |
| B3 | MINEUR | `traccar-bridge.service.ts` | Paramètre `isBackfill` mort (vestige de refactoring) | 3 |
| B4 | MINEUR | `tracking.service.ts` `saveBatch()` | `checkProximity` évalué uniquement sur le dernier point du lot | 4 |
| — | RAS | `deliveries.service.ts` `importExcel()` | Condition `newStatus ? {} : ...` **déjà corrigée** (logique `notStarted`) | — |
| B5 | **CRITIQUE (hors GPS)** | `mobile-money.service.ts` `verifyPayment()` | `true` inconditionnel pour toute ref non-`sim_` | séparé |

---

## BUG 1 — MAJEUR — PATCH /deliveries/:id : réaffectation du chauffeur silencieuse

- **Fichier / ligne** : `backend/src/modules/deliveries/deliveries.service.ts` — méthode `update()` (ligne 354), bloc `assignedDriverId` lignes 384-391, bloc effet de bord ligne 421.
- **Comportement actuel** :
  - `update()` ne déclenche notification + webhook + broadcast **que si** `dto.status` change (`statusChanged`, ligne 392-398 → 421). Le changement de statut via ce endpoint a déjà été corrigé (commentaire lignes 419-421).
  - En revanche, un changement **de chauffeur seul** (`dto.driverId` ligne 384-391) met à jour `assignedDriverId` en base **sans aucune émission** : ni `webhooks.dispatch('delivery.driver_assigned')`, ni `dataUpdateBus.emitUpdate()`, ni notification. Le frontend et les intégrations webhook ne sont jamais informés.
  - Contraste avec `bulkAction()` (branche `assignDriver`, lignes 444-466) qui, lui, dispatche bien `delivery.driver_assigned` + `emitUpdate`.
- **Comportement attendu** : alignement sur `bulkAction()` — tout changement de `driverId` (ou `vehicleId`) via `update()` doit déclencher le webhook `delivery.driver_assigned` et le broadcast `dataUpdate` (entity `delivery`, action `assigned`), y compris quand `status` ne change pas.
- **Scénario de reproduction concret** :
  1. Entreprise avec 2 chauffeurs D1 et D2, 1 livraison L1 en statut `pending` assignée à D1 (`assignedDriverId = userD1`).
  2. Le dispatcher édite L1 (formulaire d'édition) et change uniquement le chauffeur → `PATCH /deliveries/L1 { "driverId": "D2" }`.
  3. En base : `driverId=D2`, `assignedDriverId=userD2` ✓. Mais :
     - Aucun webhook `delivery.driver_assigned` → l'intégration client (ERP externe) ne sait pas que la livraison a changé de chauffeur.
     - Aucun `dataUpdate` → l'écran du dispatcher ne se rafraîchit pas en temps réel (dépend du refetch React Query).
     - L'app de D1 continue d'afficher L1 (findMyDeliveries pollé toutes les 60s) et D1 peut même la marquer `in_progress`/`delivered` (updateDriverStatus ne vérifie que `assignedDriverId === userId` — D1 a été remplacé, donc refusé, OK, mais l'affichage est faux pendant jusqu'à 60s).
  4. Impact métier : un chauffeur voit une livraison qui ne lui appartient plus, les intégrations webhook ratent l'événement de réaffectation, et l'UI temps réel reste figée.
- **Sévérité** : **MAJEUR** — chemin d'édition courant (le formulaire de livraison du dispatcher), incohérence entre endpoints (`bulkAction` émet, `update` non), casse webhook + temps réel.

---

## BUG 2 — MAJEUR — `VehicleAssignmentHistoryService.assign()` : le no-op réaffecte et perd `assignedAt`

- **Fichier / ligne** : `backend/src/common/vehicle-assignment/vehicle-assignment-history.service.ts` — `assign()` lignes 35-62 (fermeture `openForDriver` lignes 49-57, création ligne 60).
- **Appelants sans garde amont** :
  - `backend/src/modules/drivers/drivers.service.ts` — `update()` lignes 163-173 : `if (dto.vehicleId !== undefined) { ... else assign(...) }` — le formulaire chauffeur envoie toujours `vehicleId` → **chaque sauvegarde du formulaire déclenche `assign()` même si le véhicule n'a pas changé**.
  - `backend/src/modules/users/users.service.ts` — lignes 91-101 et 395-405 : idem pour la mise à jour d'un utilisateur rôle chauffeur.
- **Comportement actuel** :
  1. Chauffeur D sur véhicule V depuis 08:00 → ligne A (`assignedAt=08:00`, `unassignedAt=null`).
  2. À 10:00, le gérant sauvegarde la fiche de D **sans rien changer** (même véhicule V).
  3. `openForVehicle` = ligne A, `driverId === params.driverId` → premier `if` sauté.
  4. `openForDriver` = ligne A → **fermée** à 10:00, puis **nouvelle ligne B** créée (`assignedAt=10:00`).
  5. Résultat : 2 écritures inutiles en base, et la ligne B falsifie l'historique — « D est sur V depuis 10:00 » au lieu de 08:00.
- **Comportement attendu** : un no-op (le chauffeur est DÉJÀ sur ce véhicule, ligne ouverte du véhicule = ce chauffeur) doit retourner **sans AUCUNE écriture** : ni fermeture, ni création.
- **Impact sur `resolveDriverIdAtTimestamp` (backfill GPS / flux temps réel Traccar)** :
  - L'attribution des fixes reste correcte dans le cas nominal (la ligne fermée couvre l'intervalle [assignedAt, unassignedAt], donc un fix à 09:00 résout D via la ligne A). **Pas de mauvaise attribution.**
  - Mais l'**intégrité de l'historique** (la source de vérité de l'attribution chauffeur↔véhicule, utilisée pour le backfill et les rapports carburant par chauffeur) est corrompue : la date « depuis quand ce chauffeur est sur ce véhicule » devient la date de la dernière sauvegarde du formulaire, pas l'affectation réelle. Chaque no-op génère aussi 2 écritures inutiles (churn sur une table append-only appelée par les jobs quotidiens).
  - Cas limite aggravant : si un backfill/rapport journalier tourne entre la fermeture de A et l'ouverture de B (fenêtre de quelques ms dans la même transaction — improbable, mais la fenêtre existe), les positions de l'intervalle seraient attribuées à null.
- **Scénario de reproduction concret** :
  1. Véhicule V, chauffeur D affecté le 1er du mois (ligne ouverte `assignedAt=2026-08-01`).
  2. Le 15, le gérant ouvre la fiche de D et clique « Enregistrer » sans modification (formulaire envoyant `vehicleId=V`).
  3. `vehicleAssignmentHistory` contient désormais : ligne A fermée le 15, ligne B ouverte le 15 (`assignedAt=2026-08-15`).
  4. L'écran « affecté depuis le … » affiche le 15 au lieu du 1er ; un backfill Traccar de positions du 5 au 15 attribue toujours D (OK) mais l'audit d'historique est faux, et 2 lignes inutiles ont été écrites.
- **Sévérité** : **MAJEUR** — la table est la source de vérité de l'attribution chauffeur pour le GPS (backfill + rapport carburant par chauffeur) ; sa falsification silencieuse à chaque sauvegarde de formulaire nuit à la confiance (le cœur du produit) et gonfle inutilement la base.

---

## BUG 3 — MINEUR — `traccar-bridge.service.ts` : paramètre `isBackfill` mort

- **Fichier / ligne** : `backend/src/modules/tracking/traccar-bridge.service.ts` — ligne 1065 : `private async handlePosition(pos: TraccarPosition, _isBackfill = false)`.
- **Comportement actuel** : le paramètre est préfixé `_` (inutilisé) et **aucun appelant ne passe `true`** — seul le handler socket (`connect()` → `socket.on('message')`) et le retry `processPendingPositions()` l'appellent, toujours sans 2e argument. Le backfill réel passe par une méthode **séparée** `performBackfill()` qui insère directement via `createMany` (sans génération d'alertes, choix documenté lignes ~980-1020).
- **Verdict** : vestige d'un refactoring (le chemin backfill a été extrait dans `performBackfill`). La logique qui aurait dû dépendre de `isBackfill` n'existe plus ailleurs — rien n'a été perdu.
- **Comportement attendu** : suppression du paramètre et de son nom `_isBackfill` (signature + les 2 appels) pour éliminer la confusion. Aucun impact fonctionnel.
- **Sévérité** : **MINEUR** (maintenabilité ; aucun bug de données).

---

## BUG 4 — MINEUR — `saveBatch()` : `checkProximity` évalué sur le dernier point du lot uniquement

- **Fichier / ligne** : `backend/src/modules/tracking/tracking.service.ts` — `saveBatch()`, bloc final lignes ~640-652 : `checkProximity(driverId, last.vehicleId, ..., last.latitude, last.longitude, last.timestamp)` avec `last = inserted[inserted.length - 1]`.
- **Comportement actuel** : après un rattrapage réseau (flush IndexedDB via `batchPosition`), l'alerte de proximité « vous êtes arrivé » n'est évaluée que sur **le dernier point inséré** du lot, tous véhicules confondus. `generateAlerts`, lui, est bien appelé par position (boucle sur `inserted`).
- **Comportement attendu** : évaluer la proximité sur le **dernier point de chaque véhicule présent dans le lot** (le `lastByVehicle` est déjà construit ligne ~630) — un chauffeur qui est passé à moins de 300 m de la destination en milieu de lot, puis a quitté la zone avant le flush, ne recevrait plus le rappel de validation.
- **Scénario de reproduction concret** :
  1. Chauffeur D en trajet vers la livraison L (destination à 200 m). Réseau coupé 10 min (positions mises en file, ~40 points).
  2. D passe à 150 m de la destination (point n°25 du lot), continue, s'éloigne à 2 km (point n°40 = dernier).
  3. Réseau rétabli → `batchPosition` flush : `checkProximity` n'est appelé qu'avec le point n°40 (2 km → hors zone) → **aucune alerte de proximité** ; l'escalade « validez la livraison » ne se déclenche jamais pour ce passage.
  4. Impact : livraison non validée à temps, cascade/retard côté dispatcher, sans qu'aucun rappel n'ait été émis.
- **Sévérité** : **MINEUR** (fenêtre étroite — le point le plus récent est souvent le plus pertinent — mais vraie perte d'alerte possible après coupure réseau).

---

## POINT 4 (demandé) — `importExcel()` : **DÉJÀ CORRIGÉ** — RAS

- **Fichier / ligne** : `backend/src/modules/deliveries/deliveries.service.ts` — `importExcel()`, bloc upsert lignes ~500-515.
- **Verdict** : la branche morte `...(newStatus ? {} : { status: in_progress })` n'existe plus. Le code actuel :
  ```ts
  const notStarted = existing.status === 'pending' || existing.status === 'assigned';
  ...(notStarted ? { status: DeliveryStatus.in_progress } : {})
  ```
  Le comportement voulu est bien obtenu : une livraison `pending`/`assigned` existante est **avancée à `in_progress`** à la réimportation, et les statuts terminaux (`delivered`/`failed`/`cancelled`) ne sont **jamais régressés**. Aucune action requise.

---

## B5 — CRITIQUE (hors périmètre GPS) — `mobile-money.service.ts verifyPayment()` : CONFIRMÉ, signalé séparément

- **Fichier / ligne** : `backend/src/modules/billing/mobile-money.service.ts` — lignes 95-104.
- **Comportement actuel** : pour toute `transactionRef` ne commençant pas par `sim_`, `verifyPayment()` retourne `true` **sans aucune vérification réelle** (pas d'appel à l'API MVola/Orange Money, pas de requête d'état de transaction). La spec `mobile-money.service.spec.ts` lignes 88-92 **verrouille même ce comportement** (« should return true for non-simulated transactions »).
- **Impact** : tout paiement « réel » est considéré payé dès que la ref existe — sans contrôle de statut réel côté opérateur. Risque d'activation de comptes/prestations sans paiement effectif.
- **Note** : hors périmètre GPS (comme convenu) — un prompt correctif séparé est fourni ci-dessous, à traiter indépendamment.

---

## Constats documentés (pas de bug — choix assumés)

1. **`getLivePositions` ne filtre pas `suspect`** (`tracking.service.ts` ~ligne 1050) : la carte live affiche la dernière position même si elle est suspecte (téléportation). La carte la marque « SIGNAL GPS INSTABLE / DÉPLACEMENT (NON CONFIRMÉ) » (`RealTimeMap.tsx` + `mergePositionUpdate`). Choix délibéré (un point suspect prouve la connectivité) — OK.
2. **`flushQueue` supprime toute la file après ack partiel** (`offlineQueue.ts` `flushQueue` → `deletePositions(ids)`) : si le serveur dédoublonne/rejette une partie du lot, la file est vidée quand même. Acceptable : les positions dédoublonnées sont des doublons réels, et les rejetées ne seraient jamais sauvegardées (rejouer en boucle serait pire).
3. **Rate limit par driver sur `updatePosition` mais pas sur `batchPosition`** (`tracking.gateway.ts`) : un client peut contourner `isRateLimited` via le batch. Impact faible (dédoublonnage + validation + limite de file 500), à surveiller.
4. **`checkProximity` utilise `lastDeliveryMap` en mémoire** (`delivery-proximity.service.ts`) : nettoyé quand plus de livraison in_progress ou changement de livraison — OK mono-instance, à revoir si multi-replica (Redis utilisé pour le reste).
5. **Android foreground service + watchdog** (`LocationForegroundService.java`, `TrackingWatchdogWorker.java`) : acquisition FusedLocationProviderClient 3s/2s, permission « toujours », réconciliation avec watchPosition — solide, aucun bug trouvé.
6. **`socket.ts`** : refresh JWT avant expiration + reconnexion propre + fallback long-polling + re-subscribe aux rooms après reconnexion — solide.

---

## Prompts correctifs (1 bug = 1 prompt = 1 commit possible)

### Prompt B1 — Réaffectation chauffeur via PATCH /deliveries/:id

```
CORRIGE LE BUG SUIVANT (bug confirmé par audit GPS, voir GPS_AUDIT_COMPLET_2026-08-15.md, B1).

FICHIER(S) : backend/src/modules/deliveries/deliveries.service.ts (méthode update(), environ lignes 354-435)
            + backend/src/modules/deliveries/deliveries.service.spec.ts

PROBLÈME : update() (PATCH générique /deliveries/:id) ne déclenche AUCUN effet de bord quand
dto.driverId change SANS changement de statut : pas de webhooks.dispatch('delivery.driver_assigned'),
pas de dataUpdateBus.emitUpdate(), pas de notification. bulkAction() (branche assignDriver) fait
les trois. Conséquence : app du chauffeur et intégrations webhook jamais informées d'une réaffectation.

CHANGEMENT EXACT :
1. Dans update(), après le bloc `if (dto.driverId)` (lignes 384-391), calculer :
   const driverChanged = dto.driverId !== undefined && dto.driverId !== delivery.driverId;
2. Après le `prisma.delivery.update` (et indépendamment du bloc statusChanged), ajouter :
   if (driverChanged) {
     await this.webhooks.dispatch('delivery.driver_assigned', companyId, {
       deliveryId: id, companyId, title: updated.title, driverId: dto.driverId,
     });
     this.dataUpdateBus.emitUpdate({ companyId, entity: 'delivery', action: 'assigned',
       payload: { id, driverId: dto.driverId } });
   }
   (aligné sur le code de bulkAction() branches assignDriver — mêmes payloads).
   Ne PAS dupliquer de notification de statut (seul le webhook + broadcast sont attendus ici).

TEST À ÉCRIRE/METTRE À JOUR (deliveries.service.spec.ts) :
- « update() avec driverId seul émet delivery.driver_assigned + dataUpdate action=assigned »
  : appeler update(company, id, { driverId: newDriver }), vérifier webhooks.dispatch appelé avec
  ('delivery.driver_assigned', company, expect.objectContaining({ driverId: newDriver }))
  et dataUpdateBus.emitUpdate appelé avec action 'assigned'.
- « update() sans changement de driverId n'émet rien » : { title: 'x' } → webhooks.dispatch non appelé
  pour delivery.driver_assigned.
- Vérifier qu'aucun test existant sur update() (statut) ne casse.

VÉRIF : npx tsc --noEmit + npx jest src/modules/deliveries (backend).
```

### Prompt B2 — No-op d'affectation : zéro écriture

```
CORRIGE LE BUG SUIVANT (bug confirmé par audit GPS, voir GPS_AUDIT_COMPLET_2026-08-15.md, B2).

FICHIER(S) : backend/src/common/vehicle-assignment/vehicle-assignment-history.service.ts (assign(), lignes 35-62)
            + backend/src/common/vehicle-assignment/vehicle-assignment-history.service.spec.ts

PROBLÈME : assign() ferme la ligne ouverte du chauffeur et en recrée une nouvelle à "now" même
quand le chauffeur est DÉJÀ affecté au même véhicule (no-op). Appelé à chaque sauvegarde du
formulaire chauffeur (drivers.service.ts update() ligne 163-173 et users.service.ts lignes 91-101,
395-405 — aucun garde amont). Résultat : assignedAt d'origine perdu, 2 écritures inutiles par
sauvegarde, historique d'attribution (source de vérité du backfill GPS) falsifié.

CHANGEMENT EXACT :
Dans assign(), dès que la ligne ouverte du VÉHICULE est trouvée :
  const openForVehicle = await tx.vehicleAssignmentHistory.findFirst({ where: { vehicleId: params.vehicleId, unassignedAt: null }, select: { id: true, driverId: true } });
  // NO-OP : le chauffeur demandé est déjà le conducteur de ce véhicule → aucune écriture.
  if (openForVehicle && openForVehicle.driverId === params.driverId) return;
Puis conserver le reste inchangé (fermeture si autre chauffeur, fermeture de la ligne du
chauffeur si elle existe ailleurs, création de la nouvelle ligne).
Justification : l'invariant « au plus une ligne ouverte par chauffeur » (index unique partiel)
garantit que si openForVehicle.driverId === params.driverId, le chauffeur n'a aucune autre
ligne ouverte — le return anticipé est sûr.

TEST À ÉCRIRE/METTRE À JOUR (vehicle-assignment-history.service.spec.ts) :
- « assign() sur le même véhicule (no-op) ne fait AUCUNE écriture » : créer une affectation D→V,
  rappeler assign(D, V) avec un `at` différent, vérifier que la ligne initiale est toujours
  ouverte (unassignedAt null) AVEC l'assignedAt d'origine, et qu'aucune nouvelle ligne n'existe
  (count total inchangé).
- « assign() sur un autre véhicule ferme puis ouvre » (régression : comportement existant conservé).

VÉRIF : npx tsc --noEmit + npx jest src/common/vehicle-assignment (backend).
```

### Prompt B3 — Suppression du paramètre mort `isBackfill`

```
CORRIGE LE BUG SUIVANT (bug confirmé par audit GPS, voir GPS_AUDIT_COMPLET_2026-08-15.md, B3).

FICHIER(S) : backend/src/modules/tracking/traccar-bridge.service.ts

PROBLÈME : handlePosition(pos, _isBackfill = false) (ligne 1065) a un paramètre jamais passé à
true et jamais lu — vestige d'un refactoring (le backfill est dans performBackfill(), méthode
séparée). Aucun impact fonctionnel, confusion possible.

CHANGEMENT EXACT :
1. Signature : private async handlePosition(pos: TraccarPosition) { (supprimer _isBackfill = false).
2. Mettre à jour les 2 appels (le handler socket 'message' dans connect() ~ligne 460 et le retry
   dans processPendingPositions() ~ligne 1210) : handlePosition(pos) sans 2e argument.
3. Aucun autre changement — ne PAS déplacer de logique dans performBackfill().

TEST : aucun test unitaire spécifique requis (comportement inchangé) ; vérifier que la suite
traccar passe : npx jest src/modules/tracking/traccar-bridge.service.spec.ts (si le fichier
existe) sinon la suite tracking complète + npx tsc --noEmit.
```

### Prompt B4 — Proximité batch : dernier point de CHAQUE véhicule

```
CORRIGE LE BUG SUIVANT (bug confirmé par audit GPS, voir GPS_AUDIT_COMPLET_2026-08-15.md, B4).

FICHIER(S) : backend/src/modules/tracking/tracking.service.ts (saveBatch(), bloc final ~lignes 640-652)
            + backend/src/modules/tracking/tracking.service.spec.ts

PROBLÈME : après un flush batch (rattrapage réseau), checkProximity n'est évalué que sur le
DERNIER point inséré du lot (inserted[inserted.length - 1]) — un passage à < 300 m de la
destination en milieu de lot, suivi d'un éloignement, ne déclenche jamais l'alerte de validation.

CHANGEMENT EXACT :
Dans saveBatch(), remplacer le bloc final unique par une boucle sur lastByVehicle (déjà construit
lignes ~630-640, Map vehicleId → { timestamp, speed }) :
  for (const [vehicleId, lastPos] of lastByVehicle) {
    const rec = inserted.find((r) => r.vehicleId === vehicleId);
    if (!rec) continue;
    this.deliveryProximityService.checkProximity(driverId, vehicleId, companyId,
      rec.latitude, rec.longitude, rec.timestamp).catch((err) => this.logger.error(`Proximity check failed: ${err}`));
  }
  (checkProximity est idempotent côté serveur via les clés Redis entered/snoozed : appeler avec
  chaque dernier point de véhicule est sûr, aucun double-alert possible sur la même zone.)
Conserver la boucle generateAlerts existante telle quelle.

TEST À ÉCRIRE (tracking.service.spec.ts) :
- « saveBatch appelle checkProximity pour le dernier point de CHAQUE véhicule du lot » :
  lot de positions sur 2 véhicules → checkProximity appelé 2 fois avec les bons vehicleId/coordonnées.
- Régression : lot mono-véhicule → checkProximity appelé exactement une fois.

VÉRIF : npx tsc --noEmit + npx jest src/modules/tracking/tracking.service.spec.ts (backend).
```

### Prompt B5 (hors GPS, séparé) — verifyPayment mobile money

```
CORRIGE LE BUG SUIVANT (confirmé, hors périmètre GPS — voir GPS_AUDIT_COMPLET_2026-08-15.md, B5).

FICHIER(S) : backend/src/modules/billing/mobile-money.service.ts (verifyPayment(), lignes 95-104)
            + backend/src/modules/billing/mobile-money.service.spec.ts

PROBLÈME : verifyPayment() retourne true inconditionnellement pour toute transactionRef ne
commençant pas par "sim_" — aucun contrôle réel de l'état de la transaction auprès de
MVola/Orange Money. La spec (lignes 88-92) verrouille ce comportement.

CHANGEMENT EXACT (à valider avec le responsable paiement — plusieurs options possibles, choisir
et documenter) :
1. Option minimale (recommandée si aucune API opérateur n'est encore intégrée) : pour une ref
   non-"sim_", NE PAS affirmer "payé" : retourner false + logger.warn explicite
   (« verifyPayment: no real provider verification implemented for ref=... ») — le paiement
   reste confirmé uniquement par webhook signé (handleWebhook, déjà vérifié HMAC).
   => MAIS ce changement peut bloquer la souscription réelle : à coupler avec l'option 2.
2. Option complète : implémenter l'appel d'état réel (API opérateur : MVola getStatus /
   Orange Money checkPaymentStatus) selon la doc opérateur, avec timeout + retry, et ne
   retourner true que si le statut opérateur est payé.
   => exige les credentials opérateur (à demander au client) : mettre en place derrière une
   feature flag PAYMENT_VERIFY_REAL=true, garder l'option 1 en défaut tant que non intégré.
Mettre à jour la spec : retirer/remplacer le test « should return true for non-simulated
transactions » par le nouveau comportement choisi.

VÉRIF : npx tsc --noEmit + npx jest src/modules/billing (backend).
```

---

## Statut des correctifs (2026-08-15 — appliqués après validation)

| # | Correctif | Commit | Tests |
|---|---|---|---|
| B1 | Broadcast `delivery.driver_assigned` + `dataUpdate` dans `update()` quand `driverId` change | ✅ | +2 (réaffectation émet, no-op n'émet pas) |
| B2 | `assign()` : return anticipé sur no-op (zéro écriture, `assignedAt` conservé) | ✅ | +1 (no-op sans écriture) |
| B3 | Suppression du paramètre mort `_isBackfill` | ✅ | aucun (comportement inchangé) |
| B4 | `saveBatch()` : `checkProximity` sur le dernier point de CHAQUE véhicule | ✅ | +2 (multi-véhicules / mono-véhicule) |
| B5 | `verifyPayment()` : refus de confirmer une ref réelle sans vérification opérateur | ✅ | +1 (ref non-`sim_` → false + warn) |

Typecheck `tsc --noEmit` OK — **65 suites / 776 tests OK** (6 skips préexistants).

## Vérifications effectuées

- Lecture intégrale : useDriverTracking.ts, offlineQueue.ts, KalmanFilter.ts, sensorFusion.ts, backgroundLocation.ts, LocationForegroundService.java, TrackingWatchdogWorker.java, traccar-bridge.service.ts, tracking.gateway.ts, tracking.service.ts, geo.utils.ts, gps-quality.ts, teleportation.utils.ts, vehicle-assignment-history.service.ts, geofence.service.ts, delivery-proximity.service.ts, fuel-consumption.service.ts, dashboard.service.ts, deliveries.service.ts, socket.ts, RealTimeMap.tsx, vehicleMap.ts, animationTiming.ts, mobile-money.service.ts, schéma Prisma GpsPosition/GpsPositionArchive/VehicleAssignmentHistory, requêtes SQL brutes (getLivePositions, findNearestVehicle, getTripReport, calculateDistancePostGIS, archivePositionsBefore).
- Aucune correction appliquée (méthode demandée). En attente de validation.
