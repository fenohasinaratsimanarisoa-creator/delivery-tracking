# Paramètres batterie Android — pourquoi et comment

## Pourquoi c'est nécessaire

L'app LogiTrack transmet la position GPS en continu au dispatcher. Pour continuer à
fonctionner **écran verrouillé / app en arrière-plan**, l'app démarre un *foreground
service* Android de type `location` (`LocationForegroundService.java`).

Deux couches indépendantes peuvent interrompre cette transmission :

1. **Doze / App Standby (Android AOSP)** : l'exemption standard
   `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (bouton dans l'app, bannière
   « Optimisation batterie active ») couvre ce cas.
2. **Surcouches constructeur (MIUI/Xiaomi, etc.)** : ces écrans propriétaires ne sont
   **pas** automatisables de façon fiable par du code. Ils doivent être réglés
   **manuellement** par le chauffeur. L'app les documente via la bannière et cet écran.

> Sans ces réglages, le système peut tuer le service d'arrière-plan après quelques
> minutes d'écran verrouillé : la position cesse d'être transmise alors que le chauffeur
> est en route (le dispatcher voit le véhicule « figé »).

---

## 1. Exemption standard Android (automatisable)

Depuis l'app, la bannière « Optimisation batterie active » ouvre l'écran système
`ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` :

- **Paramètres → Applications → LogiTrack → Batterie → Sans restriction** (AOSP/Android pur).

L'état `batteryOptimizationIgnored` est exposé par le plugin `BackgroundLocation`
(`getBatteryOptimizationStatus`) et relu par l'app au démarrage du tracking et à chaque
retour au premier plan.

---

## 2. Surcouches constructeur — réglages manuels

### Xiaomi / MIUI / HyperOS (testé — historique de device de test)

Deux réglages sont requis, dans cet ordre :

**a. Autostart (démarrage automatique)**

`Paramètres → Applications → Gérer les applications → LogiTrack → Autostart → Activer`

> Sans Autostart, MIUI tue le process dès l'écran verrouillé, foreground service ou pas.

**b. Batterie → Sans restriction**

`Paramètres → Applications → Gérer les applications → LogiTrack → Réglage de la batterie → Sans restriction`

Si l'app n'apparaît pas dans « Gérer les applications », chercher via
`Paramètres → Applications → Gérer les applications → (icône loupe)`.

**c. (Recommandé) Sauvegarde en arrière-plan + notifications**

- `Sauvegarde en arrière-plan → Autoriser` (selon version MIUI).
- Autoriser les notifications de l'app (sinon les alertes de livraison ne s'affichent pas).

### Samsung (One UI)

`Paramètres → Applications → LogiTrack → Batterie → Autoriser en arrière-plan` (et
désactiver « Mettre en veille »). Pas d'Autostart nécessaire.

### Oppo / Realme / OnePlus (ColorOS/realme UI)

- `Paramètres → Applications → LogiTrack → Utilisation de la batterie → Autoriser en arrière-plan`
- `Paramètres → Applications → LogiTrack → Autoriser l'activité en arrière-plan` (ColorOS 12+)
- `Paramètres → Batterie → Autostart` (Oppo) → activer LogiTrack.

### Huawei (EMUI / HarmonyOS)

- `Paramètres → Batterie → Optimisation de la batterie → Applications → LogiTrack → Ne pas optimiser`
- `Paramètres → Applications → LogiTrack → Batterie → Autoriser l'app à démarrer automatiquement et en arrière-plan`.

### Vivo (Funtouch / OriginOS)

- `Paramètres → Applications → Gérer les applications → LogiTrack → Autorisation → (tout activer)`
- `Paramètres → Batterie → Applications en arrière-plan → Autoriser LogiTrack`.

---

## 3. Vérification

Après réglage : verrouiller l'écran pendant 5 minutes en mouvement, puis vérifier côté
backend que les positions continuent d'arriver (table `gps_positions` ou logs
`[METRICS] received/saved` de `TrackingService`). L'intervalle doit rester proche de
3–5 s, pas s'étirer à plusieurs dizaines de secondes.
