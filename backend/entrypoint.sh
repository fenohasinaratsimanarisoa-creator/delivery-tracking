#!/bin/sh
# Entrypoint robuste : les migrations/seed ne doivent JAMAIS bloquer le démarrage
# du serveur. Un `prisma migrate deploy` qui reste bloqué (verrou de migration,
# connexion DB lente, migration non destructible refusée) empêchait l'app de
# bind le port → "Port scan timeout, no open ports detected" côté Render.
# Chaque étape est bornée par `timeout` ; en cas de dépassement ou d'échec non
# récupérable, on démarre quand même l'API (le schéma est en général déjà
# synchronisé via db push / les déploiements précédents).
set -u

# Durée max (s) d'une étape migration/seed. Réglable via l'env Render si besoin.
MIGRATE_TIMEOUT="${MIGRATE_TIMEOUT:-90}"

run_migrate() {
  echo "[startup] prisma migrate deploy (timeout ${MIGRATE_TIMEOUT}s)"
  timeout "$MIGRATE_TIMEOUT" npx prisma migrate deploy
}

if [ "${RESET_DATABASE:-}" = "true" ]; then
  echo "[startup] RESET_DATABASE=true — prisma migrate reset --force (timeout ${MIGRATE_TIMEOUT}s)"
  timeout "$MIGRATE_TIMEOUT" npx prisma migrate reset --force \
    || echo "[startup] WARNING: migrate reset failed/timed out — continuing"
else
  if run_migrate; then
    echo "[startup] migrations OK"
  else
    echo "[startup] migrate deploy a échoué ou a dépassé le timeout (dérive db push probable)."
    # Sémantiquement correct : la colonne notifications.digest_sent_at existe déjà
    # en prod (synchronisée par db push) — la marquer appliquée ne perd rien.
    timeout "$MIGRATE_TIMEOUT" npx prisma migrate resolve --applied 20260807000000_add_digest_sent_at \
      >/dev/null 2>&1 \
      || echo "[startup] WARNING: resolve a échoué (peut-être déjà résolu) — on continue"

    echo "[startup] retry prisma migrate deploy"
    if run_migrate; then
      echo "[startup] migrations OK (après auto-réparation)"
    else
      echo "[startup] migrations toujours en échec — synchronisation non destructive via db push"
      timeout "$MIGRATE_TIMEOUT" npx prisma db push --accept-data-loss=false \
        && echo "[startup] db push OK" \
        || echo "[startup] WARNING: db push a échoué/timed out — on démarre l'API quand même"
    fi
  fi
fi

if [ -n "${SEED_ADMIN_EMAIL:-}" ]; then
  echo "[startup] SEED_ADMIN_EMAIL set — seeding super admin (timeout ${MIGRATE_TIMEOUT}s)"
  timeout "$MIGRATE_TIMEOUT" npx ts-node prisma/seed.ts \
    || echo "[startup] WARNING: seed failed/timed out — continuing"
else
  echo "[startup] SEED_ADMIN_EMAIL not set — seed skipped"
fi

echo "[startup] starting API on port ${PORT:-3000}"
exec node dist/src/main
