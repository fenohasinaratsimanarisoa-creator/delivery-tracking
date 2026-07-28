# RAPPORT DE DÉPLOIEMENT — Pont Traccar

## 1. Diagnostic render.yaml — Variables manquantes

**Constat :** `render.yaml` ne contenait aucune variable `TRACCAR_URL`, `TRACCAR_USER`, ou `TRACCAR_PASSWORD`. Le `TraccarBridgeService` utilisait donc les valeurs par défaut `http://traccar:8082` / `admin` / `admin` — inactif en production sans alerte visible.

**Correction :** 3 variables ajoutées dans l'`envVarGroup` `deliverytrack-secrets` avec `sync: false` (à renseigner via le Dashboard Render).

### Diff render.yaml

```diff
+      # ── Traccar GPS bridge (set via Render Dashboard) ──
+      # TRACCAR_URL must point to a Traccar server reachable from this service
+      # (HTTP/WebSocket outbound). Render does NOT expose raw TCP ports to the
+      # internet, so Traccar itself must run on a separate VPS with ports 5055-5058
+      # open for GPS tracker protocols. See TRACCAR_SETUP.md for VPS deployment.
+      - key: TRACCAR_URL
+        sync: false
+      - key: TRACCAR_USER
+        sync: false
+      - key: TRACCAR_PASSWORD
+        sync: false
```

---

## 2. Test unitaire — Notification "bridge inactif"

4 tests dans `traccar-inactive.spec.ts`, tous passent :

```
PASS src/modules/tracking/traccar-inactive.spec.ts
  ✓ envoie une notification admin au démarrage si TRACCAR_URL est la valeur par defaut (7 ms)
  ✓ envoie une notification admin si TRACCAR_URL est disabled (2 ms)
  ✓ envoie la notification une seule fois meme si onModuleInit est appele deux fois (2 ms)
  ✓ ne notifie pas si TRACCAR_URL est configure (3 ms)
```

**La notification** est envoyée via `notifications.create('platform', { type: system, priority: high, ... })` une seule fois au démarrage si `TRACCAR_URL` est `http://traccar:8082` ou `disabled`.

---

## 3. Capture curl — Statut bridge inactif

```bash
curl -s http://localhost:3999/tracking/traccar-devices
# → {"statusCode":401,...}  (JwtAuthGuard, normal — le routage est correct)
```

Le serveur a bien démarré avec le log :
```
WARN Traccar bridge: TRACCAR_URL not configured — bridge inactive
```

L'endpoint `GET /tracking/traccar-devices` est bien mappé et injecté avec `TraccarBridgeService.getStatus()` (plus le stub `trackingService.getStatus()` d'avant).

L'endpoint admin `GET /platform-admin/traccar/status` existait déjà et expose le même statut.

---

## 4. Render ne supporte pas le TCP public

**Preuve :** Documentation officielle Render — les Web Services ne reçoivent que du trafic HTTP/HTTPS sur un seul port, terminé SSL par le load balancer Render. Render ne forwarde aucun port TCP brut. Les protocoles GPS binaires (GT06 sur 5055, Teltonika sur 5056, etc.) nécessitent du TCP raw, impossible sur Render.

**Alternative documentée :** VPS dédié pour Traccar, avec Render se connectant en outbound (HTTP/WebSocket) → `TRACCAR_SETUP.md`

---

## 5. Fichiers modifiés/créés

| Fichier | Action |
|---|---|
| `render.yaml` | Modifié — 3 vars Traccar ajoutées |
| `traccar-bridge.service.ts` | Modifié — `notifyInactiveOnce()` ajoutée |
| `tracking.controller.ts` | Modifié — injection `TraccarBridgeService`, endpoint réparé |
| `traccar-inactive.spec.ts` | Nouveau — 4 tests notification inactive |
| `TRACCAR_SETUP.md` | Nouveau — guide déploiement VPS Traccar |
| `RAPPORT_DEPLOIEMENT_TRACCAR.md` | Ce document |
