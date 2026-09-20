#!/bin/sh
# Sauvegarde PostgreSQL — appelé par cron dans le conteneur "backup" de
# docker-compose.prod.yml / docker-compose.oracle.yml (image postgis, qui
# fournit déjà pg_dump/psql). Référencé par ces deux fichiers mais absent du
# repo jusqu'ici (le service "backup" échouait silencieusement au montage).
#
# Variables d'environnement attendues (toutes déjà injectées par compose) :
#   PGUSER, PGPASSWORD, PGHOST, PGDATABASE   — connexion Postgres
#   BACKUP_DIR                                — répertoire local (def: /backup/data)
#   BACKUP_RETENTION_DAYS                     — purge locale (def: 30)
#   BACKUP_S3_BUCKET, BACKUP_S3_ENDPOINT       — optionnel, upload S3-compatible
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY   — optionnel, requis si upload S3
set -eu

# CRON NE TRANSMET PAS L'ENVIRONNEMENT DU CONTENEUR (audit 2026-09-20 : ce script échouait chaque
# nuit avec « PGHOST: parameter not set » — 26 jours sans AUCUNE sauvegarde, en silence). On relit
# donc les variables utiles depuis le processus 1 du conteneur (celui que Docker a démarré avec
# l'environnement de compose). Sans effet si elles sont déjà présentes (exécution manuelle).
if [ -z "${PGHOST:-}" ] && [ -r /proc/1/environ ]; then
  ENVTMP="$(mktemp)"
  tr '\0' '\n' < /proc/1/environ | grep -E '^(PG[A-Z]*|BACKUP_[A-Z0-9_]*|AWS_[A-Z_]*|TRACCAR_[A-Z_]*)=' > "$ENVTMP" || true
  while IFS= read -r kv; do export "$kv"; done < "$ENVTMP"
  rm -f "$ENVTMP"
fi

BACKUP_DIR="${BACKUP_DIR:-/backup/data}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
FILENAME="delivery_tracking_${TIMESTAMP}.sql.gz"
FILEPATH="${BACKUP_DIR}/${FILENAME}"

mkdir -p "$BACKUP_DIR"

echo "[backup] $(date -u +%FT%TZ) démarrage — cible: ${PGHOST}/${PGDATABASE}"

# pg_dump en format plain + gzip : simple à restaurer (gunzip | psql), pas de
# dépendance à un format binaire pg_restore spécifique à une version majeure.
if pg_dump --no-owner --no-privileges | gzip > "$FILEPATH"; then
  echo "[backup] dump local OK: ${FILEPATH} ($(du -h "$FILEPATH" | cut -f1))"
else
  echo "[backup] ERREUR: pg_dump a échoué" >&2
  rm -f "$FILEPATH"
  exit 1
fi

# Un dump vide ou corrompu ne vaut rien : on le vérifie (intégrité gzip + taille minimale + présence
# de la table des positions) avant de le déclarer bon.
if ! gzip -t "$FILEPATH" || [ "$(stat -c %s "$FILEPATH")" -lt 1000 ] || ! gunzip -c "$FILEPATH" | grep -q 'gps_positions'; then
  echo "[backup] ERREUR: dump invalide (${FILEPATH})" >&2
  rm -f "$FILEPATH"
  exit 1
fi
echo "[backup] dump vérifié (intégrité gzip + contenu)"

# Traccar (audit 2026-09-20 : sa base H2, qui contient l'enregistrement des traceurs, n'était sauvegardée
# nulle part). Deux copies, en « meilleur effort » (jamais bloquant pour le dump PostgreSQL) :
#  - export JSON via l'API (appareils, utilisateurs, groupes) : cohérent, restaurable par l'API ;
#  - copie brute du fichier H2 (volume monté en lecture seule) : peut être incohérente si Traccar écrit
#    pendant la copie, à n'utiliser qu'en dernier recours.
TRACCAR_FILE="${BACKUP_DIR}/traccar_${TIMESTAMP}.tar.gz"
TRACCAR_TMP="$(mktemp -d)"
# (l'image n'a pas curl : l'export JSON est alors fait côté hôte par traccar/export-registry.sh)
if command -v curl >/dev/null 2>&1 && [ -n "${TRACCAR_URL:-}" ] && [ -n "${TRACCAR_USER:-}" ] && [ -n "${TRACCAR_PASSWORD:-}" ]; then
  COOKIE="${TRACCAR_TMP}/cj"
  if curl -sf -c "$COOKIE" --data-urlencode "email=${TRACCAR_USER}" --data-urlencode "password=${TRACCAR_PASSWORD}" "${TRACCAR_URL}/api/session" -o /dev/null; then
    for r in devices users groups geofences; do
      curl -sf -b "$COOKIE" "${TRACCAR_URL}/api/${r}" -o "${TRACCAR_TMP}/${r}.json" || echo "[backup] WARNING: export Traccar /${r} impossible" >&2
    done
  else
    echo "[backup] WARNING: connexion à Traccar impossible — export JSON ignoré" >&2
  fi
fi
[ -r /backup/traccar/database.mv.db ] && cp /backup/traccar/database.mv.db "${TRACCAR_TMP}/database.mv.db" 2>/dev/null || true
if [ -n "$(ls -A "$TRACCAR_TMP" 2>/dev/null | grep -v '^cj$' || true)" ]; then
  tar -C "$TRACCAR_TMP" --exclude=cj -czf "$TRACCAR_FILE" . && echo "[backup] Traccar sauvegardé: ${TRACCAR_FILE} ($(du -h "$TRACCAR_FILE" | cut -f1))"
else
  echo "[backup] WARNING: rien à sauvegarder côté Traccar" >&2
fi
rm -rf "$TRACCAR_TMP"

# Upload S3-compatible (Oracle Object Storage, AWS S3, Backblaze B2, etc.) —
# seulement si les 3 variables sont renseignées ; sinon on ne fait QUE le
# backup local (jamais bloquant : un backup local vaut mieux que pas de backup
# du tout si la config S3 est incomplète).
if [ -n "${BACKUP_S3_BUCKET:-}" ] && [ -n "${AWS_ACCESS_KEY_ID:-}" ] && [ -n "${AWS_SECRET_ACCESS_KEY:-}" ]; then
  ENDPOINT_ARGS=""
  if [ -n "${BACKUP_S3_ENDPOINT:-}" ]; then
    ENDPOINT_ARGS="--endpoint-url=${BACKUP_S3_ENDPOINT}"
  fi
  if aws $ENDPOINT_ARGS s3 cp "$FILEPATH" "s3://${BACKUP_S3_BUCKET}/${FILENAME}"; then
    echo "[backup] upload S3 OK: s3://${BACKUP_S3_BUCKET}/${FILENAME}"
  else
    echo "[backup] WARNING: upload S3 a échoué — le backup local est conservé" >&2
  fi
else
  echo "[backup] BACKUP_S3_BUCKET/AWS_* non configurés — backup local uniquement"
fi

# Purge locale : ne garde que les N derniers jours (l'historique long terme
# vit dans le bucket S3 si configuré, pas sur le disque de la VM).
find "$BACKUP_DIR" \( -name 'delivery_tracking_*.sql.gz' -o -name 'traccar_*.tar.gz' \) -mtime "+${RETENTION_DAYS}" -delete
echo "[backup] purge locale (> ${RETENTION_DAYS}j) effectuée"
echo "[backup] $(date -u +%FT%TZ) terminé"
