# Déploiement du pont Traccar — DelivTrack

> ⚠️ **Correction 2026-09-05** : ce document décrivait une architecture
> Render + Fly.io + Traccar Cloud (`server.traccar.org`) qui est **obsolète**.
> La prod réelle actuelle est un **Traccar auto-hébergé sur un VPS Contabo**,
> dans le même `docker-compose.contabo.yml` que le backend (voir
> `scripts/deploy-contabo.sh`). Les sections ci-dessous ont été corrigées en
> conséquence. `TRACCAR_FLY_IO_SETUP.md` et les références à
> Fly.io/Render/`server.traccar.org` ailleurs dans ce dépôt sont du matériel
> historique, à ignorer pour la prod actuelle.

## Architecture

```
┌──────────────────┐    TCP (GT06 etc.)     ┌───────────────────────────────┐
│  GPS Trackers    │ ─────────────────────▶ │  VPS Contabo (169.58.237.88)  │
│  (GT06, Teltonika,│   ports 5055-5065     │  docker-compose.contabo.yml   │
│   TK103, H02)     │   (publics)           │                               │
│                   │                       │  ┌─────────────────────────┐ │
│                   │                       │  │ traccar (conteneur)      │ │
│                   │                       │  │ admin UI: 127.0.0.1:8082 │ │
│                   │                       │  │ (accès via tunnel SSH)   │ │
│                   │                       │  └────────────┬────────────┘ │
│                   │                       │               │ réseau Docker│
│                   │                       │               │ interne      │
│                   │                       │  ┌────────────▼────────────┐ │
│                   │                       │  │ backend (TraccarBridge)  │ │
│                   │                       │  │ TRACCAR_URL=             │ │
│                   │                       │  │  http://traccar:8082     │ │
│                   │                       │  └─────────────────────────┘ │
└───────────────────┘                       └───────────────────────────────┘
```

