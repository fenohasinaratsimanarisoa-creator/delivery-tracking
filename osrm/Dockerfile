FROM ghcr.io/project-osrm/osrm-backend:v5.27.1 AS extract

RUN apt-get update && apt-get install -y wget && rm -rf /var/lib/apt/lists/*

WORKDIR /data
RUN wget -O madagascar.osm.pbf https://download.geofabrik.de/africa/madagascar-latest.osm.pbf && \
    osrm-extract -p /opt/car.lua madagascar.osm.pbf && \
    osrm-partition madagascar.osrm && \
    osrm-customize madagascar.osrm && \
    rm madagascar.osm.pbf

FROM ghcr.io/project-osrm/osrm-backend:v5.27.1
COPY --from=extract /data/madagascar.osrm* /data/
EXPOSE 5000
CMD ["osrm-routed", "--algorithm", "mld", "/data/madagascar.osrm"]