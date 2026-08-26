#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────
# Déploiement automatique de DelivTrack sur un VPS Contabo (x86_64, IP
# directe, sans domaine/TLS). Idempotent : peut être relancé sans risque
# (mises à jour) — mais NE touche jamais à la base de données au-delà des
# migrations Prisma (jamais de reset/drop). Voir DEPLOYMENT.md pour le
# contexte complet et scripts/migrate-from-render.sh pour la migration
# initiale des données.
#
# Usage : bash deploy.sh
# ─────────────────────────────────────────────────────────────────────────
set -eu

REPO_URL="${REPO_URL:-}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/delivery-tracking}"
COMPOSE_FILE="docker-compose.contabo.yml"

echo "══════════════════════════════════════════════════════"
echo " 1/6 — Docker"
echo "══════════════════════════════════════════════════════"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
else
  echo "Docker déjà installé ($(docker --version))"
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "ERREUR: le plugin 'docker compose' est introuvable." >&2
  echo "Essayez : apt-get install -y docker-compose-plugin" >&2
  exit 1
fi

echo ""
echo "══════════════════════════════════════════════════════"
echo " 2/6 — Pare-feu (ports 80, 8080, 8082, 5055-5065)"
echo "══════════════════════════════════════════════════════"
# 5055-5065 = protocoles boîtiers GPS Traccar (GT06, Teltonika, H02, etc.) :
# sans ces ports ouverts, l'interface admin Traccar fonctionne mais AUCUN
# traceur GPS réel ne peut se connecter — la demande initiale (80/8080/8082)
# n'incluait pas ces ports, ajoutés ici car indispensables au fonctionnement
# réel de Traccar.
PORTS="80 8080 8082 5055 5056 5057 5058 5059 5060 5061 5062 5063 5064 5065"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  for port in $PORTS; do
    ufw allow "$port"/tcp
  done
  echo "Règles ufw ajoutées."
else
  for port in $PORTS; do
    iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null || \
      iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
  done
  if command -v netfilter-persistent >/dev/null 2>&1; then
    netfilter-persistent save
  elif [ -d /etc/iptables ]; then
    iptables-save > /etc/iptables/rules.v4
  fi
  echo "Règles iptables ajoutées (persistées si possible)."
fi

echo ""
echo "══════════════════════════════════════════════════════"
echo " 3/6 — Code source"
echo "══════════════════════════════════════════════════════"
if [ -d "$DEPLOY_DIR/.git" ]; then
  echo "Repo déjà présent — mise à jour (git pull)"
  cd "$DEPLOY_DIR"
  git fetch origin main
  git reset --hard origin/main
else
  if [ -z "$REPO_URL" ]; then
    echo "ERREUR: DEPLOY_DIR ($DEPLOY_DIR) n'existe pas encore et REPO_URL n'est pas défini." >&2
    echo "Relancez avec : REPO_URL=https://github.com/<org>/<repo>.git bash deploy.sh" >&2
    exit 1
  fi
  mkdir -p "$DEPLOY_DIR"
  git clone "$REPO_URL" "$DEPLOY_DIR"
  cd "$DEPLOY_DIR"
fi

echo ""
echo "══════════════════════════════════════════════════════"
echo " 4/6 — Configuration (.env)"
echo "══════════════════════════════════════════════════════"
if [ ! -f .env ]; then
  cp .env.contabo.example .env
  echo "⚠️  .env créé depuis le modèle — il contient des placeholders."
  echo "    Éditez-le maintenant (nano .env) puis relancez ce script :"
  echo "    - générez les secrets indiqués en commentaire (openssl rand -hex ...)"
  echo "    - remplacez <IP-DU-VPS> par l'IP publique réelle de cette machine"
  exit 1
fi
if grep -qE '<openssl rand|<IP-DU-VPS>|<changez le mot de passe' .env; then
  echo "ERREUR: .env contient encore des placeholders non remplis (grep <openssl / <IP-DU-VPS>)." >&2
  echo "Éditez .env avant de relancer — un déploiement avec des secrets factices n'est pas sûr." >&2
  exit 1
fi

echo ""
echo "══════════════════════════════════════════════════════"
echo " 5/6 — Build & démarrage des conteneurs"
echo "══════════════════════════════════════════════════════"
docker compose -f "$COMPOSE_FILE" build
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans
docker image prune -f

echo "Attente du démarrage de la base et du backend..."
for i in $(seq 1 30); do
  if docker compose -f "$COMPOSE_FILE" exec -T backend wget --spider -q http://localhost:3000/health 2>/dev/null; then
    break
  fi
  sleep 2
done

echo "Migrations Prisma..."
docker compose -f "$COMPOSE_FILE" exec -T backend npx prisma migrate deploy

# nginx (frontend) résout le nom 'backend' UNE SEULE FOIS au démarrage et garde
# cette IP en cache pour toute la durée du process (proxy_pass sur un host
# littéral, pas une variable — pas de re-résolution dynamique). Un déploiement
# qui ne touche que le backend laisse l'image frontend inchangée : Compose ne
# recrée alors pas 'frontend', qui continue de pointer vers l'IP de l'ANCIEN
# conteneur backend (détruit) → 502 Bad Gateway sur toute l'API, y compris le
# login, jusqu'au prochain redémarrage manuel de frontend. On force donc un
# redémarrage à chaque déploiement, backend-only ou pas.
echo "Redémarrage du frontend (nginx doit re-résoudre l'IP du backend)..."
docker compose -f "$COMPOSE_FILE" restart frontend

echo ""
echo "══════════════════════════════════════════════════════"
echo " 6/6 — Vérification"
echo "══════════════════════════════════════════════════════"
FAIL=0
curl -fsS http://localhost:8080/health && echo " → backend OK" || { echo " → backend KO"; FAIL=1; }
curl -fsS -o /dev/null http://localhost:80/ && echo " → frontend OK" || { echo " → frontend KO"; FAIL=1; }
curl -fsS -o /dev/null http://localhost:8082/ && echo " → traccar OK" || { echo " → traccar KO"; FAIL=1; }

echo ""
if [ "$FAIL" -eq 0 ]; then
  IP="$(curl -s ifconfig.me 2>/dev/null || echo '<IP-du-VPS>')"
  echo "✅ Déploiement terminé."
  echo "   App        : http://$IP"
  echo "   API directe: http://$IP:8080"
  echo "   Traccar    : http://$IP:8082 (identifiants par défaut admin/admin —"
  echo "                CHANGEZ-LES dans traccar/traccar.xml si pas déjà fait)"
  echo ""
  echo "Prochaine étape si besoin : migrer les données depuis Render avec"
  echo "  scripts/migrate-from-render.sh"
else
  echo "⚠️  Au moins un service ne répond pas — voir 'docker compose -f $COMPOSE_FILE logs' pour diagnostiquer."
  exit 1
fi
