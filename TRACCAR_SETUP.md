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
│  │  VPS      │   │                         │  POST /tracking/...  │
│  │  Traccar  │   │                         │  └→ savePosition()  │
│  │  Server   │   │                         └──────────────────────┘
│  │  :5055-58 │   │
│  │  :8082    │   │
│  └──────────┘   │
└─────────────────┘
```

**Principe :** Render expose uniquement des ports HTTP(S) vers l'Internet. Les protocoles GPS binaires (GT06 sur TCP 5055, Teltonika sur TCP 5056, etc.) nécessitent du TCP brut, que Render ne supporte pas pour les web services. La solution est donc **un VPS dédié** qui héberge Traccar et reçoit les connexions des traceurs. Le `TraccarBridgeService` sur Render se connecte **en outbound** (HTTP/WebSocket) vers ce VPS pour récupérer les positions et les injecter dans `savePosition()`.

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
      - "5055:5055"   # GT06
      - "5056:5056"   # Teltonika
      - "5057:5057"   # H02
      - "5058:5058"   # TK103
      - "8082:8082"   # Interface web + API REST
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

1. Accédez à `http://<IP_DU_VPS>:8082`
2. Créez un compte administrateur
3. Allez dans **Configuration → Defaults** et paramétrez :
   - `deviceManager.updateDevicesState`: `true`
   - `event.ignoreDuplicatePositions`: `true` (la déduplication est déjà gérée par DelivTrack)
4. Créez des **devices** dans Traccar avec les IMEI des traceurs physiques
5. Associez chaque device à un **driver** :
   - Notez le `deviceId` Traccar (entier) — il servira pour `Vehicle.traccarDeviceId` dans DelivTrack

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

- **Ne pas exposer** le port 8082 du VPS à tout Internet — limitez par pare-feu aux IPs Render et à votre bureau.
- Render ne peut pas garantir une IP fixe de sortie. Utilisez l'authentification REST de Traccar (session cookie) comme mécanisme de sécurité.
- Activez HTTPS sur le VPS (Caddy reverse proxy) si vous accédez à l'interface Traccar depuis le web.

---

## 8. Dépannage

| Problème | Cause possible | Solution |
|---|---|---|
| `connected: false` | TRACCAR_URL incorrect ou VPS injoignable | Vérifiez que le VPS répond : `curl http://<IP>:8082/api/server` |
| `reconnectAttempts` augmente | Session Traccar refusée | Vérifiez TRACCAR_USER / TRACCAR_PASSWORD |
| Aucune position reçue | Les traceurs ne sont pas configurés dans Traccar | Créez les devices dans l'interface Traccar |
| `hasSession: false` | Traccar ne répond plus | Redémarrez Traccar sur le VPS |
| Notification "Pont Traccar non configuré" | TRACCAR_URL non défini dans Render | Configurez la variable dans le Dashboard |
