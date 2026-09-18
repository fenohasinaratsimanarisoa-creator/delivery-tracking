# Robustesse du GPS physique — tableau récapitulatif par modèle de traceur

> Doc de décision d'achat : pour chaque traceur **déjà utilisé** ou **prévu à l'achat**,
> ce qu'il faut savoir sur sa télémétrie (power/battery), son stockage local hors ligne,
> et le niveau de fiabilité recommandé pour des trajets critiques.

---

## 1. Méthode de lecture

| Colonne | Signification |
|---|---|
| **Power/battery** | Le traceur remonte-t-il `attributes.power` (tension d'alimentation) et/ou `attributes.battery` (niveau batterie interne) dans les positions Traccar ? Ces champs permettent la **détection de coupure électrique** et de **batterie traceur critique** (alertes dashboard + cause du silence). |
| **Stockage local** | Le traceur stocke-t-il les positions en mémoire/SD quand le réseau est absent, puis les ré-envoie au retour (« black box » / « offline data storage ») ? Sans ça, une coupure réseau = **perte réelle de données** (pas de rattrapage possible). |
| **Fiabilité trajets critiques** | **Haut** = télémétrie + stockage local → continuité et diagnostic complets. **Moyen** = un seul des deux. **Limité** = ni l'un ni l'autre (silence = perte possible + cause non documentée). |

> ⚠️ **À confirmer à l'achat** : ces caractéristiques ne sont PAS garanties par la
> seule compatibilité du protocole. Vérifiez la fiche produit / spec du modèle exact
> avant d'acheter en série. Ce tableau reflète le comportement **typique** des familles
> de protocoles, pas chaque modèle individuel.

---

## 2. Traceurs déjà configurés / documentés dans le projet

| Modèle / famille | Protocole | Power/battery | Stockage local hors ligne | Fiabilité trajets critiques | Notes |
|---|---|---|---|---|---|
| **GT06 4G (le traceur acheté)** | GT06 (port 5055 / port Traccar Cloud) | ✅ **power** (tension véhicule) + **battery** (batterie interne) remontés sur les modèles 4G récents | ⚠️ Dépend du modèle : certains GT06 récents ont un stockage mémoire de rattrapage ; les anciens non | **Haut** (si power/battery confirmés sur le modèle exact) | Guide complet : `GT06_SETUP_GUIDE.md`. Vérifier la fiche exacte pour le stockage local. |
| **Teltonika FMB0xx/1xx/9xx** | Teltonika (port 5056 / Traccar Cloud) | ✅ **power** (mV) + **battery** + **ignition** | ✅ **Oui** — stockage interne Codec 8 jusqu'à des milliers de messages (rattrapage intégré) | **Haut** | Le standard de référence pour la continuité. Protocole testé avec succès dans le repo. |
| **JM-VL03 / GT03 / GL300 (Concox)** | GT06 | ✅ power/battery selon modèle | ⚠️ À vérifier (généralement non sur les entrées de gamme) | **Moyen** | Très bon rapport qualité/prix ; compter sur le backfill Traccar (24 h) côté serveur. |

---

## 3. Traceurs prévus à l'achat (à évaluer avant achat)

| Famille | Protocole | Power/battery attendu | Stockage local attendu | Fiabilité recommandée | Ce qu'il faut vérifier sur la fiche produit |
|---|---|---|---|---|---|
| **TK103 / TK102 (Coban)** | TK103 (port 5058) | ⚠️ Souvent **power** seulement (volts) | ❌ Généralement **non** | **Moyen** (détection coupure OK, pas de rattrapage réseau) | Chercher « GPRS data buffer » / « offline storage » |
| **H02 / EELINK (générique)** | H02 (port 5057) | ❌ Souvent **aucune télémétrie** | ❌ Non | **Limité** | Pour trajets non critiques uniquement ; cause de silence non documentée |
| **Meitrack MVT-380/600** | Meitrack (port 5059) | ✅ power + battery | ✅ Oui (mémoire tampon) | **Haut** | Famille fiable pour flottes exigeantes |
| **Xexun / GStar / GlobalSat** | Xexun (port 5064) | ⚠️ power selon modèle | ❌ Souvent non | **Moyen** | — |
| **Concox GT06 haut de gamme** | GT06 | ✅ power + battery | ✅ Selon modèle (SOS/black box) | **Haut** | Vérifier « data storage on signal loss » |

---

## 4. Règle de décision d'achat (priorités)

1. **Trajets critiques (livraisons contractuelles, preuves)** : privilégier **Teltonika** ou
   **Meitrack** (télémétrie + stockage local → continuité ET diagnostic). Le surcoût se
   justifie par la réduction des litiges sur les preuves de livraison.
2. **Flotte standard** : GT06 4G récent (télémétrie power/battery confirmée) — bon
   compromis prix/fiabilité ; accepter la limite réseau (backfill 24 h Traccar côté
   serveur, mais pas de rattrapage traceur).
3. **Éviter pour la flotte principale** : H02 / TK103 entrée de gamme sans télémétrie ni
   stockage — un silence y est une **perte réelle** et la cause n'est **pas documentable**.
4. **Toujours** : vérifier le champ power/battery sur la position reçue (dashboard →
   santé du tracking → colonne « Cause probable ») après la première liaison d'un modèle.

---

## 5. Ce qui est couvert côté DelivTrack (indépendamment du modèle)

- **Reconnexion du pont** : sans limite de tentatives (backoff exponentiel, plafonné à 2 min), tant que Traccar est down.
- **Panne du process Traccar** : détectée toutes les 5 min (`GET /api/server`) + alerte critical si > 15 min hors ligne.
- **Backfill** : rattrapage des positions Traccar sur **24 h** (`BACKFILL_MAX_HOURS`) après reconnexion, avec attribution correcte du chauffeur/livraison au timestamp du fix.
- **Silence GPS** : détection serveur + alerte dashboard + **cause probable** (coupure / batterie / SIM-matériel / télémétrie absente) depuis la dernière télémétrie stockée.
- **Jamais connecté** : alerte 30 min après liaison si aucune position (cause : config SIM/APN/port/IMEI).

## 6. Limites physiques à reconnaître (jamais contournées)

- Un traceur **sans stockage local** perd ses positions pendant une coupure réseau — **c'est une limite du matériel**, pas un bug. Ne promettez pas de continuité sur ces modèles.
- Un traceur **sans power/battery** ne permet pas de diagnostiquer la cause d'un silence — la cause restera « télémétrie non remontée ».
- Une coupure électrique totale du véhicule finit par vider la batterie interne de secours du traceur (quelques heures) — après, plus aucun signal possible, même si la panne réseau est résolue.
