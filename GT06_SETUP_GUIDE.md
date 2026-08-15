# Guide de configuration — Traceur GT06 (4G) → DelivTrack

> Traceur acheté : protocole **GT06 series** (4G LTE/GSM), 66 canaux GPS, précision < 5 m.
> Le pont DelivTrack supporte GT06 nativement (Traccar). **Le traceur sort d'usine pointé
> vers le serveur chinois de démo `www.gps2828.com:7018` — il faut le reconfigurer par SMS.**

---

## 1. Avant de commencer

1. **SIM 4G** avec données GPRS **activées** et du solde.
2. SIM **sans code PIN** (retirer le PIN avant insertion).
3. **Insérer la SIM AVANT de mettre le traceur sous tension** (sinon SIM non reconnue).
4. Noter l'**IMEI** (étiquette sur le traceur) — c'est lui qui identifie le device côté Traccar.
5. Installation : antennes intégrées, face avant vers le haut, **sans plaque métallique au-dessus**.

## 2. Créer le device dans Traccar

### 2a. Production — Traccar Cloud (`server.traccar.org`) — recommandé
1. `https://server.traccar.org` → **Devices → Ajouter**.
2. **Name** : ex. « Toyota Hilux — Flotte 1 ».
3. **Identifier (uniqueId)** : **l'IMEI** du traceur (15 chiffres).
4. L'UI affiche le **Host** et le **Port** à utiliser pour ce device (le port GT06 de Traccar Cloud
   est fourni à l'écran — il diffère du 5055 local). **Notez le port.**
5. Ne liez le device dans DelivTrack qu'après avoir reçu des positions (étape 4-5).

### 2b. Auto-hébergé (VPS DigitalOcean / dev local)
- Déjà prêt dans le repo : `traccar/traccar.xml` → `<entry key='gt06.port'>5055</entry>` ✓
  et `docker-compose.yml` → `"5055:5055"` ✓.
- **Ouvrir le port 5055** :
  ```bash
  sudo ufw allow 5055/tcp
  ```
  + panel DigitalOcean → **Networking → Firewall → Inbound Rules → Custom → TCP 5055 → Apply**.
- Créer le device (même procédure : IMEI en uniqueId). Port = **5055**, Host = **IP publique du VPS**.

## 3. Configurer le traceur par SMS

Envoyer les SMS suivants depuis un téléphone **vers le numéro de la SIM du traceur**
(chaque commande se termine par `#`). Réponses SMS du traceur = confirmation.

### 3.1 APN (selon l'opérateur de la SIM)

| Opérateur | Commande SMS |
|---|---|
| **Telma (Yas)** | `APN,telma,,#` |
| **Orange Madagascar** | `APN,orange,,#` |
| **Airtel Madagascar** | `APN,internet.mg.airtel.com,,#` |

