# Traccar GPS Tracker Integration — Setup Guide

## Architecture

```
Traceur physique (GT06/Teltonika/TK103/...) ──TCP 5055-5065──▶ Traccar Server ──WebSocket──▶ TraccarBridgeService ──▶ Pipeline DelivTrack
                                                                                                                         │
Téléphone chauffeur (GPS) ────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Le pipeline DelivTrack (Kalman, déduplication, stockage, WebSocket, alertes, carte) est PARTAGÉ entre les deux sources.

---

## 1. Protocoles activés

| Protocole | Port | Modèles compatibles |
|-----------|------|---------------------|
| GT06/Concox | 5055 | GT06, GT02, GT02D, GT03, GT06N, Concox, JM-VL01/02/03 |
| Teltonika | 5056 | FMB001/010/020/100/120/140/200/900/920/930/950/960/962/964/966 |
| H02 | 5057 | H02, EELINK, génériques chinois |
| TK103/Coban | 5058 | TK103, TK102, Coban, ST-901/904 |
| Meitrack | 5059 | MVT-380, MVT-600, T1, P99, P88 |
| OsmAnd | 5060 | App OsmAnd (test/démo) |
| Lézard (L100) | 5061 | EZ90, EZ21, EZ630, Delta |
| Gator/Watch | 5062 | Montres GPS, balises |
| Navtelecom | 5063 | Naviset, Navtelecom |
| Xexun | 5064 | Xexun, Sanav, GStar, GlobalSat |
| AST/Falcom | 5065 | AST, Falcom |

**Protocoles testés via simulateur binaire :** GT06 ✅, Teltonika Codec 8 ✅

---

## 2. Déploiement Traccar (Local Dev)

```bash
docker compose up -d traccar
```

- **Interface web** : http://localhost:8082
- **Login** : admin / admin
- **Ports TCP** : 5055-5065

---

## 3. Déploiement Traccar (Production)

### Option A — VPS séparé (recommandé)

```bash
docker run -d --name traccar \
  -p 8082:8082 \
  -p 5055:5055 -p 5056:5056 -p 5057:5057 -p 5058:5058 \
  -p 5059:5059 -p 5060:5060 -p 5061:5061 -p 5062:5062 \
  -p 5063:5063 -p 5064:5064 -p 5065:5065 \
  -v /opt/traccar/data:/opt/traccar/data \
  -v /opt/traccar/traccar.xml:/opt/traccar/conf/traccar.xml:ro \
  --restart unless-stopped \
  traccar/traccar:latest
```

> ⚠️ Vérifier que le firewall du VPS ouvre bien les ports 5055-5065 en TCP.

### Option B — Render (limité)

Render ne supporte que les ports HTTP (80/443). Les ports TCP personnalisés ne sont pas disponibles sur Render. Traccar ne peut PAS être hébergé sur Render.

---

## 4. Configuration DelivTrack

### Variables d'environnement

```bash
TRACCAR_URL=http://traccar:8082
TRACCAR_USER=admin
TRACCAR_PASSWORD=change-me
```

Si `TRACCAR_URL` n'est pas défini ou vaut `disabled`, le pont Traccar reste inactif.

### Model Vehicle

```prisma
positionSource    String  @default("phone")   // "phone" | "physical_tracker"
traccarDeviceId   String?                     // ID du device dans Traccar
```

---

## 5. Ajouter un traceur dans Traccar

1. Interface web Traccar : http://[serveur]:8082
2. Login (admin / mot de passe configuré)
3. Menu : **Devices** → **Add**
4. **Name** : nom du véhicule
5. **Unique ID** : IMEI du traceur (15 chiffres)
6. **Protocol** : laisser vide (auto-détection)
7. Configurer le traceur physique (voir TRACCAR_ACHAT_NOUVEAU_TRACEUR.md)

---

## 6. Lier un device Traccar à un véhicule DelivTrack

Via l'interface admin DelivTrack → **Véhicules** → éditer un véhicule :

1. Changer `positionSource` en `physical_tracker`
2. Sélectionner le device Traccar dans la liste déroulante (ou saisir son ID manuellement)
3. Cliquer **Tester la connexion** pour vérifier
4. Sauvegarder

---

## 7. Fonctionnalités avancées

### Surveillance automatique

- **Health check REST** : Interroge `GET /api/server` toutes les 5 minutes (indépendant du WebSocket)
- **Alerte "jamais connecté"** : Si un device physique n'envoie aucune position dans les 30 minutes suivant sa création
- **Alerte device silencieux** : Si un device qui envoyait des positions s'arrête (seuil configurable)
- **File d'attente Redis** : Positions en attente pendant une coupure (rétention 1h, limite 1000)
- **Backfill automatique** : Rattrapage des positions manquées à la reconnexion (max 24h)

### File d'attente en cas de coupure

| Source | File | Capacité | Rétention |
|--------|------|----------|-----------|
| Téléphone (IndexedDB) | IndexedDB | 500 positions | Jusqu'au flush |
| Traceur (Redis) | Redis `traccar:pending-positions` | 1000 positions | 1 heure |

---

## 8. Coûts estimés

| Élément | Coût mensuel |
|---------|-------------|
| Traceur GPS physique | ~15-50€ (achat unique) |
| Carte SIM data (traceur) | ~1-5€/mois |
| Données (traceur) | ~50-200 MB/mois |
| VPS Traccar | ~5€/mois |
| **Total récurrent** | **~6-10€/mois/véhicule** |

---

## 9. Sécurité

- Changer le mot de passe admin Traccar en production
- Restreindre l'accès au port 8082 (interface web) avec un firewall / VPN
- Le pont Traccar utilise l'authentification REST (session cookie renouvelé toutes les 30 min)
- Les positions Traccar passent par les mêmes vérifications de sécurité que les positions téléphone (company scope, anti-replay, anti-téléportation)
