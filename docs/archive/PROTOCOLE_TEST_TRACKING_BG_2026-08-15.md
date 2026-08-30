# Protocole de test terrain — Fiabilité du suivi en arrière-plan & connexions

Date : 15/08/2026
Périmètre : app mobile chauffeur (Android/Capacitor) + dashboard web (dispatcher).

Ce protocole permet de vérifier **vous-même**, scénario par scénario, que le tracking
survit à tout ce qu'un usage réel impose. Le seul cas non couvert (et non corrigeable) :
téléphone réellement éteint (plus d'alimentation) — aucune app ne peut tourner.

---

## 0. Préparation obligatoire (5 min — à faire UNE fois)

Sur le téléphone du chauffeur, avec la nouvelle version de l'app (APK recompilé) :

1. Ouvrir l'app, se connecter en chauffeur. Le **guide de configuration batterie**
   s'affiche une seule fois au premier lancement : suivre les étapes dans l'ordre.
2. **Exemption Android** : bouton « Ouvrir le réglage batterie » → choisir
   **« Sans restriction »** (Android pur) / **« Ne pas optimiser »** (Huawei).
3. **Réglages constructeur** (si le guide affiche une étape 2 — Xiaomi/MIUI,
   Huawei/EMUI, Oppo/ColorOS, Vivo, OnePlus…) : bouton « Ouvrir le réglage
   constructeur » → **activer le « Démarrage automatique » (Autostart)** et
   « Autoriser l'activité en arrière-plan ».
   - Téléphones concernés à Madagascar : Xiaomi/Redmi/POCO (MIUI/HyperOS),
     Huawei/Honor (EMUI/MagicOS), Oppo/realme/OnePlus (ColorOS), Vivo (Funtouch).
4. **Localisation « Toujours »** : lors de la demande de permission, choisir
   « Autoriser tout le temps » (pas « pendant l'utilisation de l'app »).
5. Démarrer une livraison (statut `in_progress`). Vérifier que la **notification
   persistante** « Suivi actif — en ligne » est visible.
6. Côté dispatcher : ouvrir le dashboard sur une carte de flotte. Le véhicule doit
   apparaître et bouger en temps réel (points toutes les ~3 s).

> Comment vérifier les positions côté backend (facultatif) :
> `psql ... -c "SELECT timestamp, latitude, longitude, speed FROM gps_positions ORDER BY timestamp DESC LIMIT 10;"`
> ou logs `[POSITION] driver=...` côté serveur.

---

## 1. Écran verrouillé (le test n°1)

1. Vérifier que la notification « Suivi actif — en ligne » est affichée.
2. **Verrouiller le téléphone** (bouton power), le poser, **ne pas y toucher**.
3. Attendre **15 minutes** (mouvement ou arrêt, peu importe).
4. Déverrouiller. Regarder la notification : elle doit afficher
   « Suivi actif — en ligne » (ou « Hors ligne — N en attente » si zone blanche).
5. Côté dashboard : la position doit avoir continué de bouger **sans interruption**
   pendant les 15 min (vérifier l'horodatage « Dernière position » sur la carte).

**Critère de succès** : aucun trou > 1 min dans la trace pendant les 15 min d'écran verrouillé.

## 2. Veille prolongée + Doze (1 h)

1. Verrouiller le téléphone avec le tracking actif.
2. Le laisser **immobile, écran éteint, 1 heure** (le plus dur pour Doze).
3. Déverrouiller, vérifier notification + dashboard.

**Critère de succès** : la position continue d'arriver (à cadence réduite à l'arrêt,
20 s max — pas de coupure totale).

## 3. Mode avion puis retour (coupure réseau totale)

1. Tracking actif. Activer le **mode avion** pendant **3 minutes**.
2. La notification doit passer à « **Hors ligne — N en attente** » (les positions
   GPS continuent d'être captées et stockées localement).
3. Désactiver le mode avion. **Sans rien toucher**, attendre 30 s.
4. La notification doit repasser à « **Suivi actif — en ligne** » et la file
   « N en attente » doit se vider (synchronisation automatique).

**Critère de succès** : aucune position perdue — la trace côté dashboard reprend
exactement là où elle s'était arrêtée, dans l'ordre chronologique.

## 4. Changement de réseau (WiFi → 4G)

1. Tracking actif en WiFi. Couper le WiFi (passage en 4G) — ou l'inverse.
2. Sans toucher l'app, attendre 1 min : le socket doit se reconnecter seul.

**Critère de succès** : la position continue d'arriver au dashboard. Si la
notification affiche brièvement « Hors ligne — N en attente », elle doit revenir
à « en ligne » et vider la file **sans réouverture de l'app**.

## 5. Fermeture de l'app depuis le gestionnaire de tâches récentes (balayage)

1. Tracking actif (livraison en cours). Ouvrir le gestionnaire des tâches récentes
   et **balayer l'app** (fermeture complète).
2. Attendre 1 min. Vérifier que la **notification persistante est toujours là**
   et que la position continue d'arriver au dashboard.
3. Re-ouvrir l'app : tout doit fonctionner, aucune action requise.

**Critère de succès** : le balayage ne tue PAS le suivi (onTaskRemoved + AlarmManager
de secours + watchdog WorkManager 15 min).

## 6. Redémarrage du téléphone pendant une livraison

1. Tracking actif (livraison en cours). **Redémarrer le téléphone**.
2. Après le reboot, **NE PAS ouvrir l'app**.
3. Attendre 2 min, puis vérifier côté dashboard que les positions reprennent.

**Critère de succès** : le service se relance tout seul après le reboot
(BootReceiver sur BOOT_COMPLETED). La position reprend au dashboard sans que le
chauffeur n'ait rien fait.

## 7. Surcouche constructeur (Xiaomi/MIUI, Huawei, Oppo, Vivo — le test clé)

Uniquement si le téléphone de test est un de ces constructeurs :

1. Révoquer temporairement le réglage Autostart : Paramètres → Applications →
   Gérer les applications → LogiTrack → **Désactiver « Démarrage automatique »**.
2. Verrouiller le téléphone 10 min en mouvement.
3. Constater la coupure (le dashboard fige le véhicule) — c'est le comportement
   SANS le réglage.
4. Réactiver Autostart, répéter : le suivi doit continuer.

**Critère de succès** : avec les réglages constructeur activés, le tracking survit
à l'écran verrouillé. Ce test valide que le guide d'installation a bien formé le
chauffeur (c'est la cause n°1 sur le terrain).

## 8. Dashboard web — onglet laissé ouvert + veille de l'ordinateur

1. Laisser le dashboard ouvert sur la carte de flotte.
2. **Mettre l'ordinateur en veille** (ou verrouiller l'écran) 20 minutes.
3. Réveiller l'ordinateur. **Sans rien rafraîchir** :
   - la connexion se rétablit seule (Page Visibility → reconnexion forcée),
   - les données (positions, livraisons, alertes) sont **rechargées complètement**
     automatiquement au retour (refetch complet, pas seulement le prochain événement).

**Critère de succès** : après réveil, le dashboard affiche l'état à jour sans F5
et sans déconnexion visible de session (le refresh du JWT est silencieux).

## 9. Session longue (dispatcher qui garde l'onglet ouvert toute la journée)

1. Laisser le dashboard ouvert **4 h+** sans le toucher (en arrière-plan parfois).
2. Vérifier de temps en temps : pas de déconnexion visible, pas de dégradation
   (pas de listener dupliqué, la connexion reste stable après les reconnexions).

**Critère de succès** : aucune « déconnexion » affichée, les positions continuent
d'arriver en temps réel après des heures d'utilisation.

---

## Récapitulatif — ce qui est corrigé dans cette passe

| Scénario | Correctif |
|---|---|
| App tuée en arrière-plan (Doze/OEM) | Exemption batterie explicite + guide 1er lancement + réglages par marque (MIUI/EMUI/ColorOS/Vivo) |
| Service tué par le système | START_STICKY + WakeLock partiel + watchdog WorkManager 15 min |
| App balayée des tâches récentes | onTaskRemoved → redémarrage immédiat + secours AlarmManager |
| Téléphone redémarré | BootReceiver (BOOT_COMPLETED) relance le service si tracking en cours |
| Réseau coupé / changé | Reconnection socket auto (retries infinis, backoff 1→5 s) + file offline IndexedDB (500 max, envoi chronologique au retour) |
| GPS en arrière-plan | Acquisition native FusedLocationProviderClient (3 s, haute précision) indépendante de la WebView |
| Chauffeur ne sait pas si ça marche | Notification persistante avec état réel (« actif / hors ligne — N en attente / synchronisation ») + pastille dans l'app |
| Dashboard déconnecté après veille | Page Visibility : reconnexion forcée + refetch complet au retour |
| Déconnexions sur réseau lent | pingTimeout serveur élargi (25 s/35 s) + timeout de connexion client 45 s |
| Token JWT expiré avec onglet ouvert | Refresh silencieux en arrière-plan + reconnexion propre (déjà en place, vérifié) |

## Limite physique (hors périmètre, non corrigeable)

- Téléphone réellement éteint (batterie retirée / déchargée à 0 %) : aucune app ne
  peut tourner. Le dispatcher verra le véhicule « figé » à la dernière position.
- Réglages constructeur (Autostart) : non automatisables par code — le guide
  d'installation forme le chauffeur, mais le réglage reste manuel (c'est le but
  des points 2 et 3 de la partie 1).
