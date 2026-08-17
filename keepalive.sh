#!/bin/sh
# ── Keep-alive cron: ping /health pour empêcher la mise en veille ──
# CONTOURNEMENT — la vraie correction est un plan payant Redis/Render.
set -e

# BACKEND_URL doit être fourni via envVars dans render.yaml
if [ -z "$BACKEND_URL" ]; then
  echo "[keepalive] BACKEND_URL non défini, skip."
  exit 0
fi

echo "[keepalive] Ping ${BACKEND_URL}/health ..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "${BACKEND_URL}/health" || echo "000")

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  echo "[keepalive] OK — HTTP ${HTTP_CODE}"
else
  echo "[keepalive] WARN — HTTP ${HTTP_CODE} (le serveur est peut-être en train de se réveiller)"
  exit 1
fi
