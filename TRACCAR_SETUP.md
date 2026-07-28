# Déploiement du pont Traccar — DelivTrack

## Architecture

```
┌─────────────────┐     HTTPS/WebSocket     ┌──────────────────────┐
│  GPS Trackers   │     (outbound)          │  Render Web Service  │
│  (GT06, Teltonika,│──────────────────────▶│  deliverytrack-api   │
│   TK103, H02)   │     (via Traccar)      │                      │
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

**Production :** DelivTrack utilise **Traccar Cloud** (`server.traccar.org`). Traccar Cloud reçoit les connexions TCP des traceurs GPS (GT06, Teltonika, etc.) via ses propres ports. Le `TraccarBridgeService` sur Render se connecte **en outbound** (HTTPS/WebSocket) vers Traccar Cloud pour récupérer les positions et les injecter dans `savePosition()`.

**Les ports des traceurs ne sont pas documentés ici** — ils sont fournis par Traccar Cloud lors de la création du device dans l'interface web (`https://server.traccar.org`). Voir section 2 pour la procédure.

---

> ⚠️ **Note importante :** Les sections 1 et 3 ci-dessous (VPS, Docker, ports 5055-5065) concernent uniquement un environnement **Traccar auto-hébergé pour le développement local**. La production utilise exclusivement Traccar Cloud. Les ports du docker-compose local (5055-5065) ne correspondent PAS aux ports de Traccar Cloud.

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

⚠️ **Les ports 5055-5065 ci-dessus sont ceux du docker-compose local uniquement. Ils ne sont pas utilisés en production.** Traccar Cloud a ses propres ports, différents pour chaque protocole.

---

## 2. Configurer Traccar Cloud (production)

1. Connectez-vous à `https://server.traccar.org`
2. Allez dans **Configuration → Defaults** et paramétrez :
   - `deviceManager.updateDevicesState`: `true`
   - `event.ignoreDuplicatePositions`: `true`
3. Créez un **device** avec l'IMEI du traceur physique.
   - **Host** : `45.55.84.20`
   - **Port** : fourni par l'interface au moment de la création du device
   - Configurez le traceur avec ce host et ce port (pas les ports 5055-5065)
4. Notez le `deviceId` Traccar (entier) — il servira pour `Vehicle.traccarDeviceId` dans DelivTrack
5. Associez le device à un véhicule : `POST /tracking/vehicles/:vehicleId/link-traccar`

---

## 3. Connecter DelivTrack (Render) à Traccar Cloud

### Dans Render Dashboard

| Variable | Valeur | Commentaire |
|---|---|---|
| `TRACCAR_URL` | `https://server.traccar.org` | URL HTTPS de Traccar Cloud |
| `TRACCAR_USER` | email du compte Traccar Cloud | |
| `TRACCAR_PASSWORD` | mot de passe du compte Traccar Cloud | |

Ces variables sont déclarées dans `render.yaml`. `TRACCAR_URL` est versionnée ; `TRACCAR_USER` et `TRACCAR_PASSWORD` sont en `sync: false` — à saisir dans le Dashboard Render → `deliverytrack-api` → **Environment**.

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

## 6. Sécurité

### 6.1 Isolation multi-tenant

Un même `traccarDeviceId` ne peut pas être associé à deux véhicules de deux entreprises différentes. **3 mécanismes :**

1. **Contrainte DB** : `@unique` sur `Vehicle.traccarDeviceId`
2. **Contrainte applicative** : `checkTraccarDeviceIdUniqueness()` dans `vehicles.service.ts`
3. **Contrainte pont** : `linkVehicleToTraccar()` dans `tracking.service.ts`

Testé : `traccar-multitenant.spec.ts` + preuve DB réelle (`duplicate key value violates unique constraint`).

### 6.2 Transport

- La connexion entre Render et Traccar Cloud passe par HTTPS public.
- Les mots de passe Traccar sont en `sync: false` dans `render.yaml`.

---

## 7. Dépannage

| Problème | Cause possible | Solution |
|---|---|---|
| `connected: false` | TRACCAR_URL incorrect ou indisponible | Vérifiez `curl https://server.traccar.org/api/server` |
| `reconnectAttempts` augmente | Session refusée (HTTP 415) | Vérifiez que le bridge utilise `application/x-www-form-urlencoded` |
| Aucune position reçue | Device non configuré dans Traccar Cloud | Créez le device dans l'interface Traccar |
| `hasSession: false` | Traccar Cloud inaccessible | Vérifiez l'état du service Traccar Cloud |
| Notification "Pont Traccar non configuré" | TRACCAR_URL non défini | Configurez les variables dans le Dashboard Render |