**Production :** DelivTrack utilise un **Traccar auto-hébergé** dans le même
`docker-compose.contabo.yml` que le reste de l'application, sur le VPS
`169.58.237.88`. Traccar reçoit les connexions TCP des traceurs GPS (GT06,
Teltonika, etc.) directement sur les ports **5055-5065, publics** (mêmes
valeurs que `traccar/traccar.xml` — pas besoin de les "confirmer dans une
interface cloud", elles sont fixes). Le `TraccarBridgeService` du backend se
connecte en interne via le réseau Docker (`TRACCAR_URL=http://traccar:8082`),
jamais par Internet — aucune configuration DNS/HTTPS n'est nécessaire pour
cette liaison.

L'interface web d'admin Traccar (port `8082`) est bindée à `127.0.0.1` sur le
VPS (pas exposée publiquement, mesure de sécurité depuis le commit `be80181`) :
```bash
ssh -L 8082:localhost:8082 root@169.58.237.88
# puis, dans un navigateur : http://localhost:8082
```
Identifiants : `TRACCAR_USER`/`TRACCAR_PASSWORD` dans le `.env` du VPS
(⚠️ voir section 7 — ne JAMAIS laisser le défaut `admin`/`admin`).

---

## 1. Développement local — Installer Traccar avec Docker (optionnel)

*Cette section ne concerne que les développeurs qui souhaitent exécuter Traccar localement.*

### Prérequis

- Docker et Docker Compose installés

### docker-compose.yml

```yaml
version: '3.8'
services:
  traccar:
    image: traccar/traccar:latest
    container_name: traccar
    restart: unless-stopped
    ports:
      - "8082:8082"   # Interface admin
      - "5055:5055"   # GT06 (dev uniquement)
      - "5056:5056"   # Teltonika (dev uniquement)
      - "5057:5057"   # H02 (dev uniquement)
      - "5058:5058"   # TK103 (dev uniquement)
      - "5059:5059"   # Meitrack (dev uniquement)
      - "5060:5060"   # OsmAnd (dev uniquement)
      - "5061:5061"   # Lézard (dev uniquement)
      - "5062:5062"   # WristWatch (dev uniquement)
      - "5063:5063"   # Navtelecom (dev uniquement)
      - "5064:5064"   # Xexun (dev uniquement)
      - "5065:5065"   # AST (dev uniquement)
    volumes:
      - traccar_data:/opt/traccar/data
      - ./traccar.xml:/opt/traccar/conf/traccar.xml:ro

volumes:
  traccar_data:
```

⚠️ **Les ports 5055-5065 ci-dessus sont les MÊMES qu'en production** (contrairement à ce que cette section disait auparavant) : la prod utilise le même `traccar/traccar.xml`, donc les mêmes ports pour chaque protocole. Seul l'hôte change (`169.58.237.88` au lieu de `localhost`).

---

## 2. Configurer Traccar en production (Contabo, auto-hébergé)

1. Ouvrez un tunnel SSH puis connectez-vous à l'interface admin :
   ```bash
   ssh -L 8082:localhost:8082 root@169.58.237.88
   # puis http://localhost:8082 dans le navigateur
   ```
2. Créez un **device** avec l'IMEI du traceur physique (**Devices → Add**).
   - **Host** : `169.58.237.88`
   - **Port** : celui du protocole du traceur, **fixe**, listé dans `traccar/traccar.xml` (GT06=5055, Teltonika=5056, H02=5057, TK103=5058, Meitrack=5059, etc. — voir `RAPPORT_PORTS_TRACCAR.md`)
   - Configurez le traceur physique avec ce host et ce port (par SMS/USB selon le modèle)
3. Notez le `deviceId` Traccar (entier, généré à la création) — il servira pour `Vehicle.traccarDeviceId` dans DelivTrack
4. Associez le device à un véhicule : `POST /tracking/vehicles/:vehicleId/link-traccar`

---

## 3. Connexion DelivTrack ↔ Traccar (déjà configurée en prod, rien à faire normalement)

### Variables dans le `.env` du VPS Contabo

| Variable | Valeur réelle en prod | Commentaire |
|---|---|---|
| `TRACCAR_URL` | `http://traccar:8082` | Réseau Docker **interne** — pas une URL publique |
| `TRACCAR_USER` | `admin@delivertrack.local` (ou ce qui a été configuré) | Compte de l'API Traccar, pas un compte email réel |
| `TRACCAR_PASSWORD` | généré, stocké dans le `.env` du VPS | ⚠️ jamais `admin` par défaut — voir section 7 |

Ces 3 variables sont déclarées dans `docker-compose.contabo.yml` pour les services `backend` **et** `worker` (le pont GPS tourne dans les deux process — sans elles sur le `worker`, le pont reste inactif dans ce process).

---

## 4. Association véhicule ↔ device Traccar

```bash
POST /tracking/vehicles/:vehicleId/link-traccar
Content-Type: application/json
{
  "traccarDeviceId": "42"
}
```

Ou depuis l'interface web DelivTrack (admin → Véhicules → éditer → "ID device Traccar").

---

## 5. Vérifier le fonctionnement

```bash
curl -H "Authorization: Bearer <token>" https://deliverytrack-api.onrender.com/tracking/traccar-devices
```

Réponse attendue :
```json
{
  "connected": true,
  "lastPositionReceivedAt": "...",
  "reconnectAttempts": 0,
  "hasSession": true
}
```

### Test de device Traccar

```bash
curl -H "Authorization: Bearer <token>" \
  https://deliverytrack-api.onrender.com/tracking/traccar-devices/42/test
```

### Dashboard admin

`/platform-admin/traccar/status`

---

## 6. Ajouter un NOUVEAU protocole / un nouveau modèle de traceur

> **Principe fondamental** : le pont DelivTrack (`TraccarBridgeService`) est **100 %
> agnostique au protocole**. Il ne lit QUE l'objet Position normalisé de Traccar
> (latitude, longitude, speed en nœuds, course, altitude, accuracy, valid, fixTime,
> deviceTime, attributes.hdop optionnel) — jamais un champ spécifique à une marque.
> Acheter un traceur d'un modèle jamais utilisé n'exige AUCUNE modification du code
> DelivTrack : seule la **configuration du serveur Traccar** (protocole + port + device)
> est à faire, une fois par nouveau protocole.

### 6.1 Production — Traccar auto-hébergé (Contabo, `169.58.237.88`)

Le `traccar.xml` embarqué gère 11 protocoles (voir `RAPPORT_PORTS_TRACCAR.md`). Pour un nouveau modèle de traceur :

1. Vérifiez que le protocole du traceur est déjà activé dans `traccar/traccar.xml`
   (GT06, Teltonika, H02, TK103, Meitrack, OsmAnd, Lézard, WristWatch, Navtelecom,
   Xexun, AST). Sinon, voir 6.2 pour ajouter le protocole (nécessite un redéploiement).
2. Tunnel SSH puis `http://localhost:8082` → **Devices → Ajouter**.
   - **Name** : nom du véhicule (libre).
   - **Identifier (uniqueId)** : l'identifiant que le traceur ENVOIE — pour la quasi-totalité
     des protocoles GSM c'est l'**IMEI** (15 chiffres) ; certains protocoles acceptent un
     identifiant libre non-numérique.
   - **Host/Port à donner au traceur** : `169.58.237.88` + le port **fixe** du protocole
     (GT06=5055, Teltonika=5056, etc. — `traccar/traccar.xml`), jamais "fourni par une interface".
3. Configurez le traceur physique avec ce Host/Port (via commande SMS, app du fabricant,
   ou outil de configuration du modèle — **vérifiez la syntaxe SMS exacte dans le manuel
   du modèle acheté**, elle varie beaucoup d'un clone à l'autre même au sein du protocole GT06).
4. Vérifiez dans l'admin Traccar que le device passe **online** et reçoit des positions
   (onglet du device). **Ne liez le device dans DelivTrack qu'ensuite** (étape 6).
5. Notez le **deviceId numérique** (généré par Traccar à la création — indépendant du
   protocole et de l'IMEI, donc stable quel que soit le modèle).
6. Liez dans DelivTrack : UI admin → Véhicules → éditer → « ID device Traccar »,
   ou `POST /tracking/vehicles/:vehicleId/link-traccar { "traccarDeviceId": "42" }`.
7. Vérifiez la position live sur la carte temps réel.

> ⚠️ Les ports 5055-5065 sont les mêmes en dev et en prod ici (auto-hébergé) — ce
> n'est QUE si vous migrez un jour vers un Traccar Cloud tiers que les ports
> deviendraient dynamiques/fournis par une interface. Ce n'est pas le cas aujourd'hui.

### 6.2 Auto-hébergé (dev local / VPS DigitalOcean) — `traccar/traccar.xml`

Uniquement si vous hébergez vous-même Traccar (développement local ou VPS).

1. **Activer le protocole** : ouvrez `delivery-tracking/traccar/traccar.xml` et ajoutez/modifiez :
   ```xml
   <entry key='<protocole>.port'>PORT</entry>
   ```
   Exemples (clés officielles Traccar, une par protocole) :
   `gt06.port` 5055 · `teltonika.port` 5056 · `h02.port` 5057 · `tk103.port` 5058 ·
   `meitrack.port` 5059 · `osmand.port` 5060 · `l100.port` 5061 · `wristwatch.port` 5062 ·
   `navtelecom.port` 5063 · `xexun.port` 5064 · `ast.port` 5065.
   La liste complète des clés par protocole : `https://www.traccar.org/protocols/`
   (chaque page de protocole indique sa clé `<name>.port` et le port par défaut).
2. **Mapper le port** (Docker) : ajoutez le port dans `docker-compose.yml` (service traccar,
   section `ports`) : `- "PORT:PORT"`.
3. **Ouvrir le port sur le firewall du VPS** :
   ```bash
   sudo ufw allow PORT/tcp
   ```
   **Et** dans le panel DigitalOcean : **Networking → Firewall → Inbound Rules →
   Custom → TCP → PORT → Apply** (ne pas oublier — le firewall DigitalOcean bloque
   avant ufw).
4. **Redémarrer Traccar** : `docker restart traccar` (ou `systemctl restart traccar`).
5. **Vérifier que le port écoute** :
   ```bash
   ss -tlnp | grep PORT
   nc -zv localhost PORT
   ```
6. Créez le device (étape 6.1) puis liez-le dans DelivTrack.

### 6.3 Vérifications AVANT de lier un nouveau device dans DelivTrack

1. Le device existe côté Traccar : `GET <TRACCAR_URL>/api/devices` (session auth requise).
2. Le device a reçu **au moins une position** :
   `GET <TRACCAR_URL>/api/positions?deviceId=<id>` ne doit pas être vide.
   → Si vide, le traceur ne se connecte pas encore : voir 6.4, ne liez PAS dans DelivTrack.
3. Le `deviceId` numérique Traccar est bien celui saisi dans `Vehicle.traccarDeviceId`
   (STRING en base — le matching dans le bridge utilise `String(pos.deviceId)`, jamais
   l'IMEI/uniqueId : indépendant du protocole et de la marque).

### 6.4 Device créé mais AUCUNE position — causes probables (par ordre de fréquence)

1. **Protocole/port non activé** côté Traccar (le plus fréquent sur auto-hébergé) → 6.2.
   En prod (auto-hébergé), le port est fixe dans `traccar/traccar.xml` — vérifiez qu'il
   correspond à celui configuré dans le traceur, pas besoin de le chercher dans une UI.
2. **SIM inactive / APN incorrect / pas de crédit** (protocoles GSM) — la carte SIM doit
   être active et l'APN du pays configuré dans le traceur.
3. **Firewall** (VPS auto-hébergé : ufw + firewall DigitalOcean) ou **port mal configuré**
   dans le traceur.
4. **Mauvais identifiant du device** : l'IMEI saisi dans Traccar ne correspond pas à celui
   du traceur (ou l'uniqueId n'est pas celui que le traceur envoie).

La notification DelivTrack **« Traceur physique : jamais connecté »** (émise ~30 min après
la création d'un device lié, si aucune position n'arrive) liste exactement ces 4 causes.
Le diagnostic avancé `GET /tracking/traccar-devices` (rapport `TraccarDiagnoseReport`)
montre la configuration, l'authentification et les devices exposés par l'API Traccar.

### 6.5 Robustesse du pont — ce qui est déjà géré pour TOUT modèle de traceur

| Cas (traceur inhabituel) | Comportement du pont |
|---|---|
| `speed` en nœuds (tous protocoles, confirmé doc Traccar `Position.java`) | converti `× 0.514444` → m/s |
| `valid` absent (`undefined`) | traité comme fix GPS valide (seul `valid=false` explicite LBS est rejeté) |
| `accuracy` absente + `hdop` absent | repli 50 m, position conservée |
| `hdop` aberrant (> 50, valeur non standard) | ignoré (repli accuracy device) |
| `accuracy` > 1000 m | clampée à 1000 m — jamais rejetée par la validation DTO |
| horloge traceur EN AVANCE (> 5 min) | fixTime recadré sur l'heure serveur (position conservée) |
| horloge traceur illisible / absente | repli heure serveur |
| rafale de positions (Teltonika) | aucune perte ni throttling (traitement séquentiel) |
| deviceId non numérique | `String(deviceId)` — stocké STRING, matching stable |

### 6.6 Télémétrie matériel du traceur (power / battery) — diagnostic des silences

Le pont DelivTrack lit, quand le traceur les remonte, les champs `power` et `battery`
de l'objet Position normalisé de Traccar et les **stocke** (JSONB `attributes` de
`gps_positions`). Ils servent à **classer la cause probable d'un silence GPS** au lieu
de laisser le développeur deviner :

| Valeur stockée | Interprétation | Ce qu'elle déclenche |
|---|---|---|
| `power ≤ 0.5 V` | Coupure électrique du véhicule (moteur coupé longtemps, batterie déconnectée/volée) — le traceur fonctionne sur sa batterie interne | Alerte **critical** temps réel + cause « Coupure électrique » dans le dashboard silences |
| `battery ≤ 20 %` | Batterie interne du traceur critique — il va cesser d'émettre | Alerte **high** temps réel + cause « Batterie interne critique » dans le dashboard |
| power/battery **absents** | Modèle bas de gamme qui ne remonte pas cette télémétrie | Cause « Télémétrie non remontée par ce modèle » — **limite du matériel**, pas un bug DelivTrack |
| power normal, silence brutal | Panne SIM/matériel ou zone sans réseau | Cause « Panne SIM/matériel ou zone sans réseau » |

⚠️ **À vérifier pour CHAQUE nouveau modèle de traceur acheté** : le champ `power`/`battery`
dans la fiche produit. Teltonika et la plupart des GT06 4G remontent `power` (volts) et
`battery` (pourcentage). Certains modèles bas de gamme ne les remontent **pas du tout** —
dans ce cas, la cause du silence reste non documentée (le dashboard le signale
explicitement). Ne promettez jamais à un client une « détection de coupure » sur un
modèle sans ce champ.

> Unités gérées de façon protocolo-agnostique : `power` interprété en millivolts si
> > 50 (÷1000), en volts sinon ; `battery` en pourcentage (0-100) si ≤ 100, en tension
> interne (mV, plage 3.0-4.2V → %) sinon. Vérifiez quand même le format réel de votre
> modèle la première fois (position → dashboard → colonne « Cause probable »).

### 6.7 Supervision du process Traccar (prod Contabo ET dev)

⚠️ Contrairement à ce que cette section disait auparavant : la prod DelivTrack
**est** un Traccar auto-hébergé (Contabo), donc cette section s'applique
**directement à la prod**, pas seulement au dev. Le process Traccar DOIT être
relancé automatiquement en cas de crash — un process mort sans relance =
traceurs muets sans aucune alerte.

- **Docker** : `docker-compose.contabo.yml` → `restart: unless-stopped` (déjà configuré) —
  Docker relance le conteneur après un crash/reboot du VPS.
- **systemd** (service natif, sans Docker) :
  ```ini
  [Unit]
  Description=Traccar GPS Server
  After=network.target postgresql.service

  [Service]
  ExecStart=/opt/traccar/bin/traccar start
  Restart=always
  RestartSec=10
  User=traccar

  [Install]
  WantedBy=multi-user.target
  ```
  `Restart=always` + `RestartSec=10` : relance automatique 10 s après tout crash, sans
  limite de tentatives. Vérifier ensuite : `systemctl enable traccar && systemctl status traccar`.

Côté DelivTrack, une **panne du process Traccar lui-même** (pas seulement une
déconnexion websocket du bridge) est détectée et alertée : le pont ping
`GET /api/server` de Traccar toutes les 5 minutes ; si la réponse échoue, il force une
reconnexion propre (nouvelle session + backfill). Si Traccar reste injoignable plus de
15 min, une alerte **critical** part au dashboard (« Pont Traccar hors ligne prolongé »).

## 7. Sécurité

### 7.1 Isolation multi-tenant

Un même `traccarDeviceId` ne peut pas être associé à deux véhicules de deux entreprises différentes. **3 mécanismes :**

1. **Contrainte DB** : `@unique` sur `Vehicle.traccarDeviceId`
2. **Contrainte applicative** : `checkTraccarDeviceIdUniqueness()` dans `vehicles.service.ts`
3. **Contrainte pont** : `linkVehicleToTraccar()` dans `tracking.service.ts`

Testé : `traccar-multitenant.spec.ts` + preuve DB réelle (`duplicate key value violates unique constraint`).

### 7.2 Transport

- La connexion entre le backend et Traccar passe par le réseau Docker **interne**
  (`http://traccar:8082`), jamais par Internet — pas de HTTPS à gérer pour cette liaison.
- `TRACCAR_USER`/`TRACCAR_PASSWORD` sont dans le `.env` du VPS Contabo (pas versionnés).
  Le défaut du compose (`admin`/`admin` si la variable est absente) est dangereux —
  toujours vérifier qu'une vraie valeur est définie dans le `.env` en prod.

### 7.3 Tests d'intégration Traccar — base de TEST dédiée

`traccar-alert-chain.spec.ts` et `traccar-postgis.spec.ts` vérifient des propriétés réelles
utiles (cohérence PostGIS `ST_MakePoint`/`ST_DWithin`, chaîne position Traccar → alerte).
Ils font des **INSERT/DELETE réels** et doivent donc tourner contre une base Postgres de
**test** avec PostGIS — jamais la production.

- La chaîne de connexion est lue depuis `TRACCAR_TEST_DATABASE_URL` (jamais en dur).
- Sans cette variable, les deux suites sont **SKIP proprement** (aucun échec CI, aucune
  connexion accidentelle).
- Un garde-fou refuse de s'exécuter si le nom de la base ne contient ni `test` ni `staging`.
- Base de test locale : `postgis/postgis:16-3.4` (voir `docker-compose.yml` et le job
  `backend-e2e-tests` de `.github/workflows/ci.yml`).

```bash
TRACCAR_TEST_DATABASE_URL="postgresql://test:test@localhost:5432/delivery_tracking_test" npx jest traccar-alert-chain traccar-postgis
```

> ⚠️ Ne jamais committer de chaîne de connexion (même de test) dans le code : uniquement
> en variable d'environnement / secret CI. `.env.example` contient un placeholder vide.

---

## 8. Dépannage

| Problème | Cause possible | Solution |
|---|---|---|
| `connected: false` | TRACCAR_URL incorrect ou conteneur `traccar` down | `docker compose -f docker-compose.contabo.yml exec backend curl http://traccar:8082/api/server` |
| `reconnectAttempts` augmente | Session refusée (HTTP 415) | Vérifiez que le bridge utilise `application/x-www-form-urlencoded` |
| Aucune position reçue | Device non créé dans Traccar, ou traceur mal configuré | Créez le device via le tunnel SSH → interface admin ; voir 6.4 |
| `hasSession: false` | Conteneur `traccar` down ou réseau Docker cassé | `docker compose -f docker-compose.contabo.yml ps traccar` et logs |
| Notification "Pont Traccar non configuré" | `TRACCAR_URL` non défini dans le `.env` du VPS | Vérifiez `/opt/delivery-tracking/.env` sur le VPS |
