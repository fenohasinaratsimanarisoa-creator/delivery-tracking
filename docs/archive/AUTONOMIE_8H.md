# AUTONOMIE 8H — tracking continu sur une journée de service

Objectif mesurable : un chauffeur qui démarre l'app en début de journée (téléphone
chargé à 100 %) doit avoir un tracking GPS continu pendant **au moins 8 h
consécutives**, écran éteint, app en arrière-plan, **sans recharge en cours de
route** dans des conditions normales d'usage.

---

## 1. Fréquences de capture GPS retenues (compromis batterie/précision)

| Situation | Intervalle de capture | Pourquoi |
|---|---|---|
| **En mouvement** (vitesse > ~0.5 m/s ≈ 1.8 km/h) | **3 s** (min 2 s) | Fluidité temps réel du dispatcher : un véhicule qui roule doit être suivi au plus près. |
| **À l'arrêt** (immobile > 90 s — déchargement, pause, stationnement) | **20 s** (min 15 s) | Un fix GPS coûte la même énergie à l'arrêt qu'en mouvement mais n'apporte AUCUNE information utile quand le véhicule ne bouge pas. Économie majeure sur 8 h. |
| Retour en mouvement | Immédiat retour à 3 s | Dès que la vitesse dépasse le seuil, on reprend la cadence rapide (aucun trou de suivi au démarrage). |

**Implémentation :** l'acquisition est **native et adaptative** dans
`LocationForegroundService.java` (`adaptAcquisitionInterval`) : la demande de fixes
à FusedLocationProviderClient passe de 3 s → 20 s après 90 s d'arrêt continu
(délai de stabilisation anti-flap : pas de changement de cadence à chaque feu
rouge), et revient à 3 s dès le premier fix en mouvement. Le JS (`useDriverTracking.ts`)
avait déjà la cadence d'ENVOI adaptative (3 s en mouvement / 20 s à l'arrêt) — les
deux couches sont maintenant alignées.

**Conséquence fidélité :** à l'arrêt, 1 position toutes les 20 s est largement
suffisante pour un trajet exact (le véhicule ne bouge pas). Le calcul de distance
n'est pas affecté (segments nuls à l'arrêt).

## 2. Consommation batterie estimée sur 8 h

Chiffres indicatifs pour un smartphone moderne (batterie 4000–5000 mAh), GPS haute
précision, écran éteint, app en arrière-plan. **À confirmer par le test terrain §4.**

| Poste | Consommation | Détail |
|---|---|---|
| **GPS haute précision** | **~55–75 % du total** | C'est LE gros poste. Avec la cadence adaptative : en mouvement 3 s (~60–90 mA en continu), à l'arrêt 20 s (quasi nul entre les fixes). |
| WakeLock partiel (CPU actif) | ~15–25 % | `PARTIAL_WAKE_LOCK` uniquement : écran éteint, CPU maintenu éveillé. Coût modéré, indispensable à la continuité. |
| Réseau (socket + envoi positions) | ~10–15 % | Émissions toutes les 3 s en mouvement, 20 s à l'arrêt. Faible. |
| WebView / app en arrière-plan | ~5 % | Suspendue par Android (timers throttlés) quand l'écran est éteint. |

**Estimation totale : 8–12 % par heure en usage mixte** (≈ 60 % du temps en
mouvement, 40 % à l'arrêt), soit **~65–95 % de batterie sur 8 h** — le téléphone
tient la journée en partant de 100 %. En usage majoritairement à l'arrêt (peu de
conduite), la consommation chute nettement (~5–7 %/h) grâce au mode lent 20 s.

### Ce qui a été vérifié (pas de drain anormal)

- ✅ **WakeLock = `PARTIAL_WAKE_LOCK` uniquement** (jamais `SCREEN_DIM`/`FULL`) :
  l'écran reste éteint. C'est la source n°1 de drain évitée. Libéré à l'arrêt
  volontaire et en `onDestroy` (pas de fuite).
- ✅ **Aucune boucle de retry agressive** : reconnexion socket avec backoff
  (1 s → max 5 s, tentatives illimitées), `drainQueue` ne tourne que si le socket
  est connecté, `flushQueue` est gardé par un flag anti-reentrance. En zone de
  couverture faible, pas de retry haute fréquence qui viderait la batterie.
- ✅ **Intervalle natif adaptatif** (nouveau) : 3 s en mouvement / 20 s à l'arrêt.

## 3. Comportement garanti pendant les 8 h (rappel des durcissements)

- **Continuité** : foreground service `START_STICKY` + notification persistante
  `IMPORTANCE_HIGH` + WakeLock partiel + cascade de relance (startService direct →
  AlarmManager 1 s → WorkManager 2 s → watchdog 15 min → BootReceiver).
