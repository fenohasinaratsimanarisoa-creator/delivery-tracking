#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────
# Provisioning initial d'une VM Oracle Cloud Always Free (Ampere A1, Ubuntu)
# pour héberger la stack delivery-tracking. Idempotent : peut être relancé
# sans risque si une étape a échoué.
#
# Usage (sur la VM, après connexion SSH) :
#   curl -fsSL https://raw.githubusercontent.com/<votre-org>/delivery-tracking/main/scripts/oracle-vm-setup.sh | bash
#   # ou, si le repo est déjà cloné :
#   bash scripts/oracle-vm-setup.sh
#
# Voir DEPLOYMENT.md § "Oracle Cloud (Always Free)" pour le contexte complet.
# ─────────────────────────────────────────────────────────────────────────
set -eu

DEPLOY_DIR="${DEPLOY_DIR:-/opt/delivery-tracking-staging}"

echo "══════════════════════════════════════════════════════"
echo " 1/4 — Mise à jour système + installation Docker"
echo "══════════════════════════════════════════════════════"
sudo apt-get update -qq
sudo apt-get upgrade -y -qq

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
  echo "Docker installé. Reconnectez-vous en SSH (ou lancez 'newgrp docker')"
  echo "pour que l'appartenance au groupe 'docker' soit prise en compte SANS sudo."
else
  echo "Docker déjà installé ($(docker --version))"
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "ERREUR: le plugin 'docker compose' n'est pas disponible après l'installation." >&2
  echo "Vérifiez manuellement : sudo apt-get install -y docker-compose-plugin" >&2
  exit 1
fi

echo ""
echo "══════════════════════════════════════════════════════"
echo " 2/4 — Pare-feu OS (iptables) — LE piège Oracle Cloud"
echo "══════════════════════════════════════════════════════"
echo "Les images Ubuntu d'Oracle Cloud bloquent TOUT sauf SSH via iptables,"
echo "EN PLUS de la Security List du VCN configurée dans la console. Les deux"
echo "doivent autoriser un port pour qu'il soit réellement accessible."

# Insertion en TÊTE de chaîne (-I INPUT 1, pas une position fixe arbitraire) :
# garantit que la règle ACCEPT est évaluée avant tout REJECT/DROP existant,
# quelle que soit la structure exacte des règles par défaut de l'image Oracle.
for port in 80 443 8082 5055 5056 5057 5058 5059 5060 5061 5062 5063 5064 5065; do
  sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null || \
    sudo iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
done

if command -v netfilter-persistent >/dev/null 2>&1; then
  sudo netfilter-persistent save
elif [ -d /etc/iptables ]; then
  sudo iptables-save | sudo tee /etc/iptables/rules.v4 > /dev/null
else
  sudo apt-get install -y -qq iptables-persistent
  sudo netfilter-persistent save
fi
echo "Règles iptables ouvertes et persistées : 80, 443, 8082, 5055-5065"
echo ""
echo "⚠️  N'OUBLIEZ PAS la seconde moitié du pare-feu : dans la console Oracle"
echo "    Cloud → votre instance → Subnet → Security Lists → Add Ingress Rules,"
echo "    ouvrez les MÊMES ports en source 0.0.0.0/0, protocole TCP."

echo ""
echo "══════════════════════════════════════════════════════"
echo " 3/4 — Répertoire de déploiement"
echo "══════════════════════════════════════════════════════"
sudo mkdir -p "$DEPLOY_DIR"
sudo chown "$USER":"$USER" "$DEPLOY_DIR"
echo "Répertoire prêt : $DEPLOY_DIR"
echo "→ Clonez-y le repo (git clone) ou copiez-y au moins :"
echo "   docker-compose.oracle.yml, Caddyfile, traccar/traccar.xml,"
echo "   scripts/backup.sh, osrm/, backend/, frontend/"
echo "→ Puis copiez .env.oracle.example en .env dans ce répertoire et remplissez-le."

echo ""
echo "══════════════════════════════════════════════════════"
echo " 4/4 — Clé SSH pour le déploiement GitHub Actions"
echo "══════════════════════════════════════════════════════"
KEY_PATH="$HOME/.ssh/deliverytrack_deploy"
if [ ! -f "$KEY_PATH" ]; then
  ssh-keygen -t ed25519 -f "$KEY_PATH" -N "" -C "github-actions-deploy"
  cat "$KEY_PATH.pub" >> "$HOME/.ssh/authorized_keys"
  chmod 600 "$HOME/.ssh/authorized_keys"
  echo "Clé générée : $KEY_PATH"
  echo ""
  echo "Copiez la CLÉ PRIVÉE ci-dessous dans le secret GitHub STAGING_SSH_KEY"
  echo "(Settings → Secrets and variables → Actions → New repository secret) :"
  echo "──────────────────────────────────────────────────────"
  cat "$KEY_PATH"
  echo "──────────────────────────────────────────────────────"
else
  echo "Clé de déploiement déjà présente : $KEY_PATH (rien à faire)"
fi

echo ""
echo "══════════════════════════════════════════════════════"
echo " Terminé."
echo "══════════════════════════════════════════════════════"
echo "Secrets GitHub à configurer (Settings → Secrets and variables → Actions) :"
echo "  STAGING_HOST = $(curl -s ifconfig.me 2>/dev/null || echo '<IP publique de la VM>')"
echo "  STAGING_USER = $USER"
echo "  STAGING_SSH_KEY = (contenu affiché ci-dessus, si généré)"
