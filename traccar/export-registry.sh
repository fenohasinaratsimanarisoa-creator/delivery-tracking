#!/bin/sh
# Export de l'enregistrement Traccar (appareils, utilisateurs, groupes, géorepères) via son API,
# vers le volume de sauvegarde. Exécuté sur l'HÔTE (curl y est disponible ; l'image du service
# `backup` est une Debian 11 en fin de vie sans curl). Planifié par /etc/cron.d/traccar-export.
# Audit 2026-09-20 : la base H2 de Traccar n'était sauvegardée nulle part.
set -eu
ENV_FILE="${ENV_FILE:-/opt/delivery-tracking/.env}"
OUT_DIR="${OUT_DIR:-/var/lib/docker/volumes/delivery-tracking_backupdata/_data}"
BASE="${TRACCAR_LOCAL_URL:-http://127.0.0.1:8082}"
KEEP_DAYS="${KEEP_DAYS:-30}"

getenv() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"; }
USER_="$(getenv TRACCAR_USER)"; PASS_="$(getenv TRACCAR_PASSWORD)"
[ -n "$USER_" ] && [ -n "$PASS_" ] || { echo "[traccar-export] identifiants absents de $ENV_FILE" >&2; exit 1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
curl -sf -c "$TMP/cj" --data-urlencode "email=$USER_" --data-urlencode "password=$PASS_" "$BASE/api/session" -o /dev/null \
  || { echo "[traccar-export] connexion à Traccar impossible" >&2; exit 1; }
for r in devices users groups geofences; do
  curl -sf -b "$TMP/cj" "$BASE/api/$r" -o "$TMP/$r.json" || { echo "[traccar-export] export /$r impossible" >&2; exit 1; }
done
# Un export sans appareil serait suspect : on le refuse plutôt que d'écraser une bonne sauvegarde.
grep -q '"uniqueId"' "$TMP/devices.json" || { echo "[traccar-export] AUCUN appareil dans l'export — abandon" >&2; exit 1; }
STAMP="$(date -u +%Y%m%d_%H%M%S)"
tar -C "$TMP" --exclude=cj -czf "$OUT_DIR/traccar_api_${STAMP}.tar.gz" devices.json users.json groups.json geofences.json
echo "[traccar-export] $(date -u +%FT%TZ) OK: traccar_api_${STAMP}.tar.gz ($(du -h "$OUT_DIR/traccar_api_${STAMP}.tar.gz" | cut -f1))"
find "$OUT_DIR" -name 'traccar_api_*.tar.gz' -mtime "+$KEEP_DAYS" -delete
