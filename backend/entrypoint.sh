#!/bin/sh
# Entrypoint robuste : ne laisse jamais un décalage d'historique de migrations
# (ex. colonne déjà présente en base via `prisma db push`) bloquer le démarrage.
set -e

run_migrations() {
  if [ "$RESET_DATABASE" = "true" ]; then
    echo "[startup] RESET_DATABASE=true — prisma migrate reset --force"
    npx prisma migrate reset --force
    return
  fi

  echo "[startup] prisma migrate deploy"
  if npx prisma migrate deploy; then
    return
  fi

  echo "[startup] migrate deploy a échoué (dérive db push probable). Auto-réparation : marquer appliquée 20260807000000_add_digest_sent_at puis réessayer."
  # Sémantiquement correct : la colonne notifications.digest_sent_at existe déjà
  # en prod (synchronisée par db push) — la marquer appliquée ne perd rien.
  npx prisma migrate resolve --applied 20260807000000_add_digest_sent_at \
    || echo "[startup] WARNING: resolve a échoué (peut-être déjà résolu) — on continue"
  echo "[startup] retry prisma migrate deploy"
  if npx prisma migrate deploy; then
    return
  fi

  echo "[startup] dérive non résolue par les migrations — synchronisation du schéma via db push (non destructif)"
  npx prisma db push --accept-data-loss=false \
    || { echo "[startup] ERROR: db push a échoué (changement destructif refusé)"; exit 1; }
}

run_migrations

if [ -n "$SEED_ADMIN_EMAIL" ]; then
  echo "[startup] SEED_ADMIN_EMAIL set — seeding super admin ($SEED_ADMIN_EMAIL)"
  npx ts-node prisma/seed.ts || echo "[startup] WARNING: seed failed (continuing)"
else
  echo "[startup] SEED_ADMIN_EMAIL not set — seed skipped"
fi

echo "[startup] starting API"
exec node dist/src/main
