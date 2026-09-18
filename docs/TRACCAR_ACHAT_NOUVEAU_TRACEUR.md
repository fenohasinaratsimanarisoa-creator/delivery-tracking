# Guide d'achat et mise en service d'un traceur GPS physique

> Destiné aux administrateurs DelivTrack qui souhaitent équiper leurs véhicules
> d'un traceur GPS matériel pour un suivi en temps réel.

---

## 1. Protocoles supportés (prêts à l'emploi)

Le serveur Traccar de production a les protocoles suivants activés.
**Vérifiez AVANT achat que votre traceur supporte l'un de ces protocoles.**

| Protocole | Port TCP | Marques / Modèles courants | Testé |
|-----------|----------|---------------------------|-------|
| **GT06** | 5055 | Concox, JM-VL03, GT02, GT02D, GT03, GT06N | ✅ |
| **Teltonika** | 5056 | Teltonika FMB001/002/010/020/100/110/120/130/140/200/202/204/900/910/920/930/940/950/960/962/964/966, TAVL1/2 | ✅ |
| **H02** | 5057 | Boîtiers génériques "H02", EELINK, plusieurs marques Alibaba | ❌ À tester |
| **TK103/TK102** | 5058 | TK103, TK102, Coban, ST-901, ST-90x, ST-904 | ❌ À tester |
| **Meitrack** | 5059 | Meitrack MVT-380, MVT-600, T1, P99, P88, MVT-650 | ❌ À tester |
| **OsmAnd** | 5060 | Application smartphone OsmAnd (mode faux traceur, test/démo) | ❌ À tester |
| **Lézard (L100)** | 5061 | EZ90, EZ21, EZ630, Delta | ❌ À tester |
| **Gator/Watch** | 5062 | Montres GPS, balises | ❌ À tester |
| **Navtelecom** | 5063 | Naviset, Navtelecom | ❌ À tester |
| **Xexun** | 5064 | Xexun, Sanav, GStar, GlobalSat | ❌ À tester |
| **AST** | 5065 | Falcom, AST | ❌ À tester |

**Protocoles testés avec succès (trames binaires réelles simulées) :** GT06, Teltonika (Codec 8)

---

## 2. Comment identifier le protocole d'un traceur à l'achat

### Dans la fiche produit Alibaba/AliExpress

Cherchez ces mots-clés dans la description :

| Mot-clé à chercher | Protocole correspondant |
|--------------------|------------------------|
| "GT06" / "GT06N" / "Concox protocol" | GT06 (port 5055) ✅ |
| "Teltonika protocol" / "FMB" / "Codec 8" | Teltonika (port 5056) ✅ |
| "TK103" / "TK102" / "Coban protocol" | TK103 (port 5058) |
| "H02 protocol" / "EELINK" | H02 (port 5057) |
| "Meitrack protocol" | Meitrack (port 5059) |
| "GPS tracker G301" / "GT03" / "GL300" | GT06 (port 5055) ✅ |
| "JM-VL03" / "JM-VL02" | GT06 (port 5055) — très courant, excellent rapport qualité/prix ✅ |
| "Puce MT2503" / "MT6261" | Généralement GT06 ou H02 |
| "Supports GPRS/SMS" | Par défaut GT06 ou TK103 |
| "4G LTE tracker" | Vérifier le protocole — peut être GT06, Teltonika ou H02 |

> ℹ️ **Correction 2026-09-05** : les ports indiqués ci-dessus (5055, 5056…) sont
> **les mêmes en développement local ET en production**. La prod est un Traccar
> auto-hébergé (VPS Contabo, `169.58.237.88`) utilisant le même `traccar/traccar.xml`
> — pas de Traccar Cloud, pas de port "fourni par une interface". Voir `TRACCAR_SETUP.md`.

### Pièges à éviter

