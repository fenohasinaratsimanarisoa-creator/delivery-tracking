# AUDIT ROBUSTESSE UNIVERSELLE DU PONT TRACCAR — 2026-08-15

**Objectif** : garantir que `traccar-bridge.service.ts` ne fait AUCUNE hypothèse de
protocole/marque et consomme uniquement l'objet Position normalisé de Traccar, quel que
soit le traceur acheté (GT06, TK103, Teltonika, Meitrack, H02, Concox…).
**Méthode** : audit champ par champ → correctifs appliqués directement + tests → build + suite traccar.

---

## 1. Hypothèses implicites / risques par champ Position

| # | Champ | Analyse | Verdict |
|---|---|---|---|
| 1 | `speed` | **Confirmé doc Traccar** (`Position.java` : `private double speed; // value in knots`) : Traccar normalise en nœuds à la décodification, quel que soit le protocole source. `(pos.speed \|\| 0) * 0.514444` est correct pour TOUS les protocoles. `undefined` → 0 (géré). | ✅ Aucun changement |
| 2 | `valid` | `pos.valid === false` rejette (LBS/cellulaire) ; `undefined` est ACCEPTÉ (protocoles qui ne l'envoient jamais). Cohérent : un protocole sans flag n'est ni traité comme invalide ni supposé faux. | ✅ Comportement correct, **test ajouté** |
| 3 | `fixTime` / `deviceTime` | **BUG confirmé (corrigé)** : un fixTime DANS LE FUTUR (horloge traceur mal synchronisée) était accepté tel quel → `minutes_ago` négatif sur la carte, **détection offline jamais déclenchée** (now − lastPos < 0), et après resynchronisation → fixes suivants marqués suspect `non_croissant`. Le filtre `filter.future=300` de `traccar.xml` ne protège que l'auto-hébergé dev (PAS garanti sur Traccar Cloud prod). | 🔧 **Corrigé** : clamp sur l'heure serveur si skew > 300s |
| 4 | `accuracy` / `attributes.hdop` | **BUG confirmé (corrigé)** : `computeCombinedAccuracy` interprétait tout `hdop > 0` comme valide. Un traceur bas de gamme renvoyant un `hdop` non standard (100-1000 : puissance signal, compteur, unité différente) produisait une accuracy dérivée **> 1000 → la position était REJETÉE par `validateSync` (DTO `@Max(1000)`)** — perte silencieuse. Repli sans accuracy/hdop → 50 m (déjà correct). | 🔧 **Corrigé** : `hdop > 50` ignoré + accuracy finale clampée à 1000 |
| 5 | `course` / `altitude` | `pos.course \|\| 0` / `pos.altitude \|\| 0` — absents → 0 (géré, générique). | ✅ Aucun changement |
| 6 | `deviceId` | ID **numérique généré par Traccar** à la création du device, indépendant du protocole/IMEI/uniqueId → stable quel que soit le modèle. `String(pos.deviceId)` + colonne STRING en base + matching cohérent avec `linkVehicleToTraccar` et `getAvailableTraccarDevices` (`String(d.id)`). | ✅ Aucun changement |
| 7 | Fréquence / rafales | Le chemin Traccar n'a **aucun rate limit** (contrairement au WS téléphone) ; `BATCH_INTERVAL_MS` ne concerne que le retry de la file d'échec Redis. Une rafale (Teltonika) est traitée séquentiellement sans perte. | ✅ **Test ajouté** (3 positions → 3 save) |
| 8 | Téléportation — scale accuracy | **BUG confirmé (corrigé)** : `evaluateTeleportation` multipliait les seuils par `max(1, accuracy/10)` SANS plafond → une accuracy aberrante (500 m, ou le repli 50 m d'un device sans accuracy) gonflait le seuil de vitesse à 277-2778 m/s → **détection de téléportation désactivée en pratique** (vrais sauts GPS jamais signalés). Incohérent avec le filtre de bruit (`geo.utils` plafonne à 1.5). | 🔧 **Corrigé** : plafond `GPS_NOISE_MAX_ACCURACY_SCALE` (1.5) → seuil max 83 m/s (300 km/h), jamais atteint par un véhicule réel |
| 9 | `isBackfill` | Paramètre mort — **déjà supprimé** lors de l'audit GPS précédent (commit `91ad117`, B3) : `handlePosition(pos)` sans 2e argument, aucun appelant ne passait `true`. Le backfill passe par `performBackfill()` (méthode séparée, insère via `createMany` sans alertes — comportement voulu). | ✅ Déjà corrigé |

## 2. Matching device / uniqueId (vehicles.service.ts)

- `createTraccarDevice(name, uniqueId)` (ligne 180) : `uniqueId` est une **chaîne libre**
  (IMEI OU identifiant non-numérique), préfixée par entreprise (`companyId.slice(0,8)-`) pour
  l'isolation multi-tenant. **Aucune hypothèse de format numérique** → compatible avec les
  protocoles à uniqueId non-numérique. ✅
- ⚠️ **Point à connaître** : la doc officielle (`TRACCAR_SETUP.md` §2/§6.1) préconise de créer
  le device **directement dans Traccar avec l'IMEI réel** (Traccar matche le traceur sur cet
  identifiant), puis de lier le deviceId dans DelivTrack. `createTraccarDevice` (endpoint REST)
  sert au pré-provisionnement côté app : le préfixe entreprise n'est PAS l'IMEI — ne pas
  confondre avec la création du device pour un traceur physique réel (voir doc 6.1).
- `getAvailableTraccarDevices` (ligne 219) : filtre par préfixe entreprise + exclusion des
  devices déjà liés (toutes entreprises) — pas d'hypothèse protocole. ✅

## 3. Diagnostic (diagnosePlatformConfig / TraccarDiagnoseReport)

- L'inférence de protocole (`device.attributes.protocol` / `Position.protocol`) est générique
  et non bloquante (fallback documenté). ✅
- Le cas « device créé mais aucune position » est couvert par :
  - la notification **« Traceur physique : jamais connecté »** (`checkNeverConnectedDevices`,
    ~30 min après création) qui liste les **4 causes** : SIM/APN, protocole non activé, port
    firewall, mauvais identifiant ;
  - le **guide 6.4** ajouté dans `TRACCAR_SETUP.md` (mêmes 4 causes, par ordre de fréquence)
    + la vérification pré-liaison (`GET /api/positions?deviceId=` doit être non vide). ✅

## 4. Correctifs appliqués (avec tests)

| Fichier | Correctif |
|---|---|
| `traccar-bridge.service.ts` | `parseTimestamp` : clamp des fixTime futurs (> 300 s) sur l'heure serveur (constante `TRACCAR_FUTURE_SKEW_TOLERANCE_MS`) |
| `common/geo/gps-quality.ts` | `computeCombinedAccuracy` : `hdop` hors plage plausible (> 50) ignoré ; accuracy finale clampée à 1000 m (aligné DTO `@Max(1000)`) |
| `common/geo/teleportation.utils.ts` | `evaluateTeleportation` : scale accuracy plafonné à `GPS_NOISE_MAX_ACCURACY_SCALE` (1.5) |
| `tracking/traccar-bridge-valid.spec.ts` | +6 tests : `valid=undefined` accepté, horloge future clampée, hdop aberrant ignoré, repli 50 m, accuracy > 1000 clampée (jamais rejetée), rafale 3 positions → 3 save |
| `tracking/tracking.service.spec.ts` | +1 test : accuracy 100 m + saut 500 m/5 s → suspect DÉTECTÉ (plafond du scale) |
| `TRACCAR_SETUP.md` | Nouvelle section 6 « Ajouter un nouveau protocole/traceur » : procédure Traccar Cloud + auto-hébergé (traccar.xml, docker-compose, ufw + firewall DigitalOcean), vérifications pré-liaison, causes « aucune position », tableau de robustesse du pont |

## 5. Vérifications

- `npm run build` : OK (nest build, zéro erreur, zéro dépendance circulaire)
- Suite backend complète : **65 suites / 783 tests OK** (+7 tests, 6 skips préexistants)
- Suites traccar : `traccar-bridge-valid.spec.ts`, `traccar-parity.spec.ts`,
  `traccar-multitenant.spec.ts` etc. — toutes vertes

## 6. Traceurs achetable en confiance vs à vérifier

**✅ Achetable en confiance (protocoles Traccar standard, aucun risque de régression)** :
GT06, TK103, H02, Teltonika, Meitrack, Concox, Coban, Xexun, AST, Navtelecom, L100,
WristWatch, OsmAnd — et globalement **tout protocole de la liste officielle Traccar**
(`https://www.traccar.org/protocols/`), à condition de suivre la procédure §6.1/§6.2
(activer le port + créer le device avec le bon identifiant).

**⚠️ À vérifier manuellement avant achat (cas de figure rares)** :
- Traceur dont le protocole n'apparaît PAS dans la liste Traccar (protocole propriétaire) —
  à vérifier que Traccar le supporte réellement (test device avant liaison).
- Traceur envoyant des données via **HTTP/JSON personnalisé** au lieu d'un protocole TCP
  standard — nécessite un pont dédié (hors périmètre Traccar).
- Traceur avec `uniqueId` non-IMEI : supporté par Traccar et par le bridge (chaîne libre),
  mais le device doit être créé avec CET identifiant exact (pas l'IMEI).
- Traceur 4G LTE en zone rurale mal couverte : problème de réseau, pas de code.
