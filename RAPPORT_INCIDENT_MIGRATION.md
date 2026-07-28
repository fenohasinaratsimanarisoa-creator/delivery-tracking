# RAPPORT D'INCIDENT — Migration `remove_tracker_protocol_chain` (P3018)

## 1. Sorties SQL brutes

### (1) Contraintes existantes sur les tables tracker

```sql
SELECT conname FROM pg_constraint WHERE conrelid = 'tracker_devices'::regclass;
```

```
tracker_devices_company_id_fkey
tracker_devices_device_model_id_fkey
tracker_devices_imei_key
tracker_devices_pkey
```

```sql
SELECT conname FROM pg_constraint WHERE conrelid = 'device_commands'::regclass;
```

```
device_commands_pkey
device_commands_tracker_id_fkey
```

### (2) État de la migration échouée dans `_prisma_migrations`

```sql
SELECT migration_name, started_at, finished_at, applied_steps_count, logs
FROM _prisma_migrations ORDER BY started_at DESC LIMIT 5;
```

| migration_name | started_at | finished_at | applied_steps_count | logs |
|---|---|---|---|---|
| `20260728071436_remove_tracker_protocol_chain` | `2026-07-28T07:23:27.667Z` | `null` | `0` | *(voir ci-dessous)* |
| `20260727120000_add_tracker_device_system` | `2026-07-27T09:41:26.774Z` | `2026-07-27T09:41:26.962Z` | `1` | `null` |
| `20260726180000_add_import_fields` | `2026-07-26T15:58:34.061Z` | `2026-07-26T15:58:34.130Z` | `1` | `null` |
| `20260724091819_remove_fleet_model` | `2026-07-24T10:37:28.782Z` | `2026-07-24T10:37:28.860Z` | `1` | `null` |
| `20260724091040_add_fleet_model` | `2026-07-24T10:37:28.701Z` | `2026-07-24T10:37:28.779Z` | `1` | `null` |

**Logs d'erreur complets :**
```
A migration failed to apply. New migrations cannot be applied before the error is recovered from.

Migration name: 20260728071436_remove_tracker_protocol_chain

Database error code: 42704

Database error:
ERROR: constraint "tracker_devices_vehicle_id_fkey" of relation "tracker_devices" does not exist
```

### (3a) Tables encore présentes ?

```sql
SELECT tablename FROM pg_tables
WHERE tablename IN ('device_commands','device_models','tracker_devices');
```

| tablename |
|---|
| `device_models` |
| `tracker_devices` |
| `device_commands` |

**Toutes les 3 tables existent encore.**

### (3b) Enum `TrackerProtocol` encore présent ?

```sql
SELECT typname FROM pg_type WHERE typname = 'TrackerProtocol';
```

| typname |
|---|
| `TrackerProtocol` |

**L'enum existe encore.**

### (3c) FK spécifiques encore présentes ?

```sql
SELECT conname FROM pg_constraint WHERE conname IN (
  'device_commands_tracker_id_fkey',
  'tracker_devices_company_id_fkey',
  'tracker_devices_device_model_id_fkey',
  'tracker_devices_vehicle_id_fkey'
);
```

| conname |
|---|
| `device_commands_tracker_id_fkey` |
| `tracker_devices_company_id_fkey` |
| `tracker_devices_device_model_id_fkey` |

**3 FK sur 4 existent.** `tracker_devices_vehicle_id_fkey` est absente.

### (3d) Nombre de lignes dans les tables tracker

```sql
SELECT 'device_commands' as tbl, count(*) FROM device_commands UNION ALL
SELECT 'device_models', count(*) FROM device_models UNION ALL
SELECT 'tracker_devices', count(*) FROM tracker_devices;
```

| tbl | count |
|---|---|
| `device_commands` | 0 |
| `device_models` | 0 |
| `tracker_devices` | 0 |

**Toutes les tables sont vides.**

---

## 2. Analyse de la cause

La migration SQL exécutée contient 4 instructions `ALTER TABLE ... DROP CONSTRAINT` dans cet ordre :

```sql
1. ALTER TABLE "device_commands"      DROP CONSTRAINT "device_commands_tracker_id_fkey";
2. ALTER TABLE "tracker_devices"      DROP CONSTRAINT "tracker_devices_company_id_fkey";
3. ALTER TABLE "tracker_devices"      DROP CONSTRAINT "tracker_devices_device_model_id_fkey";
4. ALTER TABLE "tracker_devices"      DROP CONSTRAINT "tracker_devices_vehicle_id_fkey";
5. DROP TABLE "device_commands";
6. DROP TABLE "device_models";
7. DROP TABLE "tracker_devices";
8. DROP TYPE "TrackerProtocol";
```

**Cause directe :** la contrainte `tracker_devices_vehicle_id_fkey` (FK entre `tracker_devices.vehicle_id` et `vehicles.id`) **n'existe pas** dans la base de production. Les 3 premières FK existent bien, mais la 4e non.

**Pourquoi elle n'existe pas ?** La migration `20260727120000_add_tracker_device_system` qui a créé les tables contient bien `ADD CONSTRAINT "tracker_devices_vehicle_id_fkey" ...`. Mais en production, elle a pu être :
- Supprimée manuellement après sa création
- Créée sous un autre nom (renommage manuel)
- Ou la migration a été modifiée avant application

Peu importe la raison historique — la constatation est que le fichier SQL de notre migration a été généré par `prisma migrate diff` contre une base locale (fraîche) où cette FK existait, mais **la base de production a un état différent** concernant cette FK.

**Pourquoi `applied_steps_count=0` ?** Prisma exécute tout le fichier SQL d'une migration dans **une seule transaction**. Quand la 4e instruction échoue, PostgreSQL rollback la transaction entière. Aucune des 3 premières instructions (pourtant valides) n'est appliquée. La base est donc dans son état initial — rien n'a changé.

---

## 3. État réel de la base de production (résumé)

| Objet | Existe ? |
|---|---|
| Table `device_commands` | **OUI** — vide |
| Table `device_models` | **OUI** — vide |
| Table `tracker_devices` | **OUI** — vide |
| Enum `TrackerProtocol` | **OUI** |
| FK `device_commands_tracker_id_fkey` | **OUI** |
| FK `tracker_devices_company_id_fkey` | **OUI** |
| FK `tracker_devices_device_model_id_fkey` | **OUI** |
| FK `tracker_devices_vehicle_id_fkey` | **NON** — cause de l'échec |
| Migration `remove_tracker_protocol_chain` | **failed** (`applied_steps_count=0`) — rien n'a été modifié |

**Conclusion : la base est inchangée par la migration échouée** car la transaction entière a été rollbackée. Toutes les instructions du fichier SQL sont encore à exécuter.

---

## 4. Prochaine étape nécessaire

Le correctif consiste à **modifier le fichier `migration.sql`** pour retirer la ligne qui tente de dropper `tracker_devices_vehicle_id_fkey` (inexistante), puis marquer la migration comme résolue via `prisma migrate resolve --rolled-back` et réappliquer. Mais conformément aux interdictions, **aucune modification de la base ni du fichier de migration n'a été effectuée** — ce rapport est un diagnostic pur.
