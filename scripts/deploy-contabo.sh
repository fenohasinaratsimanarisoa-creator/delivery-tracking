#!/bin/sh
# Déploiement du VPS Contabo (production) — à exécuter DEPUIS le VPS, dans
# /opt/delivery-tracking (le clone git servant de source de build).
#
#   ssh root@<IP-VPS> '/opt/delivery-tracking/scripts/deploy-contabo.sh'
#
# Reconstruit UNIQUEMENT les services applicatifs (backend/worker/frontend —
# même image que backend pour worker, voir docker-compose.contabo.yml) : les
# services d'infra (postgres/redis/traccar/caddy/backup) ne changent jamais
# via ce dépôt et un rebuild --no-cache de tout prendrait bien plus longtemps
# sans raison. En cas d'échec des vérifications post-déploiement, revient
# automatiquement au commit précédent et redémarre dessus.
set -eu

REPO_DIR="/opt/delivery-tracking"
COMPOSE="docker compose -f docker-compose.contabo.yml"
APP_SERVICES="backend worker frontend"

cd "$REPO_DIR"

log() { echo "[deploy] $(date -u +%FT%TZ) $*"; }

PREVIOUS_COMMIT="$(git rev-parse HEAD)"
log "commit actuel avant déploiement : ${PREVIOUS_COMMIT}"

log "git pull origin main"
git pull origin main

NEW_COMMIT="$(git rev-parse HEAD)"
if [ "$NEW_COMMIT" = "$PREVIOUS_COMMIT" ]; then
  log "déjà à jour (${NEW_COMMIT}) — rien à déployer"
  exit 0
fi
log "nouveau commit : ${NEW_COMMIT}"

rollback() {
  log "ERREUR — retour au commit précédent ${PREVIOUS_COMMIT}"
  git reset --hard "$PREVIOUS_COMMIT"
  # shellcheck disable=SC2086
  $COMPOSE build --no-cache $APP_SERVICES
  # shellcheck disable=SC2086
  $COMPOSE up -d --remove-orphans $APP_SERVICES
  log "rollback effectué — vérifie manuellement l'état avant de retenter"
  exit 1
}

log "build --no-cache ${APP_SERVICES}"
# shellcheck disable=SC2086
if ! $COMPOSE build --no-cache $APP_SERVICES; then
  log "ERREUR — build échoué, aucun service redémarré (l'ancien build tourne encore)"
  git reset --hard "$PREVIOUS_COMMIT"
  exit 1
fi

log "up -d ${APP_SERVICES}"
# shellcheck disable=SC2086
$COMPOSE up -d --remove-orphans $APP_SERVICES

log "attente 15s avant vérification santé"
sleep 15

log "vérification : docker compose ps"
# shellcheck disable=SC2086
$COMPOSE ps $APP_SERVICES

FAILED=0
for svc in backend frontend; do
  STATE="$($COMPOSE ps --format '{{.Health}}' "$svc" 2>/dev/null || echo '')"
  if [ -n "$STATE" ] && [ "$STATE" != "healthy" ]; then
    log "ERREUR — service '${svc}' n'est pas healthy (état: ${STATE})"
    FAILED=1
  fi
done

if ! curl -sf -o /dev/null http://localhost:8080/health; then
  log "ERREUR — GET /health (backend, port 8080) a échoué"
  FAILED=1
fi

if [ "$FAILED" = "1" ]; then
  log "récupération des 50 dernières lignes de logs avant rollback"
  # shellcheck disable=SC2086
  $COMPOSE logs --tail=50 $APP_SERVICES || true
  rollback
fi

log "déploiement OK — commit ${NEW_COMMIT} en production"