- **Batterie** : exemption d'optimisation Android (Doze) demandée + guide OEM
  (Xiaomi/Huawei/Oppo/Vivo) — sans quoi l'OS tue l'app en arrière-plan, quel que
  soit notre code.
- **Détection** : toute interruption résiduelle (force-stop, batterie ≤ 20 %,
  service tué) est signalée automatiquement au dashboard.

## 4. PROTOCOLE DE TEST TERRAIN 8 h (à exécuter sur téléphone réel)

Ce protocole est **obligatoire** avant de considérer le point validé — l'estimation
ci-dessus ne remplace pas une mesure réelle.

### Préparation (10 min)

1. Téléphone **représentatif du parc** (idéalement un Xiaomi/Redmi — le plus
   courant à Madagascar). Charge **100 %**, écran réglé sur luminosité auto.
2. Installer l'APK recompilé (`frontend/android/app/build/outputs/apk/debug/app-debug.apk`).
3. Accorder à l'app : localisation « Toujours », exemption d'optimisation batterie,
   et les réglages constructeur (démarrage automatique / verrouillage — suivre le
   guide dans l'app). **Sans ces réglages, le test est invalide.**
4. Créer (ou activer) une livraison `in_progress` pour ce chauffeur via le dashboard.
5. Vérifier que la pastille de suivi est « Suivi actif — en ligne » dans l'app.

### Déroulé (8 h)

6. **Éteindre l'écran** (bouton power), poser le téléphone sur une table (pas de
   chargeur).
7. Noter l'heure de départ et le % batterie de départ (doit être ~100 %).
8. **Ne pas toucher au téléphone** pendant 8 h. Si vous le touchez pour vérifier,
   notez l'heure — mais évitez (chaque réveil d'écran fausse légèrement la mesure).
9. Au bout de **8 h**, rallumer l'écran : noter le **% batterie restant** et
   l'état de la pastille (« Suivi actif » = le service a tenu).

### Vérifications côté serveur (10 min)

10. Interroger les positions reçues pour ce véhicule sur la période :
    ```bash
    # Dans la base PostgreSQL (ou via le dashboard → rapport de trajet) :
    SELECT COUNT(*) AS nb_positions,
           MIN(timestamp) AS premiere, MAX(timestamp) AS derniere,
           COUNT(*) FILTER (WHERE timestamp < now() - interval '1 hour') AS positions_premiere_heure,
           COUNT(*) FILTER (WHERE timestamp > now() - interval '1 hour') AS positions_derniere_heure
    FROM gps_positions
    WHERE vehicle_id = '<ID_VEHICULE>' AND timestamp >= now() - interval '8 hours';
    ```
11. **Critères de succès :**
    - **Aucun trou > 5 min** dans les timestamps (le véhicule était immobile →
      l'écart maximal attendu est de 20 s + tolérance réseau ; un trou de plusieurs
      minutes = interruption → test ÉCHEC).
    - **Pas de dégradation** : `positions_derniere_heure` ≥ 80 % de
      `positions_premiere_heure` (si le véhicule est resté immobile, les deux
      valeurs reflètent la cadence 20 s → comparer des moyennes horaires).
    - **Batterie restante ≥ 15–20 %** après 8 h (avec usage mixte). En dessous de
      10 %, revoir l'estimation §2 et chercher un drain anormal (autre app, réglage
      constructeur manquant).
    - **Aucune notification** d'interruption reçue au dashboard pendant le test
      (sinon : reprendre le guide OEM — c'est l'OS qui a tué l'app).

### Cas de test accélérés complémentaires (30 min, facultatifs)

- **Cycle rapide 30 min** : démarrage tracking → écran éteint → vérifier au bout de
  30 min que les positions continuent et que la batterie a baissé de ≤ 8 %.
- **Arrêt prolongé simulé** : téléphone posé immobile 30 min → vérifier que les
  positions arrivent **toutes les 20 s** (pas 3 s) — preuve que le mode lent est actif.
- **Reprise en mouvement** : déplacer le téléphone (marche rapide) → vérifier le
  retour immédiat à la cadence 3 s.

## 5. Test automatisé de session longue (inclus dans la CI)

`useDriverTracking.spec.ts` — « Test 8h : session longue accélérée » : simule 8 h
de positions natives en accéléré (mock du temps) et vérifie :
1. **Aucune fuite de listeners socket** : le nombre de souscriptions persistantes
   (`.on`) reste identique après 8 h d'activité (un listener non nettoyé par
   re-render = accumulation mémoire).
2. **Aucune accumulation d'abonnements natifs** : le sink Capacitor n'est
   enregistré qu'une seule fois.
3. **Pas de dégradation** : le pipeline émet encore des positions à la 8ème heure
   (émises ou mises en file — jamais perdues).
