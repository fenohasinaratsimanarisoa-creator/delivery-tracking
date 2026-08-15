# Monitoring des connexions & silences GPS — documentation opérationnelle

Date : 15/08/2026
Périmètre : détection AUTOMATIQUE d'un véhicule qui ne transmet plus (déconnexion
app mobile, traceur muet, pont Traccar hors ligne), notification du dispatcher, et
procédure à suivre en cas d'alerte.

---

## 1. Seuils d'alerte (configurables via variables d'environnement)

| Alerte | Déclencheur | Seuil par défaut | Env de réglage |
|---|---|---|---|
| **Silence GPS — app mobile (phone)** | Un véhicule avec chauffeur actif + livraison `in_progress`/`assigned` n'a reçu AUCUNE position depuis plus de X min | **5 min** | `TRACKING_SILENCE_PHONE_MIN` |
| **Silence GPS — traceur physique** | Idem, mais pour un véhicule `physical_tracker` (cadence SIM plus variable) | **10 min** | `TRACKING_SILENCE_TRACKER_MIN` |
| **Traceur jamais connecté** | Un traceur existe depuis > 30 min sans AUCUNE position reçue (déjà en place côté pont Traccar) | 30 min de grâce | — |
| **Pont Traccar hors ligne prolongé** | Le pont (WebSocket vers le serveur Traccar) est déconnecté depuis plus de X min malgré les reconnexions | **15 min** | — |
| **Trou dans le trajet (rapport de livraison)** | Écart de temps > X min entre deux positions consécutives d'un même trajet | **3 min** | `TRACKING_GAP_THRESHOLD_MIN` |

> Les seuils par source existent parce qu'un téléphone émet toutes les 3 s alors
> qu'un traceur SIM peut légitimement espacer ses fixes. Le seuil choisi évite les
> faux positifs tout en détectant une vraie coupure en quelques minutes.

## 2. Comment vous êtes notifié

Le moniteur serveur (`TrackingService.checkSilentVehicles`, exécuté **toutes les
60 s**) détecte les silences pour **tous** les véhicules actifs (phone ET traceur)
ayant une livraison active. Pour chaque silence confirmé :

1. **Notification dashboard** (table `notifications`, type `device_offline`,
   priorité `high`) : poussée **en temps réel** sur le WebSocket du dashboard
   (room `company:*`) — le dispatcher la voit sans rafraîchir. Visible aussi dans
   la page Alertes.
2. **Journal dédié « silences de tracking »** : clé cache
   `tracking_silence:{vehicleId}` (Redis, ou mémoire si Redis indisponible) avec
   l'instant de début du silence. La trace durable reste la notification en base.
3. **Pas de spam** : une alerte par véhicule par période de seuil (cooldown Redis),
   tant que le silence dure.

Le pont Traccar alerte par ailleurs (alerte plateforme Slack/Discord si configurée,
sinon logs) en cas de coupure prolongée du pont (`startDisconnectionMonitor`).

## 3. Vérification en un coup d'œil (vue admin temps réel)

**Endpoint : `GET /api/tracking/silences`** (admin/dispatcher, scope company).

Retourne TOUS les véhicules actifs de la compagnie avec :

- `silenceMin` : durée depuis la dernière position reçue (quelle qu'elle soit, même
  suspecte — un point suspect prouve que le dispositif émet) ;
- `thresholdMin` : seuil appliqué selon la source ;
- `inSilence` : `true` si `silenceMin > thresholdMin` ;
- `neverConnected` : `true` si aucune position n'a jamais été reçue ;
- `lastPosition` : dernière position connue + horodatage ;
- `silenceStartedAt` : début du silence (journal) ;
- chauffeur, véhicule, livraison concernée.

Trié du silence le plus long au plus court. Un coup d'œil suffit pour savoir si un
véhicule « ne bouge plus » est en panne réelle ou simplement à l'arrêt.

## 4. Procédure exacte à suivre en cas d'alerte « Silence GPS »

> Avant de contacter un client, vérifiez les 4 points suivants DANS L'ORDRE.

1. **Est-ce un arrêt légitime ?** Ouvrez `GET /tracking/silences` : si le véhicule
   n'est pas en `inSilence` (ou `silenceMin` proche du seuil) et que la livraison
   est à destination, il s'agit d'un arrêt normal. Aucune action.
2. **Le téléphone/traceur émet-il ?** Vérifiez `GET /tracking/live` : si une
   position récente apparaît pour un AUTRE véhicule du même chauffeur, le
   problème est spécifique au dispositif. Sinon, testez le traceur :
   `GET /tracking/traccar-devices/{deviceId}/test` → `receiving` / `stale` /
   `never_connected`.
3. **Le pont Traccar est-il connecté ?** `GET /tracking/traccar-devices` :
   `connected` doit être `true`. Si le pont est hors ligne depuis > 15 min, une
   alerte plateforme a déjà été émise — c'est un problème d'infrastructure
   (serveur Traccar, réseau), PAS le téléphone du chauffeur.
4. **Le chauffeur a-t-il les réglages batterie ?** Pour l'app mobile : si le
   véhicule est en silence alors que tout le reste fonctionne, le plus probable
   est l'optimisation batterie du téléphone (Doze / surcouche MIUI/EMUI/ColorOS).
   → Refaites le point avec le chauffeur : exemption batterie + « Démarrage
   automatique » constructeur (voir `docs/android-battery-settings.md`).

**Après résolution** : la prochaine position reçue clôt automatiquement le silence
(journal nettoyé). Aucune action de nettoyage nécessaire.

## 5. Scénarios couverts (et leur garantie)

| Scénario | Garantie |
|---|---|
| App mobile en arrière-plan / écran verrouillé | Foreground service + WakeLock + exemption batterie → positions continues (3 s) |
| Coupure réseau mobile 5 min en pleine route | Positions capturées localement (file IndexedDB, ~4 h de capacité) → flush automatique, AUCUN trou |
| App balayée des tâches récentes / téléphone redémarré | Relance automatique (onTaskRemoved + AlarmManager, BootReceiver, watchdog WorkManager) |
| Serveur Traccar injoignable 10 min | Le pont se reconnecte (backoff 2 s → 120 s) + backfill 24 h couvrant toute la période, positions rattachées à la bonne livraison/chauffeur |
| Changement de chauffeur en cours de route | Chaque position attribuée au chauffeur EN VIGUEUR au moment du fix (VehicleAssignmentHistory) |
| Traceur physiquement muet | Alerte « jamais connecté » (30 min de grâce) puis « silence GPS » (10 min) — détection active, pas d'attente |
| Déconnexion du dashboard après veille de l'ordinateur | Reconnexion automatique + refetch complet au retour (Page Visibility) |

## 6. Limites connues (non corrigeables par le logiciel)

- **Téléphone réellement éteint / batterie vide** : aucune app ne tourne — le
  silence est alors la VÉRITÉ (le véhicule ne bouge pas). L'alerte reste émise
  après le seuil pour que le dispatcher sache que « plus rien ne transmet ».
- **Réglages constructeur refusés par le chauffeur** (Autostart désactivé) :
  l'app sera tuée par l'OS malgré l'exemption Android — l'alerte le détectera,
  mais le correctif reste un réglage manuel.
