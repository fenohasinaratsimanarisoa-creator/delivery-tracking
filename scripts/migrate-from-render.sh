#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────
# Migration ponctuelle des données : base Postgres Render (production
# actuelle) → base Postgres locale de ce VPS (docker-compose.contabo.yml).
#
# VOLONTAIREMENT séparé de deploy.sh : c'est une opération à exécuter UNE
# FOIS (pas à chaque déploiement), qui lit dans la base de PRODUCTION. Un
# garde-fou refuse de continuer si la base cible contient déjà des données
# (évite un import en double ou un écrasement accidentel).
#
# Prérequis :
#   - RENDER_DATABASE_URL = la chaîne de connexion EXTERNE de Render (PAS
#     l'interne) : Render dashboard → base de données → "External
#     Database URL". L'interne (utilisée par render.yaml) n'est joignable
#     que depuis les services Render eux-mêmes, pas depuis ce VPS.
#   - la stack Contabo doit déjà tourner (docker compose ... up -d), sinon
#     il n'y a pas de base cible à remplir.
#
# Usage :
#   RENDER_DATABASE_URL="postgresql://user:pass@xxx.frankfurt-postgres.render.com/delivery_tracking" \
#     bash scripts/migrate-from-render.sh
# ─────────────────────────────────────────────────────────────────────────
set -eu

COMPOSE_FILE="docker-compose.contabo.yml"

if [ -z "${RENDER_DATABASE_URL:-}" ]; then
  echo "ERREUR: RENDER_DATABASE_URL non défini." >&2
  echo "Récupérez la chaîne de connexion EXTERNE depuis le dashboard Render" >&2
  echo "(base de données → Connections → External Database URL), puis :" >&2
  echo '  RENDER_DATABASE_URL="postgresql://..." bash scripts/migrate-from-render.sh' >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo "ERREUR: .env introuvable — lancez ce script depuis le répertoire de déploiement." >&2
  exit 1
fi
# shellcheck disable=SC1091
set -a; . ./.env; set +a

echo "══════════════════════════════════════════════════════"
echo " Vérification : la base cible est-elle déjà peuplée ?"
echo "══════════════════════════════════════════════════════"
EXISTING_USERS="$(docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U "${POSTGRES_USER:-delivery_app}" -d "${POSTGRES_DB:-delivery_tracking}" \
  -tAc "SELECT count(*) FROM users;" 2>/dev/null || echo "0")"

if [ "$EXISTING_USERS" != "0" ] && [ "${FORCE:-}" != "true" ]; then
  echo "ERREUR: la base cible contient déjà $EXISTING_USERS utilisateur(s)." >&2
  echo "Pour forcer quand même (ÉCRASERA les données existantes) : FORCE=true bash $0" >&2
  exit 1
fi

echo ""
echo "══════════════════════════════════════════════════════"
echo " Dump de la base Render (source)"
echo "══════════════════════════════════════════════════════"
DUMP_FILE="/tmp/render_export_$(date +%Y%m%d_%H%M%S).sql"
docker run --rm postgis/postgis:16-3.4 pg_dump --no-owner --no-privileges --clean --if-exists \
  "$RENDER_DATABASE_URL" > "$DUMP_FILE"
echo "Dump récupéré : $DUMP_FILE ($(du -h "$DUMP_FILE" | cut -f1))"

echo ""
echo "══════════════════════════════════════════════════════"
echo " Restauration dans la base locale (cible)"
echo "══════════════════════════════════════════════════════"
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U "${POSTGRES_USER:-delivery_app}" -d "${POSTGRES_DB:-delivery_tracking}" < "$DUMP_FILE"

echo ""
echo "══════════════════════════════════════════════════════"
echo " Vérification post-migration"
echo "══════════════════════════════════════════════════════"
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U "${POSTGRES_USER:-delivery_app}" -d "${POSTGRES_DB:-delivery_tracking}" \
  -c "SELECT count(*) AS users FROM users; SELECT count(*) AS companies FROM companies;"

rm -f "$DUMP_FILE"
echo ""
echo "✅ Migration terminée. Vérifiez les chiffres ci-dessus par rapport à Render"
echo "   avant de considérer la migration comme validée."