(Si l'APN exige un utilisateur/mot de passe : `APN,<apn>,<user>,<pass>#` — ex. `APN,apn,user,pass#`.)

### 3.2 Serveur Traccar

- **Traccar Cloud** (domaine — le traceur gère le DNS) :
  ```
  SERVER,1,server.traccar.org,<PORT_GT06_DONNÉ_PAR_LUI>,0#
  ```
- **VPS auto-hébergé** (IP — plus fiable si le DNS pose problème) :
  ```
  SERVER,0,<IP_PUBLIQUE_DU_VPS>,5055,0#
  ```

> Format confirmé GT06 : `SERVER,0=IP / 1=domaine,adresse,port,0=TCP#`. **Garder le 0 final (TCP).**

### 3.3 Fréquence d'envoi (recommandée)

```
TIMER,10,60#
```
→ 10 s roulage (ACC ON) / 60 s à l'arrêt (ACC OFF). Bornes du traceur : T1 = 5-60 s, T2 = 5-3600 s.
Pour un suivi temps réel maximum : `TIMER,5,30#` (5 s / 30 s).

### 3.4 Vérifier la configuration

```
STATUS#
PARAM#
SERVER#
```

## 4. Vérifier que le traceur se connecte (AVANT de lier dans DelivTrack)

1. **Traccar Cloud** : le device doit passer **online** dans l'UI et recevoir des positions.
2. **API Traccar** (ou l'UI) : `GET /api/positions?deviceId=<id>` ne doit pas être vide.
   - Position reçue = le traceur parle à Traccar ✓.
   - Aucune position après 5-10 min → voir §6.
3. Noter le **deviceId numérique** Traccar (affiché dans l'UI/API — indépendant de l'IMEI).

## 5. Lier dans DelivTrack

```bash
POST /tracking/vehicles/:vehicleId/link-traccar
Content-Type: application/json
{ "traccarDeviceId": "<deviceId numérique Traccar>" }
```
Ou UI admin → **Véhicules → éditer → « ID device Traccar »**.
→ Le véhicule passe `positionSource = physical_tracker` : le pont Traccar alimente la carte
temps réel, la détection de téléportation, les alertes (vitesse/arrêt/retard/géofence), le
rapport carburant (mêmes traitements que l'app téléphone).

## 6. Dépannage — le traceur n'envoie rien

| Symptôme | Cause probable | Action |
|---|---|---|
| Pas de réponse SMS aux commandes | SIM non reconnue (insérée après mise sous tension) | Réinsérer SIM, redémarrer (`RESET#`) |
| Réponse SMS mais aucune position | APN incorrect / pas de données GPRS | Vérifier APN 3.1 + solde + activation data |
| Réponse SMS mais aucune position | Serveur non configuré / mauvais port | `SERVER#` puis re-envoyer la commande 3.2 |
| Réponse SMS mais aucune position (auto-hébergé) | Port 5055 fermé (firewall) | ufw + firewall DigitalOcean (voir 2b) |
| Position envoyée mais device offline dans Traccar | Mauvais IMEI/uniqueId du device | Recréer le device avec l'IMEI exact |
| LED jaune allumée en continu | Pas de réseau GSM | SIM/APN/réseau — vérifier 3.1 |

**LED** : jaune clignote = GSM ok · bleue clignote = GPS ok · rouge allumée = alimentation ok.
**Notification DelivTrack « Traceur physique : jamais connecté »** (30 min après création) = les 4 mêmes causes.

## 7. Options du traceur (facultatives)

- **Centres SMS (alarmes du traceur)** : `CENTER,A,<numéro>#` — les alarmes (vibration, coupure
  alimentation, SOS) partent vers ce numéro. *Non requis pour DelivTrack* : les alertes
  (vitesse, arrêt prolongé, retard, géofence, hors-ligne) sont générées par le serveur depuis
  les positions GPS, comme pour l'app téléphone.
- **Désactiver une alarme** : `SENALM,OFF#` (vibration), `POWERALM,OFF#` (coupure alimentation).
- **Mode anti-vol** : par défaut — alarme vibration 3 min après coupure du contact (envoyée au centre).
- **Microphone** : `monitor123456` (activer) / `tracker123456` (désactiver) — optionnel, non utilisé.
- **Fuseau horaire** : `GMT,A,B,C#` (ex. Madagascar UTC+3 : à régler si les horodatages SMS
  décalent ; les positions Traccar sont horodatées par le fix GPS, indépendant du fuseau).

## 8. Compatibilité — confirmée

- **Protocole** : GT06 série → supporté par Traccar (auto-hébergé `gt06.port` ET Traccar Cloud). ✅
- **Précision** : < 5 m CEP — cohérent avec le seuil de bruit GPS DelivTrack (5 m). ✅
- **Fréquence** : programmable 5-60 s — compatible (pas de rate limit sur le chemin Traccar, rafales gérées). ✅
- **Champs envoyés** : position, vitesse (nœuds → converti), cap, altitude, accuracy, `valid`,
  `fixTime` — tous gérés de façon générique par le pont (aucune hypothèse de marque). ✅
- **Robustesse** : horloge traceur en avance, accuracy/hdop aberrants, rafales → tous traités
  (correctifs commit `bb5dc57`). ✅
