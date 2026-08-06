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

> ℹ️ Les ports indiqués ci-dessus (5055, 5056…) sont ceux du **Traccar local de développement**.
> En **production** (Traccar Cloud), le port de chaque protocole est **différent** et est fourni
> par l'interface Traccar Cloud lors de la création du device — voir section 3 et
> `TRACCAR_SETUP.md` section 2.

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

### Étape 2 : Configurer le traceur

Par SMS ou par câble USB (selon le modèle). Exemple pour un traceur GT06 :

> **⚠️ ATTENTION — le port 5055 n'existe QUE en développement local.**
> Le port `5055` (ainsi que 5056-5065) est celui du **Traccar local** (docker-compose, dev uniquement).
> En **production**, DelivTrack utilise **Traccar Cloud** (`server.traccar.org`) dont le port est
> **différent et non garanti** — il n'est **jamais** 5055. Le port exact n'est connu qu'une fois
> confirmé dans l'interface `https://server.traccar.org` lors de la création du device
> (pour GT06, probablement `5023` — à confirmer, voir `RAPPORT_PORTS_TRACCAR.md` section
> « Traccar Cloud (production) »).
> **Procédure pour obtenir l'IP et le port réels :** voir **`TRACCAR_SETUP.md` section 2
> « Configurer Traccar Cloud (production) »** (IP `45.55.84.20` documentée, port fourni par l'interface).

```bash
# Configurer le serveur (APN + IP:Port Traccar Cloud)
# Par SMS au numéro de la SIM du traceur
# Remplacer XXXXX par le numéro de téléphone de la SIM du traceur

# Configurer l'APN (exemple Telma)
SMS à XXXXX : apn,telma

# Configurer le serveur Traccar Cloud de production
# [IP_TRACCAR_CLOUD]             = IP de Traccar Cloud (45.55.84.20 — voir TRACCAR_SETUP.md section 2)
# [PORT_CONFIRME_DANS_INTERFACE] = port affiché par l'interface Traccar Cloud à la création
#                                  du device (PAS 5055 — 5055 n'existe qu'en dev local)
SMS à XXXXX : adminip123,[IP_TRACCAR_CLOUD],[PORT_CONFIRME_DANS_INTERFACE]

# Configurer l'intervalle d'envoi (10 secondes en mouvement)
SMS à XXXXX : upload,10

# Redémarrer le traceur
SMS à XXXXX : reboot
```

> ⚠️ La syntaxe exacte des commandes SMS dépend du modèle. Consultez le manuel du traceur.
> Les traceurs GT06 utilisent généralement la syntaxe ci-dessus.

### Étape 3 : Créer le device dans Traccar

1. Interface web Traccar :
   - **Production (Traccar Cloud)** : `https://server.traccar.org`
   - **Dev local uniquement** : `http://[IP_Traccar]:8082`
2. Login avec les identifiants admin
3. Menu **Devices** → **Add**
4. **Name** : nom du véhicule
5. **Unique ID** : IMEI du traceur (15 chiffres, noté sur la boîte ou en appelant `#000#` par SMS)
6. **Protocol** : laisser vide (auto-détection) ou sélectionner le protocole
7. Sauvegarder

### Étape 4 : Lier le traceur au véhicule dans DelivTrack

1. Se connecter à DelivTrack en tant qu'admin
2. Aller dans **Véhicules** → sélectionner le véhicule concerné
3. Dans la section **Traceur physique**, cliquer **Sélectionner un device Traccar**
4. Choisir le device dans la liste (les devices Traccar déjà liés sont masqués)
5. Cliquer **Tester la connexion** pour vérifier que le traceur envoie des positions
6. Sauvegarder

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
# Depuis n'importe quelle machine — EXEMPLE pour le Traccar LOCAL de développement :
nc -zv [IP_SERVEUR] 5055
# Doit répondre "Connected to [IP_SERVEUR]"
# Si "Connection refused" → le port n'est pas ouvert (vérifier firewall/VPS)

# Vérifier que Traccar écoute bien le port (dev local / VPS auto-hébergé uniquement) :
ssh [VPS] "ss -tlnp | grep 5055"
# Doit montrer LISTEN
```
> ⚠️ L'exemple ci-dessus (port `5055`) ne vaut **que** pour le Traccar **local de développement**
> (docker-compose / VPS auto-hébergé). En **production** (Traccar Cloud), le port n'est **pas** 5055 :
> tester avec l'IP et le port confirmés dans l'interface Traccar Cloud
> (voir `TRACCAR_SETUP.md` section 2) :
```bash
nc -zv [IP_TRACCAR_CLOUD] [PORT_CONFIRME_DANS_INTERFACE]
# Traccar Cloud n'étant pas auto-hébergé, le contrôle "ssh ... ss -tlnp" ne s'y applique pas.
```

### 4. Le protocole est-il activé dans traccar.xml ?
> ℹ️ Cette vérification ne concerne **que** le Traccar local / auto-hébergé (dev).
> En **production** (Traccar Cloud), le fichier `traccar.xml` n'est pas accessible : le port du
> protocole est celui affiché dans l'interface Traccar Cloud à la création du device.
L'admin peut vérifier que la ligne correspondante est dans `traccar.xml` :
```xml
<entry key='gt06.port'>5055</entry>
```

### 5. Le device est-il créé dans Traccar avec le bon IMEI ?
- Vérifier dans l'interface Traccar → Devices
- L'**Unique ID** doit être l'IMEI du traceur (15 chiffres)
- Si le traceur apparaît dans la liste mais avec statut "Offline" : c'est normal (il passe en ligne dès qu'il envoie une position)

### 6. Le device est-il lié au bon véhicule dans DelivTrack ?
- Aller dans DelivTrack → Véhicules → éditer le véhicule
- Vérifier que `traccarDeviceId` correspond à l'ID du device Traccar

### 7. Vérifier les logs Traccar
```bash
docker logs delivery-tracking-traccar 2>&1 | grep -i "error\|warn\|5055"
```
Rechercher des erreurs de parsing de protocole.

### 8. Tester avec un simulateur
```bash
# Depuis une machine qui peut atteindre le serveur Traccar (dev local : IP + port 5055) :
node scripts/simulate-protocol-gt06.js [IMEI] [IP_SERVEUR] 5055
# En production (Traccar Cloud), utiliser l'IP et le port confirmés dans l'interface :
# node scripts/simulate-protocol-gt06.js [IMEI] [IP_TRACCAR_CLOUD] [PORT_CONFIRME_DANS_INTERFACE]
```
Si le simulateur fonctionne mais pas le traceur physique :
- Problème de configuration du traceur (APN, IP, port)
- Firewall bloquant le port
- Carte SIM / réseau mobile

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
