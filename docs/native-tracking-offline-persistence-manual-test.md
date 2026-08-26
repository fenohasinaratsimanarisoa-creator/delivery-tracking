# Test manuel — persistance native GPS hors ligne (mode avion 3h)

## Contexte

Ce document couvre la Phase 5 du chantier "persistance native indépendante du
JS" (SQLite natif → `POST /tracking/positions/native-batch` → WorkManager,
voir `LocationQueueDb.java`, `PositionUploadWorker.java`,
`NativeAuthTokenStore.java`, `tracking.controller.ts`).

**Aucun test automatisé (instrumenté ou non) ne peut couvrir fidèlement le
comportement RÉEL de Doze/App Standby et des surcouches constructeur (MIUI,
EMUI, ColorOS, Vivo…) sur un vrai appareil, en veille prolongée.** Les tests
instrumentés (Phases 1-4) valident la logique du code (SQLite, worker, pont
token) dans un environnement contrôlé ; ils ne prouvent PAS que l'OS laisse
effectivement tourner l'acquisition GPS + les écritures SQLite pendant 3h
d'écran éteint. Seul ce protocole, rejoué sur un appareil physique réel,
apporte cette preuve — **ne pas passer en production avant de l'avoir rejoué
et documenté le résultat ci-dessous (ou dans un rapport séparé).**

## Prérequis

- Un appareil Android physique (idéalement un modèle avec surcouche connue
  pour être agressive — Xiaomi/MIUI ou Huawei/EMUI — puisque c'est le
  scénario le plus défavorable réellement rencontré en usage terrain).
- L'app installée avec le build incluant les Phases 1-4.
- Permission de localisation "Toujours" ET exemption d'optimisation batterie
  déjà accordées (sinon ce test valide autre chose : l'absence de ces
  permissions, déjà couverte par le badge de fiabilité tracking — voir
  `trackingReliability` côté FleetPage).
- Un compte chauffeur avec un véhicule assigné.
- Accès à la base de données backend (ou à l'endpoint
  `GET /tracking/positions/:deliveryId` / à un `SELECT` direct sur
  `gps_positions`) pour la vérification finale.

## Protocole

1. **Démarrer le tracking** dans l'app (bouton de démarrage du suivi), noter
   l'heure de début précise (`T0`) et le `vehicleId` utilisé.
2. Mettre l'app en arrière-plan (bouton Accueil — ne PAS forcer l'arrêt).
3. **Activer le mode avion.** Confirmer visuellement que l'icône réseau/wifi
   est bien coupée.
4. **Laisser le téléphone en veille (écran éteint) pendant 3 heures**, sans
   aucune interaction. Ne pas brancher le chargeur si possible (le scénario
   réel inclut souvent aussi la gestion batterie).
5. Après les 3h, rallumer l'écran puis **désactiver le mode avion**.
6. Attendre 2-3 minutes que WorkManager déclenche son cycle (le worker
   périodique tourne toutes les ~3 min dès que la contrainte réseau est
   remplie — voir `PositionUploadWorker.schedulePeriodic`) et que le lot de
   positions accumulées en SQLite natif soit poussé au backend.
7. Noter l'heure de fin (`T1`).
8. **Vérifier en base** :
   ```sql
   SELECT count(*), min(timestamp), max(timestamp)
   FROM gps_positions
   WHERE vehicle_id = '<vehicleId noté à l'étape 1>'
     AND timestamp BETWEEN '<T0>' AND '<T1>';
   ```

## Résultat attendu

- Le nombre de positions doit correspondre à l'intervalle d'acquisition natif
  attendu sur ~3h (cadence rapide 3s si le véhicule est considéré en
  mouvement, ou cadence lente 20s après confirmation d'arrêt prolongé — voir
  `LocationForegroundService.adaptAcquisitionInterval`). **Aucun trou de 3h**
  ne doit apparaître dans la séquence de timestamps — c'est précisément le
  bug que ce chantier corrige (avant : 0 position sur toute la fenêtre avion,
  le JS/WebView étant gelé).
- Les positions doivent être QUASI-CONTINUES dans le temps (des micro-trous
  de quelques secondes sont normaux — cold-fix GPS, signal dégradé — mais pas
  un trou de plusieurs minutes/heures).

## Résultat du test

> ⚠️ **Non exécuté.** Ce test nécessite un appareil physique réel, 3 heures
> de veille effective, et une manipulation manuelle du mode avion — aucune de
> ces conditions n'est reproductible dans l'environnement où ce chantier a
> été développé (pas d'appareil physique disponible). **Ce protocole doit être
> rejoué par un humain avec un vrai téléphone avant toute mise en production
> de ces 4 phases.**
>
> À compléter après exécution :
> - Date / appareil / version Android / OEM :
> - `T0` / `T1` :
> - Nombre de positions trouvées en base sur la fenêtre :
> - Trou le plus long observé entre deux positions consécutives :
> - Verdict (OK / KO, avec détail si KO) :
