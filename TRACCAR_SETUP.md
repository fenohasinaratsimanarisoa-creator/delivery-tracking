# Traccar GPS Tracker Integration — Setup Guide

## Architecture

```
Traceur physique (GT06) ──TCP 5055──▶ Traccar Server ──WebSocket──▶ TraccarBridgeService ──▶ Pipeline DelivTrack
                                                                                                  │
Téléphone chauffeur (GPS) ─────────────────────────────────────────────────────────────────────────┘
```

Le pipeline DelivTrack (Kalman, déduplication, stockage, WebSocket, alertes, carte) est PARTAGÉ entre les deux sources. Traccar n'est qu'une source supplémentaire.

---

## 1. Déploiement Traccar (Local Dev)

```bash
docker compose up -d traccar
```

- **Interface web** : http://localhost:8082
- **Login** : admin / admin
- **Protocole GT06** : Port 5055

---

## 2. Déploiement Traccar (Production)

### Option A — VPS séparé (recommandé pour les ports TCP custom)

```bash
# Sur un VPS (Hetzner, DigitalOcean, etc.)
docker run -d --name traccar \
  -p 8082:8082 \
  -p 5055:5055 \
  -v /opt/traccar/data:/opt/traccar/data \
  -v /opt/traccar/traccar.xml:/opt/traccar/conf/traccar.xml:ro \
  --restart unless-stopped \
  traccar/traccar:latest
```

- Coût VPS : ~5€/mois (Hetzner CX22)

### Option B — Render (limité)

Render ne supporte que les ports HTTP (80/443). Les ports TCP custom (5055 pour GT06) ne sont pas disponibles sur Render. Traccar ne peut PAS être hébergé sur Render en production à cause de cette limitation.

---

## 3. Configuration DelivTrack

### Variables d'environnement

```bash
TRACCAR_URL=http://traccar:8082    # URL du serveur Traccar
```

Si `TRACCAR_URL` n'est pas défini ou vaut `disabled`, le pont Traccar reste inactif (pas d'erreur).

### Model Vehicle — Nouveaux champs

```prisma
positionSource    String  @default("phone")     // "phone" | "physical_tracker"
traccarDeviceId   String?                       // ID de l'appareil dans Traccar
```

### Utilisation

1. Créer un véhicule (ou éditer un existant)
2. Définir `positionSource = "physical_tracker"`
3. Renseigner `traccarDeviceId` = l'ID de l'appareil Traccar (visible dans l'interface Traccar > Devices)

---

## 4. Ajouter un traceur dans Traccar

1. Interface Traccar : http://[serveur]:8082
2. Login : admin / admin
3. Menu : Devices → Add
4. Renseigner :
   - **Name** : nom du véhicule
   - **Unique ID** : IMEI du traceur (ex: 123456789012345)
5. Configurer le traceur physique :
   - **IP/Port** : [IP du serveur Traccar]:5055
   - **Protocole** : GT06
   - **Intervalle d'envoi** : 10-30 secondes

---

## 5. Coûts estimés

| Élément | Coût mensuel |
|---------|-------------|
| Traceur GPS physique | ~30-50€ (achat unique) |
| Carte SIM data (traceur) | ~2-5€/mois |
| Données (traceur) | ~50-200 MB/mois |
| VPS Traccar | ~5€/mois |
| **Total récurrent** | **~7-10€/mois/véhicule** |

---

## 6. Comportement en coupure

| Scénario | Comportement |
|----------|-------------|
| Traccar serveur down | Le pont se reconnecte automatiquement toutes les 10s. Les traceurs physiques continuent d'envoyer (buffer interne) |
| Réseau coupé (traceur→Traccar) | Le traceur stocke en mémoire interne (dépend du modèle, ~1000-5000 points). Resync automatique au retour réseau |
| Réseau coupé (Traccar→DelivTrack) | Reconnexion WebSocket automatique. Pas de perte de données côté Traccar |

---

## 7. Sécurité

- Changer le mot de passe admin Traccar en production
- Restreindre l'accès au port 8082 (firewall, VPN)
- Le pont utilise l'authentification Traccar (login:password)
- Les positions passent par les mêmes vérifications de sécurité DelivTrack (company scope, etc.)
