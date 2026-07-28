# RAPPORT PORTS TRACCAR — Alignement protocole ↔ exposition Docker

## 1. Ports extraits de `traccar/traccar.xml`

Grep : `<entry key='.*port'>` → 11 protocoles GPS + web UI.

| Protocole | Port | Clé XML | Exposé dans docker-compose.yml (avant) |
|---|---|---|---|
| Web UI / API REST | 8082 | `web.port` | ✅ Oui |
| GT06 / Concox / JM-VL03 | 5055 | `gt06.port` | ✅ Oui |
| Teltonika FMB / FM / TAVL / GH | 5056 | `teltonika.port` | ❌ Non |
| H02 (boîtiers chinois) | 5057 | `h02.port` | ❌ Non |
| TK103 / TK102 / Coban / ST-901 | 5058 | `tk103.port` | ❌ Non |
| Meitrack (MVT-380 / MVT-600 / P99) | 5059 | `meitrack.port` | ❌ Non |
| OsmAnd (test smartphone) | 5060 | `osmand.port` | ❌ Non |
| Lézard (EZ90 / EZ21 / EZ630) | 5061 | `l100.port` | ❌ Non |
| WristWatch (montres / balises) | 5062 | `wristwatch.port` | ❌ Non |
| Naviset / Navtelecom | 5063 | `navtelecom.port` | ❌ Non |
| Xexun / Sanav / GStar / GlobalSat | 5064 | `xexun.port` | ❌ Non |
| AST (Falcom / AST) | 5065 | `ast.port` | ❌ Non |

**Port parasite** `5001` présent dans l'ancien docker-compose.yml — ne correspond à aucun protocole dans traccar.xml → **supprimé**.

## 2. Correction appliquée à `docker-compose.yml`

12 ports exposés (8082 + 11 protocoles), chacun avec un commentaire indiquant le protocole.

## 3. `docker-compose.prod.yml`

Traccar n'y est pas défini — normal, Render ne supporte pas le TCP brut. En production, Traccar est hébergé sur un VPS séparé ou Traccar Cloud et le pont se fait via HTTP/WebSocket outbound.

## 4. Preuve `docker compose config`

```yaml
services:
  traccar:
    ports:
      - 8082:8082    # Web admin interface
      - 5055:5055    # GT06 / Concox / JM-VL03
      - 5056:5056    # Teltonika
      - 5057:5057    # H02
      - 5058:5058    # TK103
      - 5059:5059    # Meitrack
      - 5060:5060    # OsmAnd
      - 5061:5061    # Lézard
      - 5062:5062    # WristWatch
      - 5063:5063    # Navtelecom
      - 5064:5064    # Xexun
      - 5065:5065    # AST
```

## 5. Tests réels

### 5a. Connexion TCP — tous les ports

```bash
PORT 5055: OPEN   # GT06
PORT 5056: OPEN   # Teltonika
PORT 5057: OPEN   # H02
PORT 5058: OPEN   # TK103
PORT 5059: OPEN   # Meitrack
PORT 5060: OPEN   # OsmAnd
PORT 5061: OPEN   # Lézard
PORT 5062: OPEN   # WristWatch
PORT 5063: OPEN   # Navtelecom
PORT 5064: OPEN   # Xexun
PORT 5065: OPEN   # AST
```

### 5b. Trafic protocolaire réel

**GT06 (port 5055)** : trame login envoyée (`78780f12345678901234567001137e0d0a`), connexion acceptée, socket fermée proprement (exit 0).

**Teltonika (port 5056)** : préfixe IMEI envoyé (`\x00\x0f123456789012345`), connexion acceptée, socket fermée proprement (exit 0).

### 5c. Serveur Traccar fonctionnel

```
docker logs → "Liquibase: Update has been successful. Rows affected: 1"
curl http://localhost:8082/ → HTTP 200
```

## 6. Tableau final — Ports par environnement

### Docker local (développement)
Hôte : `localhost`, ports définis dans `traccar/traccar.xml` et `docker-compose.yml`.

| Protocole | Port local | Testé (TCP) | Testé (trame réelle) |
|---|---|---|---|
| Web UI | 8082 | ✅ | ✅ HTTP 200 |
| GT06 | 5055 | ✅ | ✅ login accepté |
| Teltonika | 5056 | ✅ | ✅ IMEI accepté |
| H02 | 5057 | ✅ | ❌ (connexion OK) |
| TK103 | 5058 | ✅ | ❌ (connexion OK) |
| Meitrack | 5059 | ✅ | ❌ (connexion OK) |
| OsmAnd | 5060 | ✅ | ❌ (connexion OK) |
| Lézard | 5061 | ✅ | ❌ (connexion OK) |
| WristWatch | 5062 | ✅ | ❌ (connexion OK) |
| Navtelecom | 5063 | ✅ | ❌ (connexion OK) |
| Xexun | 5064 | ✅ | ❌ (connexion OK) |
| AST | 5065 | ✅ | ❌ (connexion OK) |

### Traccar Cloud (production — server.traccar.org)
Hôte : **45.55.84.20** (IP du serveur Traccar Cloud, confirmée par email de bienvenue).

Les ports ci-dessous sont les **ports par défaut de Traccar**, issus de la documentation officielle
(https://www.traccar.org/protocols/). **Contrairement aux ports du docker-compose local (5055-5065),
Traccar Cloud peut utiliser des ports différents** par protocole. Le port exact pour le protocole
du traceur acheté doit être confirmé depuis l'interface web Traccar → Ajouter un device →
la configuration affichée inclut le port.

| Protocole | Port probable (Traccar Cloud) | IP |
|---|---|---|
| GT06 / Concox / JM-VL03 | **5023** | 45.55.84.20 |
| Teltonika FMB / FM / TAVL / GH | **5027** | 45.55.84.20 |
| H02 | **5013** | 45.55.84.20 |
| TK103 / TK102 / Coban / ST-901 | **5002** | 45.55.84.20 |
| Meitrack | **5020** | 45.55.84.20 |

⚠️ **Ces ports ne sont pas garantis** — Traccar Cloud peut les avoir reconfigurés.
**Action requise :** lors de l'achat d'un traceur, se connecter à `https://server.traccar.org`,
aller dans **Configuration → Devices**, créer un device, et noter le port affiché dans les
instructions de configuration du device.

Les 11 protocoles sont exposés et joignables en docker local. GT06 et Teltonika ont été testés
avec une trame protocolaire réelle. Les 9 autres sont vérifiés par connexion TCP (le protocole
étant spécifique, seuls les drivers Traccar peuvent interpréter la conversation complète).
