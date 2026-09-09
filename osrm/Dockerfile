# OSRM auto-hébergé — routage + map-matching (Madagascar).
#
# L'image de base est figée sur Debian bullseye : son apt est cassé (Release
# expirées + paquets openssl retirés du miroir). On NE fait donc AUCUN apt.
# L'extrait Geofabrik est téléchargé SUR L'HÔTE avant le build (voir
# osrm/prepare.sh) et copié dans le contexte — le build n'a besoin d'aucun
# accès réseau.
FROM ghcr.io/project-osrm/osrm-backend:v5.27.1 AS extract
WORKDIR /data
COPY madagascar.osm.pbf .
# osrm-extract/-partition/-customize : ~2-8 min, ~1-2 Go de pointe pendant customize.
RUN osrm-extract -p /opt/car.lua madagascar.osm.pbf && \
    osrm-partition madagascar.osrm && \
    osrm-customize madagascar.osrm && \
    rm madagascar.osm.pbf

FROM ghcr.io/project-osrm/osrm-backend:v5.27.1
COPY --from=extract /data/madagascar.osrm* /data/
EXPOSE 5000
# mld = multi-level Dijkstra (rapide, faible RAM au runtime).
CMD ["osrm-routed", "--algorithm", "mld", "--max-matching-size", "1000", "/data/madagascar.osrm"]
