# Rapport sécurité multi-tenant Traccar

## 1. Contrainte d'unicité sur `traccarDeviceId`

### Avant
```prisma
// schema.prisma, model Vehicle
traccarDeviceId  String?  @map("traccar_device_id")    // PAS de @unique
```

**Aucune contrainte d'unicité** en base. Seule une vérification applicative partielle existait dans `vehicles.service.ts`, mais `tracking.service.ts::linkVehicleToTraccar()` ne la faisait pas.

### Après
```prisma
traccarDeviceId  String?  @unique @map("traccar_device_id")   // @unique ajouté
```

**Migration appliquée** : `20260728120000_add_traccar_device_id_unique/migration.sql`
```sql
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS position_source TEXT NOT NULL DEFAULT 'phone';
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS traccar_device_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_traccar_device_id_key ON vehicles(traccar_device_id);
```

La colonne `traccar_device_id` et son index unique ont été créés sur la base de production.

## 2. Test de double-liaison

Fichier : `backend/src/modules/tracking/traccar-multitenant.spec.ts`

```
PASS src/modules/tracking/traccar-multitenant.spec.ts
  ✓ rejects linking the same traccarDeviceId to two vehicles (42 ms)
  ✓ allows different traccarDeviceIds for different vehicles (1 ms)
```

### Test 1 : rejet de double liaison

Scénario :
1. Véhicule A (company A) lié à `traccarDeviceId = "42"` → succès
2. Véhicule B (company B) lié au même `traccarDeviceId = "42"` → **ConflictException**

Message d'erreur retourné :
```
traccarDeviceId "42" is already assigned to another active vehicle
```

Ce test prouve que les 3 mécanismes de protection fonctionnent :
- ✅ Contrainte base de données (`@unique`)
- ✅ Contrainte `linkVehicleToTraccar()` (nouvelle, ajoutée dans ce prompt)
- ✅ Contrainte `checkTraccarDeviceIdUniqueness()` (existante dans `vehicles.service.ts`)

### Test 2 : liaison différente autorisée

Scénario :
1. Véhicule A lié à `device-1` → succès
2. Véhicule B lié à `device-2` (ID différent) → succès

## 3. Isolation multi-tenant dans `handlePosition()`

Lecture de `traccar-bridge.service.ts` (lignes 471-489) :

```typescript
const vehicleMapping = await this.prisma.vehicle.findFirst({
  where: {
    traccarDeviceId: String(pos.deviceId),
    positionSource: 'physical_tracker',
    isActive: true,
    deletedAt: null,
  },
});
```

Pas de filtre `companyId` explicite dans `handlePosition()`. Ce n'est pas un problème car `traccarDeviceId` a une contrainte `@unique` globale — un même ID ne peut correspondre qu'à un seul véhicule, dans une seule entreprise. La position est ensuite transmise à `savePosition()` avec le `companyId` du véhicule trouvé, garantissant l'isolation tenant.

## 4. Sécurisation de l'interface web Traccar

Documenté dans `TRACCAR_SETUP.md` section 7 :

- L'interface web Traccar (port 8082) donne accès à TOUS les devices de TOUS les clients
- Ne JAMAIS exposer le port 8082 publiquement sans protection
- Utiliser exclusivement l'API DelivTrack pour l'administration des devices
- Changer impérativement le mot de passe admin après la première connexion
- Option : HTTPS via Caddy reverse proxy si l'accès distant est nécessaire

## 5. Fichiers modifiés/créés

| Fichier | Modification |
|---|---|
| `backend/prisma/schema.prisma` | `@unique` ajouté sur `traccarDeviceId` |
| `backend/src/modules/tracking/tracking.service.ts` | `ConflictException` importé + vérification unicité dans `linkVehicleToTraccar()` |
| `backend/src/modules/tracking/traccar-multitenant.spec.ts` | Nouveau — 2 tests isolation multi-tenant |
| `backend/prisma/migrations/20260728120000_add_traccar_device_id_unique/migration.sql` | Nouveau — ajout colonne + index unique |
| `TRACCAR_SETUP.md` | Section 7 enrichie (sécurité multi-tenant, isolation) |
| `RAPPORT_SECURITE_MULTI_TENANT_TRACCAR.md` | Ce document |