- ❌ "GPS tracker with APP only" = probablement fermé (protocole propriétaire, pas d'accès serveur)
- ❌ "Works with [marque] APP" = probablement incompatible
- ✅ "Supports TCP/UDP protocol" = bon signe, généralement compatible
- ✅ "Supports custom server" = excellent signe — vous pouvez configurer IP/port du serveur Traccar

### Recommandation d'achat

**Pour un premier achat, privilégiez un traceur marqué "GT06" ou "JM-VL03".**
Ce sont les plus courants, les moins chers (~15-30€), et le protocole GT06 est le mieux testé.

Si le budget le permet, **Teltonika FMB** est la référence professionnelle (~60-120€) :
- Plus fiable, meilleure qualité GPS
- Buffer interne plus grand
- Configuration à distance

---

## 3. Mise en service — étapes exactes

### Matériel nécessaire

- Traceur GPS
- Carte SIM data (n'importe quel opérateur Malagasy : Telma, Airtel, Orange)
- Optionnel : câble de programmation USB (parfois fourni)

### Étape 1 : Préparer la carte SIM

1. Insérer la SIM dans un téléphone
2. **Désactiver le code PIN** de la SIM
3. Vérifier que la SIM a du crédit data (forfait data actif)
4. Noter l'APN de l'opérateur :
   - Telma : `telma`
   - Airtel : `airtelmg`
   - Orange : `orangenet`
5. Remettre la SIM dans le traceur

> ℹ️ **Mise à jour 2026-09-18** : faites d'abord l'**Étape 1bis** ci-dessous (créer
> le véhicule dans DelivTrack avec l'IMEI) **avant** de configurer le traceur par
> SMS — Traccar rejette silencieusement les positions d'un IMEI qu'il ne connaît
> pas encore (pas d'auto-enregistrement des devices inconnus).

### Étape 1bis : Créer le véhicule dans DelivTrack (remplace les anciennes étapes 3 et 4)

Il n'y a plus de device Traccar à créer à la main dans une interface séparée — le
formulaire véhicule de DelivTrack fait tout automatiquement en une seule saisie :

1. Se connecter à DelivTrack en tant qu'admin/dispatcher.
2. **Véhicules → Nouveau véhicule** (ou éditer un véhicule existant).
3. Section « Source GPS » → **Source de position = Traceur physique**.
4. **IMEI du traceur GPS** → saisir l'IMEI noté sur la boîte du traceur (15 chiffres).
5. Enregistrer.

→ Le serveur crée le device Traccar (identifiant = l'IMEI, scopé à votre entreprise), le
lie immédiatement à ce véhicule, et bascule `positionSource = physical_tracker`. Aucun accès
à l'UI Traccar (ni tunnel SSH) n'est nécessaire pour cette étape.

**Remplacer un traceur en panne** : éditer le véhicule, resaisir le nouvel IMEI dans le même
champ — un nouvel IMEI crée et lie un nouveau device (l'ancien lien est remplacé).

### Étape 2 : Configurer le traceur

Par SMS ou par câble USB (selon le modèle), **après** l'Étape 1bis ci-dessus. Exemple pour un traceur GT06 :

> ✅ **Correction 2026-09-05 (installation réelle effectuée)** : le port GT06
> est bien **5055** en production aussi (pas "5023", cette ancienne mention était
> une supposition jamais vérifiée) — la prod est un Traccar auto-hébergé sur
> VPS Contabo (`169.58.237.88`), pas Traccar Cloud. Voir `TRACCAR_SETUP.md`.
>
> ⚠️ **La syntaxe de commande SMS ci-dessous (`adminip123,...`) ne fonctionne
> PAS sur tous les modèles GT06** — vérifié en conditions réelles : un traceur
> GT06 générique (manuel "GPS Tracker User Manual", section "Command List") a
> ignoré silencieusement `adminip123,...` (zéro réponse, zéro tentative de
> connexion) et n'a fonctionné qu'avec la syntaxe alternative :
> `SERVER,0,[IP],[PORT],0#` (config serveur) et `APN,[apn],#` (config APN).
> **Le manuel PAPIER/PDF fourni avec VOTRE modèle précis fait foi** — les deux
> syntaxes ci-dessous sont à essayer, mais aucune n'est garantie universelle.

```bash
# Configurer le serveur (APN + IP:Port) — PAR SMS au numéro de la SIM du traceur
# Remplacer XXXXX par le numéro de téléphone de la SIM du traceur
# [IP_SERVEUR] = 169.58.237.88 (VPS Contabo, voir TRACCAR_SETUP.md)
# [PORT]       = port fixe du protocole (GT06=5055, Teltonika=5056, etc.
#                voir RAPPORT_PORTS_TRACCAR.md — MÊME port qu'en dev local)

# Syntaxe A (traceurs GT06/JM-VL03 "classiques") :
SMS à XXXXX : apn,[apn_operateur]
SMS à XXXXX : adminip123,[IP_SERVEUR],[PORT]

# Syntaxe B (autre famille GT06 — vérifiée fonctionnelle en conditions réelles) :
SMS à XXXXX : APN,[apn_operateur],#
SMS à XXXXX : SERVER,0,[IP_SERVEUR],[PORT],0#

# [apn_operateur] : APN de l'opérateur de la SIM. À Madagascar, Telma est devenu
# Yas (rebranding Axian Telecom, nov. 2024) — APN "internet" d'après une source
# officielle Yas, à confirmer sur le téléphone (Paramètres → APN) avant l'achat.
# Airtel Madagascar (différent de Yas) : APN "internet.mg.airtel.com".

# Configurer l'intervalle d'envoi (10 secondes en mouvement)
SMS à XXXXX : upload,10

# Redémarrer le traceur
SMS à XXXXX : reboot
```

> ⚠️ La syntaxe exacte des commandes SMS dépend du modèle. Consultez le manuel du traceur.
> Les traceurs GT06 utilisent généralement la syntaxe ci-dessus.

### Étapes 3 et 4 : supprimées (2026-09-18)

Création du device + liaison au véhicule = déjà faites à l'**Étape 1bis**, avant la config SMS.
Rien de plus à faire ici — passez directement à la vérification.

### Étape 5 : Vérifier le fonctionnement

- Sur la page **Véhicules**, le statut du traceur doit passer à ✅ **Reçoit des positions**
- Sur la carte temps réel, le véhicule doit apparaître avec sa position
- En cas de problème, voir la section dépannage ci-dessous

---

## 4. Dépannage : "Le traceur est configuré mais aucune position n'apparaît"

Vérifications dans l'ordre :

### 1. La carte SIM est-elle active et a-t-elle du crédit data ?
```bash
# Appeler le numéro de la SIM du traceur
# Si ça sonne → la SIM est active
# Vérifier le solde data auprès de l'opérateur
```

### 2. L'APN est-il correct ?
```bash
# Envoyer au traceur : apn,xxxxx
# Remplacer xxxxx par l'APN de l'opérateur (telma, airtelmg, orangenet)
```

### 3. Le port est-il ouvert sur le serveur ?
```bash
# Depuis n'importe quelle machine, y compris en prod (169.58.237.88 : port
# public, pas besoin de tunnel SSH pour CE test — seule l'UI admin 8082 est
# restreinte à 127.0.0.1) :
nc -zv 169.58.237.88 5055
# Doit répondre "Connected to 169.58.237.88"
# Si "Connection refused" → le port n'est pas ouvert (vérifier firewall/VPS)

# Vérifier que Traccar écoute bien le port (nécessite un accès SSH au VPS) :
ssh root@169.58.237.88 "docker exec delivery-tracking-traccar ss -tlnp | grep 5055"
# Doit montrer LISTEN
```

### 4. Le protocole est-il activé dans traccar.xml ?
En prod comme en dev, le fichier est le même (`delivery-tracking/traccar/traccar.xml`,
monté dans le conteneur) — vérifiez que la ligne correspondante y est :
```xml
<entry key='gt06.port'>5055</entry>
```
> ⚠️ Un port ouvert (test 3 ci-dessus) ne garantit PAS que le protocole soit
> correctement décodé pour votre modèle précis — voir aussi le point 8 ci-dessous
> sur les logs Traccar, qui ne remontent PAS grand-chose par défaut.

### 5. Le véhicule a-t-il été créé avec le bon IMEI côté DelivTrack ?
- Aller dans DelivTrack → Véhicules → éditer le véhicule concerné
- Vérifier que la Source de position est bien **Traceur physique**
- En cas de faute de frappe sur l'IMEI à la création (Étape 1bis) : resaisir l'IMEI exact dans
  le champ IMEI et enregistrer — ça crée un nouveau device correctement lié, remplaçant l'ancien
- Note technique (si accès SSH au VPS) : le device Traccar créé automatiquement est visible via
  `GET {TRACCAR_URL}/api/devices` (identifiant interne = colonne `traccar_device_id` du véhicule
  en base, PAS l'IMEI lui-même — Traccar préfixe l'IMEI par les 8 premiers caractères du
  `companyId` pour l'isolation multi-entreprises)

### 7. Vérifier les logs Traccar
```bash
ssh root@169.58.237.88 "docker logs delivery-tracking-traccar --since 20m 2>&1 | tail -50"
```
> ⚠️ **Vérifié en conditions réelles (2026-09-05)** : Traccar, en config par
> défaut, ne logue **quasiment rien** au niveau INFO — ni connexion TCP reçue,
> ni trame décodée, ni position enregistrée. Des logs vides ne prouvent PAS
> l'absence de trafic. Le seul test fiable est de vérifier directement
> `GET /api/positions?deviceId=<id>` (voir `scripts/verify-traccar-install.sh`),
> pas les logs.

### 8. Tester avec un simulateur
```bash
node scripts/simulate-protocol-gt06.js [IMEI] 169.58.237.88 5055
```
> ⚠️ Ce script a eu un bug réel de format de trame GT06 (corrigé le 2026-09-05,
> voir son historique en tête de fichier) qui faisait échouer silencieusement
> TOUT test, même contre un serveur parfaitement configuré. Assurez-vous
> d'utiliser une version à jour du script avant de l'utiliser comme référence
> de diagnostic — sinon vous risquez de suspecter le serveur à tort.

Si le simulateur fonctionne mais pas le traceur physique :
- Problème de configuration du traceur (APN, IP, port, **ou syntaxe de commande
  SMS propre au modèle** — voir l'encadré de l'Étape 2 ci-dessus)
- Firewall bloquant le port
- Carte SIM / réseau mobile — le fait qu'un appel/SMS passe ne prouve PAS que
  la DATA fonctionne (canaux séparés), et inversement un forfait data actif ne
  garantit pas que le traceur ait la BONNE configuration serveur

---

## 5. Coûts récurrents estimés (Madagascar 2026)

| Élément | Coût |
|---------|------|
| Traceur GPS (GT06/JM-VL03) | 15 000 - 50 000 Ar (achat unique) |
| Traceur GPS (Teltonika FMB) | 80 000 - 200 000 Ar (achat unique) |
| Carte SIM data (par mois) | 5 000 - 10 000 Ar |
| Forfait data 1 Go | 3 000 - 6 000 Ar/mois |
| VPS Hetzner CX22 (traccar + bridge) | ~25 000 Ar/mois |
| **Total par véhicule/mois** | **~10 000 - 20 000 Ar/mois** |

---

## 6. Commandes SMS utiles (traceurs GT06/JM-VL03 courants)

| Commande | Action |
|----------|--------|
| `adminip123,[IP],[PORT]` | Configurer serveur Traccar |
| `apn,[APN]` | Configurer APN |
| `upload,[secondes]` | Intervalle d'envoi en mouvement |
| `uploadstatic,[secondes]` | Intervalle d'envoi à l'arrêt |
| `time,[offset]` | Fuseau horaire (ex: `time,3` pour UTC+3 Madagascar) |
| `reboot` | Redémarrer le traceur |
| `default` | Réinitialiser aux paramètres d'usine |
| `check` | État de la configuration (réponse par SMS) |
| `#000#` | Obtenir l'IMEI (parfois) |
| `fix` | Nombre de satellites visibles + coordonnées actuelles |
