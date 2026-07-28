# Déploiement du pont Traccar — DelivTrack

## Architecture

```
┌─────────────────┐     HTTP/WebSocket      ┌──────────────────────┐
│  GPS Trackers   │     (outbound)          │  Render Web Service  │
│  (GT06, Teltonika,│──────────────────────▶│  deliverytrack-api   │
│   TK103, H02)   │                         │                      │
│        │        │                         │  TraccarBridgeService│
│        ▼        │                         │  (WebSocket client)  │
│  ┌──────────┐   │                         │                      │
│  │  Traccar  │   │                         │  POST /tracking/...  │
│  │  Cloud    │   │                         │  └→ savePosition()  │
│  │  (HTTPS)  │   │                         └──────────────────────┘
│  │  :443     │   │
│  │  API REST │   │
│  └──────────┘   │
└─────────────────┘
```

**Principe :** Render expose uniquement des ports HTTP(S) vers l'Internet. Les protocoles GPS binaires nécessitent du TCP brut, que Render ne supporte pas. En production, DelivTrack utilise **Traccar Cloud** (`server.traccar.org`) — Traccar s'occupe de la réception des trames TCP des traceurs. Le `TraccarBridgeService` sur Render se connecte **en outbound** (HTTPS/WebSocket) vers Traccar Cloud pour récupérer les positions et les injecter dans `savePosition()`.

**Important :** Les ports des traceurs (pour configurer le matériel) sont fournis par Traccar Cloud lors de la création du device dans l'interface web. Ils ne sont PAS les ports 5055-5065 du docker-compose local (qui ne sert qu'au développement). Voir section 3 pour la procédure.

---

## 1. Provisionner un VPS

### Configuration minimale recommandée

| Fournisseur | Type | Prix indicatif |
|---|---|---|
| Hetzner CX22 | 2 vCPU, 4 GB RAM | ~4 €/mois |
| DigitalOcean Basic | 1 vCPU, 1 GB RAM | ~6 $/mois |
| Scaleway DEV1-S | 2 vCPU, 2 GB RAM | ~4 €/mois |

### Prérequis

- OS : Ubuntu 22.04 ou 24.04 (LTS)
- Docker et Docker Compose installés
- Ports 5055-5058 (TCP) ouverts dans le pare-feu du VPS
- Ports 8082 (TCP, interface web Traccar) accessible depuis Render UNIQUEMENT
  (ou restreint à l'IP de votre bureau pour l'admin)

---

## 2. Installer Traccar avec Docker

Créez un fichier `docker-compose.yml` sur le VPS :

```yaml
version: '3.8'
services:
  traccar:
    image: traccar/traccar:latest
    container_name: traccar
    restart: unless-stopped
    ports:
      - "8082:8082"   # Interface web + API REST
      - "5055:5055"   # GT06 / Concox / JM-VL03
      - "5056:5056"   # Teltonika FMB / FM / TAVL / GH
      - "5057:5057"   # H02 (boîtiers chinois économiques)
      - "5058:5058"   # TK103 / TK102 / Coban / ST-901
      - "5059:5059"   # Meitrack (MVT-380 / MVT-600 / T1 / P99)
      - "5060:5060"   # OsmAnd (test smartphone)
      - "5061:5061"   # Lézard (EZ90 / EZ21 / EZ630 / Delta)
      - "5062:5062"   # WristWatch (montres / balises GPS)
      - "5063:5063"   # Naviset / Navtelecom
      - "5064:5064"   # Xexun / Sanav / GStar / GlobalSat
      - "5065:5065"   # AST (Falcom / AST)
    volumes:
      - traccar_data:/opt/traccar/data
      - ./traccar.xml:/opt/traccar/conf/traccar.xml:ro

volumes:
  traccar_data:
```

### Configuration Traccar (`traccar.xml`)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE properties SYSTEM "http://java.sun.com/dtd/properties.dtd">
<properties>
  <entry key="config.default">/opt/traccar/conf/default.xml</entry>

  <!-- Web interface + API -->
  <entry key="web.port">8082</entry>
  <entry key="web.address">0.0.0.0</entry>

  <!-- Database (fichier H2 local, pas besoin de PostgreSQL externe) -->
  <entry key="database.driver">org.h2.Driver</entry>
  <entry key="database.url">jdbc:h2:/opt/traccar/data/database</entry>
  <entry key="database.user">sa</entry>
  <entry key="database.password"></entry>

  <!-- Protocoles GPS supportés -->
  <entry key="gt06.port">5055</entry>
  <entry key="teltonika.port">5056</entry>
  <entry key="h02.port">5057</entry>
  <entry key="t103.port">5058</entry>

  <!-- Médiatrice (permet le mode "headless" sans interface) -->
  <entry key="media.enable">false</entry>
</properties>
```

### Démarrer

```bash
docker compose up -d
docker compose logs -f   # Vérifier que les ports TCP sont en écoute
```

Vérifiez que Traccar écoute bien :

```bash
ss -tlnp | grep -E '5055|5056|5057|5058|8082'
```

---

## 3. Configurer Traccar

1. Connectez-vous à `https://server.traccar.org` (Traccar Cloud)
2. Allez dans **Configuration → Defaults** et paramétrez :
   - `deviceManager.updateDevicesState`: `true`
   - `event.ignoreDuplicatePositions`: `true` (la déduplication est déjà gérée par DelivTrack)
3. Créez un **device** avec l'IMEI du traceur physique.
   **⚠️ Au moment de la création, l'interface affiche les informations de connexion du device :**
   - **Host** : `45.55.84.20` (IP du serveur Traccar Cloud)
   - **Port** : dépend du protocole. Exemples (ports par défaut Traccar) :
     | Protocole | Port par défaut |
     |---|---|
     | GT06 | 5023 |
     | Teltonika | 5027 |
     | H02 | 5013 |
     | TK103 | 5002 |
     | Meitrack | 5020 |
   - **Ces ports sont ceux à configurer sur le traceur** (pas les ports 5055-5065 du docker local).
