FROM ghcr.io/project-osrm/osrm-backend:v5.27.1 AS extract

# L'image de base OSRM est figée sur Debian bullseye : ses fichiers Release apt
# ont expiré → `apt-get update` échoue (exit 100). On désactive le contrôle de
# date de validité (le seul paquet installé est `wget`, sans enjeu de sécurité).
# Alternative sans apt : télécharger l'extrait via `busybox wget` si présent.
RUN apt-get -o Acquire::Check-Valid-Until=false update \
    && apt-get install -y --no-install-recommends wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /data
# Graphe Madagascar (Geofabrik). osrm-extract/-partition/-customize : ~2-8 min
# selon la machine, ~1-2 Go de pointe pendant customize.
RUN wget -O madagascar.osm.pbf https://download.geofabrik.de/africa/madagascar-latest.osm.pbf && \
    osrm-extract -p /opt/car.lua madagascar.osm.pbf && \
    osrm-partition madagascar.osrm && \
    osrm-customize madagascar.osrm && \
    rm madagascar.osm.pbf

FROM ghcr.io/project-osrm/osrm-backend:v5.27.1
COPY --from=extract /data/madagascar.osrm* /data/
EXPOSE 5000
# mld = algorithme multi-level Dijkstra (rapide, faible RAM au runtime).
CMD ["osrm-routed", "--algorithm", "mld", "--max-matching-size", "1000", "/data/madagascar.osrm"]
