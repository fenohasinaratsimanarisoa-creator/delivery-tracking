# 🛰️ Traccar GPS Server — Déploiement Fly.io

## Pourquoi Fly.io et pas Render ?

**Render ne supporte PAS les ports TCP custom.** Un service web Render n'expose qu'un seul port HTTP (défaut 10000). Traccar a besoin de **ports TCP** (5055-5065) pour recevoir les données des traceurs GPS physiques (GT06, Teltonika, etc.).

> Feature request Render : https://feedback.render.com/features/p/allow-connecting-to-non-http-services-from-outside-render (+145 votes, toujours "Open")

**Fly.io** supporte les ports TCP/UDP arbitraires — c'est l'alternative idéale.

---

## Prérequis

1. **flyctl** installé : `curl -L https://fly.io/install.sh | sh`
2. **Compte Fly.io** : `fly auth signup` (gratuit, carte bancaire pour IPs dédiées)
3. **IPv4 dédiée** requise pour les ports TCP non-HTTP

---

## Déploiement étape par étape

### 1. Initialiser l'app Fly.io

```bash
cd traccar/
fly launch --no-deploy
# Nom : deliverytrack-traccar
# Région : fra (Francfort, même que Render)
```

### 2. Allouer une IPv4 dédiée (requis pour TCP)

```bash
fly ips allocate-v4
# Notez l'IP retournée (ex: 66.241.xxx.xxx)
```

### 3. Créer le volume persistant

```bash
fly volumes create traccar_data --region fra --size 1
```

### 4. Déployer

```bash
fly deploy
```

### 5. Configurer les identifiants

```bash
fly secrets set TRACCAR_ADMIN_PASSWORD="VOTRE_MOT_DE_PASSE_ICI"
```

### 6. Vérifier l'installation

```bash
# Status
fly status

# Logs
fly logs

# URL d'accès
fly info
# → L'URL sera : https://deliverytrack-traccar.fly.dev
```

### 7. Créer un compte utilisateur pour le pont

1. Ouvrez `https://deliverytrack-traccar.fly.dev` dans un navigateur
2. Connectez-vous avec `admin` / `admin` (identifiants par défaut)
3. **Changez IMMÉDIATEMENT le mot de passe admin**
4. Créez un nouvel utilisateur dédié pour le pont (ex: `deliverytrack-api`)
5. Notez le login et mot de passe → ils iront dans Render Dashboard

### 8. Mettre à jour Render

Dans le Dashboard Render → `deliverytrack-api` → **Environment** :

| Variable | Valeur |
|---|---|
| `TRACCAR_URL` | `https://deliverytrack-traccar.fly.dev` |
| `TRACCAR_USER` | `deliverytrack-api` (ou l'utilisateur créé) |
| `TRACCAR_PASSWORD` | `le_mot_de_passe_créé` |

### 9. Reconfigurer les appareils GT06

Pour chaque traceur GT06/Concox/JM-VL03 :

| Paramètre | Ancienne valeur | Nouvelle valeur |
|---|---|---|
| Serveur | `server.traccar.org` | `66.241.xxx.xxx` (IPv4 dédiée) |
| Port | `5055` | `5055` (inchangé) |
| Protocol | GT06 | GT06 (inchangé) |

> **Important** : les traceurs GPS utilisent l'IP, pas le domaine. Utilisez l'IPv4 dédiée Fly.io, pas le domaine `.fly.dev`.

---

## Ports exposés

| Port | Protocole | Usage |
|---|---|---|
| 8082 | HTTP | Interface d'administration web |
| 5055 | TCP | GT06 / Concox / JM-VL03 |
| 5056 | TCP | Teltonika FMB / FM / TAVL / GH |
| 5057 | TCP | H02 (boîtiers économiques) |
| 5058 | TCP | TK103 / TK102 / Coban / ST-901 |
| 5059 | TCP | Meitrack (MVT-380 / MVT-600 / T1 / P99) |
| 5060 | TCP | OsmAnd (test smartphone) |
| 5061 | TCP | Lézard (EZ90 / EZ21 / EZ630 / Delta) |
| 5062 | TCP | WristWatch (montres / balises) |
| 5063 | TCP | Naviset / Navtelecom |
| 5064 | TCP | Xexun / Sanav / GStar / GlobalSat |
| 5065 | TCP | AST (Falcom / AST) |

---

## Coût estimé

| Ressource | Coût |
|---|---|
| Machine shared-cpu-1x, 256MB | ~$3.80/mois |
| Volume persistant 1GB | ~$0.15/mois |
| IPv4 dédiée | ~$2/mois |
| **Total** | **~$6/mois** |

> Comparaison : le serveur de démo public `server.traccar.org` est gratuit mais partagé, non fiable, et vos données ne vous appartiennent pas.

---

## Sécurité

1. **Changez le mot de passe admin** immédiatement après le premier accès
2. **Créez un utilisateur dédié** pour le pont (pas admin)
3. **Firewall** : si possible, restreignez l'accès aux ports GPS aux IPs de vos traceurs
4. **HTTPS** : l'admin est accessible en HTTPS via Fly.io automatiquement
5. **Backup** : le volume `traccar_data` contient la base H2 — backup régulier recommandé

---

## Dépannage

| Problème | Solution |
|---|---|
| Traceur ne se connecte pas | Vérifiez l'IP et le port dans la config du traceur |
| Admin inaccessible | `fly logs` → vérifiez que le service démarre |
| Pont Render déconnecté | Vérifiez `TRACCAR_URL` dans Render Dashboard |
| Données manquantes | Vérifiez que l'utilisateur existe dans Traccar |
