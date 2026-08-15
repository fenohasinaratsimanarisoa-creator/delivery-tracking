# RELIABILITE GPS — Fiche de référence unique

> **Une seule source de vérité** pour tout ce qui concerne la fiabilité du tracking
> GPS (arrière-plan, connexions, précision, trajet). Ni toi ni un futur développeur
> ne devez repartir de zéro sur ce sujet. Si une alerte de silence GPS se déclenche,
> suis la procédure §4 — rien d'autre.

---

## 1. Ce qui est GARANTI par le code (et testé en CI)

| # | Garantie | Preuve | Test CI |
|---|---|---|---|
| 1 | Service de premier plan `START_STICKY` + notification persistante + WakeLock PARTIAL (écran éteint) + relance auto (AlarmManager 1s → WorkManager 2s → watchdog 15 min → BootReceiver après reboot) | `LocationForegroundService.java` (START_STICKY:302, PARTIAL_WAKE_LOCK:395, ongoing:549), `ServiceRestartWorker.java`, `TrackingWatchdogWorker.java`, `BootReceiver.java`, manifest | Compilé à chaque build Android (pas d'infra de test JVM — voir §5) |
| 2 | Exemption d'optimisation batterie (Doze) demandée + détection/guidage OEM (Xiaomi, Huawei, Oppo, Vivo, OnePlus, realme) | `AndroidManifest.xml:83` (permission), `DeviceOemInfo.java:43-47,84`, guide UI `BatterySetupGuide.tsx` | Guide UI non testé (voir §5) |
| 3 | Reconnexion WebSocket robuste : tentatives illimitées, backoff 1s→5s, refresh de session silencieux avant expiration, reconnexion forcée au retour de veille | `socket.ts:82-85` (reconnection), `:40-62` (refresh), `:106+` (visibility) | ✅ `socket.spec.ts` (5 tests) |
| 4 | Fréquence GPS adaptative : 3s en mouvement / 20s à l'arrêt (>90s) pour tenir 8h de batterie | `LocationForegroundService.java:473` (adaptAcquisitionInterval) | Compilé (voir §5) |
| 5 | Queue offline persistante (IndexedDB), cap 5000 (~4h), éviction du plus ancien TOUJOURS signalée (jamais silencieuse) | `offlineQueue.ts:11,19,93-97` | ✅ `offlineQueue.spec.ts` + `tracking-reliability.spec.ts` |
| 6 | Dead reckoning STRICTEMENT côté affichage, jamais en base (whitelist serveur + aucune fonction d'envoi dans deadReckoning) | `deadReckoning.ts:9`, `tracking.gateway.ts:147` (whitelist), DTO sans champs extrapolés | ✅ `deadReckoning.spec.ts` (garde structurelle) + `tracking.gateway.spec.ts` (test STRIP) |
| 7 | Rapport de trajet basé sur TOUTES les positions réelles, triées par fixTime, distance par segments réels, trous détectés et signalés | `tracking.service.ts:1197,1212,1424,1450` | ✅ `tracking.service.spec.ts` (88 tests) |
| 8 | Attribution du chauffeur correcte même après coupure + réaffectation (VehicleAssignmentHistory) | `traccar-bridge.service.ts:813` (resolveDriverIdAtTimestamp) | ✅ `traccar-backfill.spec.ts` + `outage-recovery.spec.ts` |
| 9 | Force-stop et batterie critique DÉTECTÉS et signalés au dashboard | `tracking.service.ts:1607` (interruption), `gateway.ts:401` (batteryCritical) | ✅ `tracking.service.spec.ts` |
| 10 | Couverture GPS mesurable par véhicule/chauffeur (% du temps avec position valide) | `tracking.service.ts:1324` (computeCoverage), endpoint `GET /tracking/reliability` | ✅ `tracking.service.spec.ts` |

**Le filet CI** : le job `tracking-reliability` (`.github/workflows/ci.yml`) exécute en
un seul run toutes les suites ci-dessus + `trip-fidelity.spec.ts` (coupure mobile 5
min + coupure serveur 10 min + changement de chauffeur → trajet intact) et
`useDriverTracking.spec.ts` (session 8h simulée sans fuite mémoire ni dégradation).
Tout changement de code qui casserait l'un de ces comportements fait échouer le build.

## 2. Ce qui DÉPEND d'un comportement correct du chauffeur (documenté + détecté si ça arrive)

| Cas | Ce qui se passe si ça arrive | Détection |
|---|---|---|
| Force-stop volontaire (Paramètres → Forcer l'arrêt) | Le process est tué SANS aucun callback possible (limite Android par design). Le tracking s'arrête. | ✅ Marqueur d'interruption lu au prochain lancement → notification dashboard « tracking interrompu à HH:MM » + moniteur de silence serveur (alerte sous 5–10 min) |
| Téléphone totalement déchargé | Plus d'alimentation → plus de tracking (aucune app ne peut tourner). | ✅ Alerte batterie critique ≤20 % envoyée AVANT l'extinction (position finale + cause) + silence serveur |
| Téléphone éteint / en mode avion GPS coupé | Plus de positions (le réseau ou le GPS sont physiquement coupés). | ✅ Silence serveur + trous signalés dans le rapport |
| App fermée par erreur (swipe) | Le service REDÉMARRE seul (cascade native) — normalement aucune interruption visible. | ✅ Si le redémarrage échoue : watchdog + marqueur d'interruption |
| Réglages constructeur non effectués (Xiaomi/Huawei/Oppo…) | L'OS tue l'app en arrière-plan MÊME avec l'exemption Android | ✅ Le guide de configuration est affiché au premier lancement + bannière persistante tant que non fait |
| Chauffeur sans réseau pendant des heures (>4h) | La file locale (5000 positions ≈ 4h) se remplit, puis éviction des plus anciennes | ✅ Éviction SIGNALÉE (alerte critique dans l'app, jamais silencieuse) |

## 3. Seuils d'alerte actuellement configurés

| Seuil | Valeur par défaut | Variable d'env | Où |
|---|---|---|---|
| Silence GPS app mobile (phone) | 5 min | `TRACKING_SILENCE_PHONE_MIN` | `tracking.service.ts` |
| Silence GPS traceur physique | 10 min | `TRACKING_SILENCE_TRACKER_MIN` | `tracking.service.ts` |
| Trou signalé dans le rapport | 3 min | `TRACKING_GAP_THRESHOLD_MIN` | `tracking.service.ts` |
| Batterie critique | ≤ 20 % | — (code natif) | `LocationForegroundService.java` |

## 4. PROCÉDURE EXACTE si une alerte de silence GPS se déclenche

1. **Ne pas paniquer, ne pas contacter le client.** L'alerte signifie « ce véhicule
   n'a pas envoyé de position depuis X minutes » — pas que le véhicule est perdu.
2. **Ouvrir le dashboard → vue silences** (`GET /tracking/silences` ou la page
   correspondante) : confirmer le véhicule, la durée de silence, la dernière
   position connue.
3. **Identifier la cause probable** dans l'ordre :
   - **Véhicule à traceur physique** : vérifier le réseau SIM du traceur (crédit
     SIM épuisé = cause n°1), la couverture zone, l'état du lien Traccar
     (`GET /tracking/traccar-devices`).
   - **Véhicule à app mobile** : le chauffeur a-t-il forcé l'arrêt de l'app ?
     A-t-il les réglages constructeur (Autostart) ? Téléphone déchargé ? Vérifier
     si une notification « Batterie critique » ou « Tracking interrompu » est
     arrivée juste avant — si oui, la cause est identifiée.
   - **Les deux** : coupure réseau générale (zone blanche), maintenance serveur.
4. **Si une notification « Batterie critique » ou « Tracking interrompu » existe**
   dans les notifications du dashboard : la cause est documentée, informer le
   client du contexte réel (batterie, force-stop) — pas un bug du système.
5. **Si AUCUNE notification de cause** : contacter le chauffeur (appel/SMS) et
   vérifier que l'app tourne. Après résolution, confirmer que les positions
   reprennent (le moniteur lève automatiquement l'alerte au retour du signal —
   la notification de résolution n'est volontairement pas émise pour éviter le bruit).
6. **Après résolution** : le rapport de trajet de la livraison concernée contiendra
   un trou signalé (« signal GPS interrompu entre 14h32 et 14h41 ») — c'est la
   trace honnête de l'incident, à communiquer comme telle au client si besoin.

## 5. Limites connues (déclarées, pas cachées)

- **Pas d'infrastructure de tests unitaires JVM/Android** dans ce projet : les
  points 1, 2 (partie native), 4 (acquisition adaptative) sont **compilés à chaque
  build** (`./gradlew assembleDebug` en CI via le Docker build) mais n'ont pas de
  test automatisé qui échouerait sur une régression de comportement Java. Ils sont
  couverts par le protocole de validation terrain (§6). Si un jour on ajoute
  Robolectric, c'est là qu'il faudrait les verrouiller.
- **Le guide UI (BatterySetupGuide.tsx)** n'a pas de test de composant — il est
  couvert par le test manuel de l'étape 1 du protocole.

## 6. Protocole de validation terrain FINAL (une seule checklist)

À exécuter UNE fois sur un téléphone réel (idéalement Xiaomi/Redmi) pour signer
définitivement la clôture de ce sujet. APK : `frontend/android/app/build/outputs/apk/debug/app-debug.apk`.

### Préparation (15 min)
- [ ] Téléphone chargé à 100 %, APK installé, localisation « Toujours » accordée
- [ ] Exemption batterie Android accordée + réglages constructeur (Autostart /
      verrouillage) effectués via le guide de l'app
- [ ] Livraison `in_progress` active pour ce chauffeur dans le dashboard
- [ ] Pastille app : « Suivi actif — en ligne »

### Scénario A — Test 8h (autonomie + continuité)
- [ ] Écran éteint, téléphone posé 8h sans recharge
- [ ] À la fin : % batterie restant ≥ 15 %, aucune notification d'interruption
- [ ] Côté serveur : positions régulières de la 1ère à la 8ème heure, aucun trou
      > 5 min (requête SQL : `AUTONOMIE_8H.md` §4)

### Scénario B — Robustesse réseau (30 min)
- [ ] Mode avion 3 min pendant une livraison → positions mises en file locale,
      synchronisées intégralement au retour (aucune perte)
- [ ] WiFi → 4G sans rouvrir l'app → le suivi continue seul
- [ ] Zone blanche puis retour → le socket se reconnecte seul (pastille redevient
      « en ligne » sans intervention)

### Scénario C — Anti-kill système (30 min)
- [ ] Swipe de l'app des tâches récentes → le service redémarre seul (< 2 min)
- [ ] Reboot du téléphone pendant une livraison → tracking relancé sans rouvrir
      l'app (BootReceiver)
- [ ] Force-stop volontaire (Paramètres) → notification « tracking interrompu »
      visible au dashboard au prochain lancement + alerte silence sous 5–10 min

### Scénario D — Fidélité du trajet (30 min)
- [ ] Trajet avec une coupure réseau de 5 min en plein milieu
- [ ] Rapport de trajet : intégralité du trajet, dans l'ordre, avec le trou signalé
      (« signal GPS interrompu »), distance cohérente
- [ ] Changer de chauffeur en cours de trajet (réaffectation) → chaque segment au
      bon chauffeur dans le rapport
- [ ] Aucune position extrapolée dans le rapport (la carte lisse à l'affichage,
      mais les données enregistrées sont uniquement des fixes réels)

### Scénario E — Batterie critique (10 min, simulateur uniquement)
- [ ] (Optionnel) Baisser la batterie sous 20 % → alerte « Batterie critique »
      visible au dashboard avec la dernière position
