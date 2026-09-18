# Guide de configuration — Traceur GT06 (4G) → DelivTrack

> Traceur acheté : protocole **GT06 series** (4G LTE/GSM), 66 canaux GPS, précision < 5 m.
> Le pont DelivTrack supporte GT06 nativement (Traccar). **Le traceur sort d'usine pointé
> vers le serveur chinois de démo `www.gps2828.com:7018` — il faut le reconfigurer par SMS.**

---

## 1. Avant de commencer

1. **SIM 4G** avec données GPRS **activées** et du solde.
2. SIM **sans code PIN** (retirer le PIN avant insertion).
3. **Insérer la SIM AVANT de mettre le traceur sous tension** (sinon SIM non reconnue).
4. Noter l'**IMEI** (étiquette sur le traceur, 15 chiffres) — c'est le SEUL identifiant à saisir
   côté DelivTrack, tout le reste est automatique (voir §2).
5. Installation : antennes intégrées, face avant vers le haut, **sans plaque métallique au-dessus**.

## 2. Créer le véhicule dans DelivTrack (seule étape manuelle côté logiciel)

Depuis la mise à jour 2026-09-18, il n'y a plus de device Traccar à créer à la main dans un
panel séparé — le formulaire véhicule de DelivTrack fait tout automatiquement :

1. **Véhicules → Nouveau véhicule** (ou éditer un véhicule existant).
2. Section « Source GPS » → **Source de position = Traceur physique**.
3. **IMEI du traceur GPS** → saisir l'IMEI noté à l'étape 1.
4. Enregistrer.

→ Le serveur crée le device Traccar (identifiant = l'IMEI, scopé à votre entreprise), le lie
immédiatement à ce véhicule (`traccarDeviceId`), et bascule `positionSource = physical_tracker`.
Rien d'autre à faire : dès que le traceur physique commence à émettre (§3), ses positions
alimentent automatiquement la carte temps réel, la détection de téléportation, les alertes
(vitesse/arrêt/retard/géofence) et le rapport carburant — mêmes traitements que l'app téléphone.

**Remplacer un traceur en panne** : éditer le véhicule, resaisir le nouvel IMEI dans le même
champ (laissé vide, l'ancien traceur reste lié — un nouvel IMEI en crée et lie un nouveau).

> Le device DOIT exister côté Traccar avant que le traceur physique ne commence à émettre —
> Traccar rejette silencieusement les positions d'un IMEI inconnu (pas d'auto-enregistrement
> configuré). Faites donc TOUJOURS cette étape 2 **avant** l'étape 3 (config SMS).

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

Production DelivTrack = VPS Contabo auto-hébergé (pas de Traccar Cloud — voir `TRACCAR_SETUP.md`
et `DEPLOYMENT.md`). Adresse IP, port fixe pour GT06 (identique en dev local, voir
`docs/RAPPORT_PORTS_TRACCAR.md`) :

```
SERVER,0,169.58.237.88,5055,0#
```

> Format confirmé GT06 : `SERVER,0=IP / 1=domaine,adresse,port,0=TCP#`. **Garder le 0 final (TCP).**
> En dev local, remplacer l'IP par celle de la machine hôte (même port 5055).

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

## 4. Vérifier que le traceur remonte bien dans DelivTrack

Plus besoin d'accéder à l'API/UI Traccar séparément — tout se vérifie depuis DelivTrack :

1. **Carte temps réel** (`/map`) : le véhicule doit apparaître et bouger.
2. **Fiche véhicule** (Véhicules → éditer) : la source GPS reste `Traceur physique`, l'IMEI a
   bien été accepté (pas d'erreur au moment de l'enregistrement — sinon voir §6).
3. Aucune position après 5-10 min alors que le traceur est sous tension avec du réseau → voir §6.

## 5. Dépannage — le traceur n'envoie rien

| Symptôme | Cause probable | Action |
|---|---|---|
| Erreur à la création du véhicule (« Impossible de créer le traceur pour l'IMEI... ») | IMEI déjà utilisé par un autre véhicule (même entreprise ou faute de frappe) | Vérifier qu'aucun autre véhicule n'a déjà cet IMEI |
| Pas de réponse SMS aux commandes | SIM non reconnue (insérée après mise sous tension) | Réinsérer SIM, redémarrer (`RESET#`) |
| Réponse SMS mais aucune position | APN incorrect / pas de données GPRS | Vérifier APN 3.1 + solde + activation data |
| Réponse SMS mais aucune position | Serveur non configuré / mauvais port | `SERVER#` puis re-envoyer la commande 3.2 |
| Réponse SMS mais aucune position | Véhicule pas encore créé avec cet IMEI côté DelivTrack (§2 sauté ou fait après) | Créer/éditer le véhicule avec l'IMEI exact, PUIS reconfigurer le traceur |
| Position envoyée mais rien sur la carte | IMEI saisi côté DelivTrack ≠ IMEI réel du traceur (faute de frappe) | Éditer le véhicule, resaisir l'IMEI exact (recrée un nouveau device lié) |
| LED jaune allumée en continu | Pas de réseau GSM | SIM/APN/réseau — vérifier 3.1 |

**LED** : jaune clignote = GSM ok · bleue clignote = GPS ok · rouge allumée = alimentation ok.
**Notification DelivTrack « Traceur physique : jamais connecté »** (30 min après création) = les
mêmes causes que ci-dessus.

## 6. Options du traceur (facultatives)

- **Centres SMS (alarmes du traceur)** : `CENTER,A,<numéro>#` — les alarmes (vibration, coupure
  alimentation, SOS) partent vers ce numéro. *Non requis pour DelivTrack* : les alertes
  (vitesse, arrêt prolongé, retard, géofence, hors-ligne) sont générées par le serveur depuis
  les positions GPS, comme pour l'app téléphone.
- **Désactiver une alarme** : `SENALM,OFF#` (vibration), `POWERALM,OFF#` (coupure alimentation).
- **Mode anti-vol** : par défaut — alarme vibration 3 min après coupure du contact (envoyée au centre).
- **Microphone** : `monitor123456` (activer) / `tracker123456` (désactiver) — optionnel, non utilisé.
- **Fuseau horaire** : `GMT,A,B,C#` (ex. Madagascar UTC+3 : à régler si les horodatages SMS
  décalent ; les positions Traccar sont horodatées par le fix GPS, indépendant du fuseau).

## 7. Compatibilité — confirmée

- **Protocole** : GT06 série → supporté nativement par Traccar (auto-hébergé, `gt06.port` fixe). ✅
- **Précision** : < 5 m CEP — cohérent avec le seuil de bruit GPS DelivTrack (5 m). ✅
- **Fréquence** : programmable 5-60 s — compatible (pas de rate limit sur le chemin Traccar, rafales gérées). ✅
- **Champs envoyés** : position, vitesse (nœuds → converti), cap, altitude, accuracy, `valid`,
  `fixTime` — tous gérés de façon générique par le pont (aucune hypothèse de marque). ✅
- **Robustesse** : horloge traceur en avance, accuracy/hdop aberrants, rafales → tous traités
  (correctifs commit `bb5dc57`). ✅