4. Notez le `deviceId` Traccar (entier) — il servira pour `Vehicle.traccarDeviceId` dans DelivTrack
5. Associez chaque device à un véhicule via DelivTrack : `POST /tracking/vehicles/:vehicleId/link-traccar`

---

## 4. Connecter DelivTrack (Render) au VPS

### Dans Render Dashboard

| Variable | Valeur | Commentaire |
|---|---|---|
| `TRACCAR_URL` | `http://<IP_DU_VPS>:8082` | Ne pas utiliser HTTPS sauf si vous mettez un reverse proxy (Caddy/Nginx) devant Traccar |
| `TRACCAR_USER` | email admin Traccar | |
| `TRACCAR_PASSWORD` | mot de passe admin Traccar | |

Ces variables sont déclarées dans `render.yaml` avec `sync: false` — vous devez les saisir manuellement depuis le Dashboard Render → `deliverytrack-api` → **Environment**.

### Alternative : Render Blueprint

Si vous préférez versionner ces valeurs dans `render.yaml`, remplacez `sync: false` par des valeurs explicites, mais déconseillé pour les mots de passe.

---

## 5. Association véhicule ↔ device Traccar

Via l'API DelivTrack :

```bash
# Récupérer les devices disponibles depuis Traccar (ou les créer manuellement)
GET /vehicles/available-traccar-devices

# Associer un véhicule à un device Traccar
POST /tracking/vehicles/:vehicleId/link-traccar
Content-Type: application/json
{
  "traccarDeviceId": "42"
}
```

Ou depuis l'interface web DelivTrack (admin → Véhicules → éditer → "ID device Traccar").

---

## 6. Vérifier le fonctionnement

### Statut du pont

```bash
# Nécessite un jeton JWT admin
curl -H "Authorization: Bearer <token>" https://deliverytrack-api.onrender.com/tracking/traccar-devices
```

Réponse attendue :
```json
{
  "connected": true,
  "lastPositionReceivedAt": "2026-07-28T10:00:00.000Z",
  "reconnectAttempts": 0,
  "hasSession": true
}
```

### Test de réception de positions

```bash
curl -H "Authorization: Bearer <token>" \
  https://deliverytrack-api.onrender.com/tracking/traccar-devices/42/test
```

Réponses possibles : `{ "status": "receiving" }`, `{ "status": "stale" }`, `{ "status": "never_connected" }`.

### Dashboard Render

Le statut est également visible sur `/platform-admin/traccar/status` (admin).

---

## 7. Sécurité

### 7.1 Interface web Traccar (port 8082)

L'interface web Traccar donne accès à **TOUS les devices GPS de TOUS les clients** (un seul Traccar pour tout le parc). Elle ne doit **JAMAIS** être exposée directement sur Internet sans protection :

- **Option A (recommandée)** : ne pas ouvrir le port 8082 dans le pare-feu du VPS. L'administration se fait exclusivement via l'API DelivTrack (création des devices via l'interface admin de DelivTrack).
- **Option B** : restreindre le port 8082 aux IPs du bureau de l'équipe uniquement (pare-feu VPS).
- **Option C** : mettre l'interface Traccar derrière un reverse proxy (Caddy/Nginx) avec authentification HTTP + HTTPS et IP allowlist strict.

⚠️ L'API REST de Traccar sur le port 8082 nécessite une session utilisateur (`POST /api/session`). Si le port 8082 est exposé publiquement, les identifiants admin/admin deviennent une cible. **Toujours changer le mot de passe admin après la première connexion.**

### 7.2 Isolation multi-tenant DelivTrack

Un même `traccarDeviceId` ne peut pas être associé à deux véhicules de deux entreprises différentes — **vérifié par 3 mécanismes :**

1. **Contrainte base de données** : `@unique` sur `Vehicle.traccarDeviceId` (migration `add_traccar_device_id_unique`).
2. **Contrainte applicative** : `checkTraccarDeviceIdUniqueness()` dans `vehicles.service.ts` vérifie sur tous les tenants avant chaque liaison.
3. **Contrainte pont Traccar** : `linkVehicleToTraccar()` dans `tracking.service.ts` vérifie également l'unicité globale.

Test de preuve : `traccar-multitenant.spec.ts` confirme qu'une tentative de lier le même ID Traccar à deux véhicules de deux companyId différents échoue avec `ConflictException`.

### 7.3 Transport

- La connexion entre Render et Traccar (pont HTTP/WebSocket) passe par le réseau public. Si le VPS le permet, activez HTTPS (Caddy reverse proxy) sur le port 8082 et renseignez `TRACCAR_URL=https://...`.
- Les mots de passe Traccar sont stockés dans `render.yaml` (versionnés). En environnement sensible, utilisez `sync: false` et configurez-les via le Dashboard Render.

---

## 8. Dépannage

| Problème | Cause possible | Solution |
|---|---|---|
| `connected: false` | TRACCAR_URL incorrect ou VPS injoignable | Vérifiez que le VPS répond : `curl http://<IP>:8082/api/server` |
| `reconnectAttempts` augmente | Session Traccar refusée | Vérifiez TRACCAR_USER / TRACCAR_PASSWORD |
| Aucune position reçue | Les traceurs ne sont pas configurés dans Traccar | Créez les devices dans l'interface Traccar |
| `hasSession: false` | Traccar ne répond plus | Redémarrez Traccar sur le VPS |
| Notification "Pont Traccar non configuré" | TRACCAR_URL non défini dans Render | Configurez la variable dans le Dashboard |
