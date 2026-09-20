#!/bin/sh
# Maintenance des journaux Traccar — SANS redémarrer Traccar (aucune coupure de réception GPS).
#
# Contexte (audit disque 2026-09-20) : `logger.level=ALL` journalisait tout le détail
# interne de Jetty (>99,9 % du fichier) : 1 à 4 Go/jour, jamais purgés, stockés dans la
# couche du container. Ce script compresse (~14x) les journaux ROTATIFS de plus d'un jour
# et purge ceux de plus de KEEP_DAYS jours. Le fichier actif (tracker-server.log) n'est
# jamais touché. Planifié quotidiennement par /etc/cron.d/traccar-log-maintenance (voir traccar/log-maintenance.sh).
set -eu
CONTAINER="${TRACCAR_CONTAINER:-delivery-tracking-traccar}"
KEEP_DAYS="${KEEP_DAYS:-7}"

docker exec "$CONTAINER" sh -c "
  cd /opt/traccar/logs || exit 0
  for f in tracker-server.log.2*; do
    [ -e \"\$f\" ] || continue
    case \"\$f\" in *.gz) continue ;; esac
    nice -n 19 gzip -6 \"\$f\"
  done
  find . -name 'tracker-server.log.2*.gz' -mtime +${KEEP_DAYS} -delete
"
