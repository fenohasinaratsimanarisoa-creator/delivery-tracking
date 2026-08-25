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
find "$BACKUP_DIR" -name 'delivery_tracking_*.sql.gz' -mtime "+${RETENTION_DAYS}" -delete
echo "[backup] purge locale (> ${RETENTION_DAYS}j) effectuée"
echo "[backup] $(date -u +%FT%TZ) terminé"
