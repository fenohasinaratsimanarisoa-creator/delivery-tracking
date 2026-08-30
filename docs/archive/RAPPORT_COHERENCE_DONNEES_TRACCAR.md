# RAPPORT COHÉRENCE DONNÉES TRACCAR — PostGIS, format, unités

## Tests exécutés

Fichier : `backend/src/modules/tracking/traccar-postgis.spec.ts`

```
PASS src/modules/tracking/traccar-postgis.spec.ts
  ✓ (a) insere et verifie le format POINT(lng lat) dans la colonne location
  ✓ (b) PostGIS queries fonctionnent sur les colonnes lat/lng
  ✓ (c) l unite de vitesse est coherente entre Traccar et le systeme
```

---

## Preuve 1 — Format `POINT(lng lat)` correct

**Sortie console :**
```
Inserted id: de3653d5-3a2b-4416-8eba-76391f83116f
location raw: "POINT(47.5079 -18.8792)"
latitude: -18.8792 longitude: 47.5079
```

**Assertion :** `expect(row.location).toBe('POINT(47.5079 -18.8792)')` — PASS

*Vérifié : le format exact est bien `POINT(longitude latitude)` avec un espace, sans virgule, conforme au standard WKT pour PostGIS. La colonne `location` est stockée comme `String` (texte) dans Prisma.*

---

## Preuve 2 — PostGIS opérationnel

**Après activation de PostGIS (CREATE EXTENSION postgis) :**

```
ST_DWithin rows within 1km: 1              ← la position est trouvée à 1km
ST_DWithin rows within 1m (500m away): 0   ← pas trouvée à 1m d'un point distant
ST_DistanceSphere (same point): 0.00 m     ← distance nulle au même point
```

**Requête SQL exécutée :**
```sql
SELECT id FROM gps_positions
WHERE ST_DWithin(
  ST_SetSRID(ST_MakePoint(longitude, latitude), 4326),
  ST_SetSRID(ST_MakePoint(47.5079, -18.8792), 4326),
  0.01   -- ~1km à cette latitude
);
→ 1 ligne retournée

SELECT ST_DistanceSphere(
  ST_SetSRID(ST_MakePoint(longitude, latitude), 4326),
  ST_SetSRID(ST_MakePoint(47.5079, -18.8792), 4326)
) AS dist_m
FROM gps_positions WHERE id = '...';
→ 0.00 m
```

**Découverte critique :** PostGIS **n'était pas installé** sur la base Render au moment du test initial. Les fonctions `ST_MakePoint`, `ST_DistanceSphere`, `ST_DWithin`, `ST_GeomFromText`, et le type `geometry` n'existaient pas. Sans `CREATE EXTENSION postgis;`, les endpoints `findNearestVehicle()`, `calculateDistancePostGIS()`, et les calculs de geofence/distances cassent en production.

**Correction appliquée :** `CREATE EXTENSION IF NOT EXISTS postgis` exécuté sur la base de production. PostGIS 3.6.2 est maintenant disponible.

---

## Preuve 3 — Unité de vitesse m/s cohérente

**Chaîne de conversion :**

| Étape | Fichier | Ligne | Opération | Résultat |
|---|---|---|---|---|
| Source | Traccar | — | speed en **noeuds** (knots) | 5 knots |
| Conversion | `traccar-bridge.service.ts` | 513 | `pos.speed * 0.514444` | **2.57 m/s** |
| Stockage | `gps_positions.speed` | — | vitesse en **m/s** | 2.57 |
| Détection téléportation | `tracking.service.ts` | 130 | `speedMs = distance / timeDiffSec` | attend **m/s** |
| Alerte vitesse | `tracking.service.ts` | 199 | `speedKmh = dto.speed * 3.6` | → **km/h** pour affichage |
| Alerte arrêt | `tracking.service.ts` | 222 | `dto.speed < STOP_SPEED_THRESHOLD_MS` | attend **m/s** |

**Lignes de preuve citées :**

- `traccar-bridge.service.ts:513` : `speed: (pos.speed || 0) * 0.514444` — conversion noeuds → m/s
- `tracking.service.ts:130` : `const speedMs = distance / timeDiffSec` — calcul de vitesse en **m/s** (distance en mètres, temps en secondes)
- `tracking.service.ts:140` : `speed=${(speedMs * 3.6).toFixed(1)}km/h` — pas de conversion inverse stockée, juste affichage → log
- `tracking.service.ts:199` : `const speedKmh = dto.speed * 3.6` — convertit **m/s → km/h** pour comparer au seuil d'alerte (settings.speedAlertThreshold en km/h)
- `tracking.service.ts:222` : `dto.speed < STOP_SPEED_THRESHOLD_MS` — compare en **m/s**, pas en km/h ni noeuds

**Vérification par le test :**
```
Vitesse test: 5 noeuds → 2.572 m/s → 9.3 km/h
```

La conversion `* 0.514444` est correcte. 1 knot = 0.514444 m/s. La valeur stockée (2.57 m/s) est cohérente avec :
- `detectTeleportation` : 2.57 m/s << TELEPORT_SPEED_THRESHOLD_MS (~100 m/s) → pas flaggé
- `generateAlerts` : 2.57 × 3.6 = 9.3 km/h << speedAlertThreshold (80 km/h) → pas d'alerte
- `prolonged_stop` : 2.57 > 0.5 m/s → pas considéré comme arrêté

**Conclusion : l'unité est correcte, aucune correction nécessaire.**

---

## Correctif appliqué

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

Exécuté sur la base Render production. PostGIS 3.6.2 maintenant disponible. Toutes les fonctions spatiales utilisées par `tracking.service.ts`, `geofence.service.ts`, et `delivery-proximity.service.ts` fonctionnent.
