#!/usr/bin/env sh
# Télécharge l'extrait OSM de Madagascar dans le contexte de build OSRM.
# À lancer AVANT `docker compose build osrm` (l'image de base a un apt cassé, on
# ne télécharge donc rien pendant le build).
#
#   sh osrm/prepare.sh && docker compose -f docker-compose.contabo.yml build osrm
set -eu
cd "$(dirname "$0")"
URL="https://download.geofabrik.de/africa/madagascar-latest.osm.pbf"
OUT="madagascar.osm.pbf"

if [ -f "$OUT" ] && [ "$(find "$OUT" -mtime -7 2>/dev/null)" ]; then
  echo "[osrm/prepare] $OUT déjà présent (< 7 j) — skip"
  exit 0
fi

echo "[osrm/prepare] téléchargement $URL"
if command -v curl >/dev/null 2>&1; then
  curl -fL --retry 3 -o "$OUT.tmp" "$URL"
else
  wget -O "$OUT.tmp" "$URL"
fi
mv "$OUT.tmp" "$OUT"
echo "[osrm/prepare] OK : $(du -h "$OUT" | cut -f1)"
